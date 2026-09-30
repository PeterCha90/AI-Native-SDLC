import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 두 페이지다. / 는 사용자가 쓰는 할 일 앱, /ops 는 운영자가 보는 관측 콘솔. */
const opsRoute = {
  name: "ops-route",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/ops" || req.url === "/ops/") req.url = "/ops.html";
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), opsRoute],
  server: {
    port: 5180,
    proxy: { "/api": "http://localhost:4100" },
  },
  build: {
    rollupOptions: {
      input: { app: resolve(import.meta.dirname, "index.html"), ops: resolve(import.meta.dirname, "ops.html") },
    },
  },
});
