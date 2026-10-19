# Canton 3.4.10 open-source sandbox with Postgres storage, for Railway.
# Build context: repo root. The release matches daml.yaml sdk-version 3.4.10.
FROM eclipse-temurin:17-jre
ARG CANTON_VERSION=3.4.10
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates netcat-openbsd \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/digital-asset/canton/releases/download/v${CANTON_VERSION}/canton-open-source-${CANTON_VERSION}.tar.gz" \
    | tar -xz -C /opt \
 && ln -s /opt/canton-open-source-${CANTON_VERSION} /opt/canton
COPY deploy/railway/canton/storage.conf /config/storage.conf
COPY deploy/railway/canton/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV JAVA_OPTS="-Xmx2g" POSTGRES_PORT=5432 POSTGRES_USER=canton
EXPOSE 7575
ENTRYPOINT ["/entrypoint.sh"]
