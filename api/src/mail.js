// Рассылки (с 13.11.2026): выборки по условиям, разовые и регулярные рассылки, очередь для бота.
//
// Кто что делает:
//   • бот раз в ~2 часа считает «аудиторию» — по каждому привязанному человеку остаток, сроки
//     пакетов, покупки и оплаты ТЕМ ЖЕ кодом, что видит кабинет, — и присылает снимок сюда
//     (/v1/mail/audience-sync). Люди, которые только нажимали /start, берутся из событий;
//   • админ тренерки считает выборки (/audience), сохраняет рассылки (/save), отменяет (/cancel),
//     включает правила (/rule), просит тест себе (/test);
//   • бот каждые 5 минут (и по «пинку» тренерки) забирает порцию (/claim) и отчитывается (/report).
//     Токен Telegram есть только у бота.
//
// Условия (решения владельца 13.11.2026): покупка — любой пакет (вкл. промокод и подарок);
// оплата — настоящие деньги; занятия — хотя бы одно проведённое; «остался 1» — остаток 1;
// «кончились» — была покупка и остаток ≤ 0; сгорание — остаток > 0 и пакет истекает в ближайшие
// N дней. Получатели — все, кто запускал бота. Регулярное правило — каждому один раз за попадание
// в условие: снова только после выхода из условия и нового попадания. Отписка — своя (mail_off),
// отдельно от афиши. Отправка — с 9:00 до 21:00 по Москве; тест себе — в любое время.

import { ApiError, qualify } from './store.js'

const A = () => qualify('audience')
const ML = () => qualify('mailings')
const S = () => qualify('mailing_sends')
const RS = () => qualify('mailing_rule_state')
const MM = () => qualify('mail_meta')
const E = () => qualify('events')

export const SEND_FROM_HOUR = 9
export const SEND_TO_HOUR = 21
const AUDIENCE_FRESH_MIN = 20       // старше — бот сначала пересчитывает аудиторию
const CLAIM_STALE_MIN = 15          // порция не подтверждена за 15 мин (бот упал) — раздаём снова
const MAX_BODY = 4000

const str = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, n)
const one = (v, allowed, def) => (allowed.includes(v) ? v : def)

// ── Условия ──
export function normFilters(f) {
  f = f && typeof f === 'object' ? f : {}
  const yn = v => one(v, ['any', 'yes', 'no'], 'any')
  const days = Math.min(Math.max(parseInt(f.expiryDays, 10) || 0, 0), 90)
  return {
    phone: one(f.phone, ['any', 'linked', 'start'], 'any'),
    purchase: yn(f.purchase), paid: yn(f.paid), lessons: yn(f.lessons),
    remaining: one(f.remaining, ['any', 'one', 'zero'], 'any'),
    expiryDays: days,
  }
}
// WHERE по людям (CTE people). Значения подставляются только из списка выше и числом дней.
function whereOf(f) {
  const w = ['true']
  if (f.phone === 'linked') w.push('linked')
  if (f.phone === 'start') w.push('NOT linked')
  if (f.purchase !== 'any') w.push((f.purchase === 'yes' ? '' : 'NOT ') + 'has_purchase')
  if (f.paid !== 'any') w.push((f.paid === 'yes' ? '' : 'NOT ') + 'has_paid')
  if (f.lessons !== 'any') w.push(f.lessons === 'yes' ? 'lessons_done > 0' : 'lessons_done = 0')
  if (f.remaining === 'one') w.push('has_purchase AND remaining = 1')
  if (f.remaining === 'zero') w.push('has_purchase AND remaining <= 0')
  if (f.expiryDays > 0) {
    w.push(`remaining > 0 AND expiry IS NOT NULL AND expiry >= (now() AT TIME ZONE 'Europe/Moscow')::date
            AND expiry <= (now() AT TIME ZONE 'Europe/Moscow')::date + ${f.expiryDays}`)
  }
  return w.join(' AND ')
}
// Все, кому бот может писать: снимок аудитории + запускавшие бота из событий (без номера).
// Чаты групп (отрицательный id) — не люди.
const PEOPLE = () => `people AS (
    SELECT tg_id, name, email, linked, has_purchase, has_paid, lessons_done, remaining, expiry, mail_off, blocked
      FROM ${A()} WHERE tg_id NOT LIKE '-%'
    UNION ALL
    SELECT DISTINCT e.tg_id, '', '', false, false, false, 0, 0, NULL::date, false, false
      FROM ${E()} e
     WHERE e.tg_id <> '' AND e.tg_id NOT LIKE '-%'
       AND e.event IN ('start', 'start_new', 'phone_button', 'phone_text', 'phone_other')
       AND NOT EXISTS (SELECT 1 FROM ${A()} a WHERE a.tg_id = e.tg_id)
  )`

