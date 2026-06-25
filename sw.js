const CACHE_NAME = 'pianoworks-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/components.css',
  './css/theme.css',
  './css/ui.css',
  './css/session.css',
  './css/ui-base.css',
  './css/piano.css'
  // 他のJSファイルなどもここに追加
];

// インストール時にファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// スリープ復帰時など、ネットワークが不安定でもキャッシュから返す
self.addEventListener('fetch', (event) => {
  // 【追加】外部サイト（X/Twitterなど）へのリクエストは検問をスルーさせる
  if (!event.request.url.startsWith(self.location.origin)) {
    return; // 自分のサイト以外の通信には干渉しない
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});