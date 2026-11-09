// Автотесты API на настоящей базе, в отдельной схеме apitest (пересоздаётся с нуля).
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/run.mjs
// Адрес и логин — из переменных окружения, пароль pg берёт из ~/.pgpass. Данные — выдуманные; staging и рабочие таблицы не трогаются.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { handle } from '../src/handler.js'
import { _resetJwksCache } from '../src/auth.js'

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const SCHEMA = 'apitest'
const PROJECT = 'repchess-trainer'
const SERVICE_KEY = 'test-service-key-0123456789'
const ORIGIN = 'https://repchess.ayvaz-270904.workers.dev'
const env = { FIREBASE_PROJECT_ID: PROJECT, SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN, AUTH_PROVIDERS: 'firebase,service' }

for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const client = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-apitest' })

// ── Ключи и токены «как у Firebase» ──
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
async function makeKey(kid) {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid, alg: 'RS256', use: 'sig' }
  return { kid, priv: kp.privateKey, jwk }
}
async function token(key, claims) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, ...claims }
  const head = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT' }) + '.' + enc(payload)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, new TextEncoder().encode(head))
  return head + '.' + Buffer.from(sig).toString('base64url')
}

let goodKey, evilKey
const fetchImpl = async () => new Response(JSON.stringify({ keys: [goodKey.jwk] }), { headers: { 'cache-control': 'max-age=3600' } })
const deps = { withClient: fn => fn(client), fetchImpl, log: () => {} }

const tok = {}
async function call(path, body, who) {
  const headers = { 'content-type': 'application/json', origin: ORIGIN }
  if (who === 'service') headers['x-service-key'] = SERVICE_KEY
  else if (who === 'badservice') headers['x-service-key'] = 'wrong'
  else if (who) headers.authorization = 'Bearer ' + tok[who]
  const req = new Request('https://api.test' + path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) })
  const res = await handle(req, env, deps)
  return { status: res.status, body: await res.json(), cors: res.headers.get('access-control-allow-origin') }
}

// ── Проверки ──
let passed = 0
const failed = []
async function t(name, fn) {
  try { await fn(); passed++; console.log('OK   ' + name) }
  catch (e) { failed.push(name); console.log('FAIL ' + name + ' — ' + e.message) }
}
function eq(a, b, what = '') {
  const A = JSON.stringify(a), B = JSON.stringify(b)
  if (A !== B) throw new Error(`${what} ожидалось ${B}, получено ${A}`)
}
const ids = r => (r.body.docs || []).map(d => d.id)
const q = (coll, opts = {}) => ({ coll, ...opts })
const lessonDoc = async id => (await client.query(`SELECT doc FROM ${SCHEMA}.lessons WHERE id=$1`, [id])).rows[0]?.doc

