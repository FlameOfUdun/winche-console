/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",   // assets referenced relative to the injected <base href> (the console prefix)
  // Built into dist/; Winche Server embeds a build of it (its scripts/update-console-web.sh).
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // Dev: the console's API is Winche Server's; run one locally on port 5000.
    proxy: { "/_console": "http://localhost:5000" },
  },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts" },
});
