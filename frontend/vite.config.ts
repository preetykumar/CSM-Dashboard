import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Absolute base: index.html references assets at /assets/* so SPA refreshes
  // on subpaths like /csm/dashboard resolve correctly. With "./" the browser
  // requests /csm/assets/* and 404s.
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
