import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
    plugins: [
        TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
        react(),
        tailwindcss()
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@srouter/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
            "@srouter/constants": path.resolve(__dirname, "../../packages/constants/src/index.ts")
        }
    },
    build: {
        chunkSizeWarningLimit: 1000
    },
    server: {
        port: 5173,
        proxy: {
            "/v1": "http://localhost:3000",
            "/health": "http://localhost:3000"
        }
    }
});
