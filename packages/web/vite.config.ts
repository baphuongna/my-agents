import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // PWA assets (manifest, service worker, offline page, icons) live in
  // public/ — Vite copies them verbatim into dist/web/.
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable filenames for predictable gateway serving
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    proxy: {
      "/status": "http://127.0.0.1:3999",
      "/sessions": "http://127.0.0.1:3999",
      "/cron": "http://127.0.0.1:3999",
      "/events": {
        target: "ws://127.0.0.1:3999",
        ws: true,
      },
      "/sync": "http://127.0.0.1:3999",
      "/collab": "http://127.0.0.1:3999",
      "/push": "http://127.0.0.1:3999",
      "/channels": "http://127.0.0.1:3999",
      "/mcp": "http://127.0.0.1:3999",
      "/pool": "http://127.0.0.1:3999",
      "/config": "http://127.0.0.1:3999",
      "/models": "http://127.0.0.1:3999",
      "/tools": "http://127.0.0.1:3999",
      "/health": "http://127.0.0.1:3999",
      "/ready": "http://127.0.0.1:3999",
    },
  },
});
