// Оплаты — копия первого листа Table 2 («ГЛАВНАЯ», все колонки) в Postgres (с 11.11.2026).
//
// Источник остаётся в Google-таблице. Копию целиком присылает только CRM-прокси:
// раз в минуту его зовёт расписание этого Worker (paymentsCron), после своих записей прокси
// шлёт копию сам, бот после своих записей просит его о том же. Одна точка записи —
// поэтому две копии разного возраста не перетирают друг друга.
//
//   POST /v1/payments/sync   — заменить копию (служебный ключ; это зовёт прокси)
//   GET  /v1/payments        — CSV ровно как у прокси: админ — все строки, тренер — строки
//                              закреплённых учеников (тренерка, CRM)
//   GET  /v1/payments/rows   — строки одного человека для бота: ?phone=10 цифр&email=почта
//                              (служебный ключ); ?all=1 — все строки (сверка)
//   GET  /v1/payments/meta   — сколько строк, когда обновлялась, сводка для сверки (админ, ключ)
//
// Копия «протухла» (прокси больше PAY_STALE_SEC не подтверждал, что она равна листу) →
// чтение отвечает 503, и страницы с ботом сами берут данные из таблицы, как раньше.
// Большие ответы собирает Postgres (string_agg, jsonb_agg): Worker не разбирает JSON на сотни
// килобайт — у бесплатного Cloudflare 10 мс процессора на запрос.

import { ApiError, qualify } from './store.js'

export const PAY_STALE_SEC = 20 * 60
const MAX_SYNC_BODY = 16_000_000
const T = () => qualify('payments')
const M = () => qualify('payments_meta')

