// Render config.template.json from env, then exec the Wallet Gateway.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const need = ['GATEWAY_CLIENT_SECRET', 'LEDGER_API_URL'];
for (const k of need) if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(1); }
const env = {
  GATEWAY_LEDGER_USER: 'damlnaut-user',
  GATEWAY_ALLOWED_ORIGINS: '*',
  GATEWAY_PORT: process.env.PORT ?? '3030', // Railway injects PORT
  ...process.env,
};
const out = readFileSync('config.template.json', 'utf8').replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? '');
JSON.parse(out);
writeFileSync('config.json', out);
const child = spawn('npx', ['wallet-gateway', '-c', 'config.json'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