async function seed() {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  await client.query(fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'))
  const ins = (t, id, doc) => client.query(`INSERT INTO ${t} (id, doc) VALUES ($1, $2)`, [id, doc])
  await ins('trainers', 'uidAdmin', { name: 'Админ', role: 'admin', email: 'admin@x.ru' })
  await ins('trainers', 'uidT1', { name: 'Тренер 1', role: 'trainer', email: 't1@x.ru', assignedStudents: ['s1@x.ru'] })
  await ins('trainers', 'uidT2', { name: 'Тренер 2', role: 'trainer', email: 't2@x.ru', assignedStudents: [] })
  const L = (trainerId, _date, status, extra = {}) => ({ trainerId, studentEmail: 's1@x.ru', studentName: 'Ученик', _date, status, type: 'individual', format: 'online', notes: '', ...extra })
  await ins('lessons', 'L1', L('uidT1', '2026-11-01', 'done'))
  await ins('lessons', 'L2', L('uidT1', '2026-11-20', 'pending'))
  await ins('lessons', 'L3', L('uidT2', '2026-11-05', 'done', { studentEmail: 's2@x.ru' }))
  await ins('lessons', 'L4', L('uidT1', '2026-10-15', 'done'))
  await ins('group_lessons', 'G1', { trainerId: 'uidT1', _date: '2026-11-12', isPublic: true, attendanceMarked: false, studentEmails: ['s1@x.ru'], notes: '' })
  await ins('group_lessons', 'G2', { trainerId: 'uidT2', _date: '2026-11-13', isPublic: true, attendanceMarked: false, studentEmails: [], notes: '' })
  await ins('trainer_schedules', 'uidT1', { template: { 1: ['16:00'] } })
  await ins('trainer_schedules', 'uidT2', { template: { 2: ['18:00'] } })
  await ins('trainer_rates', 'uidT1', { rateIndivOn: 1000 })
  await ins('cert_codes', 'REP-AAAA-11', { lessons: 4, kind: 'indiv', format: 'online', usedBy: '', archived: true, archivedReason: 'тест', archivedAt: '2026-11-01T00:00:00.000Z' })
  await ins('settings', 'removedTrainers', { x: { name: 'X' } })
  await ins('settings', 'financePin', { hash: 'h' })
  await ins('lesson_feedback', 'F1', { status: 'asked', trainerId: 'uidT1', studentEmail: 's1@x.ru', _date: '2026-11-01' })
  await ins('price_overrides', 'P1', { price: 100 })
  await client.query(`INSERT INTO schema_meta (key, value) VALUES ('schema_version','1') ON CONFLICT (key) DO NOTHING`)
}

async function main() {
  await client.connect()
  await seed()
  goodKey = await makeKey('k1'); evilKey = await makeKey('k1')   // тот же kid, другой ключ — подделка
  _resetJwksCache()
  tok.admin = await token(goodKey, { sub: 'uidAdmin' })
  tok.t1 = await token(goodKey, { sub: 'uidT1' })
  tok.t2 = await token(goodKey, { sub: 'uidT2' })
  tok.stranger = await token(goodKey, { sub: 'uidStranger' })
  tok.expired = await token(goodKey, { sub: 'uidT1', iat: 1, exp: 2 })
  tok.wrongAud = await token(goodKey, { sub: 'uidT1', aud: 'other-project' })
  tok.forged = await token(evilKey, { sub: 'uidAdmin' })

  // Вход
  await t('без входа — 401', async () => eq((await call('/v1/query', q('lessons'))).status, 401))
  await t('просроченный токен — 401', async () => eq((await call('/v1/query', q('lessons'), 'expired')).status, 401))
  await t('токен другого проекта — 401', async () => eq((await call('/v1/query', q('lessons'), 'wrongAud')).status, 401))
  await t('поддельная подпись (выдаёт себя за админа) — 401', async () => eq((await call('/v1/query', q('lessons'), 'forged')).status, 401))
  await t('неверный служебный ключ — 401', async () => eq((await call('/v1/query', q('lessons'), 'badservice')).status, 401))
  await t('вошёл, но не тренер — 403', async () => eq((await call('/v1/query', q('priceOverrides'), 'stranger')).status, 403))
  await t('health без входа отвечает, версия схемы 1', async () => eq((await call('/v1/health')).body, { ok: true, schema: '1' }))
  await t('CORS: свой сайт получает разрешение', async () => eq((await call('/v1/health')).cors, ORIGIN))

  // Чтение — тренер
  await t('тренер: свои занятия по фильтру trainerId', async () => {
    const r = await call('/v1/query', q('lessons', { where: [['trainerId', '==', 'uidT1']], orderBy: [['_date', 'desc']] }), 't1')
    eq(ids(r), ['L2', 'L1', 'L4'])
  })
  await t('тренер: занятия без фильтра — отказ', async () => eq((await call('/v1/query', q('lessons'), 't1')).status, 403))
  await t('тренер: занятия чужого тренера — отказ', async () => eq((await call('/v1/query', q('lessons', { where: [['trainerId', '==', 'uidT2']] }), 't1')).status, 403))
  await t('тренер: чужое занятие по id — отказ, своё — да', async () => {
    eq((await call('/v1/get', { coll: 'lessons', id: 'L3' }, 't1')).status, 403)
    eq((await call('/v1/get', { coll: 'lessons', id: 'L1' }, 't1')).body.doc.id, 'L1')
  })
  await t('тренер: свой документ тренера — да, чужой — нет, список — нет', async () => {
    eq((await call('/v1/get', { coll: 'trainers', id: 'uidT1' }, 't1')).status, 200)
    eq((await call('/v1/get', { coll: 'trainers', id: 'uidT2' }, 't1')).status, 403)
    eq((await call('/v1/query', q('trainers'), 't1')).status, 403)
  })
  await t('тренер: настройки, промокоды, отзывы — отказ', async () => {
    eq((await call('/v1/get', { coll: 'settings', id: 'financePin' }, 't1')).status, 403)
    eq((await call('/v1/query', q('certCodes'), 't1')).status, 403)
    eq((await call('/v1/query', q('lessonFeedback'), 't1')).status, 403)
  })
  await t('тренер: чужое расписание — отказ, своё — да', async () => {
    eq((await call('/v1/get', { coll: 'trainerSchedules', id: 'uidT2' }, 't1')).status, 403)
    eq((await call('/v1/get', { coll: 'trainerSchedules', id: 'uidT1' }, 't1')).status, 200)
  })
  await t('тренер: ручные цены читать можно', async () => eq(ids(await call('/v1/query', q('priceOverrides'), 't1')), ['P1']))

  // Чтение — админ, операторы запроса
  await t('админ: все тренеры', async () => eq(ids(await call('/v1/query', q('trainers'), 'admin')).length, 3))
  await t('админ: диапазон дат >= и <=', async () => {
    eq(ids(await call('/v1/query', q('lessons', { where: [['_date', '>=', '2026-11-01'], ['_date', '<=', '2026-11-10']] }), 'admin')), ['L1', 'L3'])
  })
  await t('админ: оператор in', async () => eq(ids(await call('/v1/query', q('lessons', { where: [['status', 'in', ['pending']]] }), 'admin')), ['L2']))
  await t('админ: сортировка по дате по убыванию + лимит', async () => eq(ids(await call('/v1/query', q('lessons', { orderBy: [['_date', 'desc']], limit: 2 }), 'admin')), ['L2', 'L3']))
  await t('админ: == по логическому полю', async () => eq(ids(await call('/v1/query', q('groupLessons', { where: [['attendanceMarked', '==', false]] }), 'admin')), ['G1', 'G2']))
  await t('админ: настройки и отзывы читаются', async () => {
    eq((await call('/v1/get', { coll: 'settings', id: 'financePin' }, 'admin')).body.doc.data, { hash: 'h' })
    eq(ids(await call('/v1/query', q('lessonFeedback'), 'admin')), ['F1'])
  })
  await t('неверное поле в запросе — 400', async () => eq((await call('/v1/query', q('lessons', { where: [["x'; drop", '==', 1]] }), 'admin')).status, 400))

  // Запись — тренер
  const W = (...writes) => ({ writes })
  await t('тренер: правит заметку своего занятия', async () => {
    eq((await call('/v1/commit', W({ op: 'update', coll: 'lessons', id: 'L1', data: { notes: 'ок' } }), 't1')).status, 200)
    eq((await lessonDoc('L1')).notes, 'ок')
  })
  await t('тренер: смена ученика в занятии — отказ', async () => eq((await call('/v1/commit', W({ op: 'update', coll: 'lessons', id: 'L1', data: { studentEmail: 'evil@x.ru' } }), 't1')).status, 403))
  await t('тренер: передача занятия другому тренеру — отказ', async () => eq((await call('/v1/commit', W({ op: 'update', coll: 'lessons', id: 'L1', data: { trainerId: 'uidT2' } }), 't1')).status, 403))
  await t('тренер: удалить проведённое — отказ, запланированное — можно', async () => {
    eq((await call('/v1/commit', W({ op: 'delete', coll: 'lessons', id: 'L1' }), 't1')).status, 403)
    eq((await call('/v1/commit', W({ op: 'delete', coll: 'lessons', id: 'L2' }), 't1')).status, 200)
    eq(await lessonDoc('L2'), undefined)
  })
  await t('тренер: создать занятие на чужого тренера — отказ, на себя — да', async () => {
    eq((await call('/v1/commit', W({ op: 'set', coll: 'lessons', data: { trainerId: 'uidT2', _date: '2026-11-30', status: 'pending' } }), 't1')).status, 403)
    const r = await call('/v1/commit', W({ op: 'set', coll: 'lessons', data: { trainerId: 'uidT1', studentEmail: 's1@x.ru', _date: '2026-11-30', status: 'pending', createdAt: { __op: 'serverTimestamp' } } }), 't1')
    eq(r.status, 200); eq(r.body.results[0].id.length, 20, 'длина id')
    const d = await lessonDoc(r.body.results[0].id)
    if (!/^\d{4}-\d\d-\d\dT/.test(d.createdAt)) throw new Error('createdAt не время: ' + d.createdAt)
  })
  await t('тренер: группы — создать нельзя, свою править можно, чужую нельзя', async () => {
    eq((await call('/v1/commit', W({ op: 'set', coll: 'groupLessons', data: { trainerId: 'uidT1', _date: '2026-12-01' } }), 't1')).status, 403)
    eq((await call('/v1/commit', W({ op: 'update', coll: 'groupLessons', id: 'G1', data: { notes: 'план' } }), 't1')).status, 200)
    eq((await call('/v1/commit', W({ op: 'update', coll: 'groupLessons', id: 'G2', data: { notes: 'план' } }), 't1')).status, 403)
  })
  await t('тренер: ручные цены писать нельзя, админ — можно', async () => {
    eq((await call('/v1/commit', W({ op: 'set', coll: 'priceOverrides', id: 'P1', data: { price: 1 } }), 't1')).status, 403)
    eq((await call('/v1/commit', W({ op: 'set', coll: 'priceOverrides', id: 'P1', data: { price: 200 } }), 'admin')).status, 200)
  })
  await t('тренер: своё расписание пишет, чужое — нет', async () => {
    eq((await call('/v1/commit', W({ op: 'set', coll: 'trainerSchedules', id: 'uidT1', data: { template: {} }, merge: true }), 't1')).status, 200)
    eq((await call('/v1/commit', W({ op: 'set', coll: 'trainerSchedules', id: 'uidT2', data: { template: {} } }), 't1')).status, 403)
  })

  // Пакеты: всё или ничего
  await t('пакет с ошибкой (нет документа) — не применяется ничего', async () => {
    const r = await call('/v1/commit', W({ op: 'update', coll: 'lessons', id: 'L4', data: { notes: 'из пакета' } }, { op: 'update', coll: 'lessons', id: 'NOPE', data: { notes: 'x' } }), 'admin')
    eq(r.status, 404); eq((await lessonDoc('L4')).notes, '', 'L4 после отката')
  })
  await t('пакет тренера с одной запрещённой записью — не применяется ничего', async () => {
    const r = await call('/v1/commit', W({ op: 'update', coll: 'lessons', id: 'L4', data: { notes: 'моё' } }, { op: 'update', coll: 'lessons', id: 'L3', data: { notes: 'чужое' } }), 't1')
    eq(r.status, 403); eq((await lessonDoc('L4')).notes, '', 'L4 после отката')
  })
  await t('create поверх существующего — 409', async () => eq((await call('/v1/commit', W({ op: 'create', coll: 'lessons', id: 'L1', data: { trainerId: 'uidT1' } }), 'admin')).status, 409))

  // Служебные значения
  const doc = async (coll, id) => (await call('/v1/get', { coll, id }, 'admin')).body.doc.data
  await t('arrayUnion без дублей и arrayRemove', async () => {
    await call('/v1/commit', W({ op: 'update', coll: 'trainers', id: 'uidT1', data: { assignedStudents: { __op: 'arrayUnion', values: ['s2@x.ru', 's1@x.ru'] } } }), 'admin')
    eq((await doc('trainers', 'uidT1')).assignedStudents, ['s1@x.ru', 's2@x.ru'])
    await call('/v1/commit', W({ op: 'update', coll: 'trainers', id: 'uidT1', data: { assignedStudents: { __op: 'arrayRemove', values: ['s1@x.ru'] } } }), 'admin')
    eq((await doc('trainers', 'uidT1')).assignedStudents, ['s2@x.ru'])
  })
  await t('set merge сливает вложенные, delete убирает ключ', async () => {
    await call('/v1/commit', W({ op: 'set', coll: 'settings', id: 'removedTrainers', data: { y: { name: 'Y' } }, merge: true }), 'admin')
    eq(await doc('settings', 'removedTrainers'), { x: { name: 'X' }, y: { name: 'Y' } })
    await call('/v1/commit', W({ op: 'update', coll: 'settings', id: 'removedTrainers', data: { x: { __op: 'delete' } } }), 'admin')
    eq(await doc('settings', 'removedTrainers'), { y: { name: 'Y' } })
  })
  await t('update с delete полей промокода (возврат из архива)', async () => {
    await call('/v1/commit', W({ op: 'update', coll: 'certCodes', id: 'REP-AAAA-11', data: { archived: false, archivedReason: { __op: 'delete' }, archivedAt: { __op: 'delete' } } }), 'admin')
    const d = await doc('certCodes', 'REP-AAAA-11')
    eq([d.archived, 'archivedReason' in d, 'archivedAt' in d], [false, false, false])
  })
  await t('путь с точкой в update меняет вложенное поле (день недели, дата)', async () => {
    eq((await call('/v1/commit', W({ op: 'update', coll: 'trainerSchedules', id: 'uidT2', data: { 'template.3': ['10:00'], 'exceptions.2026-07-19': { off: true } } }), 'admin')).status, 200)
    const d = await doc('trainerSchedules', 'uidT2')
    eq([d.template, d.exceptions], [{ 2: ['18:00'], 3: ['10:00'] }, { '2026-07-19': { off: true } }])
  })
  await t('ключ __proto__ в записи — 400', async () => {
    eq((await call('/v1/commit', { writes: [{ op: 'set', coll: 'priceOverrides', id: 'P2', data: JSON.parse('{"__proto__": {"x": 1}}') }] }, 'admin')).status, 400)
  })

  // Отзывы пишет только бот
  await t('отзыв: админ писать не может, служебный ключ — может', async () => {
    eq((await call('/v1/commit', W({ op: 'update', coll: 'lessonFeedback', id: 'F1', data: { rating: 5 } }), 'admin')).status, 403)
    eq((await call('/v1/commit', W({ op: 'update', coll: 'lessonFeedback', id: 'F1', data: { rating: 5, status: 'rated' } }), 'service')).status, 200)
  })
  await t('служебный ключ читает всё', async () => eq(ids(await call('/v1/query', q('certCodes'), 'service')), ['REP-AAAA-11']))

  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
  console.log(`\nИтог: ${passed} прошло, ${failed.length} не прошло`)
  if (failed.length) process.exitCode = 1
}

main().catch(async e => { console.error('ОШИБКА ЗАПУСКА: ' + (e.stack || e.message)); process.exitCode = 1; try { await client.end() } catch {} })
