#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ENV="${ROOT_DIR}/.env"
PACKAGES_DIR="${ROOT_DIR}/packages"

if [[ ! -f "${SOURCE_ENV}" ]]; then
  echo "Source .env not found at ${SOURCE_ENV}"
  exit 1
fi

if [[ ! -d "${PACKAGES_DIR}" ]]; then
  echo "Packages directory not found at ${PACKAGES_DIR}"
  exit 1
fi

copied_count=0

for package_dir in "${PACKAGES_DIR}"/*; do
  [[ -d "${package_dir}" ]] || continue
  cp "${SOURCE_ENV}" "${package_dir}/.env"
  echo "Copied .env -> ${package_dir}/.env"
  copied_count=$((copied_count + 1))
done

echo "Done. Updated ${copied_count} package .env file(s)."
