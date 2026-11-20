/* TOÁN MR VY PWA - no data caching to protect fresh tuition/attendance/student data. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
