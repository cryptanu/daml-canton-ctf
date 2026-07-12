// Vercel serverless entrypoint. File-system routing sends every /api/*
// request here (catch-all `[...path]`).
//
// Design notes / lessons paid for:
//
// 1. Express does not return a Promise. Vercel's Node runtime tears the
//    function down when the exported handler resolves, so a raw
//    `export default app` returns synchronously and Vercel kills the
//    process before Express writes the response body. That surfaces as
//    the useless `FUNCTION_INVOCATION_FAILED`. Fix: wrap Express in a
//    Promise that resolves on the response's `finish` / `close` event.
//
// 2. Keep `server/app` as a static import so Vercel bundles the backend
//    code into this function. A runtime import works under local tsx,
//    but Vercel can otherwise end up looking for `/var/task/server/app`
//    at request time instead of packaging it.
//
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp, ledger } from '../server/app.js';

type ExpressLikeApp = (req: IncomingMessage, res: ServerResponse) => void;

const cachedApp: ExpressLikeApp = createApp() as unknown as ExpressLikeApp;

// Prewarm the issuer. Failures are swallowed here; ensureReady()
// retries on each user request.
ledger.ensureReady().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[damlnaut] vercel prewarm deferred: ${message}`);
});

export default async function damlnautHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Vercel would tear the container down when this handler resolves.
  // Await the response lifecycle so Express can finish writing.
  try {
    await runExpress(cachedApp, req, res);
  } catch (err) {
    console.error('[damlnaut] handler threw', err);
    if (!res.headersSent) {
      respond500(res, 'damlnaut handler threw', err);
    }
  }
}

function runExpress(
  app: ExpressLikeApp,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    res.once('finish', () => settle());
    res.once('close', () => settle());
    res.once('error', (err) => settle(err));
    try {
      app(req, res);
    } catch (err) {
      settle(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function respond500(res: ServerResponse, error: string, cause: unknown): void {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      error,
      detail: cause instanceof Error ? cause.message : String(cause ?? 'unknown'),
      stack: cause instanceof Error ? cause.stack : null,
    }),
  );
}
