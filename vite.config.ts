/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pedagogical single-page tool; keep relative paths so the build can be
  // opened from disk or any subpath.
  base: "./",
  test: {
    // MusicxmlIn uses DOMParser and the renderers touch SVG geometry, so the
    // test runner needs a DOM. jsdom is enough for parsing + math.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
