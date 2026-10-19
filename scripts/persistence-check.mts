import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LedgerContext } from '../server/ledgerContext.ts';
import { templateId } from '../shared/damlnaut.ts';

const ledger = new LedgerContext('http://127.0.0.1:17575');
const statePath = new URL("../deploy/persistence/evidence.json", import.meta.url);
const boot = await ledger.ensureReady();
const cid = (events, entity) => {
  const event = events.find(e => e.templateId.endsWith(`:${entity}`));
  assert(event, `Missing ${entity}`);
  return event.contractId;
};
const submit = async (party, command) => ledger.client.submitAndWait({
  userId: 'damlnaut-app', commandId: randomUUID(), actAs: [party], commands: [command],
});
const allocate = async () => (await ledger.client.allocateParty({
  partyIdHint: `persist-${randomUUID()}`,
  synchronizerId: await ledger.resolveSynchronizerId(),
})).partyDetails.party;

if (process.argv[2] === 'verify') {
  const prior = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(boot.issuer, prior.issuer);
  assert.deepEqual(boot.flagIssuers, prior.flagIssuers);
  assert.equal(await ledger.resolveSynchronizerId(), prior.synchronizer);
  for (const item of prior.contracts) {
    assert(await ledger.partyExists(item.party));
    const events = await ledger.client.activeContractsFor(item.party);
    assert(events.some(e => e.contractId === item.cid), `Lost ${item.cid}`);
  }
  await allocate();
  console.log('PASS: identical issuer, issuer contracts, synchronizer, player parties and recorded contracts; new write succeeded.');
} else {
  const contracts = [];
  const party = await allocate();
  await submit(party, { CreateAndExerciseCommand: {
    templateId: templateId('Damlnaut.Level0', 'Level0Instance'),
    createArguments: { player: party, issuer: boot.issuer, instanceId: randomUUID(), instructions: 'Persistence test' },
    choice: 'SubmitLevel0', choiceArgument: {},
  }});
  const zero = await ledger.verifyLevel0(party);
  assert(zero.flag, zero.message);
  contracts.push({ party, cid: zero.flag.contractId });
  for (const symbol of ['ALPHA', 'BETA', 'GAMMA']) {
    const player = await allocate();
    const markets = await ledger.bootstrapLevel1(player);
    assert.equal(markets.length, 3);
    const alpha = markets.find(e => e.createArgument.symbol === 'ALPHA');
    const target = markets.find(e => e.createArgument.symbol === symbol);
    assert(alpha && target);
    await submit(player, { CreateAndExerciseCommand: {
      templateId: templateId('Damlnaut.Level1', 'Position'),
      createArguments: { player, curator: boot.issuer, market: alpha.contractId, size: '1.0', instanceId: randomUUID() },
      choice: 'Settle', choiceArgument: { marketCid: target.contractId },
    }});
    const result = await ledger.verifyLevel1(player);
    assert.equal(Boolean(result.flag), symbol !== 'ALPHA', result.message);
    contracts.push({ party: player, cid: target.contractId });
    if (result.flag) contracts.push({ party: player, cid: result.flag.contractId });
    console.log(`PASS: ${symbol} submission succeeds, flag=${Boolean(result.flag)}`);
  }
  await writeFile(statePath, JSON.stringify({ issuer: boot.issuer, flagIssuers: boot.flagIssuers,
    synchronizer: await ledger.resolveSynchronizerId(), contracts }, null, 2));
  console.log('PASS: Level 0 flag and Level 1 outcomes; saved persistence evidence.');
}