export async function mailAudience(client, body) {
  const f = normFilters(body && body.filters)
  const r = await client.query(
    `WITH ${PEOPLE()}, hit AS (SELECT * FROM people WHERE ${whereOf(f)})
     SELECT (SELECT count(*) FROM people)::int AS total,
            (SELECT count(*) FROM hit)::int AS n,
            (SELECT count(*) FROM hit WHERE mail_off)::int AS off,
            (SELECT count(*) FROM hit WHERE blocked AND NOT mail_off)::int AS blocked,
            (SELECT audience_at FROM ${MM()} WHERE id = 1) AS audience_at`)
  const x = r.rows[0]
  const out = { filters: f, total: x.total, count: x.n, off: x.off, blocked: x.blocked,
    willGet: x.n - x.off - x.blocked, audienceAt: x.audience_at ? new Date(x.audience_at).toISOString() : null }
  if (body && body.list) {
    const l = await client.query(
      `WITH ${PEOPLE()}
       SELECT tg_id, name, email, linked, remaining, expiry::text AS expiry, mail_off, blocked, has_purchase
         FROM people WHERE ${whereOf(f)}
        ORDER BY (name = ''), lower(name), tg_id LIMIT 100`)
    out.list = l.rows.map(p => ({ tg: p.tg_id.slice(-4), name: p.name, email: p.email, linked: p.linked,
      remaining: p.has_purchase ? p.remaining : null, expiry: p.expiry, off: p.mail_off, blocked: p.blocked }))
  }
  return out
}

// ── Рассылки ──
const newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
function normButton(b) {
  if (!b || typeof b !== 'object') return null
  if (b.type === 'cabinet') return { type: 'cabinet' }
  if (b.type === 'url') {
    const text = str(b.text, 40), url = str(b.url, 500)
    if (!text) throw new ApiError('invalid-argument', 'у кнопки нужен текст')
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new ApiError('invalid-argument', 'ссылка кнопки — адрес http(s)://…')
    return { type: 'url', text, url }
  }
  return null
}
const RULE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
function out(m, inside) {
  return {
    id: m.id, kind: m.kind, title: m.title, body: m.body, button: m.button, filters: m.filters, status: m.status,
    sendAt: m.send_at ? new Date(m.send_at).toISOString() : null, ruleTime: m.rule_time, ruleLast: m.rule_last ? String(m.rule_last).slice(0, 10) : null,
    counts: { total: m.total, sent: m.sent, failed: m.failed, blocked: m.blocked, skipped: m.skipped },
    insideNow: inside == null ? null : inside,
    createdAt: new Date(m.created_at).toISOString(), startedAt: m.started_at ? new Date(m.started_at).toISOString() : null,
    finishedAt: m.finished_at ? new Date(m.finished_at).toISOString() : null, testPending: !!m.test_req,
  }
}

export async function mailList(client) {
  const r = await client.query(
    `SELECT m.*, (SELECT count(*)::int FROM ${RS()} s WHERE s.mailing_id = m.id AND s.inside) AS inside
       FROM ${ML()} m ORDER BY m.created_at DESC LIMIT 200`)
  return { mailings: r.rows.map(m => out(m, m.kind === 'rule' ? m.inside : null)) }
}

