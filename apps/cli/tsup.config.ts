import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    clean: true,
    minify: true,
    target: "node22",
    noExternal: [/@srouter\/.*/],
    removeNodeProtocol: false
});

