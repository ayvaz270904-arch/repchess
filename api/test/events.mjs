// Тесты событий (api/src/events.js): права, запись пачкой, журнал по человеку, сводка по дням.
// Схема evtest пересоздаётся с нуля; данные — выдуманные.
//
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/events.mjs

import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { handle } from '../src/handler.js'
import { setSchema } from '../src/store.js'
import { _resetJwksCache } from '../src/auth.js'

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const SCHEMA = 'evtest'
const PROJECT = 'repchess-trainer'
const SERVICE_KEY = 'test-service-key-ev-0123456789'
const ORIGIN = 'https://repchess.ayvaz-270904.workers.dev'
const env = { FIREBASE_PROJECT_ID: PROJECT, SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN, AUTH_PROVIDERS: 'firebase,service' }

for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const client = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-evtest' })

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

async function call(path, { method = 'POST', body, who } = {}) {
  const headers = { origin: ORIGIN }
  if (who === 'service') headers['x-service-key'] = SERVICE_KEY
  else if (who) headers.authorization = 'Bearer ' + tok[who]
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await handle(new Request('https://api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

let passed = 0
const failed = []
async function t(name, fn) {
  try { await fn(); passed++; console.log('OK   ' + name) }
  catch (e) { failed.push(name); console.log('FAIL ' + name + ' — ' + e.message) }
}
const J = v => JSON.stringify(v)
const eq = (a, b, what = '') => { if (J(a) !== J(b)) throw new Error(`${what} ожидалось ${J(b)}, получено ${J(a)}`) }

async function seed() {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  await client.query(fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'))
  const ins = (id, doc) => client.query(`INSERT INTO trainers (id, doc) VALUES ($1, $2)`, [id, doc])
  await ins('uidAdmin', { name: 'Админ', role: 'admin', email: 'admin@x.ru' })
  await ins('uidT1', { name: 'Тренер 1', role: 'trainer', email: 't1@x.ru' })
  await client.query('SET search_path TO public')
  setSchema(SCHEMA)
}

// Московская полночь сегодня (UTC+3 круглый год) и сдвиги от неё
const mskMidnight = () => { const d = new Date(Date.now() + 3 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 3 * 3600000 }
const iso = ms => new Date(ms).toISOString()
const day = ms => new Date(ms + 3 * 3600000).toISOString().slice(0, 10)

async function main() {
  await client.connect()
  await seed()
  goodKey = await makeKey('k1')
  _resetJwksCache()
  tok.admin = await token(goodKey, { sub: 'uidAdmin' })
  tok.t1 = await token(goodKey, { sub: 'uidT1' })
  const now = Date.now()

  await t('права: писать может только служебный ключ', async () => {
    const rows = [{ ev: 'open' }]
    eq((await call('/v1/events/add', { body: { rows }, who: 'admin' })).status, 403, 'админ')
    eq((await call('/v1/events/add', { body: { rows }, who: 't1' })).status, 403, 'тренер')
    eq((await call('/v1/events/add', { body: { rows } })).status, 401, 'без входа')
  })

  await t('права: журнал и сводку видит админ и бот, тренер — нет', async () => {
    eq((await call('/v1/events/person', { body: { tg: '1' }, who: 't1' })).status, 403, 'тренер журнал')
    eq((await call('/v1/events/daily', { body: {}, who: 't1' })).status, 403, 'тренер сводка')
    eq((await call('/v1/events/daily', { body: {}, who: 'admin' })).status, 200, 'админ сводка')
    eq((await call('/v1/events/daily', { body: {}, who: 'service' })).status, 200, 'бот сводка')
    eq((await call('/v1/events/person', { method: 'GET', who: 'admin' })).status, 404, 'GET')
    eq((await call('/v1/events/nope', { body: {}, who: 'admin' })).status, 404, 'чужой адрес')
  })

  await t('запись: чистка полей, время вне окна → время записи, пустые события пропускаются', async () => {
    const r = await call('/v1/events/add', { who: 'service', body: { rows: [
      { ts: iso(now - 60000), src: 'app', tg: '111', email: ' A@X.RU ', ev: 'open', det: '', ver: 'c1' },
      { ts: '2020-01-01T00:00:00Z', src: 'zzz', tg: '11 1<script>', email: '', ev: 'tab', det: 'book\nx', ver: '' },
      { ev: '' },
      { ts: iso(now + 3600000), tg: '222', ev: 'x'.repeat(60), det: 'y'.repeat(300) },
    ] } })
    eq(r.status, 200, 'код'); eq(r.json.added, 3, 'добавлено')
    const rows = (await client.query(`SELECT ts, src, tg_id, email, event, detail, ver FROM ${SCHEMA}.events ORDER BY id`)).rows
    eq(rows[0].email, 'a@x.ru', 'почта строчными')
    eq(Math.abs(new Date(rows[0].ts) - (now - 60000)) < 1000, true, 'время события сохранено')
    eq(rows[1].src, 'app', 'неизвестный src → app'); eq(rows[1].tg_id, '111', 'tg только цифры'); eq(rows[1].detail, 'book x', 'перевод строки')
    eq(Math.abs(new Date(rows[1].ts) - now) < 60000, true, 'старое время → сейчас')
    eq(Math.abs(new Date(rows[2].ts) - now) < 60000, true, 'будущее время → сейчас')
    eq(rows[2].event.length, 40, 'событие ≤40'); eq(rows[2].detail.length, 200, 'деталь ≤200')
    await client.query(`DELETE FROM ${SCHEMA}.events`)
  })

  await t('перенос истории: старые даты как есть, до 500 строк, раньше 2025 — «сейчас»', async () => {
    const r = await call('/v1/events/add', { who: 'service', body: { import: true, rows: [
      { ts: '2026-09-05T10:00:00.000Z', tg: '1', ev: 'open' },
      { ts: '2020-01-01T00:00:00Z', tg: '1', ev: 'open' },
    ] } })
    eq(r.status, 200, 'код')
    const rows = (await client.query(`SELECT ts FROM ${SCHEMA}.events ORDER BY id`)).rows
    eq(new Date(rows[0].ts).toISOString(), '2026-09-05T10:00:00.000Z', 'сентябрь сохранён')
    eq(Math.abs(new Date(rows[1].ts) - now) < 60000, true, '2020 → сейчас')
    eq((await call('/v1/events/add', { who: 'service', body: { import: true, rows: Array(500).fill({ ev: 'a' }) } })).status, 200, '500 можно')
    eq((await call('/v1/events/add', { who: 'service', body: { import: true, rows: Array(501).fill({ ev: 'a' }) } })).status, 400, '501 нельзя')
    eq((await call('/v1/events/add', { who: 'service', body: { import: 'yes', rows: [{ ts: '2026-09-05T10:00:00Z', ev: 'a' }] } })).status, 200, 'не true')
    const last = (await client.query(`SELECT ts FROM ${SCHEMA}.events ORDER BY id DESC LIMIT 1`)).rows[0]
    eq(Math.abs(new Date(last.ts) - now) < 60000, true, 'import не true → обычное окно')
    await client.query(`DELETE FROM ${SCHEMA}.events`)
  })

  await t('запись: больше 100 за раз — отказ, не массив — отказ', async () => {
    eq((await call('/v1/events/add', { who: 'service', body: { rows: Array(101).fill({ ev: 'a' }) } })).status, 400, '101')
    eq((await call('/v1/events/add', { who: 'service', body: { rows: 'a' } })).status, 400, 'строка')
  })

  // Данные для журнала и сводки (время — в пределах двух суток, иначе API подставит «сейчас»)
  const M = mskMidnight()
  const add = rows => client.query(
    `INSERT INTO ${SCHEMA}.events (ts, src, tg_id, email, event, detail, ver) SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])`,
    [rows.map(r => iso(r[0])), rows.map(r => r[1]), rows.map(r => r[2]), rows.map(r => r[3]), rows.map(r => r[4]), rows.map(r => r[5]), rows.map(() => '')])
  // Гость 500 (без почты) получил почту g@x.ru; у той же почты второй телефон 501; чужой 900.
  // «Сегодня» берём не позже, чем сейчас: тест может идти и в 00:05.
  const todayEarly = Math.min(M + 60000, now - 1000)
  await add([
    [M - 86400000 + 3600000, 'bot', '500', '', 'start', 'src_vk'],                  // вчера 01:00 — гость
    [M - 86400000 + 7200000, 'app', '500', '', 'open', ''],
    [M - 86400000 + 7300000, 'app', '500', '', 'tab', 'book'],
    [M - 86400000 + 7400000, 'app', '500', 'g@x.ru', 'tab', 'book'],                // уже с почтой
    [M - 86400000 + 7500000, 'app', '900', 'z@x.ru', 'tab', 'book'],
    [M - 86400000 + 7600000, 'app', '900', 'z@x.ru', 'error', 'api:balance:timeout'],
    [M - 2 * 86400000 + 3600000, 'app', '900', 'z@x.ru', 'open', ''],               // позавчера
    [todayEarly, 'app', '501', 'g@x.ru', 'open', ''],                                 // сегодня, второй телефон
    [todayEarly, 'app', '900', 'z@x.ru', 'error', 'js:TypeError x'],
  ])

  await t('журнал: по почте находит и гостевую историю того же Telegram, и второй телефон', async () => {
    const r = await call('/v1/events/person', { who: 'admin', body: { emails: ['G@x.ru'] } })
    eq(r.status, 200, 'код')
    eq(r.json.rows.map(x => x.tg).sort(), ['500', '500', '500', '500', '501'], 'tg')
    eq(r.json.rows[0].ev, 'open', 'новые сверху'); eq(r.json.rows[0].tg, '501', 'самое новое')
    eq(r.json.rows.some(x => x.tg === '900'), false, 'чужих нет')
  })

  await t('журнал: по tg, limit и before для подгрузки', async () => {
    const all = (await call('/v1/events/person', { who: 'admin', body: { tg: '500' } })).json.rows
    eq(all.length, 5, 'по tg 500 + почта g@x.ru → и 501')
    const page = (await call('/v1/events/person', { who: 'admin', body: { tg: '500', limit: 2 } })).json.rows
    eq(page.length, 2, 'limit')
    const next = (await call('/v1/events/person', { who: 'admin', body: { tg: '500', limit: 10, before: page[1].ts } })).json.rows
    eq(next.length, 3, 'before'); eq(next.every(x => x.ts < page[1].ts), true, 'старше')
    eq((await call('/v1/events/person', { who: 'admin', body: {} })).status, 400, 'пусто')
  })

  await t('сводка: ключи, московские сутки, люди, вчера к этому часу', async () => {
    const r = await call('/v1/events/daily', { who: 'admin', body: { days: 3 } })
    eq(r.status, 200, 'код')
    const { days, keys } = r.json
    eq(days, [day(M), day(M - 86400000), day(M - 2 * 86400000)], 'дни')
    const y = day(M - 86400000)
    eq(keys['tab:book'].days[y], { n: 3, u: 2 }, 'tab:book вчера — 3 события, 2 человека')
    eq(keys['error:api'].days[y], { n: 1, u: 1 }, 'ошибки — по виду до «:»')
    eq(keys['error:js'].days[day(M)], { n: 1, u: 1 }, 'ошибка сегодня')
    eq(keys.open.days[day(M - 2 * 86400000)], { n: 1, u: 1 }, 'позавчера')
    eq(keys.open.days[day(M)], { n: 1, u: 1 }, 'сегодня')
    // «вчера к этому часу»: все вчерашние события раньше, чем сейчас минус сутки,
    // если тест идёт позже 02:07 МСК (время последнего вчерашнего события)
    if (now - M > 7600000) eq(keys['tab:book'].yesterdaySameTime, { n: 3, u: 2 }, 'вчера к этому часу')
    eq(keys.start.days[y], { n: 1, u: 1 }, 'start')
  })

  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
  console.log(`\nИтог: ${passed} прошло, ${failed.length} не прошло`)
  if (failed.length) process.exitCode = 1
}

main().catch(async e => { console.error('ОШИБКА ЗАПУСКА: ' + (e.stack || e.message)); process.exitCode = 1; try { await client.end() } catch {} })
