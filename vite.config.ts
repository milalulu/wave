import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        mini: resolve(__dirname, "mini.html"),
      },
      output: {
        // Разбиваем тяжёлые вендоры на отдельные чанки (кэш + маленький main).
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("@tauri-apps") || id.includes("@fabianlars/tauri-plugin-oauth")) {
              return "tauri";
            }
            if (id.includes("@supabase")) return "supabase";
            if (id.includes("zustand")) return "zustand";
            if (id.includes("react") || id.includes("scheduler")) return "react";
          }
          return undefined;
        },
      },
    },
  },
}));
