// Проверка НАСТОЯЩЕГО кода бота (gas/bot.gs) против API: поднимает API локально на копии
// данных (схема staging), подставляет боту свойство DATA_BACKEND='api' и сверяет то, что
// возвращают функции бота, с прямыми запросами в базу.
// gas/bot.gs лежит только локально (в git его нет) — без него проверка пропускается.
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> node api/test/bot-check.mjs

import fs from 'node:fs'
import vm from 'node:vm'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const botPath = fileURLToPath(new URL('../../gas/bot.gs', import.meta.url))
if (!fs.existsSync(botPath)) { console.log('gas/bot.gs нет — проверка бота пропущена'); process.exit(0) }

const require = createRequire(import.meta.url)
const { Client } = require(process.env.PG_MODULE || 'pg')
const PORT = 8791, KEY = 'local-' + Math.random().toString(36).slice(2), SCHEMA = 'staging'
const BASE = `http://127.0.0.1:${PORT}`

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))],
  { env: { ...process.env, PORT: String(PORT), SERVICE_KEY: KEY, PGSCHEMA: SCHEMA }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((res, rej) => { server.stdout.on('data', d => String(d).includes('локально') && res()); server.on('exit', c => rej(new Error('сервер не запустился, код ' + c))) })

const pg = new Client({ ssl: { rejectUnauthorized: false }, options: `-c search_path=${SCHEMA}` })
await pg.connect()
const one = async (sql, p) => (await pg.query(sql, p)).rows

// ── Заглушки сервисов Apps Script ──
const props = { DATA_BACKEND: 'api', API_SERVICE_KEY: KEY }
const cache = {}
function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]))
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|H|mm|ss/g, (m, lit) => lit !== undefined ? lit
    : ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, H: String(Number(parts.hour)), mm: parts.minute, ss: parts.second })[m])
}
let calls = 0
const UrlFetchApp = {
  fetch(url, o = {}) {
    calls++
    const args = ['-s', '-X', String(o.method || 'get').toUpperCase(), '-w', '\n%{http_code}', '--max-time', '30']
    const headers = { ...(o.headers || {}) }
    if (o.contentType) headers['content-type'] = o.contentType
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
    if (o.payload !== undefined) args.push('--data-binary', '@-')
    const out = execFileSync('curl', [...args, url], { input: o.payload === undefined ? undefined : String(o.payload), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const i = out.lastIndexOf('\n')
    return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) }
  },
}
const nope = name => new Proxy({}, { get: (_, k) => () => { throw new Error(`${name}.${String(k)} в проверке не используется`) } })
const ctx = vm.createContext({
  console, UrlFetchApp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v) }, deleteProperty: k => { delete props[k] }, getProperties: () => ({ ...props }) }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v }, remove: k => { delete cache[k] } }) },
  ScriptApp: { getOAuthToken: () => 'oauth-token' },
  Utilities: { formatDate, sleep: () => {} },
  Logger: { log: () => {} },
  SpreadsheetApp: nope('SpreadsheetApp'), ContentService: nope('ContentService'), LockService: nope('LockService'), Session: nope('Session'),
})
const src = fs.readFileSync(botPath, 'utf8')
const marker = "const API_FS_BASE = 'https://repchess-api.ayvaz-270904.workers.dev/fs/documents';"
if (!src.includes(marker)) throw new Error('в bot.gs нет строки API_FS_BASE — бот без переключателя?')
vm.runInContext(src.replace(marker, `const API_FS_BASE = '${BASE}/fs/documents';`), ctx, { filename: 'bot.gs' })
const bot = expr => vm.runInContext(expr, ctx)
const J = v => JSON.stringify(v)

let passed = 0
const failed = []
async function t(name, fn) {
  try { await fn(); passed++; console.log('OK   ' + name) }
  catch (e) { failed.push(name); console.log('FAIL ' + name + ' — ' + e.message) }
}
const eq = (a, b, what = '') => { if (J(a) !== J(b)) throw new Error(`${what} ожидалось ${J(b)}, получено ${J(a)}`) }

