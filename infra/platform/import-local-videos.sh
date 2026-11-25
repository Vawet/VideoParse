#!/bin/bash
# Import into the desktop platform's MySQL, media volume and Neo4j publication queue.
set -eu
cd "$(dirname "$0")/../.."
set -a
. infra/platform/.env
set +a
export DATABASE_URL="mysql+pymysql://videoparse:${DB_PASSWORD}@127.0.0.1:18306/videoparse?charset=utf8mb4"
export DATA_ROOT="$HOME/Library/Application Support/VideoParse/platform-local/media"
test -d "$DATA_ROOT/outputs"
cd 后端
exec .venv/bin/python -m app.import_archived_video "$@"
