# Build context: repo root. The DAR is committed under packages/ (Railway builds
# from GitHub, where .daml/ is not available). Rebuild + recommit it when Daml changes.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY scripts/demo-solve.mts ./scripts/demo-solve.mts
COPY packages ./packages
ENV DAR_DIRS=packages
CMD ["npx", "tsx", "server/index.ts"]
