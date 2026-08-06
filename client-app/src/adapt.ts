import type { Cabinet, GroupLesson, IconName, Schedule } from './types'
import { BUY_LINKS } from './config'

// ── Сырой ответ GAS (как строит bot.gs doGet) ──
export interface RawCabinet {
  ok: boolean
  error?: string
  name?: string
  email?: string
  purchased?: number
  used?: number
  remaining?: number
  byCat?: Record<string, number>
  nextExpiry?: string | null
  purchaseHistory?: { date: string; label: string; price: number; expired?: boolean }[]
  lessonHistory?: {
    id?: string
    date: string
    time?: string
    trainerName?: string
    type: string
    status: string
    notes?: string
  }[]
  upcoming?: {
    id?: string
    date: string
    time?: string
    trainerName?: string
    type: string
    cancellable?: boolean
  }[]
  openGroups?: Omit<GroupLesson, 'canJoin'>[]
  schedule?: { days: Schedule['days']; note?: { text: string; url?: string } | null; postUrl?: string; imgUrl?: string } | null
  profile?: {
    fio?: string
    email?: string
    age?: string | number
    gender?: string
    city?: string
    level?: string
  } | null
  promoAvailable?: boolean
  emailPending?: boolean
  refLink?: string
}

export interface RawSlots {
  ok: boolean
  error?: string
  trainer?: string
  canOffline: boolean
  canOnline: boolean
  remaining: number
  days: { date: string; dow: string; label: string; slots: { time: string; format: 'both' | 'offline' | 'online' }[] }[]
}

const CATS: { key: string; group: 'indiv' | 'group'; cat: string; title: string; icon: IconName; color: string }[] = [
  { key: 'io', group: 'indiv', cat: 'Индив. офлайн', title: 'Офлайн', icon: 'pin', color: '#2ea6ff' },
  { key: 'in', group: 'indiv', cat: 'Индив. онлайн', title: 'Онлайн', icon: 'globe', color: '#4dc27a' },
  { key: 'go', group: 'group', cat: 'Групп. офлайн', title: 'Офлайн', icon: 'pin', color: '#e8a13a' },
  { key: 'gn', group: 'group', cat: 'Групп. онлайн', title: 'Онлайн', icon: 'globe', color: '#a98bff' },
]

export function adapt(raw: RawCabinet): Cabinet {
  const byCat = raw.byCat || {}
  const remaining = raw.remaining ?? 0
  const nextExpiry = raw.nextExpiry || undefined

  const categories = CATS.map((c) => ({
    key: c.key,
    icon: c.icon,
    color: c.color,
    title: c.title,
    group: c.group,
    count: byCat[c.cat] || 0,
    until: nextExpiry ? `до ${nextExpiry}` : undefined,
  }))

  const canJoin = (fmt: 'online' | 'offline') =>
    (byCat['Групп. ' + (fmt === 'online' ? 'онлайн' : 'офлайн')] || 0) > 0 && remaining > 0

  const openGroups: GroupLesson[] = (raw.openGroups || []).map((g) => ({ ...g, canJoin: canJoin(g.format) }))

  return {
    name: raw.name || 'ученик',
    role: 'ученик',
    balanceTotal: remaining,
    nextExpiry,
    categories,
    upcoming: (raw.upcoming || []).map((u, i) => ({
      id: u.id || 'u' + i,
      date: u.date,
      time: u.time,
      type: u.type,
      trainerName: u.trainerName,
      cancellable: u.cancellable,
    })),
    openGroups,
    schedule: raw.schedule ? { days: raw.schedule.days, note: raw.schedule.note || undefined, postUrl: raw.schedule.postUrl } : undefined,
    lessonHistory: (raw.lessonHistory || []).map((h, i) => ({
      id: h.id || 'h' + i,
      date: h.date,
      time: h.time,
      type: h.type,
      status: h.status === 'absent' ? 'absent' : 'done',
      notes: h.notes,
    })),
    purchaseHistory: (raw.purchaseHistory || []).map((p, i) => ({
      id: 'p' + i,
      date: p.date,
      label: p.label,
      price: p.price,
      expired: p.expired,
    })),
    profile: raw.profile
      ? {
          fio: raw.profile.fio,
          email: raw.profile.email,
          age: raw.profile.age != null ? String(raw.profile.age) : '',
          gender: raw.profile.gender === 'м' || raw.profile.gender === 'ж' ? raw.profile.gender : '',
          city: raw.profile.city,
          level: raw.profile.level,
        }
      : undefined,
    email: raw.email,
    emailPending: !!raw.emailPending,
    refLink: raw.refLink,
    buyLinks: BUY_LINKS,
    promoAvailable: !!raw.promoAvailable,
  }
}
