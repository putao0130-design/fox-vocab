const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'supabase/functions/dogverb-sync');
const index = fs.readFileSync(path.join(FN, 'index.ts'), 'utf8');
const handler = fs.readFileSync(path.join(FN, 'handler.ts'), 'utf8');
const preload = fs.readFileSync(path.join(FN, 'preload-fsrs.ts'), 'utf8');
const actions = fs.readFileSync(path.join(FN, 'actions.js'), 'utf8');
const prepare = fs.readFileSync(path.join(ROOT, 'supabase/prepare-function.sh'), 'utf8');
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

assert.ok(index.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")') || handler.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'));
assert.ok(index.includes('never returned or logged') || handler.includes('never returned or logged'));
assert.ok(!/from ["']node:fs["']/.test(index) && !/\bcreateRequire\s*\(/.test(index) && !/\breadFileSync\s*\(/.test(index), 'index.ts must not read files or use createRequire at load time');
assert.ok(index.includes('req.method === "OPTIONS"'));
assert.ok(index.includes('import("./bundle.js")'), 'OPTIONS entry should dynamically import the prepared bundle');
const optionsAt = index.indexOf('req.method === "OPTIONS"');
const bundleAt = index.indexOf('import("./bundle.js")');
assert.ok(optionsAt >= 0 && bundleAt > optionsAt, 'OPTIONS must be handled before importing the bundle');

assert.ok(preload.includes('./vendor/ts-fsrs.umd.js'));
assert.ok(!/from ["']node:fs["']/.test(preload) && !/\bcreateRequire\s*\(/.test(preload) && !/\breadFileSync\s*\(/.test(preload));
assert.ok(handler.includes('import "./preload-fsrs.ts"'));
assert.ok(handler.includes('from "./actions.js"'));
assert.ok(handler.includes('from "./pg-adapter.js"'));
assert.ok(handler.includes('npm:@supabase/supabase-js@2'));
assert.ok(handler.includes('headers.set("Authorization", "Bearer " + serviceKey)'));
assert.ok(handler.includes('headers.set("apikey", serviceKey)'));
assert.ok(!/req\.headers\.get\(["']Authorization["']\)/.test(handler), 'db client must not forward the caller Authorization header');


assert.ok(actions.includes("require('./sync-wire.js')"));
assert.ok(actions.includes("require('./sync-prep.js')"));
assert.ok(!/require\('\.\/' \+ file\)/.test(actions));

assert.ok(prepare.includes('esbuild'));
assert.ok(prepare.includes('bundle.js'));
assert.ok(gitignore.includes('supabase/functions/dogverb-sync/bundle.js'));
assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rewrite-function-bundle.py')));
assert.ok(prepare.includes('rewrite-function-bundle.py'));

console.log('dogverb-sync-entry tests ok');
