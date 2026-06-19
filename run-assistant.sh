#!/usr/bin/env bash
# Travel Operator Assistant — natural language to Sabre command
#
# Usage:
#   ./run-assistant.sh                          # interactive mode (help + prompt)
#   ./run-assistant.sh "how do I get the sabre code for paris"
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

exec bun run packages/cli/src/main.ts --v2 --debug --sabre "$@"
