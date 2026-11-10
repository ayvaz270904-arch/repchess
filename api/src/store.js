// Хранилище документов поверх Postgres с поведением Firestore — ровно в том объёме,
// который используют тренерка, CRM и бот: запросы (==, in, >=, <=, >, <, сортировка,
// лимит), чтение по id, запись (create/set/set merge/update/delete) пакетом в одной
// транзакции, служебные значения (время сервера, удалить поле, добавить/убрать из массива).
//
// Клиент pg передаётся снаружи (Worker или тесты). Схема (staging/рабочая) задаётся
// setSchema() и подставляется в имя таблицы: через Hyperdrive search_path из параметров
// подключения не передаётся, а SET сбрасывается между запросами. Без setSchema имена
// идут без схемы и работает search_path (локальные тесты).
// Права проверяются здесь же, функциями из rules.js, на каждый документ.

import { COLLECTIONS, canRead, canQuery, canWrite } from './rules.js'

let SCHEMA = ''
export function setSchema(s) { SCHEMA = /^[a-z_]+$/.test(s || '') ? s : '' }
export function qualify(name) { return SCHEMA ? `${SCHEMA}.${name}` : name }

export const TABLES = {
  trainers: 'trainers', lessons: 'lessons', groupLessons: 'group_lessons',
  trainerSchedules: 'trainer_schedules', certCodes: 'cert_codes', lessonFeedback: 'lesson_feedback',
  trainerRates: 'trainer_rates', priceOverrides: 'price_overrides', settings: 'settings',
}

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

// Время последней правки строкой с микросекундами (как updateTime у Firestore)
export const UT = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const ID = /^[A-Za-z0-9_.@+-]{1,200}$/
const MAX_LIMIT = 5000
const MAX_WRITES = 500   // как у пакета Firestore

export function table(coll) {
  if (!COLLECTIONS.includes(coll)) throw new ApiError('invalid-argument', `неизвестная коллекция ${coll}`)
  return qualify(TABLES[coll])
}
export function checkId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new ApiError('invalid-argument', 'недопустимый id документа')
  return id
}
export function checkField(f) {
  if (typeof f !== 'string' || !FIELD.test(f)) throw new ApiError('invalid-argument', `недопустимое поле ${f}`)
  return f
}
// Ключ внутри документа (путь update, ключи объектов): дни недели '0'..'6', даты
// '2026-07-19', uid тренеров. В SQL не подставляется. __proto__ запрещён: присваивание
// по нему меняет прототип объекта.
const KEY = /^[A-Za-z0-9_-]{1,128}$/
function checkKey(k) {
  if (typeof k !== 'string' || !KEY.test(k) || k === '__proto__') throw new ApiError('invalid-argument', `недопустимый ключ ${k}`)
  return k
}
function noProto(obj) {
  if (Object.prototype.hasOwnProperty.call(obj, '__proto__')) throw new ApiError('invalid-argument', 'недопустимый ключ __proto__')
  return obj
}

// id как у Firestore: 20 символов [A-Za-z0-9]
export function autoId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let s = ''
  for (const b of bytes) s += abc[b % abc.length]
  return s
}

// ── Чтение ──

export async function getDoc(client, auth, coll, id) {
  const t = table(coll); checkId(id)
  const r = await client.query(`SELECT doc, ${UT} AS ut FROM ${t} WHERE id = $1`, [id])
  const data = r.rows[0] ? r.rows[0].doc : null
  // Как Firestore: правило проверяется и для несуществующего документа (по id)
  if (!canRead(auth, coll, id, data || {}, 'get')) throw new ApiError('permission-denied', 'нет доступа')
  return data ? { id, data, updateTime: r.rows[0].ut } : null
}

