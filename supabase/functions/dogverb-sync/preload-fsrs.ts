// Load the vendored FSRS UMD through a static import so `supabase functions
// deploy --use-api` uploads the file. Do not use readFileSync here: the API
// bundler only includes modules the import scanner can see, and a missing
// vendor file at load time would crash the worker before OPTIONS can run.
// prepare-function.sh copies vendor/ts-fsrs.umd.js into this folder.
// @ts-ignore UMD has no type declarations
import * as FSRSMod from "./vendor/ts-fsrs.umd.js";

type FsrsNs = { fsrs?: unknown };
const g = globalThis as { FSRS?: FsrsNs };
const mod = FSRSMod as FsrsNs & { default?: FsrsNs };
const fromMod = (mod && mod.fsrs)
  ? mod
  : (mod && mod.default && mod.default.fsrs ? mod.default : null);
if (!g.FSRS || !g.FSRS.fsrs) {
  if (fromMod) g.FSRS = fromMod;
}
if (!g.FSRS || !g.FSRS.fsrs) {
  throw new Error("FSRS failed to load");
}
