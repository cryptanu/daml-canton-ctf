# Hetzner deployment runbook

Deploys `deploy/hosted/` (Postgres-backed Canton, backend, Wallet Gateway, Caddy)
to one Hetzner Cloud VM. The frontend stays on Vercel.

**Status:** written from the locally verified Compose stack. Nothing here has
been run on a real Hetzner server, with real DNS, or with real TLS. Steps marked
**[verify]** depend on Hetzner/Vercel details that change; check them in the
current console/docs. Server type names and prices are deliberately not quoted.

## 0. What you need

- A Hetzner Cloud account and project, plus an API token if you use the `hcloud` CLI.
- A domain you control. Two names: `api.<domain>` and `wallet.<domain>`.
- Your laptop with the repo, `./damlw build` working, and the Canton JAR
  (`~/.daml/sdk/3.4.10/canton/canton.jar`).
- An SSH key pair.

## 1. Choose the server

Memory is the constraint: Canton runs with `-Xmx2g`, and Postgres, two Node
containers and Caddy sit beside it.

- Minimum: 4 vCPU, 8 GB RAM, 40+ GB disk. Go bigger if you expect many players.
- **Architecture:** the compose images were tested on Apple Silicon (arm64). An
  Arm (CAX-line) server matches that and avoids re-validating images. An x86
  server should work but the pinned image digests have not been tested on it.
  **[verify]** current server-type names and EU locations in the console.
- Image: Ubuntu 24.04 LTS.

## 2. Create the server and firewall

Console or `hcloud` CLI. Example:

```sh
hcloud ssh-key create --name damlnaut --public-key-from-file ~/.ssh/id_ed25519.pub
hcloud firewall create --name damlnaut-fw
hcloud firewall add-rule damlnaut-fw --direction in --protocol tcp --port 22  --source-ips <YOUR_IP>/32
hcloud firewall add-rule damlnaut-fw --direction in --protocol tcp --port 80  --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule damlnaut-fw --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud server create --name damlnaut --type <TYPE> --image ubuntu-24.04 \
  --ssh-key damlnaut --firewall damlnaut-fw --location <LOCATION>
```

Only 22 (your IP), 80 and 443 are open. Port 80 is needed for Caddy's TLS
certificate challenge. Do not open 7575, 3030 or 8787; Caddy is the only public entry.

## 3. DNS

Create two `A` records (and `AAAA` if you want IPv6) pointing at the server IP:

```
api.<domain>     A  <SERVER_IP>
wallet.<domain>  A  <SERVER_IP>
```

Wait until `dig +short api.<domain>` returns the IP before starting Caddy, or
certificate issuance will fail and rate-limit you.

## 4. Harden and install Docker

