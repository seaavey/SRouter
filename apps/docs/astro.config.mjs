import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
    site: "https://srouter.web.id",
    integrations: [sitemap()]
});
