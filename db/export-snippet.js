// Выгрузка всех коллекций Firestore в снимок версии 2 для db/migrate.js.
// Выполняется в консоли браузера на странице тренерки под админом (там есть `db` и вход):
// SDK в браузере читает Firestore и тогда, когда REST упирается в квоту (09.11.2026).
// Отметки времени уходят как { __ts: ISO } — тип сохраняется.
// Результат — файл repchess-firestore-export-<дата>.json в «Загрузках». В нём персональные
// данные учеников: сразу перенести в gas/export/ (папка не в git и не на сайте), chmod 600.
(async () => {
  const conv = v => {
    if (v === null || v === undefined) return v === undefined ? undefined : null
    if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() }
    if (Array.isArray(v)) return v.map(conv)
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { const c = conv(v[k]); if (c !== undefined) o[k] = c } return o }
    return v
  }
  const cols = ['trainers', 'lessons', 'groupLessons', 'trainerSchedules', 'certCodes', 'lessonFeedback', 'trainerRates', 'priceOverrides', 'settings']
  const exp = { format: 2, exportedAt: new Date().toISOString(), project: 'repchess-trainer', collections: {} }
  for (const c of cols) {
    const snap = await db.collection(c).get({ source: 'server' })
    exp.collections[c] = snap.docs.map(d => ({ id: d.id, data: conv(d.data()) }))
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(exp)], { type: 'application/json' }))
  a.download = 'repchess-firestore-export-' + exp.exportedAt.slice(0, 10) + '.json'
  document.body.appendChild(a); a.click(); a.remove()
  console.log(Object.fromEntries(Object.entries(exp.collections).map(([k, v]) => [k, v.length])))
})()
