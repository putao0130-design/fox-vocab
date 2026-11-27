const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIR = new Set(['.git', 'node_modules', 'desktop']);
const TEXT_EXT = new Set(['.js', '.ts', '.sql', '.md', '.toml', '.json', '.html', '.css', '.webmanifest', '.sh', '.py', '.txt', '.yml', '.yaml', '.gitignore']);
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const SERVICE_ASSIGN = /service[_-]?role[^\n]{0,40}['"]eyJ/i;
const DB_URL = /postgres(?:ql)?:\/\/[^/\s:]+:[^@\s]+@/i;
const ENV_SECRET = /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/;

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    if (SKIP_DIR.has(ent.name) || ent.name.startsWith('.env')) return;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  });
}

const files = [];
walk(ROOT, files);
const hits = [];
files.forEach(function (file) {
  const ext = path.extname(file).toLowerCase();
  if (!TEXT_EXT.has(ext) && path.basename(file) !== '.gitignore') return;
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (JWT.test(text)) hits.push(rel + ': jwt-like secret');
  if (SERVICE_ASSIGN.test(text)) hits.push(rel + ': service_role assignment');
  if (DB_URL.test(text)) hits.push(rel + ': database url with password');
  if (ENV_SECRET.test(text)) hits.push(rel + ': service role env assignment');
});
assert.deepStrictEqual(hits, [], hits.join('\n'));

const config = fs.readFileSync(path.join(ROOT, 'sync-config.js'), 'utf8');
assert.ok(/anonKey:\s*''/.test(config));
assert.ok(!/service_role\s*[:=]\s*['\"]/i.test(config));
assert.ok(!/postgres(?:ql)?:\/\//i.test(config));

const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/dogverb-sync/index.ts'), 'utf8');
assert.ok(fn.includes("Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")"));
assert.ok(!JWT.test(fn));
assert.ok(fn.includes('never returned or logged') || fn.includes('never returned'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.ok(!html.includes('cloudbase') && !html.includes('tcb.cloud'));
assert.ok(html.includes('manifest.webmanifest?v=18'));
assert.ok(html.includes('assets/icons/install-v18/'));

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
assert.ok(app.includes("dictvoice?type=1") || fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8').includes('dictvoice?type=1'));
assert.ok(!fs.existsSync(path.join(ROOT, 'cloudbase')));

console.log('sync-secrets tests ok');
