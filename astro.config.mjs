// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { SITE } from "./src/lib/site.ts";

export default defineConfig({
  site: SITE.origin,

  // Server-rendered, from D1, on a Cloudflare Worker.
  //
  // The earlier plan was a static build, and it worked on paper: ~2 500 city pages plus ~8 400
  // station pages fits under the 20 000-file ceiling. It stops working the moment `ru` and `tr`
  // land — three locales is 33 000 files — and it makes thirty days of history a thing the repo
  // has to carry. Rendering from a database costs one Worker and removes both problems at once.
  //
  // What does NOT change is the rule this whole rewrite exists for: the answer is in the HTML.
  // SSR satisfies that as completely as a static file did; a crawler cannot tell the difference,
  // and `Cache-Control: s-maxage` in src/middleware.ts means the edge, not the database, answers
  // the second request onward.
  output: "server",

  // The adapter runs `astro dev` inside workerd via @cloudflare/vite-plugin and reads the bindings
  // straight out of wrangler.jsonc — so a D1 query that works in dev is the same query in
  // production, against the same client. Bindings are reached with
  // `import { env } from "cloudflare:workers"`; `Astro.locals.runtime.env` throws in Astro 6.
  adapter: cloudflare({ imageService: "passthrough" }),

  // React rather than Preact: the components come from the Next app as React, and compat shims on
  // charts are a debugging tax paid in pixels. Revisit if the island bundle becomes the LCP problem.
  integrations: [react()],

  // One rule for the whole site, and it has to be `never`.
  //
  // `always` makes the router demand a trailing slash on *every* route, endpoints included, so
  // `/sitemap-cities-1.xml` 404s and only `/sitemap-cities-1.xml/` answers — a URL nobody will
  // ever request. `ignore` turns out to match only the slashless form anyway. Since a `.md` twin
  // and a sharded `.xml` cannot live under a slash, the extensionless pages are the ones that give.
  //
  // Nothing is lost: this is a Worker, not a static host, so there is no platform redirect to
  // avoid. `paths` in src/lib/site.ts emits the canonical slashless form, the canonical tag says
  // so, and src/middleware.ts 301s the slashed form for anyone holding an old link.
  trailingSlash: "never",

  vite: {
    // The cast is a version-skew nuisance, not a real incompatibility: `@tailwindcss/vite` ships
    // types built against Vite 8 while Astro 6 resolves Vite 7, so the two `Plugin` types differ
    // structurally on a hook neither of them calls here. The plugin runs correctly; only `astro
    // check` objects, and silencing it with a cast beats pinning either package back.
    plugins: /** @type {any} */ ([tailwindcss()]),
  },
});
