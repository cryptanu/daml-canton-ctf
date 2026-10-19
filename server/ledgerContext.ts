import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonApiClient, type CreatedEvent } from '../shared/jsonLedgerApi.js';
import {
  CHOICE_ISSUE_FLAG,
  DAML_JSON_API_URL_DEFAULT,
  DAMLNAUT_ISSUER_HINT,
  DAMLNAUT_USER_ID,
  ENT_FLAG,
  ENT_FLAG_ISSUER,
  ENT_FLAG_PROOF,
  ENT_MARKET,
  ENT_POSITION,
  LEVEL0_LEVEL_TAG,
  LEVEL1_LEVEL_TAG,
  LEVEL1_MARKET_CONFIGS,
  LEVEL_ISSUER_CONFIGS,
  MOD_FLAG_ISSUER,
  MOD_LEVEL1,
  templateId,
  type LevelIssuerConfig,
} from '../shared/damlnaut.js';

// LedgerContext owns the backend's identity on the Canton ledger. It
// allocates a stable damlnaut-issuer party the first time the backend
// runs against a fresh sandbox and remembers the resulting party id.
// It also caches the per-level FlagIssuer contract-ids so the verifier
// can exercise IssueFlag without re-querying every time.

export type BootstrapState = {
  jsonApiUrl: string;
  issuer: string;
  /** level -> FlagIssuer contract id */
  flagIssuers: Record<string, string>;
  ready: boolean;
  bootError: string | null;
};

export class LedgerContext {
  readonly jsonApiUrl: string;
  readonly client: JsonApiClient;
  private state: BootstrapState;
  private bootPromise: Promise<BootstrapState> | null = null;
  private synchronizerIdPromise: Promise<string> | null = null;

  constructor(jsonApiUrl: string = DAML_JSON_API_URL_DEFAULT) {
    this.jsonApiUrl = jsonApiUrl;
    this.client = new JsonApiClient({ baseUrl: jsonApiUrl });
    this.state = {
      jsonApiUrl,
      issuer: '',
      flagIssuers: {},
      ready: false,
      bootError: null,
    };
  }

  getState(): BootstrapState {
    return { ...this.state, flagIssuers: { ...this.state.flagIssuers } };
  }

