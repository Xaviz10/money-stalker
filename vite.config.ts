import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.APP_BASE_PATH ?? '/money-stalker/',
  plugins: [react(), {
    name: 'scoped-pwa',
    generateBundle(_, bundle) {
      const base = process.env.APP_BASE_PATH ?? '/money-stalker/';
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
        id: base, name: 'Money Stalker', short_name: 'Money Stalker', lang: 'es-CO',
        start_url: base, scope: base, display: 'standalone', background_color: '#f3f5f9',
        theme_color: '#235ac5', icons: [{ src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }) });
      const assets = Object.keys(bundle).filter(p => /\.(js|css|svg)$/.test(p)).map(p => base + p);
      // Never cache navigations, OAuth callbacks, API responses, or user data.
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const ASSETS = ${JSON.stringify(assets)};
const CACHE = 'money-stalker-' + ${JSON.stringify(assets.join('|'))};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('money-stalker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => { const u = new URL(e.request.url); if (e.request.method === 'GET' && u.origin === self.location.origin && !u.search && ASSETS.includes(u.pathname)) e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
` });
    },
  }],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
