import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local-only dev proxy. Session cookies remain same-origin to the browser.
// Never expose this Vite server publicly until upstream auth security is cleared.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/axelor-erp": {
        target: process.env.IOETI_AXELOR_ORIGIN || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
