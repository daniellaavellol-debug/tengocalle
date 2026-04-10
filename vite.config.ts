import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    // Garantiza una sola instancia de React en el bundle.
    // Sin esto, @supabase/auth-ui-react puede traer su propia copia y
    // romper las Reglas de los Hooks con "Cannot read properties of null (reading 'useState')".
    dedupe: ['react', 'react-dom'],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('mapbox-gl'))   return 'vendor-mapbox';
          if (id.includes('@supabase'))   return 'vendor-supabase';
          if (id.includes('posthog-js'))  return 'vendor-posthog';
          if (id.includes('react'))       return 'vendor-react';
          return 'vendor-others';
        },
      },
    },
    chunkSizeWarningLimit: 700, // mapbox-gl supera el default de 500 KB
  },

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],

      manifest: {
        name: 'CALLE — ¿Cuánta calle tienes?',
        short_name: 'CALLE',
        description: 'Conquista tu ciudad. Gamificación urbana callejera.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        cacheId: 'calle-cache-v1-22',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB — necesario por mapbox-gl
        clientsClaim: true,
        skipWaiting: true,

        runtimeCaching: [
          // Mapbox tiles y API — CacheFirst (tiles no cambian frecuentemente)
          {
            urlPattern: /^https:\/\/(api|events)\.mapbox\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mapbox-api',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }, // 24h
            },
          },
          // Mapbox tiles vectoriales
          {
            urlPattern: /^https:\/\/.*\.tiles\.mapbox\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mapbox-tiles',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7d
            },
          },
          // Supabase — NetworkFirst (datos en tiempo real primero, cache como fallback)
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/(?!auth\/).*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 }, // 5 min
            },
          },
        ],
      },
    }),
  ],
});
