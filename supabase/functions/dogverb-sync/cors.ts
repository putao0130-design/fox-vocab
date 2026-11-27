// Shared CORS for the official GitHub Pages origin only.
// Local 127.0.0.1 is rejected on purpose.
export const ORIGIN = "https://putao0130-design.github.io";

export const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dogverb-request",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
