#!/bin/sh
# Wait for Postgres (no depends_on on Railway), then start the sandbox.
set -eu
: "${POSTGRES_HOST:?set POSTGRES_HOST}" "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"
echo "waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}"
for i in $(seq 1 60); do
  nc -z "$POSTGRES_HOST" "$POSTGRES_PORT" && break
  sleep 3
done
exec /opt/canton/bin/canton sandbox --config /config/storage.conf --json-api-port 7575 \
  --log-file-appender off --log-level-stdout INFO
