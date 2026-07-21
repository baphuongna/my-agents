import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@hermes/shared": path.resolve(__dirname, "../shared/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    proxy: {
      "/status": "http://127.0.0.1:3999",
      "/sessions": "http://127.0.0.1:3999",
      "/events": { target: "ws://127.0.0.1:3999", ws: true },
      "/cron": "http://127.0.0.1:3999",
      "/models": "http://127.0.0.1:3999",
      "/tools": "http://127.0.0.1:3999",
      "/config": "http://127.0.0.1:3999",
      "/sync": "http://127.0.0.1:3999",
      "/collab": "http://127.0.0.1:3999",
      "/push": "http://127.0.0.1:3999",
      "/pool": "http://127.0.0.1:3999",
      "/health": "http://127.0.0.1:3999",
      "/ready": "http://127.0.0.1:3999",
      "/assets": "http://127.0.0.1:3999",
    },
  },
});
