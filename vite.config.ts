import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import sheetsProxyHandler from './api/sheets-proxy';
import loginHandler from './api/auth/login';
import createUserHandler from './api/users/create';
import listUsersHandler from './api/users/list';
import updateUserHandler from './api/users/update';
import deleteUserHandler from './api/users/delete';
import updateProfileHandler from './api/users/profile';
import purgeLegacyPasswordsHandler from './api/users/purge-legacy-passwords';
import approvalListHandler from './api/allocation-approvals/list';
import approvalFileHandler from './api/allocation-approvals/file';
import approvalUploadHandler from './api/allocation-approvals/upload';

type LocalApiHandler = (req: any, res: any) => unknown | Promise<unknown>;

const decorateLocalResponse = (res: any) => {
  res.status = (statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (payload: unknown) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };
};

const parseJsonBody = (req: any) => new Promise<void>((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      req.body = rawBody ? JSON.parse(rawBody) : {};
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const mountJsonApi = (server: any, route: string, handler: LocalApiHandler) => {
  server.middlewares.use(route, async (req: any, res: any) => {
    decorateLocalResponse(res);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') await parseJsonBody(req);
      await handler(req, res);
    } catch {
      if (!res.headersSent) res.status(400).json({ success: false, error: 'Invalid JSON request body' });
    }
  });
};

const mountRawApi = (server: any, route: string, handler: LocalApiHandler) => {
  server.middlewares.use(route, async (req: any, res: any) => {
    decorateLocalResponse(res);
    await handler(req, res);
  });
};

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
        name: 'local-vercel-api',
        configureServer(server) {
          mountJsonApi(server, '/api/sheets-proxy', sheetsProxyHandler);
          mountJsonApi(server, '/api/auth/login', loginHandler);
          mountJsonApi(server, '/api/users/create', createUserHandler);
          mountRawApi(server, '/api/users/list', listUsersHandler);
          mountJsonApi(server, '/api/users/update', updateUserHandler);
          mountJsonApi(server, '/api/users/delete', deleteUserHandler);
          mountJsonApi(server, '/api/users/profile', updateProfileHandler);
          mountJsonApi(server, '/api/users/purge-legacy-passwords', purgeLegacyPasswordsHandler);
          mountRawApi(server, '/api/allocation-approvals/list', approvalListHandler);
          mountRawApi(server, '/api/allocation-approvals/file', approvalFileHandler);
          mountRawApi(server, '/api/allocation-approvals/upload', approvalUploadHandler);
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
