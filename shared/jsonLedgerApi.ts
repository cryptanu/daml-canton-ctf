// Minimal typed client for the Daml SDK JSON Ledger API v2 (Daml 3.4+).
// Endpoints referenced:
//   POST /v2/parties                       - allocate a party
//   POST /v2/commands/submit-and-wait      - submit a command batch, returns updateId
//   POST /v2/state/active-contracts        - active-contract-set query
//   GET  /v2/state/ledger-end              - current absolute offset
//
// Dev-mode Canton sandbox (started with `--json-api-port 7575` and no auth
// options) accepts these calls unauthenticated and derives authority from
// the `actAs` list you pass in each command. That is why this client does
// not send an Authorization header. Production auth is out of scope for
// the CTF localnet.

export type LedgerCommand =
  | {
      CreateCommand: {
        templateId: string;
        createArguments: Record<string, unknown>;
      };
    }
  | {
      ExerciseCommand: {
        templateId: string;
        contractId: string;
        choice: string;
        choiceArgument: Record<string, unknown>;
      };
    }
  | {
      CreateAndExerciseCommand: {
        templateId: string;
        createArguments: Record<string, unknown>;
        choice: string;
        choiceArgument: Record<string, unknown>;
      };
    };

export type SubmitAndWaitRequest = {
  commands: LedgerCommand[];
  userId: string;
  commandId: string;
  actAs: string[];
  readAs?: string[];
};

export type SubmitAndWaitResponse = {
  updateId: string;
  completionOffset: number;
};

export type AllocatePartyRequest = {
  partyIdHint?: string;
  identityProviderId?: string;
  synchronizerId?: string;
};

export type AllocatePartyResponse = {
  partyDetails: {
    party: string;
    isLocal: boolean;
    localMetadata: {
      resourceVersion: string;
      annotations: Record<string, string>;
    };
    identityProviderId: string;
  };
};

export type CreatedEvent = {
  offset: number;
  nodeId: number;
  contractId: string;
  templateId: string;
  contractKey: unknown;
  createArgument: Record<string, unknown>;
  createdEventBlob?: string;
  witnessParties?: string[];
  signatories?: string[];
  observers?: string[];
};

export type ActiveContractEntry = {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent: CreatedEvent;
      synchronizerId?: string;
      reassignmentCounter?: string;
    };
  };
};

export type LedgerEndResponse = { offset: number };

export type ConnectedSynchronizer = {
  synchronizerAlias: string;
  synchronizerId: string;
  permission: string;
};

export type ConnectedSynchronizersResponse = {
  connectedSynchronizers: ConnectedSynchronizer[];
};

export type WildcardActiveContractsRequest = {
  eventFormat: {
    filtersByParty: Record<string, unknown>;
    filtersForAnyParty: {
      cumulative: Array<{
        identifierFilter: {
          WildcardFilter: {
            value: { includeCreatedEventBlob: boolean };
          };
        };
      }>;
    };
    verbose: boolean;
  };
  verbose: boolean;
  activeAtOffset: number;
};

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const globalFetch: FetchImpl | undefined =
  typeof fetch !== 'undefined' ? (fetch.bind(globalThis) as FetchImpl) : undefined;

export type JsonApiClientOptions = {
  baseUrl: string;
  fetchImpl?: FetchImpl;
  token?: string;
};

export class JsonApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly token?: string;

  constructor(opts: JsonApiClientOptions) {
    if (!globalFetch && !opts.fetchImpl) {
      throw new Error('JsonApiClient requires a fetch implementation.');
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalFetch as FetchImpl);
    this.token = opts.token;
  }

  async allocateParty(req: AllocatePartyRequest = {}): Promise<AllocatePartyResponse> {
    return this.postJson<AllocatePartyResponse>('/v2/parties', {
      partyIdHint: req.partyIdHint ?? '',
      identityProviderId: req.identityProviderId ?? '',
      synchronizerId: req.synchronizerId ?? '',
    });
  }

  async listParties(): Promise<Array<{ party: string; isLocal: boolean }>> {
    const raw = await this.getJson<
      { partyDetails?: Array<{ party: string; isLocal: boolean }> } | Array<{ party: string; isLocal: boolean }>
    >('/v2/parties');
    if (Array.isArray(raw)) return raw;
    return raw.partyDetails ?? [];
  }

  async submitAndWait(req: SubmitAndWaitRequest): Promise<SubmitAndWaitResponse> {
    return this.postJson<SubmitAndWaitResponse>('/v2/commands/submit-and-wait', req);
  }

  async ledgerEnd(): Promise<LedgerEndResponse> {
    return this.getJson<LedgerEndResponse>('/v2/state/ledger-end');
  }

  async connectedSynchronizers(): Promise<ConnectedSynchronizersResponse> {
    return this.getJson<ConnectedSynchronizersResponse>('/v2/state/connected-synchronizers');
  }

  async activeContracts(req: WildcardActiveContractsRequest): Promise<ActiveContractEntry[]> {
    const raw = await this.postJson<unknown>('/v2/state/active-contracts', req);
    return normalizeContracts(raw);
  }

  /** Return current active contracts of a given templateId that a party can see. */
  async activeContractsFor(party: string, options?: { atOffset?: number }): Promise<CreatedEvent[]> {
    const offset = options?.atOffset ?? (await this.ledgerEnd()).offset;
    const request: WildcardActiveContractsRequest = {
      eventFormat: {
        filtersByParty: {
          [party]: {
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
    const entries = await this.activeContracts(request);
    return entries
      .map((e) => e.contractEntry?.JsActiveContract?.createdEvent)
      .filter((e): e is CreatedEvent => !!e);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.readJson<T>(res, path);
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
    return this.readJson<T>(res, path);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async readJson<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      const message = truncate(text || res.statusText, 500);
      throw new Error(`JSON Ledger API ${path} -> ${res.status}: ${message}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`JSON Ledger API ${path} returned non-JSON body: ${truncate(text, 200)}`);
    }
  }
}

// The active-contracts endpoint returns either a flat array or an object with
// a `contracts` field depending on Canton sub-version. Handle both.
function normalizeContracts(raw: unknown): ActiveContractEntry[] {
  if (Array.isArray(raw)) return raw as ActiveContractEntry[];
  if (raw && typeof raw === 'object') {
    const obj = raw as { contracts?: ActiveContractEntry[]; contractEntries?: ActiveContractEntry[] };
    if (obj.contracts) return obj.contracts;
    if (obj.contractEntries) return obj.contractEntries;
  }
  return [];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}