// when: draft — черновик; now — отправить сейчас; at — в send_at; rule — регулярное правило (вкл.)
export async function mailSave(client, body, who) {
  const when = one(body && body.when, ['draft', 'now', 'at', 'rule'], '')
  if (!when) throw new ApiError('invalid-argument', 'when: draft | now | at | rule')
  const text = str(body.body, MAX_BODY + 1)
  if (!text) throw new ApiError('invalid-argument', 'нужен текст сообщения')
  if (text.length > MAX_BODY) throw new ApiError('invalid-argument', `текст длиннее ${MAX_BODY} знаков`)
  const title = str(body.title, 80) || str(text.split('\n')[0], 60)
  const button = normButton(body.button)
  const filters = normFilters(body.filters)
  const kind = when === 'rule' ? 'rule' : 'once'
  let status = 'draft', sendAt = null, ruleTime = null
  if (when === 'now') { status = 'scheduled'; sendAt = new Date().toISOString() }
  if (when === 'at') {
    const t = Date.parse(body.sendAt)
    if (!isFinite(t)) throw new ApiError('invalid-argument', 'нужна дата и время отправки')
    if (t < Date.now() - 60000) throw new ApiError('invalid-argument', 'время отправки уже прошло')
    if (t > Date.now() + 60 * 86400000) throw new ApiError('invalid-argument', 'не дальше 60 дней вперёд')
    status = 'scheduled'; sendAt = new Date(t).toISOString()
  }
  if (when === 'rule') {
    ruleTime = str(body.ruleTime, 5)
    if (!RULE_TIME_RE.test(ruleTime)) throw new ApiError('invalid-argument', 'время правила — ЧЧ:ММ')
    status = body.ruleOff ? 'off' : 'on'
  }

  if (body.id) {
    const cur = (await client.query(`SELECT * FROM ${ML()} WHERE id = $1 FOR UPDATE`, [String(body.id)])).rows[0]
    if (!cur) throw new ApiError('not-found', 'рассылка не найдена')
    if (cur.kind !== kind) throw new ApiError('invalid-argument', 'разовую нельзя превратить в правило и наоборот — сделайте копию')
    if (kind === 'once' && !['draft', 'scheduled'].includes(cur.status)) {
      throw new ApiError('already-exists', 'рассылка уже отправляется или отправлена — сделайте копию')
    }
    // Правило: сменились условия — «кто уже получил» больше не про то, сбрасываем
    if (kind === 'rule' && JSON.stringify(cur.filters) !== JSON.stringify(filters)) {
      await client.query(`DELETE FROM ${RS()} WHERE mailing_id = $1`, [cur.id])
    }
    const r = await client.query(
      `UPDATE ${ML()} SET title = $2, body = $3, button = $4, filters = $5, status = $6, send_at = $7, rule_time = $8,
              updated_at = now() WHERE id = $1 RETURNING *`,
      [cur.id, title, text, button ? JSON.stringify(button) : null, JSON.stringify(filters), status, sendAt, ruleTime])
    return { mailing: out(r.rows[0]) }
  }
  const r = await client.query(
    `INSERT INTO ${ML()} (id, kind, title, body, button, filters, status, send_at, rule_time, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [newId(), kind, title, text, button ? JSON.stringify(button) : null, JSON.stringify(filters), status, sendAt, ruleTime, String((who && who.uid) || '')])
  return { mailing: out(r.rows[0]) }
}

export async function mailCancel(client, body) {
  const id = String((body && body.id) || '')
  const cur = (await client.query(`SELECT * FROM ${ML()} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
  if (!cur) throw new ApiError('not-found', 'рассылка не найдена')
  if (cur.kind === 'rule') throw new ApiError('invalid-argument', 'правило выключается через /rule')
  if (!['draft', 'scheduled', 'sending'].includes(cur.status)) throw new ApiError('invalid-argument', 'рассылка уже завершена')
  await client.query(`UPDATE ${S()} SET status = 'cancelled', at = now() WHERE mailing_id = $1 AND status IN ('queued', 'claimed')`, [id])
  await client.query(`UPDATE ${ML()} SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1`, [id])
  await recount(client, [id])
  return { ok: true }
}

export async function mailRule(client, body) {
  const id = String((body && body.id) || '')
  const on = body.on !== false
  const r = await client.query(`UPDATE ${ML()} SET status = $2, updated_at = now() WHERE id = $1 AND kind = 'rule' RETURNING id`, [id, on ? 'on' : 'off'])
  if (!r.rowCount) throw new ApiError('not-found', 'правило не найдено')
  if (!on) await client.query(`UPDATE ${S()} SET status = 'cancelled', at = now() WHERE mailing_id = $1 AND status = 'queued'`, [id])
  return { ok: true }
}

export async function mailTest(client, body) {
  const r = await client.query(`UPDATE ${ML()} SET test_req = now() WHERE id = $1 RETURNING id`, [String((body && body.id) || '')])
  if (!r.rowCount) throw new ApiError('not-found', 'рассылка не найдена')
  return { ok: true }
}

async function recount(client, ids) {
  if (!ids.length) return
  await client.query(
    `UPDATE ${ML()} m SET sent = c.sent, failed = c.failed, blocked = c.blocked, skipped = c.skipped, total = c.total
       FROM (SELECT mailing_id,
                    count(*) FILTER (WHERE status = 'sent')::int AS sent,
                    count(*) FILTER (WHERE status = 'failed')::int AS failed,
                    count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
                    count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
                    count(*) FILTER (WHERE status NOT IN ('skipped', 'cancelled'))::int AS total
               FROM ${S()} WHERE mailing_id = ANY($1::text[]) GROUP BY mailing_id) c
      WHERE m.id = c.mailing_id`, [ids])
}

// ── Снимок аудитории от бота ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export async function mailAudienceSync(client, body) {
  const people = Array.isArray(body && body.people) ? body.people : null
  if (!people) throw new ApiError('invalid-argument', 'нужен массив people')
  if (people.length > 20000) throw new ApiError('invalid-argument', 'слишком много людей')
  const rows = []
  const seen = new Set()
  for (const p of people) {
    const tg = str(p && p.tg, 20)
    if (!/^\d{1,20}$/.test(tg) || seen.has(tg)) continue
    seen.add(tg)
    rows.push({ tg_id: tg, name: str(p.name, 120), email: str(p.email, 120).toLowerCase(), has_purchase: !!p.purchase,
      has_paid: !!p.paid, lessons_done: Math.max(0, parseInt(p.done, 10) || 0), remaining: parseInt(p.remaining, 10) || 0,
      expiry: DATE_RE.test(p.expiry || '') ? p.expiry : null, mail_off: !!p.off })
  }
  const offOnly = (Array.isArray(body.offOnly) ? body.offOnly : []).map(x => str(x, 20)).filter(x => /^\d{1,20}$/.test(x) && !seen.has(x))
  // Защита: бот вдруг прислал куда меньше людей (сбой чтения) — не «отвязываем» всех разом
  const cur = (await client.query(`SELECT count(*)::int AS n FROM ${A()} WHERE linked`)).rows[0].n
  if (cur > 10 && rows.length < cur * 0.5 && !body.force) {
    throw new ApiError('invalid-argument', `людей стало ${rows.length} вместо ${cur} — похоже на сбой; если верно, повторить с force`)
  }
  await client.query('BEGIN')
  try {
    await client.query(
      `INSERT INTO ${A()} (tg_id, name, email, linked, has_purchase, has_paid, lessons_done, remaining, expiry, mail_off, synced_at)
       SELECT tg_id, name, email, true, has_purchase, has_paid, lessons_done, remaining, expiry, mail_off, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(tg_id text, name text, email text, has_purchase boolean, has_paid boolean,
                                                 lessons_done int, remaining int, expiry date, mail_off boolean)
       ON CONFLICT (tg_id) DO UPDATE SET name = excluded.name, email = excluded.email, linked = true,
         has_purchase = excluded.has_purchase, has_paid = excluded.has_paid, lessons_done = excluded.lessons_done,
         remaining = excluded.remaining, expiry = excluded.expiry, mail_off = excluded.mail_off, synced_at = now()`,
      [JSON.stringify(rows)])
    const tgs = rows.map(r => r.tg_id)
    await client.query(
      `UPDATE ${A()} SET linked = false, has_purchase = false, has_paid = false, lessons_done = 0, remaining = 0, expiry = NULL,
              synced_at = now() WHERE linked AND NOT (tg_id = ANY($1::text[]))`, [tgs])
    await client.query(`UPDATE ${A()} SET mail_off = (tg_id = ANY($1::text[])) WHERE NOT linked`, [offOnly])
    await client.query(
      `INSERT INTO ${A()} (tg_id, mail_off) SELECT unnest($1::text[]), true ON CONFLICT (tg_id) DO UPDATE SET mail_off = true`, [offOnly])
    await client.query(
      `INSERT INTO ${MM()} (id, audience_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET audience_at = now()`)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
  return { ok: true, people: rows.length, offOnly: offOnly.length }
}

// ── Очередь для бота ──
// Возвращает: тесты (в любое время), порцию отправок (только 9–21 МСК) и тексты рассылок.
// needSync — есть что запускать, а снимок аудитории старше 20 минут: бот пересчитает и придёт снова.
export async function mailClaim(client, body) {
  const limit = Math.min(Math.max(parseInt(body && body.limit, 10) || 150, 1), 300)
  const t = (await client.query(
    `SELECT extract(hour FROM now() AT TIME ZONE 'Europe/Moscow')::int AS h,
            to_char(now() AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS hm,
            (now() AT TIME ZONE 'Europe/Moscow')::date::text AS today,
            (SELECT audience_at FROM ${MM()} WHERE id = 1) AS aud`)).rows[0]
  const window = t.h >= SEND_FROM_HOUR && t.h < SEND_TO_HOUR
  const fresh = t.aud && Date.now() - new Date(t.aud).getTime() < AUDIENCE_FRESH_MIN * 60000
  await client.query('BEGIN')
  try {
    const tests = (await client.query(
      `UPDATE ${ML()} SET test_req = NULL WHERE test_req IS NOT NULL RETURNING id, title, body, button`)).rows
    let needSync = false, sends = []
    const finishedEmpty = []
    if (window) {
      const dueOnce = (await client.query(
        `SELECT id, filters FROM ${ML()} WHERE kind = 'once' AND status = 'scheduled' AND send_at <= now() FOR UPDATE SKIP LOCKED`)).rows
      const dueRules = (await client.query(
        `SELECT id, filters FROM ${ML()} WHERE kind = 'rule' AND status = 'on' AND coalesce(rule_time, '00:00') <= $1
            AND (rule_last IS NULL OR rule_last < $2::date) FOR UPDATE SKIP LOCKED`, [t.hm, t.today])).rows
      if ((dueOnce.length || dueRules.length) && !fresh) needSync = true
      else {
        for (const m of dueOnce) {
          await client.query(
            `WITH ${PEOPLE()}
             INSERT INTO ${S()} (mailing_id, tg_id, status)
             SELECT $1, tg_id, CASE WHEN mail_off OR blocked THEN 'skipped' ELSE 'queued' END FROM people WHERE ${whereOf(normFilters(m.filters))}`, [m.id])
          await client.query(`UPDATE ${ML()} SET status = 'sending', started_at = now(), updated_at = now() WHERE id = $1`, [m.id])
          // Никто не подошёл (или все отписаны) — рассылка сразу завершена, иначе висела бы «отправляется»
          const empty = (await client.query(
            `UPDATE ${ML()} SET status = 'done', finished_at = now() WHERE id = $1
               AND NOT EXISTS (SELECT 1 FROM ${S()} WHERE mailing_id = $1 AND status = 'queued') RETURNING id, title`, [m.id])).rows
          finishedEmpty.push(...empty)
        }
        for (const m of dueRules) {
          const f = normFilters(m.filters)
          await client.query(
            `WITH ${PEOPLE()}, mem AS (SELECT tg_id, mail_off, blocked FROM people WHERE ${whereOf(f)}),
             ins AS (
               INSERT INTO ${S()} (mailing_id, tg_id, status)
               SELECT $1, mem.tg_id, CASE WHEN mem.mail_off OR mem.blocked THEN 'skipped' ELSE 'queued' END FROM mem
                WHERE NOT EXISTS (SELECT 1 FROM ${RS()} s WHERE s.mailing_id = $1 AND s.tg_id = mem.tg_id AND s.inside)
               RETURNING tg_id
             ),
             enter AS (
               INSERT INTO ${RS()} (mailing_id, tg_id, inside, changed_at) SELECT $1, tg_id, true, now() FROM ins
               ON CONFLICT (mailing_id, tg_id) DO UPDATE SET inside = true, changed_at = now()
               RETURNING tg_id
             )
             UPDATE ${RS()} SET inside = false, changed_at = now()
              WHERE mailing_id = $1 AND inside AND tg_id NOT IN (SELECT tg_id FROM mem)`, [m.id])
          await client.query(`UPDATE ${ML()} SET rule_last = $2::date, updated_at = now() WHERE id = $1`, [m.id, t.today])
        }
        await recount(client, dueOnce.map(m => m.id).concat(dueRules.map(m => m.id)))
      }
      sends = (await client.query(
        `UPDATE ${S()} SET status = 'claimed', at = now()
          WHERE id IN (
            SELECT s.id FROM ${S()} s JOIN ${ML()} m ON m.id = s.mailing_id
             WHERE (s.status = 'queued' OR (s.status = 'claimed' AND s.at < now() - make_interval(mins => ${CLAIM_STALE_MIN})))
               AND m.status IN ('sending', 'on')
             ORDER BY s.id LIMIT $1 FOR UPDATE OF s SKIP LOCKED)
          RETURNING id, mailing_id, tg_id`, [limit])).rows
    }
    const mids = [...new Set(sends.map(s => s.mailing_id))]
    const texts = mids.length ? (await client.query(`SELECT id, title, body, button FROM ${ML()} WHERE id = ANY($1::text[])`, [mids])).rows : []
    const names = sends.length ? (await client.query(`SELECT tg_id, name FROM ${A()} WHERE tg_id = ANY($1::text[])`, [sends.map(s => s.tg_id)])).rows : []
    await client.query('COMMIT')
    const nameOf = Object.fromEntries(names.map(n => [n.tg_id, n.name]))
    return {
      window, needSync,
      tests: tests.map(m => ({ id: m.id, title: m.title, body: m.body, button: m.button })),
      sends: sends.sort((a, b) => Number(a.id) - Number(b.id)).map(s => ({ id: Number(s.id), m: s.mailing_id, tg: s.tg_id, name: nameOf[s.tg_id] || '' })),
      mailings: Object.fromEntries(texts.map(m => [m.id, { title: m.title, body: m.body, button: m.button }])),
      finished: finishedEmpty.map(m => ({ id: m.id, title: m.title, total: 0, sent: 0, failed: 0, blocked: 0, skipped: 0 })),
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// Отчёт бота: статусы отправок. retry (Telegram просит подождать) — обратно в очередь.
// blocked — человек заблокировал бота: помечаем в аудитории, дальше ему не шлём (снимается его /start).
const REPORT_ST = ['sent', 'failed', 'blocked', 'skipped', 'retry']
export async function mailReport(client, body) {
  const res = (Array.isArray(body && body.results) ? body.results : []).slice(0, 1000)
    .filter(r => r && Number.isFinite(Number(r.id)) && REPORT_ST.includes(r.status))
  if (!res.length) return { ok: true, finished: [] }
  const ids = res.map(r => Number(r.id)), sts = res.map(r => (r.status === 'retry' ? 'queued' : r.status))
  const upd = (await client.query(
    `UPDATE ${S()} s SET status = x.st, at = now() FROM unnest($1::bigint[], $2::text[]) AS x(id, st)
      WHERE s.id = x.id AND s.status = 'claimed' RETURNING s.mailing_id, s.tg_id, s.status`, [ids, sts])).rows
  const blockedTg = upd.filter(u => u.status === 'blocked').map(u => u.tg_id)
  if (blockedTg.length) {
    await client.query(`INSERT INTO ${A()} (tg_id, blocked) SELECT unnest($1::text[]), true
                        ON CONFLICT (tg_id) DO UPDATE SET blocked = true`, [blockedTg])
  }
  const mids = [...new Set(upd.map(u => u.mailing_id))]
  await recount(client, mids)
  const fin = (await client.query(
    `UPDATE ${ML()} m SET status = 'done', finished_at = now(), updated_at = now()
      WHERE m.id = ANY($1::text[]) AND m.kind = 'once' AND m.status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM ${S()} s WHERE s.mailing_id = m.id AND s.status IN ('queued', 'claimed'))
      RETURNING id, title, total, sent, failed, blocked, skipped`, [mids])).rows
  return { ok: true, finished: fin }
}

// Человек снова нажал /start — значит, разблокировал бота (зовёт eventsAdd).
export async function mailUnblock(client, tgs) {
  if (tgs.length) await client.query(`UPDATE ${A()} SET blocked = false WHERE blocked AND tg_id = ANY($1::text[])`, [tgs])
}
