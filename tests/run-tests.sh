#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Running Chisel hook tests..."
node "$SCRIPT_DIR/hooks/test-hooks.js"
echo "Done."
