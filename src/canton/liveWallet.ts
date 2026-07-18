// Live Canton wallet client for Damlnaut. Replaces the retired
// local-session-wallet flow entirely: no localStorage, no backend party
// allocation. All player identity + signing comes from a CIP-103 wallet
// discovered via @canton-network/dapp-sdk.
//
// Backend responsibilities are now:
//   - own the damlnaut-issuer party (its own participant)
//   - seed FlagIssuer contracts (per level)
//   - seed Level 1 markets on demand for a player
//   - exercise IssueFlag when /api/levels/N/verify is called
//
// Everything else — Level0Instance create, SubmitLevel0, Level1 Position
// create, Settle — goes browser -> wallet -> wallet's own participant.

import { dappSDK, type ListAccountsResult, type Wallet } from '@canton-network/dapp-sdk';
import {
  CHOICE_SETTLE,
  CHOICE_SUBMIT_LEVEL0,
  ENT_FLAG,
  ENT_FLAG_PROOF,
  ENT_LEVEL0_INSTANCE,
  ENT_MARKET,
  ENT_POSITION,
  LEVEL0_LEVEL_TAG,
  LEVEL1_LEVEL_TAG,
  LEVEL1_POSITION_SIZE,
  MOD_FLAG_ISSUER,
  MOD_LEVEL0,
  MOD_LEVEL1,
  templateId,
  type FlagPayload,
  type FlagProofRecord,
  type FlagRecord,
  type Level0InstancePayload,
  type Level0InstanceRecord,
  type MarketPayload,
  type MarketRecord,
  type PositionPayload,
  type PositionRecord,
} from '../../shared/damlnaut';
import { matchesTemplateIdBrowser } from './templateMatch';

export type WalletSnapshot = {
  party: string;
  hint: string;
  networkId: string;
  namespace: string;
  providerName: string;
};

export type LiveWalletSession = {
  snapshot: WalletSnapshot;
  ledger: DamlnautLiveLedger;
};

let sdkInitPromise: Promise<void> | null = null;

/** Idempotent SDK init. Safe to call from every mount. */
export function initLiveWallet(): Promise<void> {
  if (!sdkInitPromise) {
    sdkInitPromise = dappSDK.init().catch((err) => {
      sdkInitPromise = null;
      throw err;
    });
  }
  return sdkInitPromise;
}

/** Open the wallet picker + connect. Returns the primary wallet account. */
export async function connectLiveWallet(issuer: string): Promise<LiveWalletSession> {
  await initLiveWallet();
  const connect = await dappSDK.connect();
  if (!connect.isConnected) {
    throw new Error(
      connect.reason ?? 'Wallet refused to connect. Try again from the wallet extension.',
    );
  }
  const accounts = await dappSDK.listAccounts();
  const primary = pickPrimary(accounts);
  if (!primary) {
    throw new Error('Wallet returned no accounts. Allocate a party in the wallet first.');
  }
  const status = await dappSDK.status();
  const snapshot: WalletSnapshot = {
    party: primary.partyId,
    hint: primary.hint,
    networkId: primary.networkId,
    namespace: primary.namespace,
    providerName: status.provider.id,
  };
  return {
    snapshot,
    ledger: new DamlnautLiveLedger(snapshot, issuer),
  };
}

export async function disconnectLiveWallet(): Promise<void> {
  try {
    await dappSDK.disconnect();
  } catch {
    // Wallet may already be disconnected; swallow.
  }
}

/**
 * Attempt a silent resume — if the SDK has a persisted session, we get
 * a connected status back without opening the picker.
 */
