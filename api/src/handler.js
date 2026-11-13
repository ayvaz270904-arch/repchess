// HTTP-обработчик API. Не зависит от того, где работает: Worker (worker.js) и тесты
// (test/run.mjs) передают свой способ получить клиента базы — deps.withClient(fn).
//
//   GET  /v1/health                     — жив ли API и база (без входа)
//   POST /v1/get     { coll, id }       — документ или null
//   POST /v1/query   { coll, where, orderBy, limit } — список { id, data }
//   POST /v1/commit  { writes: [...] }  — пакет записей одной транзакцией
//   *    /fs/documents…                 — вход в формате Firestore REST для бота и прокси
//                                         (fsrest.js), только по служебному ключу
//   *    /v1/payments…                  — оплаты, копия листа Table 2 (payments.js)
//   POST /v1/events/…                  — события бота и кабинета: журнал, сводка (events.js)
//   GET  /go/<метка>                   — переход по ссылке-источнику в бота (links.js, без входа)
//   POST /v1/links/…                   — ссылки-источники: список со статистикой, создание, архив
//   POST /v1/mail/…                    — рассылки: выборки, сохранение, очередь для бота (mail.js)
//
// Ответ — JSON. Ошибка — { error: { code, message } } с кодом HTTP по смыслу.

import { identify, AuthError } from './auth.js'
import { getDoc, queryDocs, commit, ApiError, qualify, table } from './store.js'
import { handleFs, FsError } from './fsrest.js'
import { paymentsSync, paymentsCsv, paymentsRows, paymentsMeta } from './payments.js'
import { eventsAdd, eventsPerson, eventsDaily } from './events.js'
import { goRedirect, linksList, linksCreate, linksArchive, linksDelete } from './links.js'
import { certsDelete } from './certs.js'
import { mailAudience, mailList, mailSave, mailCancel, mailRule, mailTest, mailArchive, mailDelete, mailAudienceSync, mailClaim, mailReport } from './mail.js'

const STATUS = {
  'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403,
  'not-found': 404, 'already-exists': 409, unavailable: 503,
}
const MAX_BODY = 1_000_000

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || ''
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const h = { 'vary': 'origin' }
  if (origin && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin
    h['access-control-allow-headers'] = 'authorization, content-type, x-service-key'
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS'   // /fs/* — не для браузера, PATCH/DELETE тут не нужны
    h['access-control-max-age'] = '600'
    h['access-control-expose-headers'] = 'x-payments-synced-at, x-payments-checked-at'
  }
  return h
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request, env) },
  })
}

function fail(e, request, env, log) {
  const code = e && e.code && STATUS[e.code] ? e.code : 'internal'
  if (code === 'internal' && log) log(e)
  const message = code === 'internal' ? 'внутренняя ошибка' : e.message
  return json({ error: { code, message } }, STATUS[code] || 500, request, env)
}

const FS_PREFIX = '/fs/documents'
const FS_STATUS = { 'invalid-argument': [400, 'INVALID_ARGUMENT'], 'permission-denied': [403, 'PERMISSION_DENIED'],
  'not-found': [404, 'NOT_FOUND'], 'already-exists': [409, 'ALREADY_EXISTS'], unauthenticated: [401, 'UNAUTHENTICATED'] }

// Ошибки — в виде Firestore: { error: { code, message, status } }. Бот различает ответы по коду HTTP.
async function fsRoute(request, env, deps, url) {
  const out = (status, body) => json(body, status, request, env)
  try {
    const who = await identify(request, env, deps)
    if (!who) throw new AuthError('нужен служебный ключ')
    if (!who.isService) throw new ApiError('permission-denied', 'этот вход — только для бота и прокси')
    let body
    if (request.method === 'POST' || request.method === 'PATCH') {
      const text = await request.text()
      if (text.length > MAX_BODY) throw new ApiError('invalid-argument', 'слишком большой запрос')
      try { body = JSON.parse(text || '{}') } catch { throw new ApiError('invalid-argument', 'тело — не JSON') }
    }
    const auth = { uid: who.uid, isService: true, role: null }
    const r = await deps.withClient(c => handleFs(c, auth, env, request.method, url.pathname.slice(FS_PREFIX.length), url.searchParams, body))
    return out(r.status, r.body)
  } catch (e) {
    if (e instanceof FsError) return out(e.http, { error: { code: e.http, message: e.message, status: e.status } })
    const m = e && e.code && FS_STATUS[e.code]
    if (m) return out(m[0], { error: { code: m[0], message: e.message, status: m[1] } })
    ;(deps.log || (x => console.error(x)))(e)
    return out(500, { error: { code: 500, message: 'внутренняя ошибка', status: 'INTERNAL' } })
  }
}

