import type { APIRoute } from "astro";
import { placeSuggestions } from "../../../lib/crew";
import { jsonReply } from "../../../lib/http";

/**
 * Place search for /crew and the app: `?q=fres` → up to 8 US places, California first. Pass a chosen
 * one to /api/crew as `place=<lat>,<lon>`, which is unambiguous; a name is resolved California-first.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  const places = await placeSuggestions(q).catch(() => []);
  return jsonReply({ q, places }, 200, "public, max-age=0, s-maxage=86400");
};
