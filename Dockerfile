FROM node:24-bookworm-slim

RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./

RUN mkdir -p /app/server/data && chown -R node:node /app/server

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "src/index.ts"]
