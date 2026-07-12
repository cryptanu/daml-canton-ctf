// Browser-side wrapper around the Daml SDK JSON Ledger API v2. Modelled on
// the shape of `@daml/ledger` (create / exercise / query) so the level
// components read like idiomatic Daml SDK code.

import { JsonApiClient, type CreatedEvent } from '../../shared/jsonLedgerApi';
import {
  CHOICE_SETTLE,
  CHOICE_SUBMIT_LEVEL0,
  DAMLNAUT_USER_ID,
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
  type WalletConnectResponse,
} from '../../shared/damlnaut';
import { matchesTemplateIdBrowser } from './templateMatch';

export type WalletSession = {
  connection: WalletConnectResponse;
  ledger: DamlnautLedger;
};

const WALLET_STORAGE_KEY = 'damlnaut:wallet:v1';

export type StoredWallet = {
  party: string;
  networkId: string;
  savedAt: number;
};

export function loadStoredWallet(): StoredWallet | null {
  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWallet;
    return typeof parsed?.party === 'string' && parsed.party.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredWallet(wallet: StoredWallet) {
  try {
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
  } catch {
    // localStorage may be disabled (private mode, quota) — just skip.
  }
}

export function clearStoredWallet() {
  try {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Ask the Damlnaut backend to allocate a party for us, then build a client
 * that talks directly to the Canton JSON Ledger API. All subsequent ledger
 * traffic goes browser -> canton, not through our backend.
 */
export async function connectWallet(
  backendUrl: string,
  partyIdHint?: string,
): Promise<WalletSession> {
  return openSession(`${backendUrl}/api/wallet/connect`, { partyIdHint });
}

/**
 * Rehydrate a previously-allocated party. The backend verifies the party
 * still exists on the participant before returning success.
 */
export async function resumeWallet(backendUrl: string, party: string): Promise<WalletSession> {
  return openSession(`${backendUrl}/api/wallet/resume`, { party });
}

async function openSession(url: string, body: unknown): Promise<WalletSession> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const payload = safeJson(text);
    throw new Error(payload?.error ?? `Wallet request failed: ${response.status}`);
  }
  const connection = JSON.parse(text) as WalletConnectResponse;
  const ledger = new DamlnautLedger(connection);
  return { connection, ledger };
}

export class DamlnautLedger {
  private readonly api: JsonApiClient;

  constructor(private readonly connection: WalletConnectResponse) {
    this.api = new JsonApiClient({ baseUrl: connection.jsonApiUrl });
  }

  get party(): string {
    return this.connection.party;
  }

  get issuer(): string {
    return this.connection.issuer;
  }

  async findFlag(level: string = LEVEL0_LEVEL_TAG): Promise<FlagRecord | null> {
    const events = await this.api.activeContractsFor(this.party);
    const tid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
    const found = events.find(
      (event) =>
        matchesTemplateIdBrowser(event.templateId, tid) &&
        (event.createArgument.solver as string) === this.party &&
        (event.createArgument.level as string) === level,
    );
    return found ? recordFromEvent<FlagPayload>(found) : null;
  }

  // ---------------------------------------------------------------------------
  // Level 1 — market rebinding
  // ---------------------------------------------------------------------------

  async findLevel1Markets(): Promise<MarketRecord[]> {
    const events = await this.api.activeContractsFor(this.party);
    const tid = templateId(MOD_LEVEL1, ENT_MARKET);
    return events
      .filter(
        (event) =>
          matchesTemplateIdBrowser(event.templateId, tid) &&
          (event.createArgument.player as string) === this.party,
      )
      .map((event) => recordFromEvent<MarketPayload>(event));
  }

  async findLevel1Position(): Promise<PositionRecord | null> {
    const events = await this.api.activeContractsFor(this.party);
    const tid = templateId(MOD_LEVEL1, ENT_POSITION);
    const found = events.find(
      (event) =>
        matchesTemplateIdBrowser(event.templateId, tid) &&
        (event.createArgument.player as string) === this.party,
    );
    return found ? recordFromEvent<PositionPayload>(found) : null;
  }

  async createLevel1Position(marketCid: string, instanceId: string): Promise<PositionRecord> {
    const payload: PositionPayload = {
      player: this.party,
      curator: this.issuer,
      market: marketCid,
      size: LEVEL1_POSITION_SIZE,
      instanceId,
    };
    await this.api.submitAndWait({
      userId: this.connection.userId || DAMLNAUT_USER_ID,
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
      throw new Error('Position was created but not visible on refresh.');
    }
    return created;
  }

  async settleLevel1(
    position: PositionRecord,
    marketCid: string,
  ): Promise<FlagProofRecord> {
    const submit = await this.api.submitAndWait({
      userId: this.connection.userId || DAMLNAUT_USER_ID,
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
    const proofEvents = await this.api.activeContractsFor(this.party, {
      atOffset: submit.completionOffset,
    });
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = proofEvents.find(
      (event) =>
        matchesTemplateIdBrowser(event.templateId, proofTid) &&
        (event.createArgument.solver as string) === this.party &&
        (event.createArgument.level as string) === LEVEL1_LEVEL_TAG,
    );
    if (!proof) {
      throw new Error('Settle executed but no Level 1 FlagProof is visible.');
    }
    const record = recordFromEvent<FlagProofRecord['payload']>(proof);
    return { ...record, updateId: submit.updateId };
  }

  async findLevel0Instance(): Promise<Level0InstanceRecord | null> {
    const events = await this.api.activeContractsFor(this.party);
    const tid = templateId(MOD_LEVEL0, ENT_LEVEL0_INSTANCE);
    const found = events.find(
      (event) =>
        matchesTemplateIdBrowser(event.templateId, tid) &&
        (event.createArgument.player as string) === this.party,
    );
    return found ? recordFromEvent<Level0InstancePayload>(found) : null;
  }

  async createLevel0Instance(instanceId: string): Promise<Level0InstanceRecord> {
    const payload: Level0InstancePayload = {
      player: this.party,
      issuer: this.issuer,
      instanceId,
      instructions: 'Exercise SubmitLevel0 through the wallet to mint a FlagProof.',
    };
    await this.api.submitAndWait({
      userId: this.connection.userId || DAMLNAUT_USER_ID,
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
      throw new Error('Level0Instance was created but not visible on refresh.');
    }
    return created;
  }

  async submitLevel0(instance: Level0InstanceRecord): Promise<FlagProofRecord> {
    const submit = await this.api.submitAndWait({
      userId: this.connection.userId || DAMLNAUT_USER_ID,
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
    const proofEvents = await this.api.activeContractsFor(this.party, {
      atOffset: submit.completionOffset,
    });
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = proofEvents.find(
      (event) =>
        matchesTemplateIdBrowser(event.templateId, proofTid) &&
        (event.createArgument.solver as string) === this.party &&
        (event.createArgument.instanceId as string) === instance.payload.instanceId,
    );
    if (!proof) {
      throw new Error('SubmitLevel0 executed but no FlagProof is visible.');
    }
    const record = recordFromEvent<FlagProofRecord['payload']>(proof);
    return { ...record, updateId: submit.updateId };
  }
}

function recordFromEvent<T>(event: CreatedEvent): { contractId: string; templateId: string; payload: T } {
  return {
    contractId: event.contractId,
    templateId: event.templateId,
    payload: event.createArgument as unknown as T,
  };
}

function safeJson(text: string): { error?: string } | null {
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return null;
  }
}
