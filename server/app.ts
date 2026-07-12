import cors from 'cors';
import express from 'express';
import {
  DAML_JSON_API_URL_DEFAULT,
  DAMLNAUT_NETWORK_ID,
  DAMLNAUT_PACKAGE_NAME,
  DAMLNAUT_PLAYER_HINT_PREFIX,
  DAMLNAUT_PROVIDER_NAME,
  DAMLNAUT_USER_ID,
  ENT_FLAG,
  ENT_FLAG_PROOF,
  MOD_FLAG_ISSUER,
  templateId,
  type BootstrapLevel1Request,
  type BootstrapLevel1Response,
  type FlagPayload,
  type FlagProofPayload,
  type MarketPayload,
  type MarketRecord,
  type PositionPayload,
  type PositionRecord,
  type VerifyLevel0Request,
  type VerifyLevel0Response,
  type VerifyLevel1Request,
  type VerifyLevel1Response,
  type WalletConnectRequest,
  type WalletConnectResponse,
  type WalletResumeRequest,
} from '../shared/damlnaut.js';
import { LedgerContext, matchesTemplateId, type VerifyOutcome } from './ledgerContext.js';

export const jsonApiUrl = process.env.DAML_JSON_API_URL ?? DAML_JSON_API_URL_DEFAULT;
export const ledger = new LedgerContext(jsonApiUrl);

// Public mount point of the JSON Ledger API proxy. Browser hits this instead
// of Canton directly, so CORS is our responsibility, not Canton's.
export const LEDGER_PROXY_PREFIX = '/api/ledger';

