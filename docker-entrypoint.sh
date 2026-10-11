#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/data}"
if command -v runuser >/dev/null 2>&1 && id node >/dev/null 2>&1; then
  chown node:node "${DATA_DIR:-/data}"
  exec runuser -u node -- node /app/src/server.js
fi
exec node /app/src/server.js
