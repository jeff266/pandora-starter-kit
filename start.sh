#!/usr/bin/env bash
set -e

PORT=3001 node --max-old-space-size=1024 ./node_modules/.bin/tsx server/index.ts &

for i in $(seq 1 20); do
  curl -sf http://localhost:3001/health/alive > /dev/null 2>&1 && break
  sleep 1
done

fuser -k 5000/tcp 2>/dev/null || true
exec npx vite --config client/vite.config.ts
