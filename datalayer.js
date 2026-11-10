// Rep Chess — слой данных тренерки и CRM.
//
// Страницы написаны под Firebase Firestore (firebase.firestore(), collection().where().get(),
// batch(), FieldValue…). При переезде на свою базу (Postgres за API, папка api/) этот файл
// подменяет firebase.firestore() на объект с теми же методами, который ходит в API.
// Код страниц при этом не меняется. Вход остаётся в Firebase Auth: токен входа уходит в API.
//
// Какая база используется:
//   RC_BACKEND_DEFAULT ниже — для всех;
//   ?backend=api | firestore в адресе — только для этой вкладки (проверка до переключения).
// Подключать ПОСЛЕ firebase-*.js и ДО скрипта страницы.

(function () {
  'use strict'

  var RC_BACKEND_DEFAULT = 'firestore'   // переключение: 'api'
  var RC_API_BASE = 'https://repchess-api.ayvaz-270904.workers.dev'

  var backend = RC_BACKEND_DEFAULT
  try {
    var q = new URLSearchParams(window.location.search).get('backend')
    if (q === 'api' || q === 'firestore') sessionStorage.setItem('rc_backend', q)
    var s = sessionStorage.getItem('rc_backend')
    if (s === 'api' || s === 'firestore') backend = s
  } catch (e) { /* приватный режим — остаёмся на значении по умолчанию */ }

  window.RC_DATA = { backend: backend, apiBase: RC_API_BASE }
  if (backend !== 'api') return   // работаем с Firestore как раньше

  // ── Отметка времени (замена firebase.firestore.Timestamp) ──
  function Timestamp(ms) {
    this._ms = ms
    this.seconds = Math.floor(ms / 1000)
    this.nanoseconds = (ms - this.seconds * 1000) * 1e6
  }
  Timestamp.prototype.toDate = function () { return new Date(this._ms) }
  Timestamp.prototype.toMillis = function () { return this._ms }
  Timestamp.prototype.toJSON = function () { return { __ts: new Date(this._ms).toISOString() } }
  Timestamp.fromDate = function (d) { return new Timestamp(d.getTime()) }
  Timestamp.fromMillis = function (ms) { return new Timestamp(ms) }
  Timestamp.now = function () { return new Timestamp(Date.now()) }

  // ── Служебные значения (замена firebase.firestore.FieldValue) ──
  function Sentinel(op, values) { this.__op = op; if (values) this.values = values }
  var FieldValue = {
    serverTimestamp: function () { return new Sentinel('serverTimestamp') },
    delete: function () { return new Sentinel('delete') },
    arrayUnion: function () { return new Sentinel('arrayUnion', Array.prototype.slice.call(arguments)) },
    arrayRemove: function () { return new Sentinel('arrayRemove', Array.prototype.slice.call(arguments)) },
  }

  function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

  // Из API: { __ts } → Timestamp
  function revive(v) {
    if (Array.isArray(v)) return v.map(revive)
    if (isPlain(v)) {
      var keys = Object.keys(v)
      if (keys.length === 1 && keys[0] === '__ts' && typeof v.__ts === 'string') return new Timestamp(new Date(v.__ts).getTime())
      var o = {}
      for (var i = 0; i < keys.length; i++) o[keys[i]] = revive(v[keys[i]])
      return o
    }
    return v
  }
  // В API: Timestamp/Date → { __ts }, служебные → { __op }, undefined выбрасываем
  function wire(v) {
    if (v instanceof Timestamp) return { __ts: new Date(v._ms).toISOString() }
    if (v instanceof Date) return { __ts: v.toISOString() }
    if (v instanceof Sentinel) return v.values ? { __op: v.__op, values: v.values.map(wire) } : { __op: v.__op }
    if (Array.isArray(v)) return v.map(function (x) { return x === undefined ? null : wire(x) })
    if (isPlain(v)) {
      var o = {}
      Object.keys(v).forEach(function (k) { if (v[k] !== undefined) o[k] = wire(v[k]) })
      return o
    }
    return v
  }

  // id как у Firestore: 20 символов
  function autoId() {
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    var bytes = crypto.getRandomValues(new Uint8Array(20)), s = ''
    for (var i = 0; i < 20; i++) s += abc[bytes[i] % abc.length]
    return s
  }

  // Тексты ошибок — как у Firestore: страницы показывают их и местами проверяют
  var MESSAGES = {
    'permission-denied': 'Missing or insufficient permissions.',
    'unauthenticated': 'The request does not have valid authentication credentials.',
  }
  function apiError(code, message) {
    var e = new Error(MESSAGES[code] || message || code)
    e.code = code
    e.name = 'FirebaseError'
    return e
  }

  function call(path, body) {
    var user = firebase.auth().currentUser
    if (!user) return Promise.reject(apiError('unauthenticated'))
    return user.getIdToken().then(function (token) {
      return fetch(RC_API_BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      })
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.error) throw apiError((j.error && j.error.code) || 'unknown', j.error && j.error.message)
        return j
      }, function () { throw apiError('unavailable', 'API ответил не JSON (HTTP ' + res.status + ')') })
    }, function (e) {
      if (e && e.code) throw e
      throw apiError('unavailable', 'Нет связи с сервером данных: ' + (e && e.message))
    })
  }

  // ── Документы и запросы ──
  function DocSnap(ref, raw) {
    this.id = ref.id
    this.ref = ref
    this.exists = raw !== null && raw !== undefined
    this._raw = this.exists ? raw : null
  }
  DocSnap.prototype.data = function () { return this.exists ? revive(this._raw) : undefined }
  DocSnap.prototype.get = function (field) { var d = this.data(); return d ? d[field] : undefined }

  function QuerySnap(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0 }
  QuerySnap.prototype.forEach = function (fn, thisArg) { this.docs.forEach(fn, thisArg) }

  function DocRef(coll, id) { this._coll = coll; this.id = id; this.path = coll + '/' + id }
  DocRef.prototype.get = function () {
    var self = this
    return call('/v1/get', { coll: this._coll, id: this.id }).then(function (j) {
      return new DocSnap(self, j.doc ? j.doc.data : null)
    })
  }
  DocRef.prototype._set = function (data, opts) {
    return { op: 'set', coll: this._coll, id: this.id, data: wire(data), merge: !!(opts && opts.merge) }
  }
  DocRef.prototype._update = function (data) { return { op: 'update', coll: this._coll, id: this.id, data: wire(data) } }
  DocRef.prototype._delete = function () { return { op: 'delete', coll: this._coll, id: this.id } }
  DocRef.prototype.set = function (data, opts) { return call('/v1/commit', { writes: [this._set(data, opts)] }).then(noop) }
  DocRef.prototype.update = function (data) { return call('/v1/commit', { writes: [this._update(pairs(arguments, data))] }).then(noop) }
  DocRef.prototype.delete = function () { return call('/v1/commit', { writes: [this._delete()] }).then(noop) }
  function noop() {}
  // update('поле', значение, 'поле2', значение2) → объект
  function pairs(args, data) {
    if (typeof data !== 'string') return data
    var o = {}
    for (var i = 0; i + 1 < args.length; i += 2) o[args[i]] = args[i + 1]
    return o
  }

  function Query(coll, where, orderBy, limit) { this._coll = coll; this._where = where; this._orderBy = orderBy; this._limit = limit }
  Query.prototype.where = function (f, op, v) { return new Query(this._coll, this._where.concat([[f, op, wire(v)]]), this._orderBy, this._limit) }
  Query.prototype.orderBy = function (f, dir) { return new Query(this._coll, this._where, this._orderBy.concat([[f, dir === 'desc' ? 'desc' : 'asc']]), this._limit) }
  Query.prototype.limit = function (n) { return new Query(this._coll, this._where, this._orderBy, n) }
  Query.prototype.get = function () {
    var coll = this._coll
    var body = { coll: coll, where: this._where, orderBy: this._orderBy }
    if (this._limit !== undefined) body.limit = this._limit
    return call('/v1/query', body).then(function (j) {
      return new QuerySnap(j.docs.map(function (d) { return new DocSnap(new DocRef(coll, d.id), d.data) }))
    })
  }

  function Collection(coll) { Query.call(this, coll, [], [], undefined); this.id = coll; this.path = coll }
  Collection.prototype = Object.create(Query.prototype)
  Collection.prototype.doc = function (id) { return new DocRef(this._coll, id === undefined ? autoId() : String(id)) }
  Collection.prototype.add = function (data) {
    var ref = this.doc()
    return call('/v1/commit', { writes: [{ op: 'create', coll: this._coll, id: ref.id, data: wire(data) }] }).then(function () { return ref })
  }

  function Batch() { this._writes = [] }
  Batch.prototype.set = function (ref, data, opts) { this._writes.push(ref._set(data, opts)); return this }
  Batch.prototype.update = function (ref, data) { this._writes.push(ref._update(pairs(Array.prototype.slice.call(arguments, 1), data))); return this }
  Batch.prototype.delete = function (ref) { this._writes.push(ref._delete()); return this }
  Batch.prototype.commit = function () {
    if (!this._writes.length) return Promise.resolve()
    return call('/v1/commit', { writes: this._writes }).then(noop)
  }

  var db = {
    collection: function (name) { return new Collection(name) },
    doc: function (path) { var p = String(path).split('/'); return new DocRef(p[0], p[1]) },
    batch: function () { return new Batch() },
  }

  // Подмена: firebase.firestore() и firebase.firestore.FieldValue / Timestamp
  var factory = function () { return db }
  factory.FieldValue = FieldValue
  factory.Timestamp = Timestamp
  try {
    Object.defineProperty(firebase, 'firestore', { value: factory, configurable: true, writable: true })
  } catch (e) { firebase.firestore = factory }
  window.RC_DATA.db = db
  window.RC_DATA.Timestamp = Timestamp
})()