try {
  await t('бот видит режим api и ходит на локальный API', async () => eq([bot('_dataBackend()'), bot('_dbBase()'), Object.keys(bot('_dbHeaders()'))], ['api', BASE + '/fs/documents', ['X-Service-Key']]))

  await t('тренеры: fsListTrainers = база', async () => {
    const rows = await one(`SELECT id, doc FROM trainers ORDER BY id`)
    const got = bot('fsListTrainers()')
    eq(got.length, rows.length, 'число')
    const withAssigned = rows.find(r => (r.doc.assignedStudents || []).length)
    eq(got.find(x => x.id === withAssigned.id).assigned, withAssigned.doc.assignedStudents.map(s => String(s).toLowerCase().trim()), 'закреплённые')
  })

  const top = (await one(`SELECT doc->>'studentEmail' AS em, count(*)::int AS n FROM lessons WHERE doc->>'studentEmail' <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 1`))[0]
  await t(`занятия ученика: fsQueryLessons = база (${top.n} занятий у самого частого)`, async () => {
    const got = bot(`fsQueryLessons(${J(top.em)})`)
    eq(got.length, top.n, 'число')
    const bad = got.filter(l => !/^\d{4}-\d\d-\d\d$/.test(l.date) || !l.status || !l.format)
    eq(bad.length, 0, 'занятий с пустыми полями')
    const ids = (await one(`SELECT id FROM lessons WHERE doc->>'studentEmail' = $1`, [top.em])).map(r => r.id).sort()
    eq(got.map(l => l.id).sort(), ids, 'id занятий')
  })
  await t('баланс: lessonsInfo считает проведённые по тем же занятиям', async () => {
    const done = (await one(`SELECT count(*)::int n FROM lessons WHERE doc->>'studentEmail' = $1 AND (status IS NULL OR status = 'done')`, [top.em]))[0].n
    const li = bot(`lessonsInfo(${J(top.em)}, 0, 0)`)
    eq(li.used, done, 'проведено')
  })

  await t('группы: fsListOpenGroups = открытые группы в базе, состав совпадает', async () => {
    const rows = await one(`SELECT id, doc FROM group_lessons WHERE is_public ORDER BY id`)
    const got = bot('fsListOpenGroups()')
    eq(got.length, rows.length, 'число')
    const r = rows.find(x => (x.doc.studentEmails || []).length) || rows[0]
    const g = got.find(x => x.id === r.id)
    eq([g.emails, g.format, g.time], [r.doc.studentEmails || [], r.doc.format, r.doc.time], 'группа ' + r.id)
  })
  await t('группа по id: fsGetGroup — дата, публичность, тренер', async () => {
    const r = (await one(`SELECT id, doc FROM group_lessons WHERE is_public ORDER BY lesson_date DESC LIMIT 1`))[0]
    const g = bot(`fsGetGroup(${J(r.id)})`)
    eq([g.isPublic, g.date, g.time], [true, r.doc._date, r.doc.time])
    eq(bot(`fsGetGroup('NOPE-NOPE')`), null, 'нет группы')
  })
  await t('расписание: fsGetSchedule — шаблон недели как в базе', async () => {
    const r = (await one(`SELECT id, doc FROM trainer_schedules ORDER BY id LIMIT 1`))[0]
    const s = bot(`fsGetSchedule(${J(r.id)})`)
    eq([Object.keys(s.template).sort(), s.template], [Object.keys(r.doc.template || {}).sort(), r.doc.template || {}])
  })
  await t('диапазон дат: _fsByDateRange = база', async () => {
    const n = (await one(`SELECT count(*)::int n FROM lessons WHERE lesson_date >= '2026-11-01' AND lesson_date <= '2026-11-09'`))[0].n
    const got = bot(`_fsByDateRange('lessons', '2026-11-01', '2026-11-09')`)
    eq(got.length, n, 'число'); if (!n) throw new Error('в диапазоне нет занятий — проверка пустая')
  })
  await t('отзывы: _fsQueryEq по статусу, оценка — число', async () => {
    const n = (await one(`SELECT count(*)::int n FROM lesson_feedback WHERE status = 'rated'`))[0].n
    const got = bot(`_fsQueryEq('lessonFeedback', 'status', 'rated')`)
    eq([got.length, got.every(d => typeof d.rating === 'number')], [n, true])
  })
  await t('промокод: тип полей как у Firestore (createdAt — время, lessons — целое)', async () => {
    const r = (await one(`SELECT id FROM cert_codes ORDER BY id LIMIT 1`))[0]
    const res = UrlFetchApp.fetch(bot('_dbBase()') + '/certCodes/' + r.id, { headers: bot('_dbHeaders()') })
    const d = JSON.parse(res.getContentText())
    eq([res.getResponseCode(), typeof d.fields.createdAt.timestampValue, typeof d.fields.lessons.integerValue, typeof d.updateTime], [200, 'string', 'string', 'string'])
  })

  await t('запись: создать, не создать повторно, поправить, прочитать', async () => {
    await pg.query(`DELETE FROM lesson_feedback WHERE id = 'ZZTEST1'`)
    eq(bot(`_fsCreateIfAbsent('lessonFeedback', 'ZZTEST1', { status: 'asked', rating: 0, studentEmail: 'zz@test' })`), true, 'создание')
    eq(bot(`_fsCreateIfAbsent('lessonFeedback', 'ZZTEST1', { status: 'asked' })`), false, 'повтор')
    eq(bot(`_fsPatchDoc('lessonFeedback', 'ZZTEST1', { status: 'rated', rating: 5 })`), true, 'правка')
    const d = bot(`_fsGetDoc('lessonFeedback', 'ZZTEST1')`)
    eq([d.status, d.rating, d.studentEmail], ['rated', 5, 'zz@test'])
    eq(bot(`_fsPatchDoc('lessonFeedback', 'ZZNOPE', { status: 'rated' })`), false, 'правка несуществующего')
    await pg.query(`DELETE FROM lesson_feedback WHERE id = 'ZZTEST1'`)
  })
  await t('запись в группу: _fsPatchGroup меняет состав и не трогает остальное', async () => {
    await pg.query(`DELETE FROM group_lessons WHERE id = 'ZZGROUP'`)
    await pg.query(`INSERT INTO group_lessons (id, doc) VALUES ('ZZGROUP', $1)`, [{ trainerId: 'x', _date: '2099-01-01', time: '18:00', isPublic: false, attendanceMarked: false, notes: 'не трогать', studentEmails: [], studentNames: [], studentIds: [], count: 0 }])
    eq(bot(`_fsPatchGroup('ZZGROUP', { emails: ['a@b.ru', 'c@d.ru'], names: ['А', 'Б'], ids: ['', ''], guestOf: ['a@b.ru'], guestNames: ['Гость'] })`), true)
    const d = (await one(`SELECT doc FROM group_lessons WHERE id = 'ZZGROUP'`))[0].doc
    eq([d.studentEmails, d.count, d.guestOf, d.guestNames, d.notes, d.time], [['a@b.ru', 'c@d.ru'], 2, ['a@b.ru'], ['Гость'], 'не трогать', '18:00'])
    await pg.query(`DELETE FROM group_lessons WHERE id = 'ZZGROUP'`)
  })

  await t('сбоев базы за проверку не было (_FS_FAIL = false)', async () => eq(bot('_FS_FAIL'), false))
  await t('неверный ключ: пустой список и флаг сбоя, а не «занятий нет»', async () => {
    for (const k of Object.keys(cache)) delete cache[k]
    bot(`_API_KEY = 'wrong'; _FS_FAIL = false`)
    eq([bot(`fsQueryLessons(${J(top.em)})`).length, bot('_FS_FAIL')], [0, true])
    bot(`_API_KEY = ${J(KEY)}; _FS_FAIL = false`)
  })
  await t('режим firestore (свойства нет): адрес и заголовок как раньше', async () => {
    delete props.DATA_BACKEND
    bot('_DATA_BACKEND = null')
    eq([bot('_dbBase()'), bot('_dbHeaders()')], ['https://firestore.googleapis.com/v1/projects/repchess-trainer/databases/(default)/documents', { Authorization: 'Bearer oauth-token' }])
  })
  console.log(`\nЗапросов бота к API: ${calls}`)
} finally {
  await pg.query(`DELETE FROM lesson_feedback WHERE id = 'ZZTEST1'`).catch(() => {})
  await pg.query(`DELETE FROM group_lessons WHERE id = 'ZZGROUP'`).catch(() => {})
  await pg.end()
  server.kill()
}
console.log(`Итог: ${passed} прошло, ${failed.length} не прошло`)
if (failed.length) process.exitCode = 1
