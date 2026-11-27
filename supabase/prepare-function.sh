#!/bin/bash
# Copy shared learning/sync modules into the Edge Function folder so a
# dashboard or CLI deploy is self-contained. Run from anywhere:
#   bash supabase/prepare-function.sh
# Do not put secrets in this folder. This script does not deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/supabase/functions/dogverb-sync"
mkdir -p "$DEST/vendor"
cp "$ROOT/sync-wire.js" "$DEST/sync-wire.js"
cp "$ROOT/sync-prep.js" "$DEST/sync-prep.js"
cp "$ROOT/core.js" "$DEST/core.js"
cp "$ROOT/vendor/ts-fsrs.umd.js" "$DEST/vendor/ts-fsrs.umd.js"
echo "Prepared $DEST (sync-wire.js, sync-prep.js, core.js, vendor/ts-fsrs.umd.js)"
