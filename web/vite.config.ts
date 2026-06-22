/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",   // assets referenced relative to the injected <base href> (the console prefix)
  build: { outDir: "../src/Winche.Console/wwwroot", emptyOutDir: true },
  server: {
    // Dev proxy: SPA dev server forwards console API calls to a host app running the console.
    proxy: { "/_console": "http://localhost:5198" },
  },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts" },
});
