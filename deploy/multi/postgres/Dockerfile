# Build context: repo root.
FROM postgres:16
ENV PGDATA=/var/lib/postgresql/data/pgdata POSTGRES_USER=canton
COPY deploy/multi/postgres/init.sql /docker-entrypoint-initdb.d/01-init.sql
