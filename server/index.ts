// Local dev entrypoint. Vercel uses api/index.ts instead.
import { createApp, jsonApiUrl, ledger } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

// Boot the issuer in the background, retrying until Canton and its
// synchronizer are ready (containers race on startup).
async function bootWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await ledger.ensureReady();
      console.log('[damlnaut] issuer ready');
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[damlnaut] issuer boot attempt ${attempt} failed: ${message.slice(0, 160)}`);
      await new Promise((r) => setTimeout(r, Math.min(5000 * attempt, 30000)));
    }
  }
}
void bootWithRetry();

app.listen(port, () => {
  console.log(`damlnaut backend listening on http://localhost:${port}`);
  console.log(`  json ledger api : ${jsonApiUrl}`);
});