// select — необязательный список полей верхнего уровня: в ответе остаются только они.
// Так тренерка берёт для подсчёта остатков 5 полей занятия вместо всего документа
// (651 занятие: ~0,5 МБ → ~0,1 МБ). Права проверяются по полному документу, как без select.
export async function queryDocs(client, auth, coll, { where = [], orderBy = [], limit, select } = {}) {
  const t = table(coll)
  if (!Array.isArray(where) || !Array.isArray(orderBy)) throw new ApiError('invalid-argument', 'where/orderBy — массивы')
  let pick = null
  if (select !== undefined) {
    if (!Array.isArray(select) || select.length === 0 || select.length > 20) throw new ApiError('invalid-argument', 'select — список из 1–20 полей')
    pick = select.map(f => { if (f === '__proto__') throw new ApiError('invalid-argument', 'недопустимое поле'); return checkField(f) })
  }
  if (!canQuery(auth, coll, where)) throw new ApiError('permission-denied', 'нет доступа к такому запросу')
  const params = []
  const conds = []
  const p = v => { params.push(v); return `$${params.length}` }
  for (const w of where) {
    if (!Array.isArray(w) || w.length !== 3) throw new ApiError('invalid-argument', 'условие — [поле, оператор, значение]')
    const [f, op, v] = w
    const fld = `doc->'${checkField(f)}'`
    if (op === '==') conds.push(`${fld} = ${p(JSON.stringify(v))}::jsonb`)
    else if (op === 'in') {
      if (!Array.isArray(v) || v.length === 0 || v.length > 30) throw new ApiError('invalid-argument', 'in — список из 1–30 значений')
      conds.push(`${fld} = ANY(${p(v.map(x => JSON.stringify(x)))}::jsonb[])`)
    } else if (['>=', '<=', '>', '<'].includes(op)) {
      // Строки — побайтово (COLLATE "C"), как Firestore; числа — как числа.
      // Документ без поля или с полем другого типа в выдачу не попадает.
      if (typeof v === 'string') conds.push(`jsonb_typeof(${fld}) = 'string' AND (doc->>'${f}') COLLATE "C" ${op} ${p(v)}`)
      else if (typeof v === 'number') conds.push(`jsonb_typeof(${fld}) = 'number' AND (doc->>'${f}')::numeric ${op} ${p(v)}`)
      else throw new ApiError('invalid-argument', 'сравнение только со строкой или числом')
    } else throw new ApiError('invalid-argument', `оператор ${op} не поддерживается`)
  }
  const order = []
  // Как Firestore: без явной сортировки запрос с неравенством отдаётся по этому полю,
  // а при равных значениях — по id в направлении последней сортировки (побайтово).
  let sort = orderBy
  if (!sort.length) {
    const ineq = where.find(w => ['>=', '<=', '>', '<'].includes(w[1]))
    if (ineq) sort = [[ineq[0], 'asc']]
  }
  let lastDir = 'ASC'
  for (const o of sort) {
    const [f, dir = 'asc'] = Array.isArray(o) ? o : [o]
    checkField(f)
    const d = dir === 'desc' ? 'DESC' : 'ASC'
    lastDir = d
    conds.push(`doc ? '${f}'`)   // как Firestore: без поля сортировки документ не выдаётся
    order.push(`CASE WHEN jsonb_typeof(doc->'${f}') = 'number' THEN (doc->>'${f}')::numeric END ${d}`,
               `coalesce(doc->'${f}'->>'__ts', doc->>'${f}') COLLATE "C" ${d}`)
  }
  order.push(`id COLLATE "C" ${lastDir}`)
  let lim = ''
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiError('invalid-argument', `limit 1–${MAX_LIMIT}`)
    lim = ` LIMIT ${limit}`
  }
  const sql = `SELECT id, doc, ${UT} AS ut FROM ${t}${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ORDER BY ${order.join(', ')}${lim}`
  const rows = (await client.query(sql, params)).rows
  // Вторая линия защиты: каждый документ выдачи ещё раз через правило чтения
  for (const r of rows) {
    if (!canRead(auth, coll, r.id, r.doc, 'list')) throw new ApiError('permission-denied', 'нет доступа к документу выдачи')
  }
  const only = doc => { const o = {}; for (const f of pick) if (Object.prototype.hasOwnProperty.call(doc, f)) o[f] = doc[f]; return o }
  return rows.map(r => ({ id: r.id, data: pick ? only(r.doc) : r.doc, updateTime: r.ut }))
}

// ── Отметки времени ──
// Timestamp Firestore хранится в документе как { "__ts": "2026-11-09T20:37:20.273Z" }: тип
// нельзя терять — тренерка зовёт у таких полей .toDate(), бот читает timestampValue.
// Обычная строка с датой (askedAt у отзывов, _date занятий) остаётся строкой.
export const isTs = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.__ts === 'string' && Object.keys(v).length === 1

// ── Служебные значения (то, что в Firestore — FieldValue) ──
// В JSON приходят как { "__op": "serverTimestamp" | "delete" | "arrayUnion" | "arrayRemove", "values": [...] }

const isOp = v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.__op === 'string'
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !isOp(v)
const DELETE = Symbol('delete')