// Роль — из документа тренера. Пользователь без документа тренера в API не допускается
// (строже Firestore: там любой вошедший читал priceOverrides).
async function authOf(client, who) {
  const auth = { uid: who.uid, isService: who.isService, role: null }
  if (!who.isService) {
    const r = await client.query(`SELECT role FROM ${table('trainers')} WHERE id = $1`, [who.uid])
    if (!r.rows[0]) throw new ApiError('permission-denied', 'нет учётной записи тренера')
    auth.role = r.rows[0].role
  }
  return auth
}

const NOT_FOUND = () => new ApiError('not-found', 'нет такого адреса')

// События (events.js): пишет только бот (служебный ключ), читают админ и бот.
const EVENT_PATHS = ['/v1/events/add', '/v1/events/person', '/v1/events/daily']
async function eventsRoute(request, env, deps, url) {
  const path = url.pathname
  if (request.method !== 'POST' || !EVENT_PATHS.includes(path)) throw NOT_FOUND()
  const who = await identify(request, env, deps)
  if (!who) throw new AuthError('нужен вход')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new ApiError('invalid-argument', 'слишком большой запрос')
  let body
  try { body = JSON.parse(text || '{}') } catch { throw new ApiError('invalid-argument', 'тело — не JSON') }
  return await deps.withClient(async client => {
    const auth = await authOf(client, who)
    if (path === '/v1/events/add') {
      if (!auth.isService) throw new ApiError('permission-denied', 'события пишет только бот')
      return json(await eventsAdd(client, body), 200, request, env)
    }
    if (!auth.isService && auth.role !== 'admin') throw new ApiError('permission-denied', 'события видит только админ')
    if (path === '/v1/events/person') return json(await eventsPerson(client, body), 200, request, env)
    return json(await eventsDaily(client, body), 200, request, env)
  })
}

// Рассылки (mail.js): выборки и рассылки — админ; снимок аудитории, очередь и отчёт — только бот.
const MAIL_ADMIN = { '/v1/mail/audience': mailAudience, '/v1/mail/list': mailList, '/v1/mail/save': mailSave,
  '/v1/mail/cancel': mailCancel, '/v1/mail/rule': mailRule, '/v1/mail/test': mailTest, '/v1/mail/archive': mailArchive, '/v1/mail/delete': mailDelete }
const MAIL_BOT = { '/v1/mail/audience-sync': mailAudienceSync, '/v1/mail/claim': mailClaim, '/v1/mail/report': mailReport }
async function mailRoute(request, env, deps, url) {
  const path = url.pathname
  const fn = MAIL_ADMIN[path] || MAIL_BOT[path]
  if (request.method !== 'POST' || !fn) throw NOT_FOUND()
  const who = await identify(request, env, deps)
  if (!who) throw new AuthError('нужен вход')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new ApiError('invalid-argument', 'слишком большой запрос')
  let body
  try { body = JSON.parse(text || '{}') } catch { throw new ApiError('invalid-argument', 'тело — не JSON') }
  return await deps.withClient(async client => {
    const auth = await authOf(client, who)
    if (MAIL_BOT[path] && !auth.isService) throw new ApiError('permission-denied', 'это — только для бота')
    if (!auth.isService && auth.role !== 'admin') throw new ApiError('permission-denied', 'рассылки — только админу')
    return json(await fn(client, body, who), 200, request, env)
  })
}

// Ссылки-источники (links.js): только админ.
const LINK_PATHS = ['/v1/links/list', '/v1/links/create', '/v1/links/archive', '/v1/links/delete', '/v1/certs/delete']
async function linksRoute(request, env, deps, url) {
  const path = url.pathname
  if (request.method !== 'POST' || !LINK_PATHS.includes(path)) throw NOT_FOUND()
  const who = await identify(request, env, deps)
  if (!who) throw new AuthError('нужен вход')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new ApiError('invalid-argument', 'слишком большой запрос')
  let body
  try { body = JSON.parse(text || '{}') } catch { throw new ApiError('invalid-argument', 'тело — не JSON') }
  return await deps.withClient(async client => {
    const auth = await authOf(client, who)
    if (!auth.isService && auth.role !== 'admin') throw new ApiError('permission-denied', 'ссылки — только админу')
    if (path === '/v1/certs/delete' && auth.role !== 'admin') throw new ApiError('permission-denied', 'удалять промокоды может только админ')
    if (path === '/v1/links/list') return json(await linksList(client, env), 200, request, env)
    if (path === '/v1/links/create') return json(await linksCreate(client, body, who), 200, request, env)
    if (path === '/v1/links/delete') return json(await linksDelete(client, body), 200, request, env)
    if (path === '/v1/certs/delete') return json(await certsDelete(client, body), 200, request, env)
    return json(await linksArchive(client, body), 200, request, env)
  })
}

