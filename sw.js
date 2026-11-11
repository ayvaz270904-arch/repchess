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

// Сайт не ответил, и страница открыта из кэша. Раньше это происходило молча: человек
// видел старую версию и не понимал, почему не работают свежие исправления
// (так было у тренера без VPN 11.11). Теперь сверху страницы плашка. Она встроена прямо в
// HTML копии со своими стилями, поэтому работает в любой старой версии страницы.
function offlineBar(dateHeader) {
  let when = '';
  const d = new Date(dateHeader || '');
  if (!isNaN(d.getTime())) {
    const p = n => String(n).padStart(2, '0');
    when = ' от ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  return '<div id="sw-offline-bar" role="alert" style="position:fixed;left:0;right:0;top:0;z-index:2147483647;'
    + 'background:#8a2a22;color:#fff;font:14px/1.45 -apple-system,\'Segoe UI\',Roboto,Arial,sans-serif;'
    + 'padding:10px 44px 10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.45);text-align:left">'
    + '<b>Сайт не загрузился — открыта сохранённая копия' + when + '.</b> '
    + 'В ней может не быть последних исправлений. Проверьте интернет или включите VPN и нажмите '
    + '<button type="button" onclick="location.reload()" style="margin-left:4px;padding:4px 12px;border:0;'
    + 'border-radius:6px;background:#fff;color:#8a2a22;font:inherit;font-weight:700;cursor:pointer">Обновить</button>'
    + '<button type="button" aria-label="Закрыть" onclick="this.parentNode.remove()" style="position:absolute;'
    + 'right:6px;top:6px;width:30px;height:30px;border:0;background:transparent;color:#fff;font-size:22px;'
    + 'line-height:1;cursor:pointer">×</button></div>';
}

async function cachedWithBar(req) {
  const cached = await caches.match(req);
  if (!cached) return Response.error();
  try {
    const html = await cached.clone().text();
    const bar = offlineBar(cached.headers.get('date'));
    const out = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + bar) : bar + html;
    return new Response(out, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (err) {
    return cached;   // не смогли дописать плашку — отдаём копию как есть
  }
}

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
        .catch(() => cachedWithBar(req))   // нет сети — последняя сохранённая версия с плашкой
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
