// События бота и кабинета клиента (с 13.11.2026): журнал действий человека и сводка по дням.
//
// Кто пишет: только бот (служебный ключ). Кабинет шлёт пачки боту (?action=track, бот сам
// проверяет initData Telegram), бот кладёт их в лист «События» и сюда. Свои события бот
// (start, вход по номеру, ошибки) пишет тем же путём.
// Кто читает: админ тренерки — журнал по человеку (/v1/events/person) и сводку по дням
// (/v1/events/daily); бот — сводку для утреннего сигнала о резком падении.
//
//   POST /v1/events/add     { rows: [{ ts, src, tg, email, ev, det, ver }], import? }  → { added }
//        import: true — перенос истории из листа «События» (разовая функция бота): старые даты
//        принимаются как есть (не раньше 2025 года), до 500 строк за раз.
//   POST /v1/events/person  { emails: [], tg, limit, before }                 → { rows }
//   POST /v1/events/daily   { days }                                          → { today, days, keys }
//
// Сутки — московские. Человек в сводке — tg_id, а если его нет — почта.

import { ApiError, qualify } from './store.js'
import { mailUnblock } from './mail.js'

const T = () => qualify('events')
const MAX_ROWS = 100
const MAX_IMPORT_ROWS = 500
const IMPORT_FROM = Date.parse('2025-01-01T00:00:00Z')
const SRC = ['app', 'bot']

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)

// Время события: присланное, если оно в пределах «двое суток назад … 5 минут вперёд»,
// иначе — время записи (часы телефона бывают сбиты, пачка может ехать минутами).
function tsOf(v, nowMs, isImport) {
  const t = Date.parse(v)
  const from = isImport ? IMPORT_FROM : nowMs - 2 * 86400000
  if (!isFinite(t) || t < from || t > nowMs + 300000) return new Date(nowMs).toISOString()
  return new Date(t).toISOString()
}

export async function eventsAdd(client, body) {
  const rows = body && body.rows
  if (!Array.isArray(rows)) throw new ApiError('invalid-argument', 'нужен массив rows')
  const isImport = body.import === true
  const max = isImport ? MAX_IMPORT_ROWS : MAX_ROWS
  if (rows.length > max) throw new ApiError('invalid-argument', `не больше ${max} событий за раз`)
  const now = Date.now()
  const cols = { ts: [], src: [], tg: [], email: [], ev: [], det: [], ver: [] }
  for (const r of rows) {
    const ev = str(r && r.ev, 40)
    if (!ev) continue
    cols.ts.push(tsOf(r.ts, now, isImport))
    cols.src.push(SRC.includes(r.src) ? r.src : 'app')
    cols.tg.push(str(r.tg, 20).replace(/[^\d-]/g, ''))
    cols.email.push(str(r.email, 120).toLowerCase())
    cols.ev.push(ev)
    cols.det.push(str(r.det, 200))
    cols.ver.push(str(r.ver, 30))
  }
  if (!cols.ev.length) return { added: 0 }
  await client.query(
    `INSERT INTO ${T()} (ts, src, tg_id, email, event, detail, ver)
     SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])`,
    [cols.ts, cols.src, cols.tg, cols.email, cols.ev, cols.det, cols.ver])
  // Снова нажал /start — значит, разблокировал бота: рассылки ему снова можно слать
  if (!isImport) await mailUnblock(client, cols.tg.filter((tg, i) => tg && cols.ev[i] === 'start'))
  return { added: cols.ev.length }
}

