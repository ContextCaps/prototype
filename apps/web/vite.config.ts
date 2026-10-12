import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In development the broker is reached through the Vite proxy, so the browser
// only ever talks to its own origin and no CORS setup is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: env.BROKER_PROXY_TARGET ?? "http://127.0.0.1:8787", changeOrigin: true },
      },
    },
  };
});
