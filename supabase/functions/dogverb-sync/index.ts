// Supabase Edge Function for Dog Verb pairing and sync.
// This file contains no secret. The service role key is read from the
// function secret SUPABASE_SERVICE_ROLE_KEY and is never returned or logged.
// Writes go through this function only. The client may send the anon key so
// the gateway will accept the request; that key is not used to open the database.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const ORIGIN = "https://putao0130-design.github.io";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function preloadFsrs() {
  const g = globalThis as { FSRS?: unknown };
  if (g.FSRS) return;
  const umd = readFileSync(join(here, "vendor/ts-fsrs.umd.js"), "utf8");
  const factory = new Function("globalThis", umd + "\nreturn globalThis.FSRS;");
  g.FSRS = factory(globalThis);
}

preloadFsrs();
const { handleAction } = require("./actions.js");
const { createPgAdapter } = require("./pg-adapter.js");

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dogverb-request",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function statusOf(error: string) {
  if (
    error === "unauthorized" ||
    error === "expired" ||
    error === "proof-invalid" ||
    error === "nonce-replay" ||
    error === "pair-replay"
  ) {
    return error === "expired" ? 401 : 401;
  }
  if (error === "origin-rejected") return 403;
  if (error === "not-found") return 404;
  if (error === "rate-limited") return 429;
  if (error === "server-misconfigured") return 500;
  return 400;
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0].trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "not-found" }, 404);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json({ error: "server-misconfigured" }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  // Prefer the browser-controlled Origin header. Do not trust only the body.
  const headerOrigin = req.headers.get("origin") || "";
  if (headerOrigin) body.origin = headerOrigin;
  if (!body.ip) body.ip = clientIp(req);

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const result = await handleAction(createPgAdapter(client), body, {});
    if (result && result.error) return json(result, statusOf(String(result.error)));
    return json(result, 200);
  } catch (err) {
    const code = err && (err as { code?: string }).code;
    if (code === "pair-replay") return json({ error: "pair-replay" }, 401);
    if (code === "unauthorized") return json({ error: "unauthorized" }, 401);
    return json({ error: "server-error" }, 500);
  }
});
