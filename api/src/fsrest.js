// Вход «в формате Firestore REST» — для бота и CRM-прокси (Apps Script).
//
// Бот и прокси написаны под REST API Firestore: документы как { fields: { x: { stringValue } } },
// запросы structuredQuery, PATCH с updateMask и условием currentDocument. Чтобы при переезде
// не переписывать десятки мест разбора ответов, этот модуль отвечает на те же запросы в том
// же формате. В скриптах меняются только адрес и заголовок с ключом.
//
// Только по служебному ключу (handler.js пускает сюда лишь isService).
//
//   POST   /fs/documents:runQuery                    { structuredQuery }
//   GET    /fs/documents/{coll}/{id}
//   GET    /fs/documents/{coll}?pageSize=N
//   POST   /fs/documents/{coll}[?documentId=ID]       { fields }       — создать
//   PATCH  /fs/documents/{coll}/{id}?updateMask.fieldPaths=a&currentDocument.exists=true
//                                   &currentDocument.updateTime=…     { fields }
//   DELETE /fs/documents/{coll}/{id}

import { table, checkId, checkField, autoId, queryDocs, getDoc, isTs, UT } from './store.js'
import { canWrite } from './rules.js'

export class FsError extends Error {
  constructor(http, status, message) { super(message); this.http = http; this.status = status }
}

// ── Значения: обычный JSON ↔ Value Firestore ──
export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return v.length ? { arrayValue: { values: v.map(enc) } } : { arrayValue: {} }
  if (isTs(v)) return { timestampValue: v.__ts }
  return { mapValue: { fields: encFields(v) } }
}
export function encFields(obj) {
  const f = {}
  for (const [k, v] of Object.entries(obj || {})) f[k] = enc(v)
  return f
}
export function dec(v) {
  if (!v || typeof v !== 'object') throw new FsError(400, 'INVALID_ARGUMENT', 'значение не в формате Firestore')
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return !!v.booleanValue
  if ('integerValue' in v) {
    const n = Number(v.integerValue)
    if (!Number.isSafeInteger(n)) throw new FsError(400, 'INVALID_ARGUMENT', 'integerValue вне диапазона')
    return n
  }
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('stringValue' in v) return String(v.stringValue)
  if ('timestampValue' in v) {
    const d = new Date(v.timestampValue)
    if (isNaN(d.getTime())) throw new FsError(400, 'INVALID_ARGUMENT', 'timestampValue не дата')
    return { __ts: d.toISOString() }
  }
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(dec)
  if ('mapValue' in v) return decFields((v.mapValue && v.mapValue.fields) || {})
  throw new FsError(400, 'INVALID_ARGUMENT', 'неизвестный тип значения')
}
export function decFields(fields) {
  const o = {}
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === '__proto__') throw new FsError(400, 'INVALID_ARGUMENT', 'недопустимый ключ')
    o[k] = dec(v)
  }
  return o
}

const docName = (project, coll, id) => `projects/${project}/databases/(default)/documents/${coll}/${id}`
const docJson = (project, coll, d) => ({
  name: docName(project, coll, d.id), fields: encFields(d.data), createTime: d.updateTime, updateTime: d.updateTime,
})

const OPS = {
  EQUAL: '==', GREATER_THAN_OR_EQUAL: '>=', LESS_THAN_OR_EQUAL: '<=', GREATER_THAN: '>', LESS_THAN: '<', IN: 'in',
}
function flattenWhere(w, out) {
  if (!w) return out
  if (w.fieldFilter) {
    const f = w.fieldFilter
    const op = OPS[f.op]
    if (!op) throw new FsError(400, 'INVALID_ARGUMENT', `оператор ${f.op} не поддерживается`)
    out.push([f.field && f.field.fieldPath, op, dec(f.value)])
  } else if (w.compositeFilter) {
    if (w.compositeFilter.op !== 'AND') throw new FsError(400, 'INVALID_ARGUMENT', 'поддерживается только AND')
    for (const x of w.compositeFilter.filters || []) flattenWhere(x, out)
  } else throw new FsError(400, 'INVALID_ARGUMENT', 'неподдерживаемое условие')
  return out
}

async function inTx(client, fn) {
  await client.query('BEGIN')
  try { const r = await fn(); await client.query('COMMIT'); return r }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e }
}

