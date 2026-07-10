import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api/ws": {
        ws: true,
        target: "ws://localhost:8080/",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api": {
        target: "http://localhost:8080",
        // Keep the original Host (localhost:4000) so the server-side Google OAuth
        // flow builds a redirect_uri that points back through this dev proxy,
        // i.e. http://localhost:4000/api/google_callback (which the proxy handles).
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
