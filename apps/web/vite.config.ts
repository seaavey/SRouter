import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
    plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@srouter/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
            "@srouter/constants": path.resolve(__dirname, "../../packages/constants/src/index.ts")
        }
    },
    build: {
        chunkSizeWarningLimit: 500,
        cssCodeSplit: true,
        cssMinify: true,
        rollupOptions: {
            preserveEntrySignatures: "exports-only",
            output: {
                preserveModules: true,
                preserveModulesRoot: "src",
                entryFileNames: "sr-[hash:12].js",
                chunkFileNames: "sr-[hash:12].js",
                assetFileNames: "assets/sr-[hash:12][extname]"
            }
        }
    },
    server: {
        port: 5173,
        proxy: {
            "/v1": "http://localhost:3000",
            "/health": "http://localhost:3000"
        }
    }
});
