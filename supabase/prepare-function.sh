#!/bin/bash
# Copy shared learning/sync modules into the Edge Function folder and bundle
# them so a CLI --use-api deploy is self-contained. Run from anywhere:
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

# --use-api only uploads modules the import scanner can see, and the Edge
# runtime has no reliable filesystem for readFileSync/require of siblings.
# Bundle the handler and its local CommonJS/UMD dependencies into one ESM file.
npx --yes esbuild@0.25.12 "$DEST/handler.ts" \
  --bundle \
  --format=esm \
  --platform=node \
  --target=es2022 \
  --outfile="$DEST/bundle.js" \
  --external:npm:@supabase/supabase-js@2 \
  --external:node:crypto \
  --external:fs \
  --external:path \
  --external:vm \
  --alias:crypto=node:crypto \
  --legal-comments=none

python3 "$ROOT/supabase/rewrite-function-bundle.py" "$DEST/bundle.js"
echo "Prepared $DEST (sync-wire.js, sync-prep.js, core.js, vendor/ts-fsrs.umd.js, bundle.js)"
