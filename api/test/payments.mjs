// Тесты оплат (копия листа Table 2 в базе): права, замена копии, CSV, строки для бота, сводка,
// «протухание» и расписание. Схема paytest пересоздаётся с нуля; данные — выдуманные.
//
// Часть 2 (если есть gas/crm-proxy.gs и gas/bot.gs — в git их нет) гоняет НАСТОЯЩИЙ код:
//  • прокси собирает копию (_payBuild/_paySync) из выдуманного листа и шлёт её в API;
//  • CSV из API сравнивается с doGet прокси байт в байт — для админа и для тренера;
//  • бот считает остаток и ищет клиента по листу и по строкам из базы — результаты равны;
//  • бот после своей записи просит прокси обновить копию (_payDirty), сбой → читает лист.
//
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/payments.mjs

import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { handle } from '../src/handler.js'
import { setSchema } from '../src/store.js'
import { _resetJwksCache } from '../src/auth.js'
import { paymentsCron } from '../src/payments.js'

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const SCHEMA = 'paytest'
const PROJECT = 'repchess-trainer'
const SERVICE_KEY = 'test-service-key-pay-0123456789'
const ORIGIN = 'https://repchess.ayvaz-270904.workers.dev'
const env = { FIREBASE_PROJECT_ID: PROJECT, SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN, AUTH_PROVIDERS: 'firebase,service', PAYMENTS_PROXY_URL: 'https://proxy.test/exec' }

for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const client = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-paytest' })

// ── Токены «как у Firebase» (как в run.mjs) ──
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
async function makeKey(kid) {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  return { kid, priv: kp.privateKey, jwk: { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid, alg: 'RS256', use: 'sig' } }
}
async function token(key, claims) {
  const now = Math.floor(Date.now() / 1000)
  const head = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT' }) + '.' + enc({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, ...claims })
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, new TextEncoder().encode(head))
  return head + '.' + Buffer.from(sig).toString('base64url')
}
let goodKey
const deps = { withClient: fn => fn(client), fetchImpl: async () => new Response(JSON.stringify({ keys: [goodKey.jwk] }), { headers: { 'cache-control': 'max-age=3600' } }), log: () => {} }
const tok = {}

async function call(path, { method = 'GET', body, who } = {}) {
  const headers = { origin: ORIGIN }
  if (who === 'service') headers['x-service-key'] = SERVICE_KEY
  else if (who) headers.authorization = 'Bearer ' + tok[who]
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await handle(new Request('https://api.test' + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env, deps)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, text, json, headers: res.headers }
}

let passed = 0
const failed = []
async function t(name, fn) {
  try { await fn(); passed++; console.log('OK   ' + name) }
  catch (e) { failed.push(name); console.log('FAIL ' + name + ' — ' + e.message) }
}
const J = v => JSON.stringify(v)
const eq = (a, b, what = '') => { if (J(a) !== J(b)) throw new Error(`${what} ожидалось ${J(b)}, получено ${J(a)}`) }

