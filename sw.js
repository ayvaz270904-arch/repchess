// Версия кэша — меняй при необходимости принудительно сбросить старый кэш у всех
const CACHE = 'repchess-v4';

// Новый SW активируется сразу, не дожидаясь закрытия вкладок
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Удаляем все старые кэши
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    // Сразу берём под контроль уже открытые вкладки
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;
  const url = req.url;

  // Firebase / Google API — не трогаем, всегда напрямую в сеть
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('gstatic') || url.includes('google')) return;

  // HTML-страницы (сам код приложения) — ВСЕГДА из сети, чтобы не залипал старый код.
  // Кэш используется только как офлайн-резерв, если сети нет.
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))   // нет сети — отдаём последнюю сохранённую версию
    );
    return;
  }

  // Прочие ресурсы (иконки, манифест) — сеть-первой с резервом из кэша
  e.respondWith(
    fetch(req)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
