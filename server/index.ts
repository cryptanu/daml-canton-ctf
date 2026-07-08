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
  type FlagPayload,
  type FlagProofPayload,
  type VerifyLevel0Request,
  type VerifyLevel0Response,
  type WalletConnectRequest,
  type WalletConnectResponse,
  type WalletResumeRequest,
} from '../shared/damlnaut';
import { LedgerContext, matchesTemplateId } from './ledgerContext';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const jsonApiUrl = process.env.DAML_JSON_API_URL ?? DAML_JSON_API_URL_DEFAULT;

const ledger = new LedgerContext(jsonApiUrl);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Public mount point of the JSON Ledger API proxy. Browser hits this instead
// of Canton on 7575 directly, so CORS is our responsibility, not Canton's.
const LEDGER_PROXY_PREFIX = '/api/ledger';

// Six random base36 characters. Canton party-id hints must match
// `[A-Za-z0-9:_\- ]+`, and this suffix keeps them alphanumeric while
// making cross-session collisions astronomically unlikely.
function randomPartySuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

function browserJsonApiUrl(req: express.Request): string {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0];
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0];
  const proto = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get('host') ?? `localhost:${port}`;
  return `${proto}://${host}${LEDGER_PROXY_PREFIX}`;
}

app.get('/api/health', (_req, res) => {
  const state = ledger.getState();
  res.json({
    ok: true,
    service: 'damlnaut-dapp-backend',
    jsonApiUrl,
    ledgerProxyPrefix: LEDGER_PROXY_PREFIX,
    issuerReady: state.ready,
    issuer: state.issuer || null,
    flagIssuerCid: state.flagIssuerCid,
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
      // The frontend uses this URL to talk to Canton. We hand back the
      // backend's proxy mount so the browser stays same-origin.
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
// call http://localhost:7575 directly from http://localhost:5173. We forward
// requests through this backend (which does emit CORS), leaving Canton
// unchanged.
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

/**
 * Restore a party that a returning browser stashed in localStorage. This is
 * the deterministic-identity layer for the local session wallet: the
 * frontend keeps the party id, the backend confirms it still exists on
 * this participant, and we hand back the same shape as /connect so the
 * browser can rebuild its Ledger client.
 */
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
    const proofTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG_PROOF);
    const flagTid = templateId(MOD_FLAG_ISSUER, ENT_FLAG);
    const response: VerifyLevel0Response = {
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
    };
    res.json(response);
  } catch (error) {
    respondWithError(res, error);
  }
});

// Kick off the issuer boot in the background so the first user-facing
// request doesn't wait for FlagIssuer creation. If Canton isn't up yet
// this just records a bootError; the next request will retry.
ledger.ensureReady().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[damlnaut] issuer boot deferred: ${message}`);
});

app.listen(port, () => {
  console.log(`damlnaut backend listening on http://localhost:${port}`);
  console.log(`  json ledger api : ${jsonApiUrl}`);
});

function respondWithError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const statusFromError = /: 4\d\d/.test(message) ? 400 : 500;
  res.status(statusFromError).json({ error: message });
}