// Журнал человека: по его почтам и Telegram id, плюс все id и почты, которые встречались
// в событиях вместе с ними (гость с пустой почтой потом получил почту — история одна).
export async function eventsPerson(client, body) {
  const emails = (Array.isArray(body && body.emails) ? body.emails : [])
    .map(e => str(e, 120).toLowerCase()).filter(Boolean).slice(0, 10)
  const tg = str(body && body.tg, 20).replace(/[^\d-]/g, '')
  if (!emails.length && !tg) throw new ApiError('invalid-argument', 'нужна почта или tg')
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 200, 1), 1000)
  const before = body.before && isFinite(Date.parse(body.before)) ? new Date(body.before).toISOString() : null
  const r = await client.query(
    `WITH tgs AS (
        SELECT DISTINCT tg_id FROM ${T()} WHERE email = ANY($1::text[]) AND tg_id <> ''
        UNION SELECT $2::text WHERE $2::text <> ''
     ), ems AS (
        SELECT DISTINCT email FROM ${T()} WHERE tg_id IN (SELECT tg_id FROM tgs) AND email <> ''
        UNION SELECT unnest($1::text[])
     )
     SELECT ts, src, tg_id, email, event, detail, ver FROM ${T()}
      WHERE (tg_id IN (SELECT tg_id FROM tgs) OR email IN (SELECT email FROM ems))
        AND ($4::timestamptz IS NULL OR ts < $4::timestamptz)
      ORDER BY ts DESC, id DESC LIMIT $3`,
    [emails, tg, limit, before])
  return {
    rows: r.rows.map(x => ({ ts: new Date(x.ts).toISOString(), src: x.src, tg: x.tg_id, email: x.email, ev: x.event, det: x.detail, ver: x.ver })),
  }
}

// Ключ сводки: разделы кабинета (tab) и экраны — по названию, ошибки — по виду
// (до первого «:» в детали), остальное — по названию события.
const KEY_SQL = `CASE WHEN event IN ('tab', 'screen') THEN event || ':' || detail
                      WHEN event IN ('error', 'bot_error') THEN event || ':' || split_part(detail, ':', 1)
                      ELSE event END`
const WHO_SQL = `coalesce(nullif(tg_id, ''), nullif(email, ''), '?')`

// Сводка: по каждому ключу — число событий и людей за каждый из последних N московских суток,
// плюс «вчера к этому же часу» — чтобы сразу после выкладки сравнивать неполный сегодняшний день.
// days — последние N суток (по умолчанию 8). Или период from/to ('ГГГГ-ММ-ДД', МСК, не длиннее 92 дней):
// тогда days — дни периода, новые первыми, а total у ключа — события и РАЗНЫЕ люди за весь период.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export async function eventsDaily(client, body) {
  const t = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD"T"HH24:MI') AS now`)
  const nowMsk = t.rows[0].now, today = nowMsk.slice(0, 10)
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  let from, to
  if (body && DAY_RE.test(body.from || '') && DAY_RE.test(body.to || '')) {
    from = body.from < body.to ? body.from : body.to
    to = body.from < body.to ? body.to : body.from
    if (to > today) to = today
    if (from > to) from = to
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 91) from = shift(to, -91)
  } else {
    const days = Math.min(Math.max(parseInt(body && body.days, 10) || 8, 2), 60)
    to = today
    from = shift(today, -(days - 1))
  }
  const r = await client.query(
    `WITH e AS (
        SELECT ${KEY_SQL} AS key, (ts AT TIME ZONE 'Europe/Moscow')::date AS day, ts, ${WHO_SQL} AS who
          FROM ${T()}
         WHERE ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Moscow')
           AND ts < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow')
           AND event <> 'link_click'   -- клики по ссылкам-источникам зависят от рекламы, не от работы кабинета
     ), b AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow') AS today)
     SELECT key, day::text AS day, count(*)::int AS n, count(DISTINCT who)::int AS u, 'day' AS kind
       FROM e GROUP BY key, day
     UNION ALL
     SELECT key, NULL, count(*)::int, count(DISTINCT who)::int, 'total' FROM e GROUP BY key
     UNION ALL
     SELECT key, NULL, count(*)::int, count(DISTINCT who)::int, 'same'
       FROM e, b WHERE e.ts >= b.today - interval '1 day' AND e.ts < now() - interval '1 day'
      GROUP BY key`,
    [from, to])
  const keys = {}
  for (const x of r.rows) {
    const k = keys[x.key] || (keys[x.key] = { days: {}, total: { n: 0, u: 0 }, yesterdaySameTime: { n: 0, u: 0 } })
    if (x.kind === 'same') k.yesterdaySameTime = { n: x.n, u: x.u }
    else if (x.kind === 'total') k.total = { n: x.n, u: x.u }
    else k.days[x.day] = { n: x.n, u: x.u }
  }
  const list = []
  for (let d = to; d >= from; d = shift(d, -1)) list.push(d)
  return { now: nowMsk, from, to, days: list, keys }
}
