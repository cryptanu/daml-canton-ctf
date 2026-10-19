# Build context: repo root (same as the backend service).
FROM node:22-alpine
WORKDIR /gw
RUN npm i @canton-network/wallet-gateway-remote@1.12.0 && mkdir -p /gw/data
COPY deploy/hosted/gateway/config.template.json deploy/hosted/gateway/entrypoint.mjs ./
EXPOSE 3030
CMD ["node", "entrypoint.mjs"]