function applyOp(op, current, now) {
  switch (op.__op) {
    case 'serverTimestamp': return { __ts: now }
    case 'delete': return DELETE
    case 'arrayUnion': {
      const base = Array.isArray(current) ? current.slice() : []
      for (const x of op.values || []) if (!base.some(y => JSON.stringify(y) === JSON.stringify(x))) base.push(x)
      return base
    }
    case 'arrayRemove': {
      const drop = (op.values || []).map(x => JSON.stringify(x))
      return Array.isArray(current) ? current.filter(y => !drop.includes(JSON.stringify(y))) : []
    }
    default: throw new ApiError('invalid-argument', `неизвестное служебное значение ${op.__op}`)
  }
}

// Значение без служебных вставок (для set без merge и вложенных объектов в update)
function resolveDeep(v, now) {
  if (isOp(v)) { const r = applyOp(v, undefined, now); return r === DELETE ? undefined : r }
  if (Array.isArray(v)) return v.map(x => resolveDeep(x, now))
  if (isPlain(v)) {
    const o = {}
    for (const [k, x] of Object.entries(noProto(v))) { const r = resolveDeep(x, now); if (r !== undefined) o[k] = r }
    return o
  }
  return v
}

// set с merge: вложенные объекты сливаются, служебные значения применяются на месте
function mergeDeep(base, patch, now) {
  const out = isPlain(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(noProto(patch))) {
    if (isOp(v)) {
      const r = applyOp(v, out[k], now)
      if (r === DELETE) delete out[k]; else out[k] = r
    } else if (isPlain(v)) out[k] = mergeDeep(out[k], v, now)
    else out[k] = resolveDeep(v, now)
  }
  return out
}

// update: ключ верхнего уровня заменяется целиком; 'a.b' — путь во вложенный объект
function applyUpdate(base, patch, now) {
  const out = structuredClone(base)
  for (const [path, v] of Object.entries(noProto(patch))) {
    const parts = path.split('.')
    parts.forEach(checkKey)
    let node = out
    for (const part of parts.slice(0, -1)) {
      if (!isPlain(node[part])) node[part] = {}
      node = node[part]
    }
    const last = parts[parts.length - 1]
    if (isOp(v)) {
      const r = applyOp(v, node[last], now)
      if (r === DELETE) delete node[last]; else node[last] = r
    } else node[last] = resolveDeep(v, now)
  }
  return out
}

// ── Запись пакетом ──
// writes: [{ op: 'set' | 'update' | 'delete' | 'create', coll, id?, data?, merge? }]
//   set без id = add (id создаётся здесь). create — ошибка, если документ уже есть.
// Всё в одной транзакции: одна ошибка или отказ в правах — не применяется ничего.

export async function commit(client, auth, writes) {
  if (!Array.isArray(writes) || writes.length === 0 || writes.length > MAX_WRITES) {
    throw new ApiError('invalid-argument', `writes — от 1 до ${MAX_WRITES} операций`)
  }
  const now = new Date().toISOString()
  const results = []
  await client.query('BEGIN')
  try {
    for (const w of writes) {
      const t = table(w.coll)
      const id = w.id === undefined && (w.op === 'set' || w.op === 'create') ? autoId() : checkId(w.id)
      const row = (await client.query(`SELECT doc FROM ${t} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
      const before = row ? row.doc : null
      let after
      if (w.op === 'delete') after = null
      else {
        if (!isPlain(w.data)) throw new ApiError('invalid-argument', 'data — объект')
        if (w.op === 'set') after = w.merge ? mergeDeep(before, w.data, now) : resolveDeep(w.data, now)
        else if (w.op === 'create') {
          if (before) throw new ApiError('already-exists', `${w.coll}/${id} уже существует`)
          after = resolveDeep(w.data, now)
        } else if (w.op === 'update') {
          if (!before) throw new ApiError('not-found', `${w.coll}/${id} не найден`)
          after = applyUpdate(before, w.data, now)
        } else throw new ApiError('invalid-argument', `операция ${w.op} не поддерживается`)
      }
      const kind = after === null ? 'delete' : before ? 'update' : 'create'
      if (kind === 'delete' && !before) { results.push({ id, op: 'noop' }); continue }
      if (!canWrite(auth, w.coll, id, kind, before, after)) {
        throw new ApiError('permission-denied', `нет прав: ${kind} ${w.coll}/${id}`)
      }
      if (kind === 'delete') await client.query(`DELETE FROM ${t} WHERE id = $1`, [id])
      else if (kind === 'create') await client.query(`INSERT INTO ${t} (id, doc, updated_at) VALUES ($1, $2, clock_timestamp())`, [id, after])
      else await client.query(`UPDATE ${t} SET doc = $2, updated_at = clock_timestamp() WHERE id = $1`, [id, after])
      results.push({ id, op: kind })
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
  return { results, at: now }
}
