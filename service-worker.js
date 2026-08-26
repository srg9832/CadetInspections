'use strict';

const CACHE_VERSION = 'cap-uniform-pwa-v1.0.0';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const LOCAL_APP_FILES = [
  './',
  './index.html',
  './app.js',
  './offline-store.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(LOCAL_APP_FILES);
    // CDN libraries are cached independently so a temporary CDN problem cannot
    // prevent the service worker from installing.
    await Promise.all(CDN_FILES.map(async url => {
      try { await cache.add(url); } catch (err) { console.warn('Could not precache', url, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('cap-uniform-pwa-') && ![APP_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase API/auth/function traffic. Those requests need a live
  // connection and authenticated responses must not be placed in a shared cache.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    // config.js is network-first so a changed Supabase configuration is picked up
    // quickly, but the previous working copy remains available offline.
    if (url.pathname.endsWith('/config.js')) event.respondWith(networkFirst(request));
    else event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(RUNTIME_CACHE);
  cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then(async response => {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || (await fetchPromise) || Response.error();
}