export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const state = ledger.getState();
    res.json({
      ok: true,
      service: 'damlnaut-dapp-backend',
      jsonApiUrl,
      ledgerProxyPrefix: LEDGER_PROXY_PREFIX,
      issuerReady: state.ready,
      issuer: state.issuer || null,
      flagIssuers: state.flagIssuers,
      bootError: state.bootError,
    });
  });

  app.post('/api/wallet/connect', async (req, res) => {
    try {
      const state = await ledger.ensureReady();
      const body = (req.body ?? {}) as WalletConnectRequest;
      const hintBase = body.partyIdHint?.trim() || DAMLNAUT_PLAYER_HINT_PREFIX;
      const partyIdHint = `${hintBase}-${randomPartySuffix()}`;
      const allocation = await ledger.client.allocateParty({ partyIdHint });
      const response: WalletConnectResponse = {
        party: allocation.partyDetails.party,
        jsonApiUrl: browserJsonApiUrl(req),
        packageName: DAMLNAUT_PACKAGE_NAME,
        userId: DAMLNAUT_USER_ID,
        networkId: DAMLNAUT_NETWORK_ID,
        providerName: DAMLNAUT_PROVIDER_NAME,
        issuer: state.issuer,
      };
      res.json(response);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  // -----------------------------------------------------------------------------
  // JSON Ledger API v2 reverse proxy
  // -----------------------------------------------------------------------------
  // Canton's JSON Ledger API doesn't emit CORS headers, so the browser cannot
  // call the ledger directly. Forward everything through the backend.
  app.use(LEDGER_PROXY_PREFIX, async (req, res) => {
    const upstreamPath = req.originalUrl.slice(LEDGER_PROXY_PREFIX.length) || '/';
    const target = `${jsonApiUrl}${upstreamPath}`;
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });
      const text = await upstream.text();
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      res.status(upstream.status).type(contentType).send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ledger proxy error';
      res.status(502).json({ error: `ledger proxy: ${message}` });
    }
  });

  app.post('/api/wallet/resume', async (req, res) => {
    try {
      const body = (req.body ?? {}) as WalletResumeRequest;
      if (!body.party) {
        res.status(400).json({ error: 'party is required' });
        return;
      }
      const state = await ledger.ensureReady();
      const exists = await ledger.partyExists(body.party);
      if (!exists) {
        res.status(404).json({ error: 'party is not allocated on this participant' });
        return;
      }
      const response: WalletConnectResponse = {
        party: body.party,
        jsonApiUrl: browserJsonApiUrl(req),
        packageName: DAMLNAUT_PACKAGE_NAME,
        userId: DAMLNAUT_USER_ID,
        networkId: DAMLNAUT_NETWORK_ID,
        providerName: DAMLNAUT_PROVIDER_NAME,
        issuer: state.issuer,
      };
      res.json(response);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  app.post('/api/levels/0/verify', async (req, res) => {
    try {
      const body = (req.body ?? {}) as VerifyLevel0Request;
      if (!body.party) {
        res.status(400).json({ error: 'party is required' });
        return;
      }
      const outcome = await ledger.verifyLevel0(body.party);
      res.json(verifyResponse<VerifyLevel0Response>(outcome));
    } catch (error) {
      respondWithError(res, error);
    }
  });

  app.post('/api/levels/1/bootstrap', async (req, res) => {
    try {
      const body = (req.body ?? {}) as BootstrapLevel1Request;
      if (!body.party) {
        res.status(400).json({ error: 'party is required' });
        return;
      }
      const markets = await ledger.bootstrapLevel1(body.party);
      const positionTid = templateId('Damlnaut.Level1', 'Position');

      const playerEvents = await ledger.client.activeContractsFor(body.party);
      const positionEvent = playerEvents.find(
        (event) =>
          matchesTemplateId(event.templateId, positionTid) &&
          (event.createArgument.player as string) === body.party,
      );

      const response: BootstrapLevel1Response = {
        markets: markets.map((event) => ({
          contractId: event.contractId,
          templateId: event.templateId,
          payload: event.createArgument as unknown as MarketPayload,
        })) as MarketRecord[],
        position: positionEvent
          ? ({
              contractId: positionEvent.contractId,
              templateId: positionEvent.templateId,
              payload: positionEvent.createArgument as unknown as PositionPayload,
            } as PositionRecord)
          : null,
      };
      res.json(response);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  app.post('/api/levels/1/verify', async (req, res) => {
    try {
      const body = (req.body ?? {}) as VerifyLevel1Request;
      if (!body.party) {
        res.status(400).json({ error: 'party is required' });
        return;
      }
      const outcome = await ledger.verifyLevel1(body.party);
      res.json(verifyResponse<VerifyLevel1Response>(outcome));
    } catch (error) {
      respondWithError(res, error);
    }
  });

  return app;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Six random base36 characters. Canton party-id hints must match
// `[A-Za-z0-9:_\- ]+`; this suffix stays alphanumeric while making
// cross-session collisions astronomically unlikely.
function randomPartySuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

function browserJsonApiUrl(req: express.Request): string {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0];
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0];
  const proto = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get('host') ?? 'localhost:8787';
  return `${proto}://${host}${LEDGER_PROXY_PREFIX}`;
}

function respondWithError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const statusFromError = /: 4\d\d/.test(message) ? 400 : 500;
  res.status(statusFromError).json({ error: message });
}

/**
 * Shape a VerifyOutcome into the on-the-wire response every level's
 * /api/levels/N/verify endpoint returns.
 */
function verifyResponse<
  T extends {
    verified: boolean;
    message: string;
    proof: { contractId: string; templateId: string; payload: FlagProofPayload } | null;
    flag: { contractId: string; templateId: string; payload: FlagPayload } | null;
  },
>(outcome: {
  proof: VerifyOutcome['proof'];
  flag: VerifyOutcome['flag'];
  message: string;
}): T {
  const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
  const flagTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
  return {
    verified: !!outcome.flag,
    message: outcome.message,
    proof:
      outcome.proof && matchesTemplateId(outcome.proof.templateId, proofTid)
        ? {
            contractId: outcome.proof.contractId,
            templateId: outcome.proof.templateId,
            payload: outcome.proof.createArgument as unknown as FlagProofPayload,
          }
        : null,
    flag:
      outcome.flag && matchesTemplateId(outcome.flag.templateId, flagTid)
        ? {
            contractId: outcome.flag.contractId,
            templateId: outcome.flag.templateId,
            payload: outcome.flag.createArgument as unknown as FlagPayload,
          }
        : null,
  } as T;
}
