import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import sheetsProxyHandler from './api/sheets-proxy';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'FIFA - Financial Integrated Flow Application',
          short_name: 'FIFA',
          description: 'Financial Integrated Flow Application',
          theme_color: '#005245',
          background_color: '#f9fafb',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          lang: 'id-ID',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
          globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
          globIgnores: ['**/pwa-*.png'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({url}) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
              method: 'GET',
            },
            {
              urlPattern: ({url}) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
              method: 'POST',
            },
            {
              urlPattern: /^https:\/\/(?:[^/]+\.)?(?:googleapis\.com|firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|script\.google\.com|script\.googleusercontent\.com)\//,
              handler: 'NetworkOnly',
              method: 'GET',
            },
            {
              urlPattern: /^https:\/\/(?:[^/]+\.)?(?:googleapis\.com|firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|script\.google\.com|script\.googleusercontent\.com)\//,
              handler: 'NetworkOnly',
              method: 'POST',
            },
          ],
        },
      }),
      {
        name: 'local-sheets-proxy',
        configureServer(server) {
          server.middlewares.use('/api/sheets-proxy', async (req: any, res: any) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', async () => {
              try {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                req.body = rawBody ? JSON.parse(rawBody) : {};
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON request body' }));
                return;
              }

              res.status = (statusCode: number) => {
                res.statusCode = statusCode;
                return res;
              };
              res.json = (payload: unknown) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(payload));
              };

              await sheetsProxyHandler(req, res);
            });
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
