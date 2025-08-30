# Build and run a Node.js server with Express + better-sqlite3
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install build tools for native deps (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (better cache)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy source
COPY server.js db.js ./
COPY public ./public

# Ensure runtime dirs
RUN mkdir -p /app/data /app/uploads/vehicles /app/uploads/receipts
VOLUME ["/app/data","/app/uploads"]

EXPOSE 3000
CMD ["node","server.js"]
