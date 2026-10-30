import { defineConfig } from "vite";
export default defineConfig({
  root: "frontend",
  base: "/platform/",
  build: { outDir: "../public/platform", emptyOutDir: true },
  server: {
    proxy: {
      "/ui-theme.css": "http://127.0.0.1:4173",
      "/api": "http://127.0.0.1:4173",
      "/js": "http://127.0.0.1:4173",
      "/assets": "http://127.0.0.1:4173",
    },
  },
});
