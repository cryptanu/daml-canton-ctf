// Canary function with zero imports beyond node built-ins. If /api/ping
// works but /api/health does not, the issue is a module-load failure in
// server/app.ts (missing dep, invalid path, ESM/CJS mismatch, etc.). If
// /api/ping also 500s, Vercel isn't routing api/*.ts files as functions.
import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      ok: true,
      service: 'damlnaut-ping',
      node: process.version,
      timestamp: new Date().toISOString(),
    }),
  );
}
