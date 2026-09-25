#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "Packaging skills archive into skills.zip..."
rm -f skills.zip
zip -r skills.zip skills/
echo "Created skills.zip successfully."