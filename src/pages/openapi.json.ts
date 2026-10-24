import type { APIRoute } from "astro";
import { openapiSpec } from "../lib/openapi";

/**
 * What the site can be asked, in a form something else can read.
 *
 * These endpoints already existed and were undocumented, which meant an agent could only reach the
 * site by parsing HTML — and the whole argument for the Markdown twins is that it should not have
 * to. This is the same idea one level up: not "here is a page rendered for you" but "here is the
 * question you can ask".
 *
 * No authentication, deliberately, and that is why there is no
 * `/.well-known/oauth-protected-resource`: the data is open, and publishing a document that
 * describes how to authenticate against a resource that requires nothing would assert a protection
 * this site does not have.
 */
export const GET: APIRoute = () => {
  const spec = openapiSpec();
  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
};