// ── Выдуманная копия без кода прокси (часть 1) ──
const clean = s => String(s == null ? '' : s).trim().replace(/^"+|"+$/g, '').trim()
const phone10 = p => { const d = String(p == null ? '' : p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const COLS = ['Name', 'Email', 'Phone', 'sent', 'paymentid', 'products', 'price', 'Checkbox']
const cellCsv = v => '"' + (v && typeof v === 'object' ? 'D' + v.d : clean(String(v))).replace(/"/g, '""') + '"'
function snapshot(rows, { readAt = new Date().toISOString(), digest } = {}) {
  const out = rows.map((c, i) => ({ r: i + 2, c, l: c.map(cellCsv).join(','), e: clean(c[1]).toLowerCase(), p: phone10(c[2]) }))
  const header = COLS.map(cellCsv).join(',')
  return { columns: COLS, header, rows: out, digest: digest || crypto.createHash('md5').update(J([COLS, header, out])).digest('hex'), readAt, source: 'test' }
}
const R = (name, email, phone, pid, products, price, d = '2026-10-01T10:00:00.000Z') => [name, email, phone, { d }, pid, products, price, false]
const BASE = [
  R('Аня', ' "S1@X.ru" ', '+7 (916) 111-22-33', 'tinkoff:123', 'Индив. онлайн, 4 занятия', 8000),
  R('Боря', 'b@x.ru', '89162223344', 'sber:9', 'Групп. офлайн, 1 занятие', 1500),
  R('Аня', 's1-alt@x.ru', '79161112233', 'tinkoff:0-cert', 'Групп. онлайн, 1 занятие', 0),      // вторая почта Ани
  R('Вика', 'S1@x.ru', '79165556677', 'tinkoff:0', 'Индив. офлайн, 1 занятие', 0),             // общая почта с Аней
  R('Аня', 's1@x.ru', '9161112233', 'manual:override', 'Ручной баланс — Индив. онлайн, -2 занятий', 0),
  R('', '', '', '', '', '', '2026-10-02T10:00:00.000Z'),                                         // пустая строка
  R('Гена', 'g@x.ru', '123', 'pay:5', 'Индив. онлайн, 10 занятий', '15 000,50'),               // короткий телефон
]
const filler = n => Array.from({ length: n }, (_, i) => R('Ф' + i, `f${i}@x.ru`, '7900000' + String(1000 + i), 'tinkoff:f' + i, 'Групп. онлайн, 1 занятие', 1000))

async function seed() {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  await client.query(fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'))
  const ins = (id, doc) => client.query(`INSERT INTO trainers (id, doc) VALUES ($1, $2)`, [id, doc])
  await ins('uidAdmin', { name: 'Админ', role: 'admin', email: 'admin@x.ru' })
  await ins('uidT1', { name: 'Тренер 1', role: 'trainer', email: 't1@x.ru', assignedStudents: ['  "S1@X.RU" ', 'nobody@x.ru', 7] })
  await ins('uidT2', { name: 'Тренер 2', role: 'trainer', email: 't2@x.ru', assignedStudents: [] })
  await client.query('SET search_path TO public')   // дальше — как Worker через Hyperdrive: схема в имени таблицы
  setSchema(SCHEMA)
}
const meta = async () => (await client.query(`SELECT rows, digest, source, read_at, checked_at, synced_at FROM ${SCHEMA}.payments_meta WHERE id = 1`)).rows[0]
const ago = sec => client.query(`UPDATE ${SCHEMA}.payments_meta SET checked_at = now() - make_interval(secs => $1) WHERE id = 1`, [sec])

async function partApi() {
  const s1 = snapshot([...BASE, ...filler(40)])
  await t('sync: без входа — 401', async () => eq((await call('/v1/payments/sync', { method: 'POST', body: s1 })).status, 401))
  await t('sync: вход админа (не ключ) — 403', async () => eq((await call('/v1/payments/sync', { method: 'POST', body: s1, who: 'admin' })).status, 403))
  await t('sync: не JSON — 400', async () => eq((await call('/v1/payments/sync', { method: 'POST', body: '{oops', who: 'service' })).status, 400))
  await t('sync: в шапке нет колонки — 400 с названием', async () => {
    const r = await call('/v1/payments/sync', { method: 'POST', body: { ...s1, columns: COLS.filter(c => c !== 'paymentid') }, who: 'service' })
    eq([r.status, /paymentid/.test(r.json.error.message)], [400, true])
  })
  await t('sync: строка не в том формате — 400, копия не тронута', async () => {
    const r = await call('/v1/payments/sync', { method: 'POST', body: { ...s1, rows: [{ r: 2, c: [], l: 5, e: '', p: '' }] }, who: 'service' })
    eq([r.status, await meta()], [400, undefined])
  })
  await t('sync: GET — 404', async () => eq((await call('/v1/payments/sync', { who: 'service' })).status, 404))
  await t('sync: первая копия записана', async () => {
    const r = await call('/v1/payments/sync', { method: 'POST', body: s1, who: 'service' })
    eq([r.status, r.json.changed, r.json.rows, r.json.digest, (await meta()).rows], [200, true, 47, s1.digest, 47])
  })
  await t('sync: тот же отпечаток — без замены, проверка отмечена', async () => {
    await ago(600)
    const before = await meta()
    const r = await call('/v1/payments/sync', { method: 'POST', body: { ...s1, readAt: new Date().toISOString() }, who: 'service' })
    const after = await meta()
    eq([r.json.changed, after.synced_at.getTime() === before.synced_at.getTime(), after.checked_at > before.checked_at], [false, true, true])
  })
  await t('sync: копия, прочитанная раньше записанной, не принимается', async () => {
    const old = snapshot(BASE, { readAt: '2020-01-01T00:00:00.000Z' })
    const r = await call('/v1/payments/sync', { method: 'POST', body: old, who: 'service' })
    eq([r.json.skipped, (await meta()).rows], ['older', 47])
  })
  await t('sync: лист резко уменьшился — 400; с allowShrink=1 — принят', async () => {
    const small = snapshot(BASE)
    const r1 = await call('/v1/payments/sync', { method: 'POST', body: small, who: 'service' })
    const r2 = await call('/v1/payments/sync?allowShrink=1', { method: 'POST', body: small, who: 'service' })
    eq([r1.status, r2.status, r2.json.rows, (await meta()).rows], [400, 200, 7, 7])
  })
  await t('sync: повтор номера строки — 400', async () => {
    const s = snapshot([...BASE, ...filler(2)]); s.rows[1].r = 2
    eq((await call('/v1/payments/sync', { method: 'POST', body: s, who: 'service' })).status, 400)
  })

  const s2 = snapshot([...BASE, ...filler(3)])
  await call('/v1/payments/sync', { method: 'POST', body: s2, who: 'service' })
  const lines = s2.rows.map(r => r.l)
  await t('CSV: админ — шапка и все строки по порядку листа', async () => {
    const r = await call('/v1/payments', { who: 'admin' })
    eq([r.status, r.text, r.headers.get('content-type')], [200, [s2.header, ...lines].join('\n'), 'text/plain; charset=utf-8'])
  })
  await t('CSV: время копии в заголовках и они видны странице (CORS)', async () => {
    const r = await call('/v1/payments', { who: 'admin' })
    eq([!!r.headers.get('x-payments-synced-at'), /x-payments-synced-at/.test(r.headers.get('access-control-expose-headers') || '')], [true, true])
  })
  await t('CSV: тренер — только строки своих учеников (почта без кавычек и регистра)', async () => {
    const r = await call('/v1/payments', { who: 't1' })
    eq(r.text, [s2.header, lines[0], lines[3], lines[4]].join('\n'))
  })
  await t('CSV: тренер без учеников — только шапка', async () => eq((await call('/v1/payments', { who: 't2' })).text, s2.header))
  await t('CSV: вошёл, но не тренер — 403; без входа — 401', async () => eq([(await call('/v1/payments', { who: 'stranger' })).status, (await call('/v1/payments')).status], [403, 401]))
  await t('CSV: служебный ключ — все строки', async () => eq((await call('/v1/payments', { who: 'service' })).text.split('\n').length, 1 + lines.length))
  await t('CSV: POST — 404', async () => eq((await call('/v1/payments', { method: 'POST', body: {}, who: 'admin' })).status, 404))

  await t('rows: только служебный ключ (админ — 403)', async () => eq((await call('/v1/payments/rows?all=1', { who: 'admin' })).status, 403))
  await t('rows: телефон → его строки, строки его почт и общая почта, порядок листа, даты {d}', async () => {
    const r = await call('/v1/payments/rows?phone=9161112233&email=', { who: 'service' })
    eq([r.json.columns, r.json.total, r.json.rows.map(c => c[0] + ':' + c[4]), r.json.rows[0][3]],
      [COLS, 10, ['Аня:tinkoff:123', 'Аня:tinkoff:0-cert', 'Вика:tinkoff:0', 'Аня:manual:override'], { d: '2026-10-01T10:00:00.000Z' }])
  })
  await t('rows: только почта — строки этой почты', async () => {
    const r = await call('/v1/payments/rows?phone=&email=b%40x.ru', { who: 'service' })
    eq(r.json.rows.map(c => c[0]), ['Боря'])
  })
  await t('rows: пустой телефон не цепляет строки без телефона', async () => {
    const r = await call('/v1/payments/rows?phone=&email=nobody%40x.ru', { who: 'service' })
    eq(r.json.rows, [])
  })
  await t('rows: all=1 — все строки; неверный телефон и пустой запрос — 400', async () => {
    const all = await call('/v1/payments/rows?all=1', { who: 'service' })
    eq([all.json.rows.length, (await call('/v1/payments/rows?phone=12ab', { who: 'service' })).status, (await call('/v1/payments/rows', { who: 'service' })).status], [10, 400, 400])
  })

  await t('meta: админу и ключу — сводка; тренеру — 403', async () => {
    const r = await call('/v1/payments/meta', { who: 'admin' })
    eq([r.json.rows, r.json.stats, (await call('/v1/payments/meta', { who: 'service' })).status, (await call('/v1/payments/meta', { who: 't1' })).status],
      [10, { rows: 10, paid: 8, paidSum: 27500.5, promo: 1, cert: 1, manual: 1, priceSum: 27500.5 }, 200, 403])
  })

  await t('копия давно не сверялась — CSV и rows отвечают 503 (страницы и бот уходят в таблицу)', async () => {
    await ago(21 * 60)
    eq([(await call('/v1/payments', { who: 'admin' })).status, (await call('/v1/payments/rows?all=1', { who: 'service' })).status], [503, 503])
  })
  const digest = (await meta()).digest
  const proxy = reply => async (url, init) => { proxy.last = { url, body: JSON.parse(init.body) }; return new Response(typeof reply === 'string' ? reply : J(reply)) }
  await t('расписание: прокси подтвердил тот же отпечаток — копия снова «свежая»', async () => {
    const out = await paymentsCron(env, deps, proxy({ ok: true, changed: false, digest }))
    eq([out.ok, proxy.last.url, proxy.last.body.action, proxy.last.body.key, proxy.last.body.digest, (await call('/v1/payments', { who: 'admin' })).status],
      [true, env.PAYMENTS_PROXY_URL, 'paySync', SERVICE_KEY, digest, 200])
  })
  await t('расписание: отпечаток не тот, прокси с ошибкой или не JSON — проверка не отмечается', async () => {
    await ago(21 * 60)
    await paymentsCron(env, deps, proxy({ ok: true, changed: false, digest: 'другой' }))
    let e1 = '', e2 = ''
    try { await paymentsCron(env, deps, proxy({ ok: false, error: 'нет ключа' })) } catch (e) { e1 = e.message }
    try { await paymentsCron(env, deps, proxy('<html>Unauthorized')) } catch (e) { e2 = e.message }
    eq([/нет ключа/.test(e1), /не JSON/.test(e2), (await call('/v1/payments', { who: 'admin' })).status], [true, true, 503])
  })
  await t('расписание без адреса прокси — пропуск', async () => eq(!!(await paymentsCron({ ...env, PAYMENTS_PROXY_URL: '' }, deps)).skipped, true))
  await ago(0)
}

// ── Часть 2: настоящий код прокси и бота ──
const proxyPath = fileURLToPath(new URL('../../gas/crm-proxy.gs', import.meta.url))
const botPath = fileURLToPath(new URL('../../gas/bot.gs', import.meta.url))

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]))
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|H|mm|ss/g, (m, lit) => lit !== undefined ? lit
    : ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, H: String(Number(parts.hour)), mm: parts.minute, ss: parts.second })[m])
}
// Синхронный UrlFetchApp через curl (как в bot-check.mjs): сервер API — отдельный процесс
function curlFetch(url, o = {}) {
  const args = ['-s', '-X', String(o.method || 'get').toUpperCase(), '-w', '\n%{http_code}', '--max-time', '30']
  const headers = { ...(o.headers || {}) }
  if (o.contentType) headers['content-type'] = o.contentType
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  if (o.payload !== undefined) args.push('--data-binary', '@-')
  const out = execFileSync('curl', [...args, url], { input: o.payload === undefined ? undefined : String(o.payload), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const i = out.lastIndexOf('\n')
  return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) }
}
// Даты листа создаём конструктором Date ИЗ контекста GAS: иначе `cell instanceof Date` в коде
// прокси и бота не узнаёт их (другой realm), и даты не проверяются вовсе.
function gasContext(sheetRef, props, fetchImpl) {
  const cache = {}
  let CtxDate = Date
  const values = () => sheetRef.vals.map(r => r.map(v => v instanceof Date ? new CtxDate(v.getTime()) : v))
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    UrlFetchApp: { fetch: fetchImpl, fetchAll: reqs => reqs.map(q => fetchImpl(q.url, q)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v) }, deleteProperty: k => { delete props[k] }, getProperties: () => ({ ...props }) }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v }, remove: k => { delete cache[k] } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {}, openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: values }), getLastRow: () => sheetRef.vals.length }], getSheetByName: () => null }) },
    ContentService: { MimeType: { TEXT: 'text' }, createTextOutput: text => ({ text, setMimeType() { return this } }) },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    Utilities: {
      formatDate, sleep() {},
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => [...crypto.createHash(alg).update(str, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    ScriptApp: { getOAuthToken: () => 'oauth' },
    Logger: { log() {} },
  })
  CtxDate = vm.runInContext('Date', ctx)
  return ctx
}

