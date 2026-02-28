// Service Worker — кэширует всё приложение для оффлайн-работы
const CACHE = 'chisty-prud-v1';
const FILES = [
    './',
    './index.html',
    './cashier.html',
    './admin.html',
    './styles.css',
    './db.js',
    './cashier.js',
    './admin.js',
    './manifest.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(FILES))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
});
