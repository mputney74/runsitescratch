import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    // Chunk size warning threshold — Platform.jsx is large by design
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep all app code in a single chunk — avoids lazy-load race conditions
        // on Stripe return when the app needs to restore state immediately.
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    // Proxy API calls to Railway in local dev — avoids CORS issues
    proxy: {
      "/api": {
        target: "https://runsitescratch-server-production.up.railway.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
