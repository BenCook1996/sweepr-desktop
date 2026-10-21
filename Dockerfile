FROM node:22-bookworm-slim

WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && npm install --ignore-scripts tsx

COPY server/ ./

RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "src/index.ts"]
