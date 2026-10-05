// Bundles main (ESM), preload (CJS — sandboxed preloads must be CommonJS)
// and renderer (IIFE), then copies the static renderer files.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });

const common = { bundle: true, sourcemap: true, target: "node22", logLevel: "warning" };

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    platform: "node",
    format: "esm",
    // acpx stays in node_modules and is imported lazily at runtime.
    external: ["electron", "acpx", "acpx/*"],
  }),
  build({
    ...common,
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/renderer.ts"],
    outfile: "dist/renderer/renderer.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
  }),
  cp("src/renderer/index.html", "dist/renderer/index.html"),
  cp("src/renderer/style.css", "dist/renderer/style.css"),
]);
console.log("built dist/");