// Оплаты (payments.js). Копию присылает и читает построчно только служебный ключ (прокси, бот);
// CSV — админ и тренер (тренер — только своих учеников), сводку — админ.
async function paymentsRoute(request, env, deps, url) {
  const path = url.pathname
  const who = await identify(request, env, deps)
  if (!who) throw new AuthError('нужен вход')
  if (path === '/v1/payments/sync') {
    if (request.method !== 'POST') throw NOT_FOUND()
    if (!who.isService) throw new ApiError('permission-denied', 'копию оплат присылает только прокси')
    const text = await request.text()
    const r = await deps.withClient(c => paymentsSync(c, text, url.searchParams.get('allowShrink') === '1'))
    return json(r, 200, request, env)
  }
  if (request.method !== 'GET') throw NOT_FOUND()
  if (path === '/v1/payments/rows') {
    if (!who.isService) throw new ApiError('permission-denied', 'строки оплат — только для бота')
    const text = await deps.withClient(c => paymentsRows(c, url.searchParams))
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request, env) } })
  }
  if (path === '/v1/payments' || path === '/v1/payments/meta') {
    return await deps.withClient(async client => {
      const auth = await authOf(client, who)
      if (path === '/v1/payments/meta') {
        if (!auth.isService && auth.role !== 'admin') throw new ApiError('permission-denied', 'сводка — только админу')
        return json(await paymentsMeta(client), 200, request, env)
      }
      const r = await paymentsCsv(client, auth)
      return new Response(r.text, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
          'x-payments-synced-at': new Date(r.syncedAt).toISOString(), 'x-payments-checked-at': new Date(r.checkedAt).toISOString(),
          ...corsHeaders(request, env),
        },
      })
    })
  }
  throw NOT_FOUND()
}

export async function handle(request, env, deps) {
  const url = new URL(request.url)
  const log = deps.log || (e => console.error(e))
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })

  try {
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      const v = await deps.withClient(c => c.query(`SELECT value FROM ${qualify('schema_meta')} WHERE key = 'schema_version'`))
      return json({ ok: true, schema: v.rows[0] ? v.rows[0].value : null }, 200, request, env)
    }
    if (url.pathname.startsWith(FS_PREFIX)) return await fsRoute(request, env, deps, url)
    if (url.pathname === '/v1/payments' || url.pathname.startsWith('/v1/payments/')) return await paymentsRoute(request, env, deps, url)
    if (url.pathname.startsWith('/v1/events/')) return await eventsRoute(request, env, deps, url)
    if (url.pathname.startsWith('/v1/links/')) return await linksRoute(request, env, deps, url)
    if (url.pathname === '/v1/certs/delete') return await linksRoute(request, env, deps, url)
    if (url.pathname.startsWith('/v1/mail/')) return await mailRoute(request, env, deps, url)
    if (request.method === 'GET' && url.pathname.startsWith('/go/')) return await goRedirect(request, env, deps, url.pathname.slice(4))
    if (request.method !== 'POST' || !['/v1/get', '/v1/query', '/v1/commit'].includes(url.pathname)) {
      return json({ error: { code: 'not-found', message: 'нет такого адреса' } }, 404, request, env)
    }

    const who = await identify(request, env, deps)
    if (!who) throw new AuthError('нужен вход')

    const text = await request.text()
    if (text.length > MAX_BODY) throw new ApiError('invalid-argument', 'слишком большой запрос')
    let body
    try { body = JSON.parse(text || '{}') } catch { throw new ApiError('invalid-argument', 'тело — не JSON') }

    return await deps.withClient(async client => {
      const auth = await authOf(client, who)
      if (url.pathname === '/v1/get') return json({ doc: await getDoc(client, auth, body.coll, body.id) }, 200, request, env)
      if (url.pathname === '/v1/query') return json({ docs: await queryDocs(client, auth, body.coll, body) }, 200, request, env)
      return json(await commit(client, auth, body.writes), 200, request, env)
    })
  } catch (e) {
    return fail(e, request, env, log)
  }
}