export async function tryResumeLiveWallet(issuer: string): Promise<LiveWalletSession | null> {
  try {
    await initLiveWallet();
    const state = await dappSDK.isConnected();
    if (!state.isConnected) return null;
    const accounts = await dappSDK.listAccounts();
    const primary = pickPrimary(accounts);
    if (!primary) return null;
    const status = await dappSDK.status();
    const snapshot: WalletSnapshot = {
      party: primary.partyId,
      hint: primary.hint,
      networkId: primary.networkId,
      namespace: primary.namespace,
      providerName: status.provider.id,
    };
    return { snapshot, ledger: new DamlnautLiveLedger(snapshot, issuer) };
  } catch {
    return null;
  }
}

function pickPrimary(accounts: ListAccountsResult): Wallet | null {
  if (!accounts?.length) return null;
  return accounts.find((a) => a.primary) ?? accounts[0];
}

// -----------------------------------------------------------------------------
// Per-level ledger operations
// -----------------------------------------------------------------------------

type CreatedEvent = {
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
};

type ActiveContractEntry = {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent: CreatedEvent;
    };
  };
};

export class DamlnautLiveLedger {
  constructor(readonly snapshot: WalletSnapshot, readonly issuer: string) {}

  get party(): string {
    return this.snapshot.party;
  }

  // ---- reads ---------------------------------------------------------------