// Как _clean в прокси и cleanVal в боте: снять пробелы и кавычки, которыми Тильда обрамляет значения
export const clean = s => String(s == null ? '' : s).trim().replace(/^"+|"+$/g, '').trim()
// Как parsePrice в боте
export const parsePrice = s => parseFloat(String(s == null ? '' : s).replace(/[\s "]/g, '').replace(',', '.')) || 0

function staleCheck(m) {
  if (!m) throw new ApiError('unavailable', 'копии оплат ещё нет')
  if (!(Number(m.age) <= PAY_STALE_SEC)) throw new ApiError('unavailable', 'копия оплат давно не сверялась с таблицей')
}

// Ошибки данных из Postgres (класс 22 — неверное значение, 23 — дубль строки) — это ошибка
// присланной копии, а не сервера
function dataError(e) {
  if (e && typeof e.code === 'string' && /^2[23]/.test(e.code)) return new ApiError('invalid-argument', e.message)
  return e
}

export async function paymentsSync(client, text, allowShrink) {
  if (text.length > MAX_SYNC_BODY) throw new ApiError('invalid-argument', 'слишком большая копия')
  try {
    const r = await client.query(`SELECT ${qualify('payments_sync')}($1::jsonb, $2) AS r`, [text, !!allowShrink])
    return r.rows[0].r
  } catch (e) { throw dataError(e) }
}

// Почты учеников тренера — как в прокси (_auth): без кавычек и пробелов, строчными
async function assignedOf(client, uid) {
  const r = await client.query(`SELECT doc->'assignedStudents' AS a FROM ${qualify('trainers')} WHERE id = $1`, [uid])
  const a = r.rows[0] && r.rows[0].a
  // Не строка — пропускаем (прокси превращал её в '' и отдавал строки с пустой почтой)
  return Array.isArray(a) ? [...new Set(a.filter(v => typeof v === 'string').map(v => clean(v).toLowerCase()).filter(Boolean))] : []
}

// CSV одной строкой текста: шапка + строки по порядку листа, разделитель \n (как у прокси)
export async function paymentsCsv(client, auth) {
  let filter = '', params = []
  if (auth.isService || auth.role === 'admin') {
    // все строки
  } else if (auth.role === 'trainer') {
    filter = 'WHERE email = ANY($1::text[])'
    params = [await assignedOf(client, auth.uid)]
  } else {
    throw new ApiError('permission-denied', 'нет доступа')
  }
  const r = await client.query(
    `SELECT m.header, m.synced_at, m.checked_at, extract(epoch FROM now() - m.checked_at)::float8 AS age,
            (SELECT string_agg(line, E'\\n' ORDER BY row_num) FROM ${T()} ${filter}) AS body
       FROM ${M()} m WHERE m.id = 1`, params)
  const m = r.rows[0]
  staleCheck(m)
  return { text: m.header + (m.body ? '\n' + m.body : ''), syncedAt: m.synced_at, checkedAt: m.checked_at }
}

// Строки одного человека для бота. Берём ровно то, что нужно clientBalance, findClientByPhone
// и findClientByEmail: строки с его телефоном, строки с его почтой и строки с любой почтой из
// строк его телефона (по ним бот решает, общая ли почта, и собирает все почты человека).
// Порядок — как в листе. Ответ — JSON-текст: { columns, total, syncedAt, rows: [[ячейки], …] }.
export async function paymentsRows(client, params) {
  const all = params.get('all') === '1'
  const phone = params.get('phone') || ''
  const email = params.get('email') || ''
  if (phone && !/^\d{10}$/.test(phone)) throw new ApiError('invalid-argument', 'phone — 10 цифр')
  if (email.length > 320) throw new ApiError('invalid-argument', 'слишком длинная почта')
  if (!all && !phone && !email) throw new ApiError('invalid-argument', 'нужен phone, email или all=1')
  const where = all ? '' : `WHERE ($1 <> '' AND p.phone10 = $1) OR ($2 <> '' AND p.email = $2)
       OR ($1 <> '' AND p.email <> '' AND p.email IN (SELECT q.email FROM ${T()} q WHERE q.phone10 = $1))`
  const r = await client.query(
    `SELECT m.columns, m.rows AS total, m.synced_at, extract(epoch FROM now() - m.checked_at)::float8 AS age,
            (SELECT coalesce(jsonb_agg(p.cells ORDER BY p.row_num), '[]'::jsonb)::text FROM ${T()} p ${where}) AS rows
       FROM ${M()} m WHERE m.id = 1`, all ? [] : [phone, email])
  const m = r.rows[0]
  staleCheck(m)
  return '{"columns":' + JSON.stringify(m.columns) + ',"total":' + Number(m.total) +
    ',"syncedAt":' + JSON.stringify(new Date(m.synced_at).toISOString()) + ',"rows":' + m.rows + '}'
}

// Сводка для сверки с листом: те же правила, что в боте и страницах (оплачено — paymentid
// со словом tinkoff/sber/pay; промо tinkoff:0; сертификат/подарок tinkoff:0-cert; ручной баланс).
export async function paymentsMeta(client) {
  const r = await client.query(
    `SELECT columns, rows, digest, read_at, synced_at, checked_at, source,
            extract(epoch FROM now() - checked_at)::float8 AS age FROM ${M()} WHERE id = 1`)
  const m = r.rows[0]
  if (!m) throw new ApiError('unavailable', 'копии оплат ещё нет')
  const H = m.columns.map(h => String(h).trim())
  const iPay = H.indexOf('paymentid'), iPrice = H.indexOf('price')
  if (iPay < 0 || iPrice < 0) throw new ApiError('unavailable', 'в шапке копии нет paymentid или price')
  const cells = await client.query(`SELECT cells->>$1::int AS pid, cells->$2::int AS price FROM ${T()} ORDER BY row_num`, [iPay, iPrice])
  const s = { rows: 0, paid: 0, paidSum: 0, promo: 0, cert: 0, manual: 0, priceSum: 0 }
  for (const row of cells.rows) {
    const pid = String(row.pid == null ? '' : row.pid)
    const price = parsePrice(row.price)
    s.rows++
    s.priceSum += price
    if (/tinkoff|sber|pay/i.test(pid)) { s.paid++; s.paidSum += price }
    const t = pid.trim()
    if (t === 'tinkoff:0') s.promo++
    else if (t === 'tinkoff:0-cert') s.cert++
    else if (t === 'manual:override') s.manual++
  }
  s.paidSum = Math.round(s.paidSum * 100) / 100
  s.priceSum = Math.round(s.priceSum * 100) / 100
  return {
    rows: m.rows, columns: m.columns.length, digest: m.digest, source: m.source, ageSec: Math.round(m.age),
    readAt: m.read_at, syncedAt: m.synced_at, checkedAt: m.checked_at, stale: !(m.age <= PAY_STALE_SEC), stats: s,
  }
}

// Расписание (cron раз в минуту): попросить прокси сверить лист с копией. Прокси сравнивает
// отпечаток листа с присланным: совпал — ничего не шлёт, иначе присылает копию через /sync.
// Если прокси подтвердил, что лист = копии, отмечаем проверку (иначе копия через
// PAY_STALE_SEC станет «протухшей», и чтение уйдёт в таблицу).
export async function paymentsCron(env, deps, fetchImpl = fetch) {
  if (!env.PAYMENTS_PROXY_URL || !env.SERVICE_KEY) return { skipped: 'нет PAYMENTS_PROXY_URL или SERVICE_KEY' }
  const digest = await deps.withClient(async c => {
    const r = await c.query(`SELECT digest FROM ${M()} WHERE id = 1`)
    return r.rows[0] ? r.rows[0].digest : ''
  })
  const res = await fetchImpl(env.PAYMENTS_PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'paySync', key: env.SERVICE_KEY, digest, source: 'cron' }),
  })
  const text = await res.text()
  let out
  try { out = JSON.parse(text) } catch { throw new Error(`прокси ответил не JSON (HTTP ${res.status}): ${text.slice(0, 120)}`) }
  if (!out || !out.ok) throw new Error('прокси: ' + ((out && out.error) || 'ошибка'))
  if (!out.changed && digest && out.digest === digest) {
    await deps.withClient(c => c.query(`UPDATE ${M()} SET checked_at = now() WHERE id = 1 AND digest = $1`, [digest]))
  }
  return out
}