```sh
ssh root@<SERVER_IP>
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ \
  && chown -R deploy:deploy /home/deploy/.ssh
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
apt-get update && apt-get -y install unattended-upgrades fail2ban ca-certificates curl rsync
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Reconnect as `deploy` and check `docker compose version`.

## 5. Ship the code

Build the DAR locally (the backend image bakes `.daml/dist/*.dar`), then copy.
From your laptop, in the repo root:

```sh
./damlw build
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude log \
  --exclude 'deploy/hosted/.env' --exclude scratchpad.md --exclude CLAUDE.md \
  ./ deploy@<SERVER_IP>:~/damlnaut/
ssh deploy@<SERVER_IP> 'mkdir -p ~/canton'
rsync -avP ~/.daml/sdk/3.4.10/canton/canton.jar deploy@<SERVER_IP>:~/canton/canton.jar
```

The JAR is 300 MB and is not part of the repo. Do not commit it.

## 6. Configure secrets

On the server:

```sh
cd ~/damlnaut/deploy/hosted
cat > .env <<EOF
CANTON_JAR=/home/deploy/canton/canton.jar
POSTGRES_PASSWORD=$(openssl rand -hex 16)
ADMIN_TOKEN=$(openssl rand -hex 16)
GATEWAY_CLIENT_SECRET=$(openssl rand -hex 16)
API_SITE=api.<domain>
WALLET_SITE=wallet.<domain>
HTTP_PORT=80
HTTPS_PORT=443
GATEWAY_ALLOWED_ORIGINS=https://<your-vercel-frontend-domain>
EOF
chmod 600 .env
```

Store these secrets in a password manager. Losing `POSTGRES_PASSWORD` after the
database is initialised means you cannot reconnect to it.

## 7. Start

```sh
cd ~/damlnaut
docker compose -p damlnaut -f deploy/hosted/compose.yaml --env-file deploy/hosted/.env up -d --build
docker compose -p damlnaut ps
docker compose -p damlnaut logs -f backend    # wait for "[damlnaut] issuer ready"
```

Canton can take a couple of minutes to connect its synchronizer. The backend
retries on its own, and the Canton healthcheck waits for a connected synchronizer.

## 8. Verify (do all of these)

```sh
curl -s https://api.<domain>/api/health | python3 -m json.tool
```

Expect `canton.reachable: true`, `issuerReady: true`, `bootError: null`, and
`level-0` and `level-1` under `flagIssuers`.

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://wallet.<domain>/login/        # 200
curl -s -o /dev/null -w "%{http_code}\n" -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  https://api.<domain>/api/admin/packages                                      # 200
curl -s -o /dev/null -w "%{http_code}\n" https://api.<domain>/api/admin/packages  # 401
```

Full solve from inside the stack (repo's own test, no wallet needed):

```sh
docker compose -p damlnaut exec -T \
  -e DAML_JSON_API_URL=http://canton:7575 -e BACKEND_URL=http://localhost:8787 \
  backend npx tsx scripts/demo-solve.mts
```

Expect `both flags captured`.

Persistence: `docker compose -p damlnaut down`, then `up -d` again (never `-v`).
`/api/health` must report the same `issuer` string as before.

## 9. Point the frontend at it (Vercel)

1. In the Vercel project, set `VITE_DAMLNAUT_API_BASE=https://api.<domain>` for
   Production and redeploy. **[verify]** the setting name in the Vercel UI.
2. The `api/` serverless functions in the repo are no longer needed once the
   frontend uses the Hetzner API.
3. Backend CORS currently allows any origin (`origin: true` in `server/app.ts`).
   Tighten it to your frontend domain before sharing the link.

## 10. Wallet access for players

Players need a wallet on the same participant as the backend. The tested option
is the bundled Wallet Gateway.

- Players open the app, click `connect canton wallet`, and use the wallet
  picker's **Custom Wallet URL** with `https://wallet.<domain>/api/v0/dapp`.
- The picker's built-in "Wallet Gateway (localhost, dev)" entry only works on a
  machine running a gateway on port 3030.
- On the gateway login: Client ID `damlnaut-user`, Client Secret is your
  `GATEWAY_CLIENT_SECRET`. Players then create a party in the gateway UI.

**Not verified:** this flow through Caddy with a Custom Wallet URL, and whether
the gateway needs a public URL setting for popup redirects behind a proxy. Test
it from a clean browser before announcing anything. If it fails, the gateway
log is `docker compose -p damlnaut logs gateway`.

**Security warning:** every player who knows the shared `GATEWAY_CLIENT_SECRET`
can log in as the same participant user. For a private demo that is acceptable.
For a public link, replace the self-signed IdP with a real OIDC provider first.

## 11. Operations

| Task | Command |
|---|---|
| Logs | `docker compose -p damlnaut logs -f --tail 100 <service>` |
| Restart one service | `docker compose -p damlnaut restart backend` |
| Add or update a level | Rebuild DAR locally, rsync, `docker compose ... up -d --build backend`, or `POST /api/admin/packages` with the DAR in `packages/` |
| Update code | rsync again, then `up -d --build` |
| Stop (keeps data) | `docker compose -p damlnaut down` |
| Wipe everything | `docker compose -p damlnaut down -v` (destroys ledger, parties, flags) |

Backups (single VM, no replication):

```sh
docker compose -p damlnaut exec -T postgres pg_dumpall -U canton | gzip > ~/backup-$(date +%F).sql.gz
docker run --rm -v damlnaut_gateway-data:/d -v ~:/out alpine tar czf /out/gateway-$(date +%F).tgz -C /d .
```

Copy these off the server, and also enable Hetzner server backups or snapshots
**[verify]**. A lost host means a lost ledger unless you have an off-box copy.

## 12. Before announcing publicly

- Replace the self-signed gateway IdP with a real OIDC provider.
- Canton runs unauthenticated on the private Docker network. The backend does
  not send a token yet (`LedgerContext` constructs `JsonApiClient` without one).
- Restrict backend CORS and `GATEWAY_ALLOWED_ORIGINS` to your frontend origin.
- Uptime alert on `https://api.<domain>/api/health`.
- Rate limiting exists on `/api/levels/*` (30/min/IP default). Express trusts one
  proxy hop (`TRUST_PROXY_HOPS`, default 1) so Caddy's `X-Forwarded-For` is used.
  Confirm with two clients from different IPs after deploy.
- Decide how long player parties and flags are kept; there is no cleanup job.

## 13. Teardown

```sh
hcloud server delete damlnaut
hcloud firewall delete damlnaut-fw
```

Remove the DNS records and the Vercel env var. Take a backup first if you want
to keep the ledger.
