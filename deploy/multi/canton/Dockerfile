# Build context: repo root. Canton 3.4.10 open-source, two participants in one JVM.
FROM eclipse-temurin:17-jre
ARG CANTON_VERSION=3.4.10
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates netcat-openbsd \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/digital-asset/canton/releases/download/v${CANTON_VERSION}/canton-open-source-${CANTON_VERSION}.tar.gz" \
    | tar -xz -C /opt \
 && ln -s /opt/canton-open-source-${CANTON_VERSION} /opt/canton
COPY deploy/multi/canton/canton.conf deploy/multi/canton/bootstrap.canton /config/
COPY deploy/multi/canton/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV JAVA_OPTS="-Xmx3g" POSTGRES_PORT=5432 POSTGRES_USER=canton
EXPOSE 7575 7576
ENTRYPOINT ["/entrypoint.sh"]
