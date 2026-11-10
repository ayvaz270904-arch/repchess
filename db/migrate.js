// Rep Chess — перенос снимка Firestore в Postgres (этап 2 плана).
//
// Запуск:  node db/migrate.js <снимок.json> [схема]      (схема по умолчанию staging)
// Снимок — JSON { exportedAt, collections: { <коллекция>: [{ id, data }] } }, отметки
// времени Firestore в нём уже строки ISO. Подключение: адрес, база и пользователь — из
// переменных окружения PGHOST, PGDATABASE, PGUSER (PGPORT по умолчанию 5432), пароль pg
// берёт сам из ~/.pgpass. В репозитории (он публичный) их нет.
//
// Повторяемый: запись вставляется или обновляется по id, неизменённая не трогается.
// Документ, которого больше нет в снимке, удаляется — КРОМЕ промокодов cert_codes:
// их никогда не удаляем (правило владельца), только сообщаем.
// После загрузки — сверка со снимком: число записей, каждый документ поле в поле,
// и проведённые занятия каждого ученика по датам и типам (из них считается баланс).

const fs = require('fs')
const { Client } = require(process.env.PG_MODULE || 'pg')

const TABLES = {
  trainers: 'trainers',
  lessons: 'lessons',
  groupLessons: 'group_lessons',
  trainerSchedules: 'trainer_schedules',
  certCodes: 'cert_codes',
  lessonFeedback: 'lesson_feedback',
  trainerRates: 'trainer_rates',
  priceOverrides: 'price_overrides',
  settings: 'settings',
}
const NEVER_DELETE = new Set(['cert_codes'])

// Отметки времени Firestore (Timestamp) хранятся как { "__ts": "<ISO>" } — тип терять нельзя:
// тренерка зовёт у них .toDate(), бот читает timestampValue. Снимок версии 2 уже несёт их
// в таком виде (db/export-snippet.js). Снимок версии 1 (09.11.2026) записал их строками —
// для него список полей ниже; он снят с базы проходом по всем документам 10.11.2026
// (вложенных отметок времени нет).
const TS_FIELDS_V1 = {
  trainers: ['createdAt'], lessons: ['createdAt'], groupLessons: ['createdAt'],
  certCodes: ['createdAt', 'usedAt', 'archivedAt'], trainerSchedules: ['updatedAt'],
}
function upgradeV1(snap) {
  for (const [coll, fields] of Object.entries(TS_FIELDS_V1)) {
    for (const d of snap.collections[coll] || []) {
      for (const f of fields) if (typeof d.data[f] === 'string') d.data[f] = { __ts: d.data[f] }
    }
  }
  snap.format = 2
}

// Ключи объектов по алфавиту — чтобы сравнивать документы независимо от порядка полей
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k])
    return o
  }
  return v
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// Проведённые занятия: «почта|дата|тип» — то, из чего считается баланс (status done или без статуса)
function doneKey(d) {
  if (d.status && d.status !== 'done') return null
  const em = String(d.studentEmail || '').toLowerCase().trim()
  if (!em || !d._date) return null
  return `${em}|${d._date}|${d.type || ''}|${d.format || ''}`
}

