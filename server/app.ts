import cors from 'cors';
import express from 'express';
import {
  DAML_JSON_API_URL_DEFAULT,
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
} from '../shared/damlnaut.js';
import { LedgerContext, matchesTemplateId, type VerifyOutcome } from './ledgerContext.js';

export const jsonApiUrl = process.env.DAML_JSON_API_URL ?? DAML_JSON_API_URL_DEFAULT;
export const ledger = new LedgerContext(jsonApiUrl);

// Post-live-wallet backend surface:
//
//   GET  /api/health                 — issuer party + FlagIssuer CIDs
//   POST /api/levels/0/verify        — mint level-0 flag from an existing FlagProof
//   POST /api/levels/1/bootstrap     — seed level-1 markets for a player
//   POST /api/levels/1/verify        — mint level-1 flag from an existing FlagProof
//
// All player-side reads and writes go through the wallet's own participant
// via @canton-network/dapp-sdk. The backend owns the issuer identity only.

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
      issuerReady: state.ready,
      issuer: state.issuer || null,
      flagIssuers: state.flagIssuers,
      bootError: state.bootError,
    });
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
