// Handler for `/api` (the bare root, no path segment). The catch-all in
// api/[...path].ts handles every actual endpoint. This exists purely so
// Vercel's function-validation step sees a valid default export at the
// index route.
import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      service: 'damlnaut-dapp-backend',
      hint: 'try /api/health, /api/wallet/connect, /api/levels/0/verify, /api/levels/1/verify',
    }),
  );
}
