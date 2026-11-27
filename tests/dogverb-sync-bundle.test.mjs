import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const bundlePath = path.join(ROOT, "supabase/functions/dogverb-sync/bundle.js");
if (!fs.existsSync(bundlePath)) {
  const prepared = spawnSync("bash", ["supabase/prepare-function.sh"], { cwd: ROOT, stdio: "inherit" });
  assert.equal(prepared.status, 0, "prepare-function.sh failed");
}

const src = fs.readFileSync(bundlePath, "utf8");
assert.ok(src.includes('from "node:crypto"'));
assert.ok(!src.includes('__require("node:crypto")'));
assert.ok(src.includes("handleRequest"));

const dir = fs.mkdtempSync(path.join("/tmp", "dogverb-bundle-"));
const stub = path.join(dir, "supabase-js-stub.js");
fs.writeFileSync(stub, "export function createClient() { return { from() { return {}; }, rpc() { return {}; } }; }\n");
const rewritten = path.join(dir, "bundle.js");
const rewrittenSrc = src.replace(
  'from "npm:@supabase/supabase-js@2"',
  `from ${JSON.stringify(pathToFileURL(stub).href)}`
);
assert.ok(rewrittenSrc !== src, "expected to rewrite the supabase-js import for the load test");
fs.writeFileSync(rewritten, rewrittenSrc);

globalThis.Deno = { env: { get() { return ""; } } };
const mod = await import(pathToFileURL(rewritten).href);
assert.equal(typeof mod.handleRequest, "function");
assert.ok(globalThis.FSRS && typeof globalThis.FSRS.fsrs === "function", "FSRS should be on globalThis after loading the bundle");

const res = await mod.handleRequest(new Request("https://example.com/functions/v1/dogverb-sync", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://putao0130-design.github.io" },
  body: "{}"
}));
assert.equal(res.status, 500);
const body = await res.json();
assert.deepStrictEqual(body, { error: "server-misconfigured" });
assert.equal(res.headers.get("access-control-allow-origin"), "https://putao0130-design.github.io");

const bad = await mod.handleRequest(new Request("https://example.com/functions/v1/dogverb-sync", { method: "GET" }));
assert.equal(bad.status, 404);

console.log("dogverb-sync-bundle tests ok");
