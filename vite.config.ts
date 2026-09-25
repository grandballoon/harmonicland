/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pedagogical single-page tool; keep relative paths so the build can be
  // opened from disk or any subpath.
  base: "./",
  build: {
    // The Verovio engraving engine is one ~8 MB module (WebAssembly inlined
    // in JavaScript), fetched lazily by outputs/verovio.ts after the app is
    // up. It cannot be split further, so the limit sits just above it —
    // which also means a bloated app bundle no longer warns here; it is
    // ~120 kB, and that is the number to watch.
    chunkSizeWarningLimit: 8 * 1024,
  },
  // TF.js is imported only by the microphone's worker, so the dev server
  // would discover it on the first "Enable mic" and reload the page under
  // the listener. Pre-bundle it up front instead.
  optimizeDeps: { include: ["@tensorflow/tfjs"] },
  test: {
    // MusicxmlIn uses DOMParser and the renderers touch SVG geometry, so the
    // test runner needs a DOM. jsdom is enough for parsing + math.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
