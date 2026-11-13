// Ссылки-источники (с 13.11.2026): откуда люди приходят в бота и сколько потом платят.
//
// Админ создаёт ссылку в тренерке (название → метка «транслит_ДДММГГ»). Ссылок у метки две:
//   • со счётом кликов — https://<api>/go/<метка>: переход записывается в события (link_click)
//     и сразу уходит в бота https://t.me/<бот>?start=src_<метка>;
//   • прямая — t.me/<бот>?start=src_<метка>: кликов не видно, остальное считается.
// Запуски — события бота `start` с деталью src_<метка> (бот пишет их с 13.11.2026).
// Оплаты — первая ссылка человека («первое касание»): его почты из событий (после привязки
// кабинета) → строки листа оплат с этой почтой, оплаченные (tinkoff|sber|pay, сумма > 0) ПОСЛЕ
// первого запуска по ссылке. Кто запустил бота, но так и не поделился номером, — без почты,
// его оплаты не видны.
//
//   GET  /go/<метка>          — переход (без входа)
//   POST /v1/links/list       — ссылки со статистикой (админ)
//   POST /v1/links/create     { name }                → { link }
//   POST /v1/links/archive    { slug, archived }      → { ok }
//   POST /v1/links/delete     { slugs: [...] }        → { deleted: [...] } — только из архива (14.11.2026)

import { ApiError, qualify } from './store.js'

const L = () => qualify('links')
const E = () => qualify('events')
const P = () => qualify('payments')
const PM = () => qualify('payments_meta')
const SLUG_RE = /^[a-z0-9_]{1,60}$/

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
export function translit(name) {
  const s = String(name || '').toLowerCase().split('').map(ch => (ch in TR ? TR[ch] : ch)).join('')
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '') || 'link'
}
// Дата создания в метке — по Москве, ДДММГГ
export function mskStamp(ms) {
  const d = new Date(ms + 3 * 3600000)
  const p = n => String(n).padStart(2, '0')
  return p(d.getUTCDate()) + p(d.getUTCMonth() + 1) + String(d.getUTCFullYear()).slice(2)
}

// Предпросмотр ссылок (Telegram, VK, мессенджеры) и роботы — не клики. «Telegram-Android» —
// встроенный браузер Telegram, это живой человек; робот превью Telegram — «TelegramBot».
const BOT_UA = /(bot\b|crawler|spider|facebookexternalhit|vkshare|whatsapp|slack|discord|curl|wget|python|headless|preview)/i

async function visitorHash(ip, ua) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(ip) + '|' + String(ua)))
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function botUrl(env, slug) {
  const bot = (env && env.BOT_USERNAME) || 'RepChessEducation_bot'
  return 'https://t.me/' + bot + (slug ? '?start=src_' + slug : '')
}

// Переход по ссылке: записать клик и отправить в бота. Любой сбой базы — всё равно в бота.
export async function goRedirect(request, env, deps, slugRaw) {
  let slug = ''
  try { slug = decodeURIComponent(slugRaw || '').toLowerCase() } catch { slug = '' }
  let target = botUrl(env, '')
  if (SLUG_RE.test(slug)) {
    try {
      await deps.withClient(async c => {
        const r = await c.query(`SELECT slug FROM ${L()} WHERE slug = $1`, [slug])
        if (!r.rows[0]) return
        target = botUrl(env, slug)
        const ua = request.headers.get('user-agent') || ''
        if (BOT_UA.test(ua)) return
        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
        await c.query(`INSERT INTO ${E()} (ts, src, event, detail, visitor) VALUES (now(), 'web', 'link_click', $1, $2)`,
          [slug, await visitorHash(ip, ua)])
      })
    } catch (e) {
      ;(deps.log || (x => console.error(x)))(e)
    }
  }
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } })
}

