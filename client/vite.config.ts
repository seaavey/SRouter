import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must run before react(): the plugin generates `routeTree.gen.ts` from
    // `src/routes/**`, and the React plugin needs that file to exist.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // The admin session is an HttpOnly cookie with `SameSite=Lax`. A browser
    // treats `localhost:5173` and `127.0.0.1:3000` as different *sites*, so a
    // cross-origin dev setup silently drops the cookie: login answers 200 and
    // the next request is still unauthenticated. Proxying keeps every request
    // same-origin, which is also how production serves it (the built dashboard
    // is served by the API itself), so dev and prod follow one path.
    //
    // Same-origin means the browser sends no CORS preflight, and the `Origin`
    // header reaches the server's CSRF guard intact. Do not strip it here.
    proxy: {
      "/v1": {
        target: process.env.SROUTER_API_URL ?? "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
})
