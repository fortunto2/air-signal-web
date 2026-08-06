// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { SITE } from "./src/lib/site.ts";

export default defineConfig({
  site: SITE.origin,

  // Static output. Both upstreams (Sensor.Community, Open-Meteo) send
  // `access-control-allow-origin: *`, so live readings are fetched from the browser and no server
  // is needed. The one call that needs a server-side key — NASA FIRMS — is a Pages Function in
  // functions/, not an adapter.
  output: "static",

  // React rather than Preact: recharts and react-leaflet come from the Next app as React
  // components, and compat shims on charts are a debugging tax paid in pixels. Revisit if the
  // island bundle becomes the LCP problem.
  integrations: [react()],

  // Trailing slashes always, matching site.ts paths(). Cloudflare Pages 308s the slashless form,
  // and a canonical that redirects is a canonical that wastes a hop.
  trailingSlash: "always",

  vite: {
    plugins: [tailwindcss()],
  },
});
