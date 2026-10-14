FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build:web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATA_DIR=/app/data

EXPOSE 8787
VOLUME ["/app/data"]

ENTRYPOINT []
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/src/index.ts"]
