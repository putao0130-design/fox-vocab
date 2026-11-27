// Request handler for Dog Verb pairing and sync.
// This file contains no secret. The service role key is read from the
// function secret SUPABASE_SERVICE_ROLE_KEY and is never returned or logged.
// Writes go through this function only. The client may send the anon key so
// the gateway will accept the request; that key is not used to open the database.
import { createClient } from "npm:@supabase/supabase-js@2";
import "./preload-fsrs.ts";
import { handleAction } from "./actions.js";
import { createPgAdapter } from "./pg-adapter.js";
import { json } from "./cors.ts";

function statusOf(error: string) {
  if (
    error === "unauthorized" ||
    error === "expired" ||
    error === "proof-invalid" ||
    error === "nonce-replay" ||
    error === "pair-replay"
  ) {
    return 401;
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

export async function handleRequest(req: Request) {
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
}