// Возвращает { status, body } — handler.js заворачивает в Response.
export async function handleFs(client, auth, env, method, path, searchParams, body) {
  const project = env.FIREBASE_PROJECT_ID || 'repchess'
  const now = () => new Date().toISOString()

  if (path === ':runQuery') {
    if (method !== 'POST') throw new FsError(405, 'INVALID_ARGUMENT', 'нужен POST')
    const q = (body && body.structuredQuery) || {}
    const coll = q.from && q.from[0] && q.from[0].collectionId
    const where = flattenWhere(q.where, [])
    const orderBy = (q.orderBy || []).map(o => [o.field && o.field.fieldPath, o.direction === 'DESCENDING' ? 'desc' : 'asc'])
    const limit = q.limit === undefined ? undefined : Number(typeof q.limit === 'object' ? q.limit.value : q.limit)
    const docs = await queryDocs(client, auth, coll, { where, orderBy, limit })
    const readTime = now()
    // Как Firestore: пустая выдача — один элемент без document
    return { status: 200, body: docs.length ? docs.map(d => ({ document: docJson(project, coll, d), readTime })) : [{ readTime }] }
  }

  const m = /^\/([A-Za-z]+)(?:\/([^/]+))?$/.exec(path)
  if (!m) throw new FsError(404, 'NOT_FOUND', 'нет такого адреса')
  const coll = m[1]
  const t = table(coll)
  const id = m[2] === undefined ? undefined : checkId(decodeURIComponent(m[2]))

  if (method === 'GET' && id !== undefined) {
    const d = await getDoc(client, auth, coll, id)
    if (!d) throw new FsError(404, 'NOT_FOUND', `документ ${coll}/${id} не найден`)
    return { status: 200, body: docJson(project, coll, d) }
  }

  if (method === 'GET') {
    const size = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '100', 10) || 100, 1), 1000)
    const docs = await queryDocs(client, auth, coll, { limit: size })
    return { status: 200, body: docs.length ? { documents: docs.map(d => docJson(project, coll, d)) } : {} }
  }

  if (method === 'POST' && id === undefined) {
    const newId = searchParams.get('documentId') ? checkId(searchParams.get('documentId')) : autoId()
    const data = decFields((body && body.fields) || {})
    return inTx(client, async () => {
      const ex = await client.query(`SELECT 1 FROM ${t} WHERE id = $1 FOR UPDATE`, [newId])
      if (ex.rows[0]) throw new FsError(409, 'ALREADY_EXISTS', `документ ${coll}/${newId} уже существует`)
      if (!canWrite(auth, coll, newId, 'create', null, data)) throw new FsError(403, 'PERMISSION_DENIED', 'нет прав')
      const r = await client.query(`INSERT INTO ${t} (id, doc, updated_at) VALUES ($1, $2, clock_timestamp()) RETURNING ${UT} AS ut`, [newId, data])
      return { status: 200, body: docJson(project, coll, { id: newId, data, updateTime: r.rows[0].ut }) }
    })
  }

  if (method === 'PATCH' && id !== undefined) {
    const mask = searchParams.getAll('updateMask.fieldPaths')
    mask.forEach(checkField)   // только поля верхнего уровня — вложенные пути бот не использует
    const fields = decFields((body && body.fields) || {})
    const needExists = searchParams.get('currentDocument.exists')
    const needTime = searchParams.get('currentDocument.updateTime')
    return inTx(client, async () => {
      const cur = (await client.query(`SELECT doc, ${UT} AS ut FROM ${t} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
      if (needExists === 'true' && !cur) throw new FsError(404, 'NOT_FOUND', `документ ${coll}/${id} не найден`)
      if (needExists === 'false' && cur) throw new FsError(409, 'ALREADY_EXISTS', `документ ${coll}/${id} уже существует`)
      if (needTime !== null) {
        // Документ изменился после чтения (например, промокод уже погасили) — как Firestore: 400
        if (!cur || cur.ut !== needTime) {
          throw new FsError(400, 'FAILED_PRECONDITION', 'документ изменился после чтения')
        }
      }
      let after
      if (mask.length) {
        after = { ...(cur ? cur.doc : {}) }
        for (const k of mask) { if (k in fields) after[k] = fields[k]; else delete after[k] }
      } else after = fields
      const kind = cur ? 'update' : 'create'
      if (!canWrite(auth, coll, id, kind, cur ? cur.doc : null, after)) throw new FsError(403, 'PERMISSION_DENIED', 'нет прав')
      const r = cur
        ? await client.query(`UPDATE ${t} SET doc = $2, updated_at = clock_timestamp() WHERE id = $1 RETURNING ${UT} AS ut`, [id, after])
        : await client.query(`INSERT INTO ${t} (id, doc, updated_at) VALUES ($1, $2, clock_timestamp()) RETURNING ${UT} AS ut`, [id, after])
      return { status: 200, body: docJson(project, coll, { id, data: after, updateTime: r.rows[0].ut }) }
    })
  }

  if (method === 'DELETE' && id !== undefined) {
    return inTx(client, async () => {
      const cur = (await client.query(`SELECT doc FROM ${t} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
      if (cur) {
        // Промокоды не удаляются никогда — даже ботом (правило владельца)
        if (coll === 'certCodes') throw new FsError(403, 'PERMISSION_DENIED', 'промокоды не удаляются, только архив')
        if (!canWrite(auth, coll, id, 'delete', cur.doc, null)) throw new FsError(403, 'PERMISSION_DENIED', 'нет прав')
        await client.query(`DELETE FROM ${t} WHERE id = $1`, [id])
      }
      return { status: 200, body: {} }
    })
  }

  throw new FsError(405, 'INVALID_ARGUMENT', 'метод не поддерживается')
}
