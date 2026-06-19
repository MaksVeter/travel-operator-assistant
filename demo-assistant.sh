#!/usr/bin/env bash
# Demo script — runs a few example queries for screen recording.
#
# Usage:
#   ./demo-assistant.sh
#
# Prerequisite: assistant API running (bun run assistant:local)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

QUERIES=(
	"how do I get the sabre code for paris"
	"what is the airport code for Heathrow"
	"find flights from JFK to London on March 10"
)

echo "Travel Operator Assistant — demo"
echo ""

for q in "${QUERIES[@]}"; do
	echo "================================================================"
	echo "Query: $q"
	echo "================================================================"
	./run-assistant.sh "$q"
	echo ""
done

echo "Demo complete."
