import { JsonApiClient, type CreatedEvent } from '../shared/jsonLedgerApi';
import {
  CHOICE_ISSUE_FLAG,
  DAML_JSON_API_URL_DEFAULT,
  DAMLNAUT_ISSUER_HINT,
  DAMLNAUT_USER_ID,
  ENT_FLAG,
  ENT_FLAG_ISSUER,
  ENT_FLAG_PROOF,
  LEVEL0_EXPECTED_PROOF,
  LEVEL0_FLAG_VALUE,
  LEVEL0_LEVEL_TAG,
  MOD_FLAG_ISSUER,
  templateId,
} from '../shared/damlnaut';

// LedgerContext owns the backend's identity on the Canton ledger: it
// allocates a stable damlnaut-issuer party the first time the backend
// runs against a fresh sandbox and remembers the resulting party id.
// It also caches the FlagIssuer contract-id so the verifier can exercise
// IssueFlag without re-querying every time.

export type BootstrapState = {
  jsonApiUrl: string;
  issuer: string;
  flagIssuerCid: string | null;
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
      flagIssuerCid: null,
      ready: false,
      bootError: null,
    };
  }

  getState(): BootstrapState {
    return { ...this.state };
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
      const flagIssuerCid = await this.ensureFlagIssuer(issuer);
      this.state = {
        jsonApiUrl: this.jsonApiUrl,
        issuer,
        flagIssuerCid,
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
   * Look for an existing party whose id starts with the issuer hint; allocate a
   * new one only if none exists. This keeps the FlagIssuer contract stable
   * across backend restarts on the same sandbox.
   */
  private async resolveIssuerParty(): Promise<string> {
    try {
      const parties = await this.client.listParties();
      const existing = parties.find((p) =>
        p.party.split('::')[0].toLowerCase() === DAMLNAUT_ISSUER_HINT.toLowerCase(),
      );
      if (existing) return existing.party;
    } catch {
      // Some sandbox versions gate /v2/parties GET behind auth; fall through.
    }
    const allocated = await this.client.allocateParty({ partyIdHint: DAMLNAUT_ISSUER_HINT });
    return allocated.partyDetails.party;
  }

  private async ensureFlagIssuer(issuer: string): Promise<string> {
    const created = await this.client.activeContractsFor(issuer);
    const tid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_ISSUER);
    const match = created.find(
      (event) =>
        matchesTemplateId(event.templateId, tid) &&
        (event.createArgument.issuer as string) === issuer &&
        (event.createArgument.level as string) === LEVEL0_LEVEL_TAG,
    );
    if (match) return match.contractId;

    const submit = await this.client.submitAndWait({
      userId: DAMLNAUT_USER_ID,
      commandId: `flag-issuer-boot-${Date.now()}`,
      actAs: [issuer],
      commands: [
        {
          CreateCommand: {
            templateId: tid,
            createArguments: {
              issuer,
              level: LEVEL0_LEVEL_TAG,
              expectedProof: LEVEL0_EXPECTED_PROOF,
              flagValue: LEVEL0_FLAG_VALUE,
            },
          },
        },
      ],
    });
    // Re-read to find the CID of what we just created.
    const after = await this.client.activeContractsFor(issuer, {
      atOffset: submit.completionOffset,
    });
    const fresh = after.find(
      (event) =>
        matchesTemplateId(event.templateId, tid) &&
        (event.createArgument.issuer as string) === issuer,
    );
    if (!fresh) {
      throw new Error('FlagIssuer bootstrap succeeded but the contract was not visible.');
    }
    return fresh.contractId;
  }

  /**
   * As issuer, look up an outstanding FlagProof for `solver`, exercise
   * IssueFlag on the FlagIssuer, and return the resulting Flag.
   */
  async verifyLevel0(solver: string): Promise<{
    proof: CreatedEvent | null;
    flag: CreatedEvent | null;
    message: string;
  }> {
    const state = await this.ensureReady();
    if (!state.flagIssuerCid) {
      return { proof: null, flag: null, message: 'FlagIssuer not initialised.' };
    }

    const issuerEvents = await this.client.activeContractsFor(state.issuer);
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const proof = issuerEvents.find(
      (event) =>
        matchesTemplateId(event.templateId, proofTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === LEVEL0_LEVEL_TAG,
    );
    if (!proof) {
      return {
        proof: null,
        flag: null,
        message: 'No Level 0 FlagProof visible to the issuer yet.',
      };
    }

    // Already minted? Return the existing flag if any.
    const flagTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
    const existingFlag = issuerEvents.find(
      (event) =>
        matchesTemplateId(event.templateId, flagTid) &&
        (event.createArgument.solver as string) === solver &&
        (event.createArgument.level as string) === LEVEL0_LEVEL_TAG,
    );
    if (existingFlag) {
      return {
        proof,
        flag: existingFlag,
        message: 'Flag was already minted for this solver.',
      };
    }

    const submit = await this.client.submitAndWait({
      userId: DAMLNAUT_USER_ID,
      commandId: `issue-flag-${solver}-${Date.now()}`,
      actAs: [state.issuer],
      commands: [
        {
          ExerciseCommand: {
            templateId: templateId(MOD_FLAG_ISSUER, ENT_FLAG_ISSUER),
            contractId: state.flagIssuerCid,
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
        (event.createArgument.level as string) === LEVEL0_LEVEL_TAG,
    );
    return {
      proof,
      flag: flag ?? null,
      message: flag
        ? 'FlagIssuer accepted the proof and minted the Level 0 flag.'
        : 'IssueFlag submitted but the resulting Flag was not visible.',
    };
  }
}

/**
 * Template ids can come back as either `#pkg-name:Mod:Ent` (what we send) or
 * `<packageId>:Mod:Ent` (the resolved form Canton echoes). Compare the
 * `Mod:Ent` tail so we recognise either.
 */
export function matchesTemplateId(actual: string, expected: string): boolean {
  const tail = (s: string) => s.split(':').slice(-2).join(':');
  return tail(actual) === tail(expected);
}
