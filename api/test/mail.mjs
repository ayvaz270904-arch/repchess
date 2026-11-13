// Тесты рассылок (api/src/mail.js): права, снимок аудитории, условия, очередь, правила, отчёт.
// Схема mltest пересоздаётся с нуля; данные — выдуманные.
//
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/mail.mjs

import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { handle } from '../src/handler.js'
import { setSchema } from '../src/store.js'
import { _resetJwksCache } from '../src/auth.js'

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const SCHEMA = 'mltest'
const PROJECT = 'repchess-trainer'
const SERVICE_KEY = 'test-service-key-ev-0123456789'
const ORIGIN = 'https://repchess.ayvaz-270904.workers.dev'
const env = { FIREBASE_PROJECT_ID: PROJECT, SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN, AUTH_PROVIDERS: 'firebase,service' }

for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const client = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-mltest' })

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
  const S = SCHEMA
  const day = n => new Date(Date.now() + 3 * 3600000 + n * 86400000).toISOString().slice(0, 10)   // МСК + n дней
  const mskHour = new Date(Date.now() + 3 * 3600000).getUTCHours()
  const inWindow = mskHour >= 9 && mskHour < 21
  const P = (tg, name, o) => Object.assign({ tg, name, email: name.toLowerCase() + '@x.ru', purchase: false, paid: false, done: 0, remaining: 0, expiry: null, off: false }, o)
  const PEOPLE = [
    P('101', 'Анна', { purchase: true, paid: true, done: 5, remaining: 1, expiry: day(20) }),
    P('102', 'Борис', { purchase: true, paid: false, done: 1, remaining: 0 }),
    P('103', 'Вика', { purchase: true, paid: true, done: 2, remaining: 3, expiry: day(5) }),
    P('104', 'Гость', { email: '' }),
    P('105', 'Дина', { purchase: true, paid: true, done: 4, remaining: 1, expiry: day(3), off: true }),
  ]
  const sync = (people, extra = {}) => call('/v1/mail/audience-sync', { who: 'service', body: Object.assign({ people, offOnly: ['202'] }, extra) })
  const aud = filters => call('/v1/mail/audience', { who: 'admin', body: { filters } }).then(r => r.json)
  const claim = () => call('/v1/mail/claim', { who: 'service', body: { limit: 100 } }).then(r => r.json)
  const report = results => call('/v1/mail/report', { who: 'service', body: { results } }).then(r => r.json)
  const mailing = async id => (await call('/v1/mail/list', { who: 'admin', body: {} })).json.mailings.find(m => m.id === id)
  // запускавшие бота без номера — из событий; группа — не человек
  await client.query(`INSERT INTO ${S}.events (ts, src, tg_id, email, event, detail) VALUES
    (now(), 'bot', '201', '', 'start_new', ''), (now(), 'bot', '202', '', 'start', ''), (now(), 'bot', '-100500', '', 'start', ''),
    (now(), 'bot', '101', 'анна@x.ru', 'start', '')`)

  await t('права: админ — выборки, бот — снимок/очередь/отчёт, тренер — ничего', async () => {
    eq((await call('/v1/mail/audience', { body: {}, who: 't1' })).status, 403, 'тренер')
    eq((await call('/v1/mail/claim', { body: {}, who: 'admin' })).status, 403, 'админ claim')
    eq((await call('/v1/mail/audience-sync', { body: { people: [] }, who: 'admin' })).status, 403, 'админ sync')
    eq((await call('/v1/mail/report', { body: {}, who: 'admin' })).status, 403, 'админ report')
    eq((await call('/v1/mail/list', { body: {} })).status, 401, 'без входа')
    eq((await call('/v1/mail/nope', { body: {}, who: 'admin' })).status, 404, 'чужой адрес')
  })

  await t('снимок аудитории: люди + запускавшие из событий, группы нет; отписка без привязки', async () => {
    const r = await sync(PEOPLE)
    eq(r.status, 200, 'код'); eq(r.json.people, 5, 'людей')
    const a = await aud({})
    eq([a.total, a.count, a.off, a.blocked, a.willGet], [7, 7, 2, 0, 5], 'все: 5 + 201 + 202; отписаны 105 и 202')
    eq(!!a.audienceAt, true, 'время снимка')
  })

  await t('защита: людей стало вдвое меньше — отказ, с force — можно', async () => {
    await client.query(`INSERT INTO ${S}.audience (tg_id, linked) SELECT 'x' || g, true FROM generate_series(1, 10) g`)
    eq((await sync(PEOPLE)).status, 400, 'без force')
    eq((await sync(PEOPLE, { force: true })).status, 200, 'с force')
    eq((await client.query(`SELECT count(*)::int n FROM ${S}.audience WHERE linked`)).rows[0].n, 5, 'лишние отвязаны')
    await client.query(`DELETE FROM ${S}.audience WHERE tg_id LIKE 'x%'`)   // пробные строки — дальше не нужны
  })

  await t('условия по отдельности', async () => {
    const n = async f => (await aud(f)).count
    eq(await n({ phone: 'linked' }), 5, 'поделились')
    eq(await n({ phone: 'start' }), 2, 'только /start')
    eq(await n({ purchase: 'yes' }), 4, 'покупка есть'); eq(await n({ purchase: 'no' }), 3, 'покупки нет')
    eq(await n({ paid: 'yes' }), 3, 'оплата есть'); eq(await n({ paid: 'no' }), 4, 'оплаты нет')
    eq(await n({ lessons: 'yes' }), 4, 'занятия есть'); eq(await n({ lessons: 'no' }), 3, 'занятий нет')
    eq(await n({ remaining: 'one' }), 2, 'остался 1'); eq(await n({ remaining: 'zero' }), 1, 'кончились (гость без покупки не входит)')
    eq(await n({ expiryDays: 7 }), 2, 'сгорает за 7 дней (103 и 105, не 101)')
    eq(await n({ expiryDays: 4 }), 1, 'за 4 дня — только 105')
    eq(await n({ paid: 'yes', remaining: 'one' }), 2, 'сочетание')
    eq(await n({ phone: 'bogus', expiryDays: 999 }), 3, 'мусор → «неважно», дней не больше 90 (101, 103, 105)')
  })

  await t('список: имена, хвост tg, остаток только при покупке', async () => {
    const l = (await call('/v1/mail/audience', { who: 'admin', body: { filters: {}, list: true } })).json.list
    eq(l.length, 7, 'все'); eq(l[0].name, 'Анна', 'по имени, безымянные в конце')
    eq(l.find(x => x.name === 'Гость').remaining, null, 'у гостя остатка нет')
    eq(l.find(x => x.tg === '0201' || x.tg === '201') ? true : false, true, 'хвост tg')
    eq(l.some(x => x.tg.length > 4), false, 'не больше 4 цифр')
  })

  await t('сохранение: проверки', async () => {
    const save = b => call('/v1/mail/save', { who: 'admin', body: b })
    eq((await save({ when: 'draft', body: '  ' })).status, 400, 'пустой текст')
    eq((await save({ when: 'draft', body: 'x'.repeat(4001) })).status, 400, 'длинный')
    eq((await save({ when: 'draft', body: 'x', button: { type: 'url', text: 'Сайт', url: 'javascript:alert(1)' } })).status, 400, 'плохая ссылка')
    eq((await save({ when: 'at', body: 'x', sendAt: new Date(Date.now() - 3600000).toISOString() })).status, 400, 'прошлое')
    eq((await save({ when: 'rule', body: 'x', ruleTime: '25:00' })).status, 400, 'время правила')
    eq((await save({ when: 'oops', body: 'x' })).status, 400, 'when')
    const d = (await save({ when: 'draft', body: 'Первая строка\nвторая', filters: { paid: 'yes' } })).json.mailing
    eq([d.status, d.kind, d.title, d.filters.paid], ['draft', 'once', 'Первая строка', 'yes'], 'черновик, название из первой строки')
  })

  let once
  await t('разовая: устаревший снимок → needSync; после снимка — порция, отписанные пропущены', async () => {
    once = (await call('/v1/mail/save', { who: 'admin', body: { when: 'now', title: 'Остался 1', body: 'Привет, {имя}!',
      filters: { remaining: 'one' }, button: { type: 'cabinet' } } })).json.mailing
    eq(once.status, 'scheduled', 'запланирована')
    await client.query(`UPDATE ${S}.mail_meta SET audience_at = now() - interval '1 hour'`)
    const c1 = await claim()
    if (!inWindow) { eq(c1.sends.length, 0, 'вне окна — ничего'); return }
    eq([c1.needSync, c1.sends.length], [true, 0], 'сначала пересчитать')
    await sync(PEOPLE, { force: true })
    const c2 = await claim()
    eq(c2.sends.map(s => s.tg), ['101'], 'только Анна (Дина отписана)')
    eq(c2.sends[0].name, 'Анна', 'имя'); eq(c2.mailings[once.id].body, 'Привет, {имя}!', 'текст')
    eq(c2.mailings[once.id].button, { type: 'cabinet' }, 'кнопка')
    const m = await mailing(once.id)
    eq([m.status, m.counts.total, m.counts.skipped], ['sending', 1, 1], 'идёт, 1 получатель, 1 пропущен')
    eq((await call('/v1/mail/save', { who: 'admin', body: { id: once.id, when: 'draft', body: 'x' } })).status, 409, 'идущую не править')
    const r = await report([{ id: c2.sends[0].id, status: 'sent' }])
    eq(r.finished.map(f => [f.id, f.sent]), [[once.id, 1]], 'завершена, отчёт для админа')
    eq((await mailing(once.id)).status, 'done', 'done')
    eq((await claim()).sends.length, 0, 'повторно не шлёт')
  })

  await t('отчёт: заблокировал — в аудиторию; retry — снова в очередь; claimed старше 15 мин — раздаётся снова', async () => {
    if (!inWindow) return
    const m = (await call('/v1/mail/save', { who: 'admin', body: { when: 'now', body: 'Всем', filters: { phone: 'linked' } } })).json.mailing
    const c = await claim()
    const by = Object.fromEntries(c.sends.map(s => [s.tg, s.id]))
    eq(Object.keys(by).sort(), ['101', '102', '103', '104'], 'четверо (Дина отписана)')
    await report([{ id: by['101'], status: 'sent' }, { id: by['102'], status: 'blocked' }, { id: by['103'], status: 'retry' }])
    eq((await client.query(`SELECT blocked FROM ${S}.audience WHERE tg_id = '102'`)).rows[0].blocked, true, 'Борис заблокировал')
    eq((await aud({ phone: 'linked' })).blocked, 1, 'в счётчике')
    await client.query(`UPDATE ${S}.mailing_sends SET at = now() - interval '20 minutes' WHERE id = $1`, [by['104']])
    const c2 = await claim()
    eq(c2.sends.map(s => s.tg).sort(), ['103', '104'], 'retry и зависший — снова')
    await report(c2.sends.map(s => ({ id: s.id, status: 'sent' })))
    const mm = await mailing(m.id)
    eq([mm.status, mm.counts.sent, mm.counts.blocked, mm.counts.total], ['done', 3, 1, 4], 'итог')
    // /start снимает блокировку
    await call('/v1/events/add', { who: 'service', body: { rows: [{ tg: '102', ev: 'start', src: 'bot' }] } })
    eq((await client.query(`SELECT blocked FROM ${S}.audience WHERE tg_id = '102'`)).rows[0].blocked, false, 'разблокирован')
  })

  await t('правило: один раз за попадание; вышел — вошёл снова — ещё раз', async () => {
    if (!inWindow) return
    const r = (await call('/v1/mail/save', { who: 'admin', body: { when: 'rule', ruleTime: '00:00', body: 'Остался 1', filters: { remaining: 'one' } } })).json.mailing
    eq([r.kind, r.status], ['rule', 'on'], 'включено')
    const c1 = await claim()
    eq(c1.sends.filter(s => s.m === r.id).map(s => s.tg), ['101'], 'первый раз — Анна')
    await report(c1.sends.map(s => ({ id: s.id, status: 'sent' })))
    eq((await mailing(r.id)).insideNow, 2, 'в условии двое (Дина отписана, но внутри)')
    eq((await claim()).sends.length, 0, 'в тот же день — ничего')
    const nextDay = () => client.query(`UPDATE ${S}.mailings SET rule_last = (now() AT TIME ZONE 'Europe/Moscow')::date - 1 WHERE id = $1`, [r.id])
    await nextDay()
    eq((await claim()).sends.length, 0, 'назавтра, всё ещё внутри — не повторяем')
    const P2 = PEOPLE.map(p => (p.tg === '101' ? Object.assign({}, p, { remaining: 3 }) : p))
    await sync(P2, { force: true }); await nextDay(); await claim()
    eq((await client.query(`SELECT inside FROM ${S}.mailing_rule_state WHERE mailing_id = $1 AND tg_id = '101'`, [r.id])).rows[0].inside, false, 'вышла')
    await sync(PEOPLE, { force: true }); await nextDay()
    const c4 = await claim()
    eq(c4.sends.filter(s => s.m === r.id).map(s => s.tg), ['101'], 'вошла снова — ещё раз')
    await report(c4.sends.map(s => ({ id: s.id, status: 'sent' })))
    eq((await mailing(r.id)).counts.sent, 2, 'всего 2')
    // выключили — очередь не раздаётся; сменили условия — состояние сброшено
    await call('/v1/mail/rule', { who: 'admin', body: { id: r.id, on: false } })
    eq((await mailing(r.id)).status, 'off', 'выключено')
    await call('/v1/mail/save', { who: 'admin', body: { id: r.id, when: 'rule', ruleTime: '00:00', body: 'Остался 1', filters: { remaining: 'one', paid: 'yes' }, ruleOff: true } })
    eq((await client.query(`SELECT count(*)::int n FROM ${S}.mailing_rule_state WHERE mailing_id = $1`, [r.id])).rows[0].n, 0, 'сброшено')
  })

  await t('отмена, тест себе, пустая выборка', async () => {
    const at = (await call('/v1/mail/save', { who: 'admin', body: { when: 'at', body: 'Позже', sendAt: new Date(Date.now() + 86400000).toISOString() } })).json.mailing
    eq((await call('/v1/mail/cancel', { who: 'admin', body: { id: at.id } })).status, 200, 'отмена')
    eq((await mailing(at.id)).status, 'cancelled', 'отменена')
    eq((await call('/v1/mail/cancel', { who: 'admin', body: { id: at.id } })).status, 400, 'дважды нельзя')
    eq((await call('/v1/mail/test', { who: 'admin', body: { id: at.id } })).status, 200, 'тест')
    const c = await claim()
    eq(c.tests.map(x => x.id), [at.id], 'тест в очереди (в любое время)')
    eq((await claim()).tests.length, 0, 'тест — один раз')
    if (!inWindow) return
    const e = (await call('/v1/mail/save', { who: 'admin', body: { when: 'now', body: 'Никому', filters: { phone: 'start', paid: 'yes' } } })).json.mailing
    const c2 = await claim()
    eq(c2.finished.map(f => f.id), [e.id], 'пустая — сразу завершена')
    eq((await mailing(e.id)).status, 'done', 'done')
  })

  await t('архив: завершённую можно, запланированную и включённое правило — нет, вернуть можно', async () => {
    const at = (await call('/v1/mail/save', { who: 'admin', body: { when: 'at', body: 'X', sendAt: new Date(Date.now() + 86400000).toISOString() } })).json.mailing
    eq((await call('/v1/mail/archive', { who: 'admin', body: { id: at.id } })).status, 400, 'запланированную нельзя')
    await call('/v1/mail/cancel', { who: 'admin', body: { id: at.id } })
    eq((await call('/v1/mail/archive', { who: 'admin', body: { id: at.id } })).status, 200, 'отменённую можно')
    eq((await mailing(at.id)).archived, true, 'в архиве')
    eq((await call('/v1/mail/archive', { who: 'admin', body: { id: at.id, archived: false } })).status, 200, 'вернуть')
    eq((await mailing(at.id)).archived, false, 'вернулась')
    const r = (await call('/v1/mail/save', { who: 'admin', body: { when: 'rule', ruleTime: '12:00', body: 'R' } })).json.mailing
    eq((await call('/v1/mail/archive', { who: 'admin', body: { id: r.id } })).status, 400, 'включённое правило нельзя')
    eq((await call('/v1/mail/archive', { who: 't1', body: { id: r.id } })).status, 403, 'тренер — нет')
  })

  await t('удаление: только из архива, вместе с очередью и памятью правила; тренер — нет', async () => {
    const a = (await call('/v1/mail/save', { who: 'admin', body: { when: 'draft', body: 'Черновик' } })).json.mailing
    const b = (await call('/v1/mail/save', { who: 'admin', body: { when: 'draft', body: 'Живая' } })).json.mailing
    await call('/v1/mail/archive', { who: 'admin', body: { id: a.id } })
    await client.query(`INSERT INTO ${S}.mailing_sends (mailing_id, tg_id, status) VALUES ($1, '101', 'sent')`, [a.id])
    await client.query(`INSERT INTO ${S}.mailing_rule_state (mailing_id, tg_id) VALUES ($1, '101')`, [a.id])
    eq((await call('/v1/mail/delete', { who: 't1', body: { ids: [a.id] } })).status, 403, 'тренер — нет')
    eq((await call('/v1/mail/delete', { who: 'admin', body: { ids: [] } })).status, 400, 'пусто')
    const r = await call('/v1/mail/delete', { who: 'admin', body: { ids: [a.id, b.id, 'nope'] } })
    eq([r.status, r.json.deleted], [200, [a.id]], 'удалена только архивная')
    eq(await mailing(a.id), undefined, 'нет в списке'); eq(!!(await mailing(b.id)), true, 'живая на месте')
    const left = (await client.query(`SELECT (SELECT count(*) FROM ${S}.mailing_sends WHERE mailing_id = $1)::int s, (SELECT count(*) FROM ${S}.mailing_rule_state WHERE mailing_id = $1)::int r`, [a.id])).rows[0]
    eq([left.s, left.r], [0, 0], 'хвосты удалены')
  })

  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
  console.log(`\nИтог: ${passed} прошло, ${failed.length} не прошло` + (inWindow ? '' : ' (вне окна 9–21 МСК часть проверок отправки пропущена)'))
  if (failed.length) process.exitCode = 1
}

main().catch(async e => { console.error('ОШИБКА ЗАПУСКА: ' + (e.stack || e.message)); process.exitCode = 1; try { await client.end() } catch {} })
