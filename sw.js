const CACHE_NAME = 'pianoworks-v3'; // ★ また上げる（ネットワーク優先方式に変更したので、これで一度クリーンになる）
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
    }).then(() => self.skipWaiting()) // ★ 待機させず即座に新しいSWへ切り替える
  );
});

// ★ 古いバージョンのキャッシュを削除し、すぐにページの制御を引き継ぐ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ★ ネットワーク優先：まずネットから最新を取りに行く。
//   オフライン等で取得に失敗した時だけ、キャッシュにあるものを返す。
//   （開発中にファイルを更新しても、古い内容が握られ続けるのを防ぐため）
self.addEventListener('fetch', (event) => {
  // 【追加】外部サイト（X/Twitterなど）へのリクエストは検問をスルーさせる
  if (!event.request.url.startsWith(self.location.origin)) {
    return; // 自分のサイト以外の通信には干渉しない
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // 取得できたら、次回オフライン用にキャッシュも更新しておく
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});