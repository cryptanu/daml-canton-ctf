# Build context: repo root.
# Build context: repo root.
FROM postgres:16
# Railway volumes mount at /var/lib/postgresql/data; keep data in a subdirectory.
ENV PGDATA=/var/lib/postgresql/data/pgdata POSTGRES_USER=canton
COPY deploy/railway/postgres/init.sql /docker-entrypoint-initdb.d/01-init.sql
