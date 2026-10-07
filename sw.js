// A service worker that does NOTHING with the network: no cache, no offline mode. Chrome on Android wants a service
// worker with a fetch handler before it offers "Install app" (an installed app starts full screen, without the address
// bar). Every request goes to the network exactly as without it, so the version guard in index.html (version.json,
// ?v=<version> on every module) keeps working.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass-through: the browser does the request itself */ });