  private async activeContractsForSelf(): Promise<CreatedEvent[]> {
    const endResult = (await dappSDK.ledgerApi({
      requestMethod: 'get',
      resource: '/v2/state/ledger-end',
    })) as { offset: number };
    const offset = endResult.offset ?? 0;
    const query = {
      eventFormat: {
        filtersByParty: {
          [this.party]: {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              },
            ],
          },
        },
        filtersForAnyParty: {
          cumulative: [
            {
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            },
          ],
        },
        verbose: false,
      },
      verbose: false,
      activeAtOffset: offset,
    };
    const acs = (await dappSDK.ledgerApi({
      requestMethod: 'post',
      resource: '/v2/state/active-contracts',
      body: query,
    })) as ActiveContractEntry[] | { contracts?: ActiveContractEntry[] };
    const entries = Array.isArray(acs) ? acs : (acs.contracts ?? []);
    return entries
      .map((e) => e.contractEntry?.JsActiveContract?.createdEvent)
      .filter((e): e is CreatedEvent => !!e);
  }

  async findLevel0Instance(): Promise<Level0InstanceRecord | null> {
    const events = await this.activeContractsForSelf();
    const tid = templateId(MOD_LEVEL0, ENT_LEVEL0_INSTANCE);
    const found = events.find(
      (e) =>
        matchesTemplateIdBrowser(e.templateId, tid) &&
        (e.createArgument.player as string) === this.party,
    );
    return found ? toRecord<Level0InstancePayload>(found) : null;
  }

  async findLevel1Markets(): Promise<MarketRecord[]> {
    const events = await this.activeContractsForSelf();
    const tid = templateId(MOD_LEVEL1, ENT_MARKET);
    return events
      .filter(
        (e) =>
          matchesTemplateIdBrowser(e.templateId, tid) &&
          (e.createArgument.player as string) === this.party,
      )
      .map((e) => toRecord<MarketPayload>(e));
  }

  async findLevel1Position(): Promise<PositionRecord | null> {
    const events = await this.activeContractsForSelf();
    const tid = templateId(MOD_LEVEL1, ENT_POSITION);
    const found = events.find(
      (e) =>
        matchesTemplateIdBrowser(e.templateId, tid) &&
        (e.createArgument.player as string) === this.party,
    );
    return found ? toRecord<PositionPayload>(found) : null;
  }

  async findFlag(level: string = LEVEL0_LEVEL_TAG): Promise<FlagRecord | null> {
    const events = await this.activeContractsForSelf();
    const tid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
    const found = events.find(
      (e) =>
        matchesTemplateIdBrowser(e.templateId, tid) &&
        (e.createArgument.solver as string) === this.party &&
        (e.createArgument.level as string) === level,
    );
    return found ? toRecord<FlagPayload>(found) : null;
  }

  // ---- Level 0 -------------------------------------------------------------

  async createLevel0Instance(instanceId: string): Promise<Level0InstanceRecord> {
    const payload: Level0InstancePayload = {
      player: this.party,
      issuer: this.issuer,
      instanceId,
      instructions: 'Exercise SubmitLevel0 to mint a FlagProof visible to the issuer.',
    };
    await dappSDK.prepareExecuteAndWait({
      commandId: `l0-boot-${instanceId}`,
      actAs: [this.party],
      commands: [
        {
          CreateCommand: {
            templateId: templateId(MOD_LEVEL0, ENT_LEVEL0_INSTANCE),
            createArguments: payload,
          },
        },
      ],
    });
    const created = await this.findLevel0Instance();
    if (!created) {
      throw new Error('Level0Instance was created but is not visible on refresh.');
    }
    return created;
  }

  async submitLevel0(instance: Level0InstanceRecord): Promise<FlagProofRecord> {
    const result = await dappSDK.prepareExecuteAndWait({
      commandId: `l0-solve-${instance.payload.instanceId}`,
      actAs: [this.party],
      commands: [
        {
          ExerciseCommand: {
            templateId: instance.templateId,
            contractId: instance.contractId,
            choice: CHOICE_SUBMIT_LEVEL0,
            choiceArgument: {},
          },
        },
      ],
    });
    const events = await this.activeContractsForSelf();
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = events.find(
      (e) =>
        matchesTemplateIdBrowser(e.templateId, proofTid) &&
        (e.createArgument.solver as string) === this.party &&
        (e.createArgument.instanceId as string) === instance.payload.instanceId,
    );
    if (!proof) {
      throw new Error('SubmitLevel0 executed but no FlagProof is visible.');
    }
    return {
      ...toRecord<FlagProofRecord['payload']>(proof),
      updateId: result.tx.payload.updateId,
    };
  }

  // ---- Level 1 -------------------------------------------------------------

  async createLevel1Position(marketCid: string, instanceId: string): Promise<PositionRecord> {
    const payload: PositionPayload = {
      player: this.party,
      curator: this.issuer,
      market: marketCid,
      size: LEVEL1_POSITION_SIZE,
      instanceId,
    };
    await dappSDK.prepareExecuteAndWait({
      commandId: `l1-open-${instanceId}`,
      actAs: [this.party],
      commands: [
        {
          CreateCommand: {
            templateId: templateId(MOD_LEVEL1, ENT_POSITION),
            createArguments: payload as unknown as Record<string, unknown>,
          },
        },
      ],
    });
    const created = await this.findLevel1Position();
    if (!created) {
      throw new Error('Position was created but is not visible on refresh.');
    }
    return created;
  }

  async settleLevel1(position: PositionRecord, marketCid: string): Promise<FlagProofRecord> {
    const result = await dappSDK.prepareExecuteAndWait({
      commandId: `l1-settle-${position.payload.instanceId}`,
      actAs: [this.party],
      commands: [
        {
          ExerciseCommand: {
            templateId: position.templateId,
            contractId: position.contractId,
            choice: CHOICE_SETTLE,
            choiceArgument: { marketCid },
          },
        },
      ],
    });
    const events = await this.activeContractsForSelf();
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = events.find(
      (e) =>
        matchesTemplateIdBrowser(e.templateId, proofTid) &&
        (e.createArgument.solver as string) === this.party &&
        (e.createArgument.level as string) === LEVEL1_LEVEL_TAG,
    );
    if (!proof) {
      throw new Error('Settle executed but no Level 1 FlagProof is visible.');
    }
    return {
      ...toRecord<FlagProofRecord['payload']>(proof),
      updateId: result.tx.payload.updateId,
    };
  }
}

function toRecord<T>(event: CreatedEvent): { contractId: string; templateId: string; payload: T } {
  return {
    contractId: event.contractId,
    templateId: event.templateId,
    payload: event.createArgument as unknown as T,
  };
}