  /**
   * Does `party` still exist on this participant? Used to validate a
   * localStorage-restored party id before the browser trusts it.
   */
  async partyExists(party: string): Promise<boolean> {
    try {
      const parties = await this.client.listParties();
      return parties.some((p) => p.party === party);
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<BootstrapState> {
    if (this.state.ready) return this.state;
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  /** Directories scanned for DARs to push at boot / on demand. */
  static darDirs(): string[] {
    return (process.env.DAR_DIRS ?? 'packages:.daml/dist').split(':');
  }

  async listLocalDars(): Promise<string[]> {
    const found: string[] = [];
    for (const dir of LedgerContext.darDirs()) {
      try {
        for (const f of await readdir(dir)) {
          if (f.endsWith('.dar')) found.push(path.join(dir, f));
        }
      } catch {
        // directory absent — fine
      }
    }
    return found;
  }

  /** Upload every local DAR. Canton treats re-uploads of known packages as no-ops. */
  async uploadLocalDars(): Promise<string[]> {
    const uploaded: string[] = [];
    for (const file of await this.listLocalDars()) {
      await this.client.uploadDar(new Uint8Array(await readFile(file)));
      uploaded.push(file);
    }
    return uploaded;
  }

  /** Canton reachability + package count, for /api/health. */
  async probeCanton(): Promise<{ reachable: boolean; packageCount: number; error: string | null }> {
    try {
      const ids = await this.client.listPackageIds();
      return { reachable: true, packageCount: ids.length, error: null };
    } catch (error) {
      return {
        reachable: false,
        packageCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async boot(): Promise<BootstrapState> {
    try {
      if (process.env.DAR_AUTO_UPLOAD !== '0') {
        const uploaded = await this.uploadLocalDars();
        if (uploaded.length) console.log(`[damlnaut] uploaded DARs: ${uploaded.join(', ')}`);
      }
      const issuer = await this.resolveIssuerParty();
      // Wallet Gateway grants party rights to this participant user when a
      // player creates a party; it must already exist.
      await this.client.ensureUser(process.env.GATEWAY_LEDGER_USER ?? 'damlnaut-user');
      const flagIssuers: Record<string, string> = {};
      for (const config of LEVEL_ISSUER_CONFIGS) {
        flagIssuers[config.level] = await this.ensureFlagIssuer(issuer, config);
      }
      this.state = {
        jsonApiUrl: this.jsonApiUrl,
        issuer,
        flagIssuers,
        ready: true,
        bootError: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, bootError: message };
      this.bootPromise = null; // allow retry
      throw error;
    }
    return this.state;
  }

  /**
   * Look for an existing party whose hint prefix matches the issuer hint;
   * allocate a new one only if none exists. This keeps the FlagIssuer
   * contracts stable across backend restarts on the same sandbox.
   */
  private async resolveIssuerParty(): Promise<string> {
    try {
      const parties = await this.client.listParties();
      const existing = parties.find(
        (p) => p.party.split('::')[0].toLowerCase() === DAMLNAUT_ISSUER_HINT.toLowerCase(),
      );
      if (existing) return existing.party;
    } catch {
      // Some sandbox versions gate /v2/parties GET behind auth; fall through.
    }
    try {
      const allocated = await this.client.allocateParty({
        partyIdHint: DAMLNAUT_ISSUER_HINT,
        synchronizerId: await this.resolveSynchronizerId(),
      });
      return allocated.partyDetails.party;
    } catch (error) {
      if (isPartyAlreadyExistsError(error)) {
        const parties = await this.client.listParties();
        const existing = parties.find(
          (p) => p.party.split('::')[0].toLowerCase() === DAMLNAUT_ISSUER_HINT.toLowerCase(),
        );
        if (existing) return existing.party;
      }
      throw error;
    }
  }

  async resolveSynchronizerId(): Promise<string> {
    if (!this.synchronizerIdPromise) {
      this.synchronizerIdPromise = this.loadSynchronizerId();
    }
    return this.synchronizerIdPromise;
  }

  private async loadSynchronizerId(): Promise<string> {
    const response = await this.client.connectedSynchronizers();
    const connected = response.connectedSynchronizers.find(
      (entry) => entry.permission !== 'PARTICIPANT_PERMISSION_UNSPECIFIED',
    ) ?? response.connectedSynchronizers[0];
    if (!connected?.synchronizerId) {
      this.synchronizerIdPromise = null;
      throw new Error('No connected synchronizer is available for party allocation.');
    }
    return connected.synchronizerId;
  }

  private async ensureFlagIssuer(issuer: string, config: LevelIssuerConfig): Promise<string> {
    const events = await this.client.activeContractsFor(issuer);
    const tid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_ISSUER);
    const match = events.find(
      (event) =>
        matchesTemplateId(event.templateId, tid) &&
        (event.createArgument.issuer as string) === issuer &&
        (event.createArgument.level as string) === config.level,
    );
    if (match) return match.contractId;

    const submit = await this.client.submitAndWait({
      userId: DAMLNAUT_USER_ID,
      commandId: `flag-issuer-boot-${config.level}-${Date.now()}`,
      actAs: [issuer],
      commands: [
        {
          CreateCommand: {
            templateId: tid,
            createArguments: {
              issuer,
              level: config.level,
              expectedProof: config.expectedProof,
              flagValue: config.flagValue,
            },
          },
        },
      ],
    });
    const after = await this.client.activeContractsFor(issuer, {
      atOffset: submit.completionOffset,
    });
    const fresh = after.find(
      (event) =>
        matchesTemplateId(event.templateId, tid) &&
        (event.createArgument.issuer as string) === issuer &&
        (event.createArgument.level as string) === config.level,
    );
    if (!fresh) {
      throw new Error(`FlagIssuer bootstrap for ${config.level} succeeded but the contract was not visible.`);
    }
    return fresh.contractId;
  }

  // ---------------------------------------------------------------------------
  // Level 0 — verifier
  // ---------------------------------------------------------------------------

  async verifyLevel0(solver: string): Promise<VerifyOutcome> {
    return this.verifyGeneric(solver, LEVEL0_LEVEL_TAG);
  }

  // ---------------------------------------------------------------------------
  // Level 1 — market seeding + verifier
  // ---------------------------------------------------------------------------

  /**
   * Seed the configured Level 1 markets for `player` if they don't already exist.
   * These markets are signed by the issuer (curator) and observed by the
   * player, which is what makes them settleable through the vulnerable
   * Position.Settle choice.
   */
  async bootstrapLevel1(player: string): Promise<CreatedEvent[]> {
    const state = await this.ensureReady();
    const marketTid = templateId(MOD_LEVEL1, ENT_MARKET);

    const seed = async (symbol: string, price: string) => {
      // First: does a Market with this symbol observed by the player
      // already exist? If so, skip creation.
      const existing = await this.client.activeContractsFor(state.issuer);
      const found = existing.find(
        (event) =>
          matchesTemplateId(event.templateId, marketTid) &&
          (event.createArgument.player as string) === player &&
          (event.createArgument.symbol as string) === symbol,
      );
      if (found) return found;

      const submit = await this.client.submitAndWait({
        userId: DAMLNAUT_USER_ID,
        commandId: `mkt-${symbol}-${player.slice(-6)}-${Date.now()}`,
        actAs: [state.issuer],
        commands: [
          {
            CreateCommand: {
              templateId: marketTid,
              createArguments: {
                curator: state.issuer,
                player,
                symbol,
                price,
              },
            },
          },
        ],
      });
      const after = await this.client.activeContractsFor(state.issuer, {
        atOffset: submit.completionOffset,
      });
      const fresh = after.find(
        (event) =>
          matchesTemplateId(event.templateId, marketTid) &&
          (event.createArgument.player as string) === player &&
          (event.createArgument.symbol as string) === symbol,
      );
      if (!fresh) {
        throw new Error(`Market ${symbol} was created for ${player} but is not visible.`);
      }
      return fresh;
    };

    const markets: CreatedEvent[] = [];
    for (const config of LEVEL1_MARKET_CONFIGS) {
      markets.push(await seed(config.symbol, config.price));
    }
    return markets;
  }

  async verifyLevel1(solver: string): Promise<VerifyOutcome> {
    return this.verifyGeneric(solver, LEVEL1_LEVEL_TAG);
  }

  // ---------------------------------------------------------------------------
  // Shared verifier logic (used by every level).
  // ---------------------------------------------------------------------------

  /**
   * As issuer, look up an outstanding FlagProof for `solver` at `level`,
   * exercise IssueFlag on the FlagIssuer, and return the resulting Flag.
   */
  private async verifyGeneric(solver: string, level: string): Promise<VerifyOutcome> {
    const state = await this.ensureReady();
    const issuerEvents = await this.client.activeContractsFor(state.issuer);
    const config = LEVEL_ISSUER_CONFIGS.find((entry) => entry.level === level);
    if (!config) {
      return {
        proof: null,
        flag: null,
        message: `FlagIssuer config for ${level} is missing.`,
      };
    }
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proofs = issuerEvents
      .filter(
        (event) =>
        matchesTemplateId(event.templateId, proofTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === level,
      )
      .sort((a, b) => b.offset - a.offset);
    const proof =
      proofs.find((event) => (event.createArgument.proof as string) === config.expectedProof) ??
      proofs[0];
    if (!proof) {
      return {
        proof: null,
        flag: null,
        message: `No ${level} FlagProof visible to the issuer yet.`,
      };
    }

    const flagTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
    const existingFlag = issuerEvents.find(
      (event) =>
        matchesTemplateId(event.templateId, flagTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === level,
    );
    if (existingFlag) {
      return {
        proof,
        flag: existingFlag,
        message: `Flag was already minted for this solver at ${level}.`,
      };
    }

    let flagIssuerCid = state.flagIssuers[level];
    if (!flagIssuerCid) {
      flagIssuerCid = await this.refreshFlagIssuer(level, state.issuer);
    }

    let submit;
    try {
      submit = await this.client.submitAndWait({
        userId: DAMLNAUT_USER_ID,
        commandId: `issue-flag-${level}-${solver.slice(-6)}-${Date.now()}`,
        actAs: [state.issuer],
        commands: [
          {
            ExerciseCommand: {
              templateId: templateId(MOD_FLAG_ISSUER, ENT_FLAG_ISSUER),
              contractId: flagIssuerCid,
              choice: CHOICE_ISSUE_FLAG,
              choiceArgument: { proofCid: proof.contractId },
            },
          },
        ],
      });
    } catch (error) {
      if (isContractNotFoundError(error)) {
        flagIssuerCid = await this.refreshFlagIssuer(level, state.issuer);
        submit = await this.client.submitAndWait({
          userId: DAMLNAUT_USER_ID,
          commandId: `issue-flag-retry-${level}-${solver.slice(-6)}-${Date.now()}`,
          actAs: [state.issuer],
          commands: [
            {
              ExerciseCommand: {
                templateId: templateId(MOD_FLAG_ISSUER, ENT_FLAG_ISSUER),
                contractId: flagIssuerCid,
                choice: CHOICE_ISSUE_FLAG,
                choiceArgument: { proofCid: proof.contractId },
              },
            },
          ],
        });
      } else if (isWrongProofError(error)) {
        return {
          proof,
          flag: null,
          message: `Proof does not satisfy the ${level} verifier.`,
        };
      } else {
        throw error;
      }
    }

    const after = await this.client.activeContractsFor(state.issuer, {
      atOffset: submit.completionOffset,
    });
    const flag = after.find(
      (event) =>
        matchesTemplateId(event.templateId, flagTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === level,
    );
    return {
      proof,
      flag: flag ?? null,
      message: flag
        ? `FlagIssuer accepted the proof and minted the ${level} flag.`
        : `IssueFlag submitted at ${level} but the resulting Flag was not visible.`,
    };
  }

  private async refreshFlagIssuer(level: string, issuer: string): Promise<string> {
    const config = LEVEL_ISSUER_CONFIGS.find((entry) => entry.level === level);
    if (!config) {
      throw new Error(`Missing issuer config for ${level}.`);
    }
    const cid = await this.ensureFlagIssuer(issuer, config);
    this.state = {
      ...this.state,
      flagIssuers: {
        ...this.state.flagIssuers,
        [level]: cid,
      },
    };
    return cid;
  }
}

export type VerifyOutcome = {
  proof: CreatedEvent | null;
  flag: CreatedEvent | null;
  message: string;
};

/**
 * Template ids come back as either `#pkg-name:Mod:Ent` (what we send) or
 * `<packageId>:Mod:Ent` (the resolved form Canton echoes). Compare the
 * `Mod:Ent` tail so we recognise either.
 */
export function matchesTemplateId(actual: string, expected: string): boolean {
  const tail = (s: string) => s.split(':').slice(-2).join(':');
  return tail(actual) === tail(expected);
}

function isContractNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('CONTRACT_NOT_FOUND');
}

function isWrongProofError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('WRONG_PROOF');
}

function isPartyAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Party already exists');
}
