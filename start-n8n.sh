#!/usr/bin/env bash
# n8n offline launcher — place next to the extracted "n8n" folder, then run it
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export N8N_USER_FOLDER="${N8N_USER_FOLDER:-$HOME/.n8n}"
exec node "$DIR/n8n/bin/n8n" start