async function partGas() {
  if (!fs.existsSync(proxyPath) || !fs.existsSync(botPath)) { console.log('gas/crm-proxy.gs или gas/bot.gs нет — часть 2 пропущена'); return }
  const PORT = 8792, LOCAL = `http://127.0.0.1:${PORT}`
  const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(PORT), SERVICE_KEY, PGSCHEMA: SCHEMA }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((res, rej) => { server.stdout.on('data', d => String(d).includes('локально') && res()); server.on('exit', c => rej(new Error('сервер не запустился, код ' + c))) })
  try {
    // Выдуманный лист: даты — Date, числа, кавычки Тильды, почты в разном регистре, общие почты,
    // ручной баланс, сертификаты, пустая строка, кавычка и перевод строки внутри ячейки.
    const H = ['Name', 'Email', 'Input', 'Phone', 'referer', 'sent', 'requestid', 'Ваш_ник_в_Telegram', 'paymentid', 'products', 'price', 'Checkbox']
    const D = s => new Date(s)
    const row = (n, e, ph, sent, pid, prod, price, extra = {}) => H.map(h => ({ Name: n, Email: e, Phone: ph, sent, paymentid: pid, products: prod, price, Input: extra.input || '', referer: '', requestid: 'rq' + Math.random().toString(36).slice(2, 8), 'Ваш_ник_в_Telegram': extra.nick || '', Checkbox: '' })[h])
    const sheet = { vals: [H,
      row('"Анна Кот"', ' "Anna@X.ru" ', '+7 (916) 111-22-33', D('2026-10-07T14:52:00Z'), 'tinkoff:1001', 'Индив. онлайн, 4 занятия', 8000, { nick: '@anna' }),
      row('Анна Кот', 'anna@x.ru', 79161112233, D('2026-09-23T09:00:00Z'), 'tinkoff:1002', 'Индив. онлайн, 1 занятие', 2200),
      row('Анна', 'anna2@x.ru', '9161112233', D('2026-11-01T08:00:00Z'), 'tinkoff:0-cert', 'Групп. онлайн, 1 занятие — подарок за регистрацию', 0),
      row('Муж Анны', 'ANNA@x.ru', '79167778899', D('2026-08-01T10:00:00Z'), 'sber:77', 'Групп. офлайн, 4 занятия', 5600),
      row('Анна Кот', 'anna@x.ru', '79161112233', D('2026-11-05T12:00:00Z'), 'manual:override', 'Ручной баланс — Индив. онлайн, -1 занятий', 0),
      row('Борис', 'boris@x.ru', '', D('2026-07-01T10:00:00Z'), 'pay:55', 'Групп. онлайн, 10 занятий', '12 000'),
      row('', '', '', '', '', '', ''),
      row('Вера "В."', 'vera@x.ru', '8 (903) 000-00-01', D('2026-10-30T20:30:00Z'), 'tinkoff:0', 'Индив. офлайн, 1 занятие', 0, { input: 'строка1\nстрока2' }),
      row('Вера', 'vera@x.ru', '89030000001', D('2026-06-15T10:00:00Z'), 'tinkoff:99', '2 x 1500 Групп. онлайн', 3000),
      row('Гоша', 'gosha@x.ru', '12345', D('2026-10-01T10:00:00Z'), 'old', 'Индив. онлайн, 4 занятия', 8000),
    ] }
    const pprops = { API_SERVICE_KEY: SERVICE_KEY }
    const pctx = gasContext(sheet, pprops, curlFetch)
    const psrc = fs.readFileSync(proxyPath, 'utf8')
    const pmark = "const API_BASE = 'https://repchess-api.ayvaz-270904.workers.dev';"
    if (!psrc.includes(pmark)) throw new Error('в crm-proxy.gs нет строки API_BASE')
    vm.runInContext(psrc.replace(pmark, `const API_BASE = '${LOCAL}';`), pctx, { filename: 'crm-proxy.gs' })
    const P = expr => vm.runInContext(expr, pctx)

    await t('прокси: paySync без ключа и с чужим ключом — Unauthorized', async () => {
      const post = body => P(`doPost({ postData: { contents: ${J(J(body))} } })`).text
      eq([post({ action: 'paySync' }), post({ action: 'paySync', key: 'чужой' })], ['Unauthorized', 'Unauthorized'])
    })
    await t('прокси: первая копия уходит в API', async () => {
      const r = JSON.parse(P(`doPost({ postData: { contents: ${J(J({ action: 'paySync', key: SERVICE_KEY, source: 'test' }))} } })`).text)
      eq([r.ok, r.changed, r.rows, (await meta()).source], [true, true, sheet.vals.length - 1, 'test'])
    })
    const digest1 = (await meta()).digest
    await t('прокси: лист не менялся — с отпечатком базы ничего не шлёт', async () => {
      const r = P(`_paySync('cron', ${J(digest1)}, false)`)
      eq([r.ok, r.changed, r.digest], [true, false, digest1])
    })
    await t('расписание → прокси → копия «свежая» (сквозной путь)', async () => {
      await ago(21 * 60)
      const viaProxy = async (url, init) => new Response(P(`doPost({ postData: { contents: ${J(init.body)} } })`).text)
      const out = await paymentsCron(env, deps, viaProxy)
      eq([out.ok, out.changed, (await call('/v1/payments', { who: 'admin' })).status], [true, false, 200])
    })

    const csvFromProxy = auth => { pctx.__auth = auth; return P(`(function(){ var real = _auth; _auth = function(){ return __auth }; try { return doGet({ parameter: {} }).text } finally { _auth = real } })()`) }
    await t('CSV из базы = doGet прокси байт в байт (админ)', async () => {
      const api = await call('/v1/payments', { who: 'admin' })
      // 14:52 UTC = 17:52 по Москве: даты действительно форматируются, а не уходят строкой
      eq([api.text === csvFromProxy({ uid: 'uidAdmin', role: 'admin', assigned: [] }), api.text.includes('"2026-10-07 17:52:00"')], [true, true])
    })
    await t('CSV из базы = doGet прокси байт в байт (тренер со своими учениками)', async () => {
      await client.query(`UPDATE ${SCHEMA}.trainers SET doc = jsonb_set(doc, '{assignedStudents}', '["anna@x.ru", " VERA@x.ru "]') WHERE id = 'uidT2'`)
      const api = await call('/v1/payments', { who: 't2' })
      const proxyText = csvFromProxy({ uid: 'uidT2', role: 'trainer', assigned: ['anna@x.ru', 'vera@x.ru'] })
      eq([api.text === proxyText, api.text.split('\n').length], [true, 8])   // шапка, 6 строк, перевод строки в ячейке Веры
    })

    // Бот: адреса API и прокси — локальные; «прокси» зовём прямо в его контексте
    const bprops = { DATA_BACKEND: 'api', API_SERVICE_KEY: SERVICE_KEY, PAYMENTS_BACKEND: 'api' }
    let proxyCalls = 0, proxyBroken = false
    const botFetch = (url, o = {}) => {
      if (url === 'https://proxy.local/exec') {
        proxyCalls++
        if (proxyBroken) return { getResponseCode: () => 200, getContentText: () => 'Unauthorized' }
        const text = P(`doPost({ postData: { contents: ${J(String(o.payload))} } })`).text
        return { getResponseCode: () => 200, getContentText: () => text }
      }
      return curlFetch(url, o)
    }
    const bctx = gasContext(sheet, bprops, botFetch)
    let bsrc = fs.readFileSync(botPath, 'utf8')
    for (const [from, to] of [
      ["const API_PAY_BASE = 'https://repchess-api.ayvaz-270904.workers.dev/v1/payments';", `const API_PAY_BASE = '${LOCAL}/v1/payments';`],
      ["const API_FS_BASE = 'https://repchess-api.ayvaz-270904.workers.dev/fs/documents';", `const API_FS_BASE = '${LOCAL}/fs/documents';`],
      [/const CRM_PROXY_URL = '[^']+';/, "const CRM_PROXY_URL = 'https://proxy.local/exec';"],
    ]) { if (!(typeof from === 'string' ? bsrc.includes(from) : from.test(bsrc))) throw new Error('в bot.gs нет строки ' + from); bsrc = bsrc.replace(from, to) }
    vm.runInContext(bsrc, bctx, { filename: 'bot.gs' })
    const B = expr => vm.runInContext(expr, bctx)

    // Все варианты «человека» из строк листа: почта+телефон, только почта, только телефон
    const people = () => {
      const seen = new Set(), out = []
      const iE = H.indexOf('Email'), iP = H.indexOf('Phone')
      for (const r of sheet.vals.slice(1)) {
        const e = clean(r[iE]).toLowerCase(), p = phone10(r[iP])
        for (const x of [[e, p], [e, ''], ['', p]]) { const k = x.join('|'); if ((x[0] || x[1]) && !seen.has(k)) { seen.add(k); out.push(x) } }
      }
      return out
    }
    const both = (e, p) => {
      bctx.__e = e; bctx.__p = p
      return B(`(function(){
        var k = 'bal:' + (__e || __p), sheet = SpreadsheetApp.openById(TABLE_ID).getSheets()[0].getDataRange().getValues();
        _cDel(k); var a = JSON.stringify([clientBalance(__e, __p, sheet), __p ? findClientByPhone(__p, sheet) : null, __e ? findClientByEmail(__e, sheet) : null]);
        _cDel(k); var b = JSON.stringify([clientBalance(__e, __p), __p ? findClientByPhone(__p) : null, __e ? findClientByEmail(__e) : null]);
        _cDel(k); return [a, b, _PAY_SHEET_ONLY];
      })()`)
    }
    await t('бот: остаток, поиск по телефону и почте — по листу и по базе одинаково (все варианты людей)', async () => {
      const ps = people(), bad = []
      for (const [e, p] of ps) { const [a, b, sheetOnly] = both(e, p); if (a !== b || sheetOnly) bad.push(e + '/' + p) }
      eq([ps.length > 10, bad], [true, []])
    })
    await t('бот: по базе остаток Анны учитывает обе её почты, общую почту и ручной баланс', async () => {
      const r = JSON.parse(both('anna@x.ru', '9161112233')[1])[0]
      eq([r.sharedEmail, r.emails, Object.keys(r.override)], [true, ['anna@x.ru', 'anna2@x.ru'], ['Индив. онлайн']])
    })

    await t('бот: после своей записи просит прокси, и база сразу видит новую строку', async () => {
      sheet.vals.push(row('Борис', 'boris@x.ru', '', new Date(), 'tinkoff:0-cert', 'Групп. онлайн, 1 занятие', 0))
      const calls = proxyCalls
      const ok = B(`_payDirty('cert')`)
      const [a, b] = both('boris@x.ru', '')
      eq([ok, proxyCalls - calls, a === b, JSON.parse(b)[0].totalActive], [true, 1, true, 11])   // 10 из пакета + 1 сертификат
    })
    await t('бот: прокси не ответил — до конца запуска читает лист, а не устаревшую копию', async () => {
      proxyBroken = true
      sheet.vals.push(row('Борис', 'boris@x.ru', '', new Date(), 'tinkoff:0-cert', 'Групп. онлайн, 1 занятие', 0))
      const ok = B(`_payDirty('cert')`)
      bctx.__e = 'boris@x.ru'; bctx.__p = ''
      const total = B(`(_cDel('bal:boris@x.ru'), clientBalance('boris@x.ru', '').totalActive)`)
      eq([ok, B('_PAY_SHEET_ONLY'), total], [false, true, 12])
      proxyBroken = false
      B('_PAY_SHEET_ONLY = false')
    })
    await t('бот: в режиме листа (откат) к API и прокси не ходит', async () => {
      B(`paymentsFromSheet()`)
      const calls = proxyCalls
      const out = B(`[_payRowsApi('9161112233', ''), _payDirty('x')]`)
      eq([bprops.PAYMENTS_BACKEND, out, proxyCalls - calls], ['sheet', [null, true], 0])
    })
    await t('бот: checkPaymentsApi на выдуманном листе — сходится, setupPaymentsApi включает базу', async () => {
      P(`_paySync('test', '', false)`)
      const ok = B(`checkPaymentsApi()`)
      B(`setupPaymentsApi()`)
      eq([ok, bprops.PAYMENTS_BACKEND, B('_payApiOn()')], [true, 'api', true])
    })
    await t('бот: checkPaymentsApi ловит расхождение (копия отстала), setupPaymentsApi не включает базу', async () => {
      B(`paymentsFromSheet()`)
      proxyBroken = true
      sheet.vals[2][H.indexOf('price')] = 9999   // поменяли лист, а прокси не отвечает — копия старая
      const ok = B(`checkPaymentsApi()`)
      B(`setupPaymentsApi()`)
      eq([ok, bprops.PAYMENTS_BACKEND], [false, 'sheet'])
      proxyBroken = false
    })
  } finally {
    server.kill()
  }
}

async function main() {
  await client.connect()
  await seed()
  goodKey = await makeKey('k1')
  _resetJwksCache()
  tok.admin = await token(goodKey, { sub: 'uidAdmin' })
  tok.t1 = await token(goodKey, { sub: 'uidT1' })
  tok.t2 = await token(goodKey, { sub: 'uidT2' })
  tok.stranger = await token(goodKey, { sub: 'uidStranger' })
  await partApi()
  await partGas()
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
  console.log(`\nИтог: ${passed} прошло, ${failed.length} не прошло`)
  if (failed.length) process.exitCode = 1
}

main().catch(async e => { console.error('ОШИБКА ЗАПУСКА: ' + (e.stack || e.message)); process.exitCode = 1; try { await client.end() } catch {} })
