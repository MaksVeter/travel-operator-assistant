#!/usr/bin/env bash
# Short smoke test: run CLI with --debug for a few fixed queries (see data/validation-dataset.json).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUERIES=(
	"what is the city code for Auckland"
	"what is the airport code for Toronto Pearson"
	"what is the airline code for SAS"
	"what is the equipment code for embraer 190"
	"what city is FCO"
	"find city code Tokyo Narita"
	"what is the airport code for El Prat"
	"iata code for Boston"
	"decode airport code FCO"
	"what is the airline code for Japan Airlines"
)

echo "CLI debug smoke test (v2 pipeline, stderr = steps, stdout = command)"
echo ""

for q in "${QUERIES[@]}"; do
	echo "================================================================"
	bun run packages/cli/src/main.ts -- --v2 --debug "$q" || true
	echo ""
done

echo "Done."
