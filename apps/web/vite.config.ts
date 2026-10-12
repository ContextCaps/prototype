import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// Two pages, one deployment: the landing page at / (static, served from
// public/ as-is) and the live demo console at /demo/ (React).
// In development the broker is reached through the Vite proxy, so the browser
// only ever talks to its own origin and no CORS setup is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    build: {
      // public/assets holds the landing page's images; keep bundles out of it.
      assetsDir: "_app",
      rollupOptions: {
        input: {
          landing: fileURLToPath(new URL("./index.html", import.meta.url)),
          demo: fileURLToPath(new URL("./demo/index.html", import.meta.url)),
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: env.BROKER_PROXY_TARGET ?? "http://127.0.0.1:8787", changeOrigin: true },
      },
    },
  };
});