async function main() {
  const [file, schema = 'staging'] = process.argv.slice(2)
  if (!file) throw new Error('укажи файл снимка')
  if (!/^[a-z_]+$/.test(schema)) throw new Error('недопустимое имя схемы')
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (snap.format !== 2) upgradeV1(snap)
  for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
  const c = new Client({ ssl: { rejectUnauthorized: false }, application_name: 'repchess-migrate' })
  await c.connect()
  const report = {}
  try {
    await c.query('BEGIN')
    await c.query(`SET LOCAL search_path TO ${schema}`)
    for (const [coll, table] of Object.entries(TABLES)) {
      const docs = snap.collections[coll] || []
      const r = { inserted: 0, updated: 0, unchanged: 0, deleted: 0, kept: 0 }
      const existing = new Map((await c.query(`SELECT id, doc FROM ${table}`)).rows.map(x => [x.id, x.doc]))
      for (const { id, data } of docs) {
        if (!existing.has(id)) {
          await c.query(`INSERT INTO ${table} (id, doc) VALUES ($1, $2)`, [id, data]); r.inserted++
        } else if (!same(existing.get(id), data)) {
          await c.query(`UPDATE ${table} SET doc = $2, updated_at = now() WHERE id = $1`, [id, data]); r.updated++
        } else r.unchanged++
      }
      const ids = new Set(docs.map(d => d.id))
      for (const id of existing.keys()) {
        if (ids.has(id)) continue
        if (NEVER_DELETE.has(table)) { r.kept++; continue }
        await c.query(`DELETE FROM ${table} WHERE id = $1`, [id]); r.deleted++
      }
      report[table] = r
    }
    await c.query(`INSERT INTO schema_meta (key, value) VALUES ('last_import', $1)
                   ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = now()`,
      [`${snap.exportedAt} ${file.split('/').pop()}`])
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  }

  // ── Сверка со снимком ──
  const problems = []
  for (const [coll, table] of Object.entries(TABLES)) {
    const docs = snap.collections[coll] || []
    const rows = (await c.query(`SELECT id, doc FROM ${schema}.${table}`)).rows
    const byId = new Map(rows.map(x => [x.id, x.doc]))
    const extra = rows.length - docs.length
    if (extra !== 0 && !(NEVER_DELETE.has(table) && extra > 0)) problems.push(`${table}: в базе ${rows.length}, в снимке ${docs.length}`)
    let diff = 0
    for (const { id, data } of docs) if (!byId.has(id) || !same(byId.get(id), data)) diff++
    if (diff) problems.push(`${table}: ${diff} документов отличаются от снимка`)
    report[table].total = rows.length
  }
  // Проведённые занятия по ученикам: снимок против SQL по вычисляемым колонкам
  const fromSnap = {}
  for (const { data } of snap.collections.lessons || []) {
    const k = doneKey(data); if (k) fromSnap[k] = (fromSnap[k] || 0) + 1
  }
  const fromDb = {}
  const q = await c.query(`SELECT student_email AS em, lesson_date AS d, coalesce(lesson_type,'') AS t,
      coalesce(lesson_format,'') AS f, count(*)::int AS n
    FROM ${schema}.lessons
    WHERE (status IS NULL OR status = 'done') AND coalesce(student_email,'') <> '' AND lesson_date IS NOT NULL
    GROUP BY 1,2,3,4`)
  for (const x of q.rows) fromDb[`${x.em}|${x.d}|${x.t}|${x.f}`] = x.n
  const keys = new Set([...Object.keys(fromSnap), ...Object.keys(fromDb)])
  let lessonDiff = 0
  for (const k of keys) if ((fromSnap[k] || 0) !== (fromDb[k] || 0)) lessonDiff++
  const students = new Set([...keys].map(k => k.split('|')[0])).size
  const doneTotal = Object.values(fromDb).reduce((a, b) => a + b, 0)
  if (lessonDiff) problems.push(`проведённые занятия: ${lessonDiff} расхождений`)
  await c.end()

  console.log(`Снимок от ${snap.exportedAt}, схема ${schema}`)
  for (const [t, r] of Object.entries(report)) {
    console.log(`  ${t.padEnd(18)} всего ${String(r.total).padStart(4)} | новых ${r.inserted}, изменено ${r.updated}, без изменений ${r.unchanged}, удалено ${r.deleted}${r.kept ? `, оставлено (не удаляем) ${r.kept}` : ''}`)
  }
  console.log(`  проведённых занятий: ${doneTotal} у ${students} учеников`)
  console.log(problems.length ? 'СВЕРКА: РАСХОЖДЕНИЯ\n  - ' + problems.join('\n  - ') : 'СВЕРКА: всё совпадает со снимком')
  if (problems.length) process.exitCode = 2
}

main().catch(e => { console.error('ОШИБКА: ' + e.message); process.exitCode = 1 })