export async function linksCreate(client, body, who) {
  const name = String((body && body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) throw new ApiError('invalid-argument', 'нужно название источника')
  const base = translit(name) + '_' + mskStamp(Date.now())
  for (let i = 1; i <= 20; i++) {
    const slug = i === 1 ? base : base + '_' + i
    const r = await client.query(
      `INSERT INTO ${L()} (slug, name, created_by) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING
       RETURNING slug, name, created_at, archived`, [slug, name, String((who && who.uid) || '')])
    if (r.rows[0]) return { link: rowOut(r.rows[0]) }
  }
  throw new ApiError('already-exists', 'слишком много ссылок с таким названием за день')
}

export async function linksArchive(client, body) {
  const slug = String((body && body.slug) || '')
  if (!SLUG_RE.test(slug)) throw new ApiError('invalid-argument', 'нет такой метки')
  const r = await client.query(`UPDATE ${L()} SET archived = $2 WHERE slug = $1`, [slug, body.archived !== false])
  if (!r.rowCount) throw new ApiError('not-found', 'ссылка не найдена')
  return { ok: true }
}

// Удаление из архива (решение владельца 14.11.2026): только архивные; события (клики, запуски)
// остаются, но без названия ссылки. Переход /go по удалённой метке ведёт в бота без метки.
export async function linksDelete(client, body) {
  const slugs = Array.isArray(body && body.slugs) ? body.slugs.map(String).filter(s => SLUG_RE.test(s)).slice(0, 500) : []
  if (!slugs.length) throw new ApiError('invalid-argument', 'нет ссылок для удаления')
  const r = await client.query(`DELETE FROM ${L()} WHERE slug = ANY($1) AND archived RETURNING slug`, [slugs])
  return { deleted: r.rows.map(x => x.slug) }
}

const rowOut = r => ({ slug: r.slug, name: r.name, createdAt: new Date(r.created_at).toISOString(), archived: !!r.archived })

// Статистика по всем ссылкам одним запросом (событий — тысячи, оплат — сотни).
export async function linksList(client, env) {
  const r = await client.query(
    `WITH lk AS (SELECT slug, name, created_at, archived FROM ${L()}),
     st AS (
       SELECT tg_id, substr(detail, 5) AS slug, ts FROM ${E()}
        WHERE event = 'start' AND detail LIKE 'src\\_%' AND tg_id <> ''
     ),
     first AS (SELECT DISTINCT ON (tg_id) tg_id, slug, ts FROM st ORDER BY tg_id, ts),
     newbie AS (
       SELECT f.slug, count(*)::int AS n FROM first f
        WHERE NOT EXISTS (SELECT 1 FROM ${E()} e WHERE e.tg_id = f.tg_id AND e.ts < f.ts - interval '2 seconds')
        GROUP BY f.slug
     ),
     starts AS (SELECT slug, count(*)::int AS n, count(DISTINCT tg_id)::int AS u FROM st GROUP BY slug),
     clicks AS (
       SELECT detail AS slug, count(*)::int AS n, count(DISTINCT visitor)::int AS u FROM ${E()}
        WHERE event = 'link_click' GROUP BY detail
     ),
     mails AS (
       SELECT DISTINCT f.slug, f.tg_id, f.ts, e.email FROM first f
         JOIN ${E()} e ON e.tg_id = f.tg_id AND e.email <> ''
     ),
     cols AS (
       SELECT (SELECT i - 1 FROM jsonb_array_elements_text(columns) WITH ORDINALITY x(k, i) WHERE btrim(k) = 'sent' LIMIT 1) AS c_sent,
              (SELECT i - 1 FROM jsonb_array_elements_text(columns) WITH ORDINALITY x(k, i) WHERE btrim(k) = 'paymentid' LIMIT 1) AS c_pid,
              (SELECT i - 1 FROM jsonb_array_elements_text(columns) WITH ORDINALITY x(k, i) WHERE btrim(k) = 'price' LIMIT 1) AS c_price
         FROM ${PM()} WHERE id = 1
     ),
     pay AS (
       SELECT p.row_num, p.email,
              CASE WHEN jsonb_typeof(p.cells -> cols.c_sent::int) = 'object'
                   THEN (p.cells -> cols.c_sent::int ->> 'd')::timestamptz END AS paid_at,
              coalesce(nullif(regexp_replace(replace(p.cells ->> cols.c_price::int, ',', '.'), '[^0-9.]', '', 'g'), ''), '0')::numeric AS price,
              coalesce(p.cells ->> cols.c_pid::int, '') AS pid
         FROM ${P()} p, cols
     ),
     paid AS (
       SELECT DISTINCT m.slug, m.tg_id, pay.row_num, pay.price FROM mails m
         JOIN pay ON pay.email = m.email
        WHERE pay.pid ~* '(tinkoff|sber|pay)' AND pay.price > 0 AND pay.paid_at >= m.ts
     ),
     money AS (SELECT slug, count(DISTINCT tg_id)::int AS payers, count(*)::int AS n, sum(price) AS sum FROM paid GROUP BY slug)
     SELECT lk.*, coalesce(clicks.n, 0) AS clicks, coalesce(clicks.u, 0) AS clicks_u,
            coalesce(starts.n, 0) AS starts, coalesce(starts.u, 0) AS starts_u, coalesce(newbie.n, 0) AS newbies,
            coalesce(money.payers, 0) AS payers, coalesce(money.n, 0) AS payments, coalesce(money.sum, 0)::float AS sum
       FROM lk
       LEFT JOIN clicks ON clicks.slug = lk.slug
       LEFT JOIN starts ON starts.slug = lk.slug
       LEFT JOIN newbie ON newbie.slug = lk.slug
       LEFT JOIN money ON money.slug = lk.slug
      ORDER BY lk.created_at DESC`)
  return {
    links: r.rows.map(x => ({
      ...rowOut(x),
      bot: botUrl(env, x.slug),
      stats: { clicks: x.clicks, clicksUniq: x.clicks_u, starts: x.starts, startsPeople: x.starts_u, newcomers: x.newbies,
        payers: x.payers, payments: x.payments, sum: Math.round(x.sum) },
    })),
  }
}
