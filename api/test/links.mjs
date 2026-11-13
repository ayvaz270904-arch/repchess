// Тесты ссылок-источников (api/src/links.js): права, метка, переход /go, клики, запуски, оплаты.
// Схема lktest пересоздаётся с нуля; данные — выдуманные.
//
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/links.mjs

import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { handle } from '../src/handler.js'
import { setSchema } from '../src/store.js'
import { _resetJwksCache } from '../src/auth.js'
import { translit, mskStamp } from '../src/links.js'

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const SCHEMA = 'lktest'
const PROJECT = 'repchess-trainer'
const SERVICE_KEY = 'test-service-key-ev-0123456789'
const ORIGIN = 'https://repchess.ayvaz-270904.workers.dev'
const env = { FIREBASE_PROJECT_ID: PROJECT, SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN, AUTH_PROVIDERS: 'firebase,service' }

for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const client = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-lktest' })

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

async function call(path, { method = 'POST', body, who, ua, ip } = {}) {
  const headers = { origin: ORIGIN }
  if (ua) headers['user-agent'] = ua
  if (ip) headers['cf-connecting-ip'] = ip
  if (who === 'service') headers['x-service-key'] = SERVICE_KEY
  else if (who) headers.authorization = 'Bearer ' + tok[who]
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await handle(new Request('https://api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, location: res.headers.get('location') }
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
  const S = SCHEMA

  await t('метка: транслит, чистка, обрезка', async () => {
    eq(translit('Щука и Ёж'), 'schuka_i_ezh', 'щ/ё/ж')
    eq(translit('ВК — пост «Ярмарка» 15.11!'), 'vk_post_yarmarka_15_11', 'знаки')
    eq(translit('!!!'), 'link', 'пусто')
    eq(translit('a'.repeat(60)).length, 40, 'длина')
    eq(mskStamp(Date.parse('2026-11-13T21:30:00Z')), '141126', 'московская дата (00:30 14.11)')
  })

  await t('права: тренер и без входа — нет', async () => {
    eq((await call('/v1/links/list', { body: {}, who: 't1' })).status, 403, 'тренер список')
    eq((await call('/v1/links/create', { body: { name: 'x' }, who: 't1' })).status, 403, 'тренер создать')
    eq((await call('/v1/links/list', { body: {} })).status, 401, 'без входа')
    eq((await call('/v1/links/nope', { body: {}, who: 'admin' })).status, 404, 'чужой адрес')
  })

  let A, B
  await t('создание: метка с датой, повтор за день → _2, пустое — отказ', async () => {
    const r1 = await call('/v1/links/create', { body: { name: 'ВК Ярмарка' }, who: 'admin' })
    eq(r1.status, 200, 'код')
    A = r1.json.link.slug
    eq(A, 'vk_yarmarka_' + mskStamp(Date.now()), 'метка')
    const r2 = await call('/v1/links/create', { body: { name: 'ВК  Ярмарка ' }, who: 'admin' })
    eq(r2.json.link.slug, A + '_2', 'повтор')
    B = (await call('/v1/links/create', { body: { name: 'Школа 1514' }, who: 'admin' })).json.link.slug
    eq((await call('/v1/links/create', { body: { name: '   ' }, who: 'admin' })).status, 400, 'пусто')
    const by = (await client.query(`SELECT created_by FROM ${S}.links WHERE slug = $1`, [A])).rows[0].created_by
    eq(by, 'uidAdmin', 'кто создал')
  })

  await t('переход: 302 в бота с меткой, клик записан; робот превью — без клика; чужая метка — в бота без метки', async () => {
    const UA = 'Mozilla/5.0 (Linux; Android 14) Telegram-Android/11.2'
    const r = await call('/go/' + A, { method: 'GET', ua: UA, ip: '1.1.1.1' })
    eq(r.status, 302, 'код'); eq(r.location, 'https://t.me/RepChessEducation_bot?start=src_' + A, 'куда')
    await call('/go/' + A.toUpperCase(), { method: 'GET', ua: UA, ip: '1.1.1.1' })          // тот же человек, метка заглавными
    await call('/go/' + A, { method: 'GET', ua: 'Mozilla/5.0 (iPhone)', ip: '2.2.2.2' })
    await call('/go/' + A, { method: 'GET', ua: 'TelegramBot (like TwitterBot)', ip: '3.3.3.3' })
    const u = await call('/go/nope_111111', { method: 'GET', ua: UA })
    eq(u.location, 'https://t.me/RepChessEducation_bot', 'чужая метка')
    const bad = await call('/go/%E0%A4%A', { method: 'GET', ua: UA })
    eq(bad.status, 302, 'битая метка'); eq(bad.location, 'https://t.me/RepChessEducation_bot', 'битая — в бота')
    const ev = (await client.query(`SELECT detail, visitor, src FROM ${S}.events WHERE event = 'link_click' ORDER BY id`)).rows
    eq(ev.length, 3, 'кликов записано'); eq(ev[0].src, 'web', 'src')
    eq(ev[0].visitor === ev[1].visitor && ev[0].visitor !== ev[2].visitor && ev[0].visitor.length === 16, true, 'отпечаток')
    eq(ev[0].visitor.includes('1.1.1.1'), false, 'IP не хранится')
  })

  // Люди: 100 — новичок по A, платит после; 200 — старый клиент, запускал по A дважды;
  // 300 — сначала по B, потом по A (первое касание — B). Время — относительно «сейчас».
  const now = Date.now(), H = 3600000, iso = ms => new Date(ms).toISOString()
  const ev = (ms, tg, email, event, detail) => client.query(
    `INSERT INTO ${S}.events (ts, src, tg_id, email, event, detail) VALUES ($1, 'bot', $2, $3, $4, $5)`, [iso(ms), tg, email, event, detail])
  await ev(now - 10 * H, '100', '', 'start', 'src_' + A)
  await ev(now - 9 * H, '100', 'a@x.ru', 'open', '')
  await ev(now - 50 * H, '200', 'b@x.ru', 'open', '')            // был до ссылки
  await ev(now - 8 * H, '200', 'b@x.ru', 'start', 'src_' + A)
  await ev(now - 7 * H, '200', 'b@x.ru', 'start', 'src_' + A)
  await ev(now - 20 * H, '300', '', 'start', 'src_' + B)
  await ev(now - 6 * H, '300', 'c@x.ru', 'start', 'src_' + A)
  await ev(now - 5 * H, '400', '', 'start', 'ref_123')            // реферал — не ссылка-источник
  // Оплаты (лист Table 2): колонки как у Тильды, дата — {d}
  const COLS = ['Name', 'Email', 'Phone', 'sent', 'paymentid', 'products', 'price']
  await client.query(`INSERT INTO ${S}.payments_meta (id, columns, header, rows, digest, read_at, synced_at, checked_at, source)
                      VALUES (1, $1, '', 0, 'x', now(), now(), now(), 'test')`, [JSON.stringify(COLS)])
  let rn = 2
  const pay = (email, ms, pid, price) => client.query(`INSERT INTO ${S}.payments (row_num, cells, line, email, phone10) VALUES ($1, $2, '', $3, '')`,
    [rn++, JSON.stringify(['И', email, '', { d: iso(ms) }, pid, 'Групп. онлайн, 4 занятия', price]), email])
  await pay('a@x.ru', now - 8 * H, 'tinkoff:555', 4000)        // после ссылки — в A
  await pay('a@x.ru', now - 30 * H, 'tinkoff:554', 9999)       // до ссылки — нет
  await pay('a@x.ru', now - 4 * H, 'tinkoff:0', 0)             // промо — нет
  await pay('b@x.ru', now - 6 * H, 'sber:77', '1 500,00')      // сумма строкой — в A
  await pay('b@x.ru', now - 5 * H, 'manual:override', 0)       // ручная правка — нет
  await pay('c@x.ru', now - 5 * H, 'pay:9', 2000)              // 300 — первое касание B

  await t('статистика: клики, запуски, новички, оплаты по первой ссылке', async () => {
    const r = await call('/v1/links/list', { body: {}, who: 'admin' })
    eq(r.status, 200, 'код')
    const by = Object.fromEntries(r.json.links.map(l => [l.slug, l]))
    eq(by[A].stats, { clicks: 3, clicksUniq: 2, starts: 4, startsPeople: 3, newcomers: 1, payers: 2, payments: 2, sum: 5500 }, 'A')
    eq(by[B].stats, { clicks: 0, clicksUniq: 0, starts: 1, startsPeople: 1, newcomers: 1, payers: 1, payments: 1, sum: 2000 }, 'B')
    eq(by[A + '_2'].stats.starts, 0, 'пустая ссылка')
    eq(by[A].bot, 'https://t.me/RepChessEducation_bot?start=src_' + A, 'ссылка в бота')
    eq(r.json.links[0].slug, B, 'новые сверху')
  })

  await t('архив: флаг, переход по архивной работает, чужая метка — 404', async () => {
    eq((await call('/v1/links/archive', { body: { slug: A + '_2' }, who: 'admin' })).status, 200, 'в архив')
    const l = (await call('/v1/links/list', { body: {}, who: 'admin' })).json.links.find(x => x.slug === A + '_2')
    eq(l.archived, true, 'флаг')
    eq((await call('/go/' + A + '_2', { method: 'GET', ua: 'Mozilla' })).location, 'https://t.me/RepChessEducation_bot?start=src_' + A + '_2', 'архивная ведёт в бота')
    eq((await call('/v1/links/archive', { body: { slug: A + '_2', archived: false }, who: 'admin' })).status, 200, 'вернуть')
    eq((await call('/v1/links/archive', { body: { slug: 'no_such' }, who: 'admin' })).status, 404, 'нет такой')
    eq((await call('/v1/links/archive', { body: { slug: 'Плохая' }, who: 'admin' })).status, 400, 'плохая метка')
  })

  await t('сводка «Пульса» без кликов по ссылкам', async () => {
    const d = (await call('/v1/events/daily', { body: { days: 3 }, who: 'admin' })).json
    eq('link_click' in d.keys, false, 'link_click нет'); eq('start' in d.keys, true, 'start есть')
  })

  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
  console.log(`\nИтог: ${passed} прошло, ${failed.length} не прошло`)
  if (failed.length) process.exitCode = 1
}

main().catch(async e => { console.error('ОШИБКА ЗАПУСКА: ' + (e.stack || e.message)); process.exitCode = 1; try { await client.end() } catch {} })
