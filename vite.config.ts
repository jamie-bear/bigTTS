import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:20205";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    proxy: {
      "/favicon.ico": backend,
      "/api": backend,
      "/auth": backend,
      "/oauth": backend,
      "/stream": {
        target: backend.replace("http", "ws"),
        ws: true
      }
    }
  }
});
