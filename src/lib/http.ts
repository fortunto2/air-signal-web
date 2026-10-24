/**
 * One JSON response for the crew API routes. Every route here sent the same three headers by hand,
 * and the copies had started to drift (one lacked CORS). Open data: CORS is on unless asked off.
 */
export function jsonReply(body: unknown, status = 200, cache = "no-store", cors = true): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": status >= 400 ? "no-store" : cache,
  };
  if (cors) headers["access-control-allow-origin"] = "*";
  return new Response(JSON.stringify(body), { status, headers });
}
