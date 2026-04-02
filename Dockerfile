FROM node:22-slim

# Install system deps for better-sqlite3 native build
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install global tools
RUN npm install -g obsidian-headless readability-cli

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source
COPY tsconfig.json ./
COPY src/ src/
COPY scaffold/ scaffold/
COPY static/ static/

# Build TypeScript
RUN npx tsc

# Run migration on startup, then start the server
COPY scripts/ scripts/
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV DATABASE_PATH=/data/ithildin.db
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
