export type IconName =
  | 'pin'
  | 'globe'
  | 'calendar'
  | 'users'
  | 'check'
  | 'card'
  | 'ticket'
  | 'gift'
  | 'clock'
  | 'user'

export interface BalanceCategory {
  key: string
  icon: IconName
  color: string
  title: string
  until?: string
  count: number
  group: 'indiv' | 'group'
}

export interface UpcomingLesson {
  id: string
  date: string
  time?: string
  type: string
  trainerName?: string
  cancellable?: boolean
}

// ── Запись: индивидуальные слоты ──
export type SlotFormat = 'both' | 'offline' | 'online'
export interface Slot {
  time: string
  format: SlotFormat
}
export interface SlotDay {
  date: string
  dow: string
  label: string
  slots: Slot[]
}
export interface IndivSlots {
  trainer?: string
  canOffline: boolean
  canOnline: boolean
  remaining: number
  days: SlotDay[]
}

// ── Запись: групповые занятия ──
export interface GroupLesson {
  id: string
  date: string
  time?: string
  format: 'online' | 'offline'
  venue?: string
  trainerName?: string
  count: number
  max?: number
  joined?: boolean
  regOpen?: boolean
  opensAt?: string
  hasLinks?: boolean
  linksOpen?: boolean
  voiceUrl?: string
  studioUrl?: string
  canJoin?: boolean
}

// ── Афиша: расписание недели ──
export interface ScheduleItem {
  time: string
  title: string
  url?: string
  ticketUrl?: string
  ticketLabel?: string
}
export interface ScheduleDay {
  date: string
  label: string
  items: ScheduleItem[]
}
export interface Schedule {
  days: ScheduleDay[]
  note?: { text: string; url?: string }
  postUrl?: string
}

// ── История ──
export interface LessonHist {
  id: string
  date: string
  time?: string
  type: string
  status: 'done' | 'absent'
  notes?: string
}
export interface PurchaseHist {
  id: string
  date: string
  label: string
  price: number
  expired?: boolean
}

// ── Профиль ──
export interface Profile {
  fio?: string
  email?: string
  age?: string
  birthdate?: string // дд.мм.гггг (у новых анкет; у старых остаётся age)
  gender?: '' | 'м' | 'ж'
  city?: string
  level?: string
}

export interface Cabinet {
  name: string
  role: string
  balanceTotal: number
  nextExpiry?: string
  categories: BalanceCategory[]
  upcoming: UpcomingLesson[]
  openGroups: GroupLesson[]
  schedule?: Schedule
  lessonHistory: LessonHist[]
  purchaseHistory: PurchaseHist[]
  profile?: Profile
  email?: string
  emailPending?: boolean
  refLink?: string
  buyLinks: [string, string][]
  promoAvailable?: boolean
}
