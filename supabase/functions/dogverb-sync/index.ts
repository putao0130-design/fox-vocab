// Supabase Edge Function for Dog Verb pairing and sync.
// This file contains no secret. The service role key is read from the
// function secret SUPABASE_SERVICE_ROLE_KEY and is never returned or logged.
// Writes go through this function only. The client may send the anon key so
// the gateway will accept the request; that key is not used to open the database.
//
// OPTIONS is handled here with no other imports besides CORS. Heavy modules
// (FSRS, actions, Postgres adapter) load only for POST via a static-specifier
// dynamic import of the prepared bundle. `supabase functions deploy --use-api`
// only uploads files the import scanner can see; the previous entry used
// readFileSync and createRequire, so the worker crashed at load time and
// preflight returned 500 WORKER_ERROR.
import { cors, json } from "./cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { handleRequest } = await import("./bundle.js");
    return await handleRequest(req);
  } catch {
    return json({ error: "server-error" }, 500);
  }
});
