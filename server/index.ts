// Local dev entrypoint. Vercel uses api/index.ts instead.
import { createApp, jsonApiUrl, ledger } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

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
