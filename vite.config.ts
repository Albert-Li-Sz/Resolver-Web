import { defineConfig } from "vite";
export default defineConfig({
  root: "frontend",
  base: "/platform/",
  build: { outDir: "../public/platform", emptyOutDir: true },
  server: {
    proxy: {
      "/ui-theme.css": "http://127.0.0.1:9080",
      "/api": "http://127.0.0.1:9080",
      "/js": "http://127.0.0.1:9080",
      "/assets": "http://127.0.0.1:9080",
    },
  },
});
