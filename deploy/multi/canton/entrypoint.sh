#!/bin/sh
set -eu
: "${POSTGRES_HOST:?set POSTGRES_HOST}" "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"
for i in $(seq 1 60); do nc -z "$POSTGRES_HOST" "$POSTGRES_PORT" && break; sleep 3; done
exec /opt/canton/bin/canton daemon -c /config/canton.conf --bootstrap /config/bootstrap.canton \
  --log-file-appender off --log-level-stdout INFO
