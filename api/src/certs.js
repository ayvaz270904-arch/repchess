// Промокоды: удаление из архива (решение владельца 14.11.2026).
//
// Общее правило «промокоды не удаляются» (rules.js, fsrest.js) остаётся: обычным DELETE их не
// удалить никому. Здесь — единственный путь, и только для кодов, которые никто не активировал:
//   • в архиве (archived: true);
//   • одноразовый — usedBy пуст; многоразовый — ни одной активации (uses = 0, redeemers пуст).
// Активированные остаются навсегда: по ним история, CSV и «оплаты после».
//
//   POST /v1/certs/delete  { codes: [...] }  → { deleted: [...], kept: [{ code, why }] }  (админ)

import { ApiError, qualify } from './store.js'

const CODE_RE = /^[A-Z0-9-]{3,24}$/

export function certDeletable(doc) {
  if (!doc || doc.archived !== true) return 'not_archived'
  if (String(doc.usedBy || '').trim()) return 'used'
  if (doc.multi && ((Number(doc.uses) || 0) > 0 || (Array.isArray(doc.redeemers) && doc.redeemers.length))) return 'used'
  return ''
}

export async function certsDelete(client, body) {
  const codes = Array.isArray(body && body.codes) ? [...new Set(body.codes.map(String).filter(c => CODE_RE.test(c)))].slice(0, 1000) : []
  if (!codes.length) throw new ApiError('invalid-argument', 'нет кодов для удаления')
  const T = qualify('cert_codes')
  await client.query('BEGIN')
  try {
    const rows = (await client.query(`SELECT id, doc FROM ${T} WHERE id = ANY($1) FOR UPDATE`, [codes])).rows
    const found = new Set(rows.map(r => r.id))
    const kept = codes.filter(c => !found.has(c)).map(code => ({ code, why: 'not_found' }))
    const del = []
    rows.forEach(r => { const why = certDeletable(r.doc); if (why) kept.push({ code: r.id, why }); else del.push(r.id) })
    if (del.length) await client.query(`DELETE FROM ${T} WHERE id = ANY($1)`, [del])
    await client.query('COMMIT')
    return { deleted: del, kept }
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e }
}
