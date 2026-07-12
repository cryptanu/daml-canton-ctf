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
  LEVEL1_MARKET_ALPHA_PRICE,
  LEVEL1_MARKET_ALPHA_SYMBOL,
  LEVEL1_MARKET_BETA_PRICE,
  LEVEL1_MARKET_BETA_SYMBOL,
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

  private async boot(): Promise<BootstrapState> {
    try {
      const issuer = await this.resolveIssuerParty();
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
    const allocated = await this.client.allocateParty({ partyIdHint: DAMLNAUT_ISSUER_HINT });
    return allocated.partyDetails.party;
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
   * Seed Alpha and Beta markets for `player` if they don't already exist.
   * Both markets are signed by the issuer (curator) and observed by the
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

    const alpha = await seed(LEVEL1_MARKET_ALPHA_SYMBOL, LEVEL1_MARKET_ALPHA_PRICE);
    const beta = await seed(LEVEL1_MARKET_BETA_SYMBOL, LEVEL1_MARKET_BETA_PRICE);
    return [alpha, beta];
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
    const flagIssuerCid = state.flagIssuers[level];
    if (!flagIssuerCid) {
      return { proof: null, flag: null, message: `FlagIssuer for ${level} not initialised.` };
    }

    const issuerEvents = await this.client.activeContractsFor(state.issuer);
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = issuerEvents.find(
      (event) =>
        matchesTemplateId(event.templateId, proofTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === level,
    );
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

    const submit = await this.client.submitAndWait({
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
