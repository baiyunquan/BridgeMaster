import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { templateCompilerOptions } from "@tresjs/core";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";

export default defineConfig({
  plugins: [
    vue({ ...templateCompilerOptions }),
    viteStaticCopy({
      targets: [
        {
          src: "../public/cards/vector-cards/cards-svg",
          dest: "cards/vector-cards",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/dds-api": {
        target: "http://localhost:8001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dds-api/, ""),
      },
    },
  },
});
