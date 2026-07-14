import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // Phase C: PWA assets (manifest, service worker, offline page, icons) live
  // in `public/` so Vite copies them verbatim into dist/web/ without esbuild
  // touching the SW (which must remain a raw root-scope script).
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "web",
    },
    rollupOptions: {
      external: [], // Bundle everything for static deployment
    },
    // Output as a single JS file for simplicity
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
  },
  // For testing purposes
  test: {
    globals: true,
    environment: "node",
  },
});
