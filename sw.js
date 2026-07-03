// sw.js (Service Worker Sederhana)
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Terinstal');
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('[Service Worker] Aktif');
});

// Fetch listener wajib ada agar diakui sebagai PWA oleh browser
self.addEventListener('fetch', (e) => {
    // Untuk sekarang biarkan kosong agar tidak mengganggu proses development
});
