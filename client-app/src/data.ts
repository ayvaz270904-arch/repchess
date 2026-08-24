import { retrieveRawInitData, popup } from '@telegram-apps/sdk-react'
import { BACKEND } from './config'
import type { Cabinet, IndivSlots, Profile } from './types'
import { adapt, type RawCabinet, type RawSlots } from './adapt'
import { MOCK_CABINET } from './mock/cabinet'
import { MOCK_SLOTS } from './mock/slots'

// В dev подпись initData поддельная — реальный GAS вернул бы auth. Поэтому в dev отдаём мок,
// в проде (внутри Telegram) — реальные запросы к тому же бэкенду, что и старый client.html.
const DEV = import.meta.env.DEV

export class ApiError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export type ActionResult = { ok: true } | { ok: false; error?: string; need?: string }
export type SaveResult = { ok: true; emailPending?: boolean; promoGranted?: boolean } | { ok: false; error?: string }
export type CertResult = { ok: true; label?: string } | { ok: false; error?: string }

function rawInitData(): string {
  try {
    return retrieveRawInitData() || ''
  } catch {
    return ''
  }
}

async function api<T = unknown>(params: string): Promise<T> {
  const url = BACKEND + '?' + params + '&initData=' + encodeURIComponent(rawInitData()) + '&t=' + Date.now()
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new ApiError('network')
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('server')
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Кэш кабинета (stale-while-revalidate) ──
// GAS отвечает медленно (~2с+ оверхед Apps Script). Чтобы повторное открытие было
// мгновенным, показываем последний известный кабинет из localStorage, а свежий грузим в фоне.
// Ключ по id пользователя — чтобы на общем устройстве не показать чужой баланс.
function userKey(): string {
  try {
    const u = new URLSearchParams(rawInitData()).get('user')
    if (u) {
      const id = JSON.parse(u).id
      if (id) return String(id)
    }
  } catch {
    /* noop */
  }
  return 'anon'
}

// Фото профиля из Telegram (если пользователь его открыл боту) — иначе '' и покажем маскот.
export function userPhoto(): string {
  try {
    const u = new URLSearchParams(rawInitData()).get('user')
    if (u) {
      const p = JSON.parse(u).photo_url
      if (p) return String(p)
    }
  } catch {
    /* noop */
  }
  return ''
}

function cabinetCacheKey(): string {
  return 'rc_cabinet_v1_' + userKey()
}

export function getCachedCabinet(): Cabinet | null {
  try {
    const s = localStorage.getItem(cabinetCacheKey())
    return s ? (JSON.parse(s) as Cabinet) : null
  } catch {
    return null
  }
}

function saveCabinetCache(c: Cabinet): void {
  try {
    localStorage.setItem(cabinetCacheKey(), JSON.stringify(c))
  } catch {
    /* приватный режим / переполнение — не критично */
  }
}

// ── Кэш индив-слотов (stale-while-revalidate) ──
// Расписание тренера грузится с GAS при каждом открытии вкладки «Запись». Чтобы не мигать
// спиннером на каждом свапе, показываем последние известные слоты из localStorage, а свежие
// тянем в фоне. Устаревший слот при записи отсеет бэкенд (slot_taken/slot_gone → перезагрузка).
function slotsCacheKey(): string {
  return 'rc_slots_v1_' + userKey()
}

export function getCachedSlots(): IndivSlots | null {
  try {
    const s = localStorage.getItem(slotsCacheKey())
    return s ? (JSON.parse(s) as IndivSlots) : null
  } catch {
    return null
  }
}

function saveSlotsCache(s: IndivSlots): void {
  try {
    localStorage.setItem(slotsCacheKey(), JSON.stringify(s))
  } catch {
    /* noop */
  }
}

// Стереть кэш кабинета и слотов (например при not_linked/auth — личность не подтверждена).
export function clearCachedCabinet(): void {
  try {
    localStorage.removeItem(cabinetCacheKey())
    localStorage.removeItem(slotsCacheKey())
  } catch {
    /* noop */
  }
}

export async function fetchCabinet(): Promise<Cabinet> {
  let c: Cabinet
  if (DEV) {
    await delay(350)
    c = MOCK_CABINET
  } else {
    const raw = await api<RawCabinet>('')
    if (!raw.ok) throw new ApiError(raw.error || 'server')
    c = adapt(raw)
  }
  saveCabinetCache(c)
  return c
}

export async function fetchSlots(): Promise<IndivSlots> {
  let s: IndivSlots
  if (DEV) {
    await delay(250)
    s = MOCK_SLOTS
  } else {
    const raw = await api<RawSlots>('action=indivSlots')
    if (!raw.ok) throw new ApiError(raw.error || 'server')
    s = {
      trainer: raw.trainer,
      canOffline: raw.canOffline,
      canOnline: raw.canOnline,
      remaining: raw.remaining,
      days: raw.days,
    }
  }
  saveSlotsCache(s)
  return s
}

/**
 * Обёртка для действий кабинета: НИКОГДА не бросает исключение.
 *
 * api() бросает ApiError при обрыве сети или нечитаемом ответе, а обработчики нажатий —
 * обычные async-функции без catch. Из-за этого исключение оставляло экран навсегда
 * застывшим на «Записываю…»/«Отменяю…»: подпись не менялась, даже если действие на
 * сервере фактически прошло (GAS медленный — ответ мог не доехать после успешной записи).
 *
 * Превращаем такой обрыв в обычный неуспешный результат, чтобы вызывающий код прошёл
 * по своей же ветке ошибки — и обязательно перечитал состояние с сервера.
 */
export async function safeAction<T extends { ok: boolean; error?: string }>(
  p: Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await p
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : 'server' }
  }
}

