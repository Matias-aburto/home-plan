import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Casa",
        short_name: "Casa",
        description: "Todo lo de tu hogar, en un solo lugar.",
        theme_color: "#f8f7f3",
        background_color: "#f8f7f3",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "es",
        categories: ["lifestyle", "productivity"],
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Conserva el Host original: la API compara Origin con Host para rechazar escrituras de otros sitios.
      "/api": { target: "http://localhost:3001", changeOrigin: false }
    }
  }
});
