# Why the wallet connection drops (and how to stop depending on `vercel --prod` to fix it)

## The chain of causes

Three ephemeral things have to stay aligned for wallet connect to work, and nothing in the current setup keeps them aligned automatically:

1. **Canton sandbox is in-memory.** Every party allocation, the `damlnaut-issuer` party, and every `FlagIssuer` contract live only in the running sandbox process. Restart it (crash, laptop sleep, reboot) and all of that is gone.
2. **ngrok's free-tier URL is not stable.** Every time the local `ngrok http 7575` process restarts, it gets a new random subdomain. The README's own deploy steps confirm this is the assumed workflow: run ngrok, copy the URL, `vercel env add DAML_JSON_API_URL`, `vercel --prod`.
3. **The Vercel function caches the ledger connection for the life of the lambda, not per-request.** In `server/app.ts`:

   ```ts
   export const jsonApiUrl = process.env.DAML_JSON_API_URL ?? DAML_JSON_API_URL_DEFAULT;
   export const ledger = new LedgerContext(jsonApiUrl);
   ```

   This runs once per cold start. `LedgerContext.ensureReady()` (in `server/ledgerContext.ts`) then short-circuits on every later call:

   ```ts
   async ensureReady(): Promise<BootstrapState> {
     if (this.state.ready) return this.state;
     ...
   }
   ```

   Once a warm lambda has successfully booted against *some* ngrok URL, it keeps using that same `jsonApiUrl` and the same cached `issuer` / `flagIssuers` state indefinitely — it never notices that the tunnel died or that Canton restarted underneath it.

Updating the `DAML_JSON_API_URL` env var in the Vercel dashboard doesn't change anything for functions that are already warm, and per Vercel's model it only takes effect on the *next deployment* anyway. So the moment ngrok rotates its URL, or the sandbox restarts, the production site is left holding a dead endpoint or stale contract IDs, and `/api/wallet/connect` starts failing (fetch to a closed ngrok tunnel, or `allocateParty` against a synchronizer that no longer matches what the cached state expects).

## Why `vercel --prod` "fixes" it

It doesn't fix the underlying fragility — it just forces a brand-new deployment, which means brand-new lambda containers, which means the two module-level `const`s above get re-evaluated from scratch: fresh `jsonApiUrl` read from the current env var, fresh `LedgerContext` with `ready: false`, forcing a real re-bootstrap against whatever is actually live right now. It's a full reset dressed up as a "publish."

## Keeping sessions persisted while still running Canton locally behind ngrok

**Get a static ngrok domain (highest leverage fix).** ngrok's free tier now includes one reserved domain per account. Run:

```
ngrok http 7575 --domain=<your-name>.ngrok-free.app
```

Set `DAML_JSON_API_URL` to that fixed domain once, and it never has to change again — no more `vercel env add` / `vercel --prod` cycle just to point at a new URL. Cloudflare Tunnel (`cloudflared tunnel run <name>`) or Tailscale Funnel are the paid-tier-free alternatives with the same property and no periodic session expiry to worry about.

**Stop restarting the Canton sandbox mid-session.** Since it's in-memory, every restart invalidates every previously-allocated party and the issuer/FlagIssuer contracts with it — this is a separate failure mode from the tunnel URL, and a static ngrok domain won't fix it. Your own `scratchpad.md` already has the right long-term answer queued up (item #1: hot-swap DARs via `POST /v2/packages` instead of restarting Canton to ship a new level; item #2: Docker + a persistent participant). Short of that, at minimum avoid restarting the sandbox process casually.

**Make the backend self-heal instead of needing a redeploy.** Two small changes to `server/ledgerContext.ts` / `server/app.ts` would remove the need for `vercel --prod` as a recovery tool entirely:

- In the `LEDGER_PROXY_PREFIX` proxy handler and in `ensureReady()`, catch connection failures (`fetch` throwing, or a `CONTRACT_NOT_FOUND`/`party is not allocated` response) and reset `this.state.ready = false` so the *next* request re-bootstraps automatically, rather than the lambda permanently believing it's fine.
- Treat `DAML_JSON_API_URL` as something to re-check periodically rather than read once — e.g., re-read `process.env` and diff against the URL the client was constructed with before trusting a cached client.

**Give the frontend a clean recovery path.** Right now `resumeWallet()` 404s silently if the stored party no longer exists (sandbox restarted) — from the user's side that just looks like "wallet won't connect." A one-line UX fix: on a 404 from `/api/wallet/resume`, clear the stored wallet and automatically fall through to `connectWallet()` so a stale session turns into a fresh one instead of a stuck error.

## Summary

The redeploy "fix" works because it clears in-memory state that nothing else clears. The two things actually going stale are the ngrok URL (fix: reserved/static domain) and the Canton sandbox's contents (fix: don't restart it, or move to a persistent participant per your own Docker plan in `scratchpad.md`). Once the tunnel URL is fixed and stable, the only remaining reason you'd ever need `vercel --prod` again is an actual code change.