export async function bookIndiv(date: string, time: string, format: 'offline' | 'online'): Promise<ActionResult> {
  if (DEV) {
    await delay(400)
    return { ok: true }
  }
  return api('action=bookIndiv&date=' + encodeURIComponent(date) + '&time=' + encodeURIComponent(time) + '&format=' + format)
}

export async function cancelIndiv(lessonId: string): Promise<ActionResult> {
  if (DEV) {
    await delay(400)
    return { ok: true }
  }
  return api('action=cancelIndiv&lessonId=' + encodeURIComponent(lessonId))
}

export async function joinGroup(id: string): Promise<ActionResult> {
  if (DEV) {
    await delay(400)
    return { ok: true }
  }
  return api('action=joinGroup&groupId=' + encodeURIComponent(id))
}

export async function leaveGroup(id: string): Promise<ActionResult> {
  if (DEV) {
    await delay(400)
    return { ok: true }
  }
  return api('action=leaveGroup&groupId=' + encodeURIComponent(id))
}

export async function saveProfile(p: Profile): Promise<SaveResult> {
  if (DEV) {
    await delay(400)
    return { ok: true }
  }
  const q =
    'action=saveProfile' +
    '&fio=' + encodeURIComponent(p.fio || '') +
    '&pemail=' + encodeURIComponent(p.email || '') +
    '&bdate=' + encodeURIComponent(p.birthdate || '') +
    '&gender=' + encodeURIComponent(p.gender || '') +
    '&city=' + encodeURIComponent(p.city || '') +
    '&level=' + encodeURIComponent(p.level || '')
  return api(q)
}

export async function redeemCert(code: string): Promise<CertResult> {
  if (DEV) {
    await delay(400)
    return { ok: true, label: 'Групп. онлайн ×1' }
  }
  return api('action=redeemCert&code=' + encodeURIComponent(code))
}

// Трекинг — fire-and-forget, только в проде.
export function track(event: string, detail?: string): void {
  if (DEV) return
  try {
    let u = BACKEND + '?action=track&event=' + encodeURIComponent(event)
    if (detail) u += '&detail=' + encodeURIComponent(String(detail).slice(0, 80))
    u += '&initData=' + encodeURIComponent(rawInitData()) + '&t=' + Date.now()
    fetch(u).catch(() => {})
  } catch {
    /* noop */
  }
}

// Нативное подтверждение Telegram; вне клиента — window.confirm.
export async function confirmDialog(message: string): Promise<boolean> {
  try {
    if (popup.open.isAvailable()) {
      const pressed = await popup.open({
        message,
        buttons: [
          { id: 'ok', type: 'default', text: 'Да' },
          { id: 'cancel', type: 'cancel' },
        ],
      })
      return pressed === 'ok'
    }
  } catch {
    /* упадём в window.confirm */
  }
  try {
    return window.confirm(message)
  } catch {
    return true
  }
}
