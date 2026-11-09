// HTTP-обработчик API. Не зависит от того, где работает: Worker (worker.js) и тесты
// (test/run.mjs) передают свой способ получить клиента базы — deps.withClient(fn).
//
//   GET  /v1/health                     — жив ли API и база (без входа)
//   POST /v1/get     { coll, id }       — документ или null
//   POST /v1/query   { coll, where, orderBy, limit } — список { id, data }
//   POST /v1/commit  { writes: [...] }  — пакет записей одной транзакцией
//
// Ответ — JSON. Ошибка — { error: { code, message } } с кодом HTTP по смыслу.

import { identify, AuthError } from './auth.js'
import { getDoc, queryDocs, commit, ApiError } from './store.js'

const STATUS = {
  'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403,
  'not-found': 404, 'already-exists': 409,
}
const MAX_BODY = 1_000_000

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || ''
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const h = { 'vary': 'origin' }
  if (origin && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin
    h['access-control-allow-headers'] = 'authorization, content-type, x-service-key'
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    h['access-control-max-age'] = '600'
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

export async function handle(request, env, deps) {
  const url = new URL(request.url)
  const log = deps.log || (e => console.error(e))
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })

  try {
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      const v = await deps.withClient(c => c.query(`SELECT value FROM schema_meta WHERE key = 'schema_version'`))
      return json({ ok: true, schema: v.rows[0] ? v.rows[0].value : null }, 200, request, env)
    }
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
      // Роль — из документа тренера. Пользователь без документа тренера в API не допускается
      // (строже Firestore: там любой вошедший читал priceOverrides).
      const auth = { uid: who.uid, isService: who.isService, role: null }
      if (!who.isService) {
        const r = await client.query('SELECT role FROM trainers WHERE id = $1', [who.uid])
        if (!r.rows[0]) throw new ApiError('permission-denied', 'нет учётной записи тренера')
        auth.role = r.rows[0].role
      }
      if (url.pathname === '/v1/get') return json({ doc: await getDoc(client, auth, body.coll, body.id) }, 200, request, env)
      if (url.pathname === '/v1/query') return json({ docs: await queryDocs(client, auth, body.coll, body) }, 200, request, env)
      return json(await commit(client, auth, body.writes), 200, request, env)
    })
  } catch (e) {
    return fail(e, request, env, log)
  }
}
