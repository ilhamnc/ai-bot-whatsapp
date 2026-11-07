FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=1 \
    BOT_STATE_DIR=/data/state \
    WA_AUTH_DIR=/data/auth \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=3030

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data/state /data/auth

EXPOSE 3030

# Volume Northflank bisa dimiliki root saat pertama dipasang.
CMD ["sh", "-c", "mkdir -p /data/state /data/auth && chown -R node:node /data && exec gosu node node server.js"]
