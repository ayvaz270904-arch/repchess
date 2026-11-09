// Вход в API — сменный: список способов (провайдеров), каждый включается настройкой
// AUTH_PROVIDERS (через запятую). Сейчас: firebase (токен входа тренерки и CRM) и
// service (служебный ключ бота и CRM-прокси). Вход через Telegram — этап 8 плана:
// добавить провайдер 'telegram' сюда же, остальной API не меняется.
//
// Провайдер получает запрос и env и возвращает { uid, isService } или null (не его случай);
// при неверных данных бросает AuthError. Роль (admin/trainer) потом берётся из trainers.

export class AuthError extends Error {
  constructor(message) { super(message); this.code = 'unauthenticated' }
}

const b64urlToBytes = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)))

// Сравнение строк за постоянное время (служебный ключ)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}

// ── Firebase: проверка токена входа (JWT RS256) по открытым ключам Google ──
const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
let jwksCache = { keys: null, until: 0 }

async function firebaseKeys(fetchImpl) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys
  const res = await fetchImpl(FIREBASE_JWKS)
  if (!res.ok) throw new AuthError('не удалось получить ключи проверки входа')
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '')
  const body = await res.json()
  jwksCache = { keys: body.keys || [], until: Date.now() + (m ? Number(m[1]) * 1000 : 3600_000) }
  return jwksCache.keys
}

export async function verifyFirebaseToken(token, projectId, { fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new AuthError('токен входа повреждён')
  const header = b64urlJson(parts[0])
  const payload = b64urlJson(parts[1])
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('неверный алгоритм токена')
  const jwk = (await firebaseKeys(fetchImpl)).find(k => k.kid === header.kid)
  if (!jwk) throw new AuthError('ключ токена неизвестен')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]))
  if (!ok) throw new AuthError('подпись токена неверна')
  if (payload.aud !== projectId) throw new AuthError('токен для другого проекта')
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('токен выдан не Firebase')
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) throw new AuthError('срок токена истёк')
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) throw new AuthError('токен из будущего')
  if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('в токене нет пользователя')
  return payload.sub
}

// Сбросить кэш ключей (для тестов)
export function _resetJwksCache() { jwksCache = { keys: null, until: 0 } }

export const PROVIDERS = {
  async firebase(request, env, deps) {
    const h = request.headers.get('authorization') || ''
    if (!h.startsWith('Bearer ')) return null
    const uid = await verifyFirebaseToken(h.slice(7), env.FIREBASE_PROJECT_ID, deps)
    return { uid, isService: false }
  },
  async service(request, env) {
    const key = request.headers.get('x-service-key')
    if (!key) return null
    if (!env.SERVICE_KEY || !safeEqual(key, env.SERVICE_KEY)) throw new AuthError('неверный служебный ключ')
    return { uid: 'service', isService: true }
  },
  // telegram: этап 8 — одноразовая ссылка от бота → сессия. Пока не подключён.
}

// Кто пришёл. Возвращает { uid, isService } или null — никто из включённых способов не узнал запрос.
export async function identify(request, env, deps = {}) {
  const enabled = String(env.AUTH_PROVIDERS || 'firebase,service').split(',').map(s => s.trim()).filter(Boolean)
  for (const name of enabled) {
    const p = PROVIDERS[name]
    if (!p) continue
    const who = await p(request, env, deps)
    if (who) return { ...who, provider: name }
  }
  return null
}
