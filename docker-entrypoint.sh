#!/bin/sh
set -eu

DATA_FILE="${DATA_FILE:-/data/schedule.json}"
LOG_DIR="${LOG_DIR:-/data/logs}"
DATA_DIR="$(dirname "$DATA_FILE")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$LOG_DIR"
  chown -R node:node "$DATA_DIR" "$LOG_DIR"
  exec su-exec node:node "$@"
fi

exec "$@"
