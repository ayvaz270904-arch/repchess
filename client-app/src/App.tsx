import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppRoot, Placeholder, Button } from '@telegram-apps/telegram-ui'
import '@fontsource/onest/400.css'
import '@fontsource/onest/500.css'
import '@fontsource/onest/600.css'
import '@fontsource/onest/700.css'
import '@fontsource/onest/800.css'
import { applyAppearance } from './telegram/env'
import { DHeader, DTabbar } from './ui/DHeader'
import queenWhite from './assets/mascot.svg'
import { haptic } from './telegram/ui'
import { tabIcons } from './ui/icons'
import { fetchCabinet, getCachedCabinet, clearCachedCabinet, track, ApiError } from './data'
import { errText } from './errors'
import type { Cabinet } from './types'
import { HomeScreen } from './screens/HomeScreen'
import { BookScreen } from './screens/BookScreen'
import { EventsScreen } from './screens/EventsScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { ProfileScreen } from './screens/ProfileScreen'

type Tab = 'home' | 'book' | 'events' | 'history' | 'profile'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Главная' },
  { id: 'book', label: 'Запись' },
  { id: 'events', label: 'Афиша' },
  { id: 'history', label: 'История' },
  { id: 'profile', label: 'Профиль' },
]

// Начальная вкладка из URL-hash (#book и т.п.) — удобно для deep-link и превью.
function initialTab(): Tab {
  const h = (window.location.hash || '').replace('#', '')
  return (['home', 'book', 'events', 'history', 'profile'] as string[]).includes(h) ? (h as Tab) : 'home'
}

// Плашка «сервер занятий не отвечает». Есть сохранённая копия — спокойный тон и время копии;
// копии нет (первое открытие на устройстве) — красная: показать нечего.
function FsAlert({ data, onReload }: { data: Cabinet; onReload: () => void }) {
  const stale = data.staleAt !== undefined
  let when = ''
  if (data.staleAt) {
    const d = new Date(data.staleAt)
    const p = (n: number) => String(n).padStart(2, '0')
    when = ` на ${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return (
    <div className={'fs-alert' + (stale ? ' fs-alert-soft' : '')} role="status">
      <div className="fs-alert-text">
        {stale ? (
          <>
            <b>{when ? 'Показаны данные' + when : 'Показаны последние сохранённые данные'}.</b> Сервер занятий временно не отвечает — обновим сами, как только он ответит.
            {data.newPurchases ? ' Новая покупка уже видна в истории, в балансе она появится после обновления.' : ''}
          </>
        ) : (
          <>
            <b>Не удалось загрузить занятия.</b> Сервер временно не отвечает — попробуем снова через пару минут.
          </>
        )}
      </div>
      <button className="fs-alert-btn" onClick={onReload}>Обновить</button>
    </div>
  )
}

// Слово после числа: 1 занятие, 2 занятия, 5 занятий.
function lessonsWord(n: number): string {
  const m10 = Math.abs(n) % 10
  const m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return 'занятие'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'занятия'
  return 'занятий'
}

// Имя для приветствия. В базе ФИО обычно «Фамилия Имя» («Девяткин Егор»), но бывает и
// «Имя Фамилия». Берём слово, которое НЕ похоже на фамилию по окончанию; одно слово — его.
const SURNAME_END = /(ов|ова|ев|ева|ёв|ёва|ский|ская|цкий|цкая|ой|ая|ко|ук|юк|ян|дзе|швили|их|ых)$/i
function firstName(full?: string): string {
  const w = (full || '').trim().split(/\s+/).filter((x) => /[a-zа-яё]/i.test(x))
  if (w.length <= 1) return w[0] || ''
  if (SURNAME_END.test(w[0]) && !SURNAME_END.test(w[1])) return w[1]
  if (SURNAME_END.test(w[1]) && !SURNAME_END.test(w[0])) return w[0]
  return w[1] // по умолчанию в базе фамилия идёт первой
}

function todayShort(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()] + ', ' + p(d.getDate()) + '.' + p(d.getMonth() + 1)
}

// Шапка D для каждой вкладки. Живёт здесь, а не в экранах, чтобы плашка «нет связи»
// вставала СРАЗУ ПОД шапкой, а не над ней.
function TabHeader({ tab, data }: { tab: Tab; data: Cabinet }) {
  if (tab === 'home') {
    const noData = !!data.fsError && data.staleAt === undefined
    const n = data.balanceTotal
    return (
      <DHeader tab="home" tall sticker="queen" right={todayShort()}>
        <div className="dh-hello">{firstName(data.name) || 'Привет'}, осталось</div>
        <div className="dh-big">
          <b className={n < 0 && !noData ? 'debt' : ''}>{noData ? '—' : n}</b>
          <span>{noData ? 'нет данных' : lessonsWord(n)}</span>
        </div>
        <div className="dh-sub">
          {noData ? 'баланс временно недоступен' : data.nextExpiry ? 'пакет до ' + data.nextExpiry : '\u00a0'}
        </div>
      </DHeader>
    )
  }
  if (tab === 'book') return <DHeader tab="book" title="Запись" sticker="checker" />
  if (tab === 'events') return <DHeader tab="events" title="Афиша" sticker="sun" />
  if (tab === 'history') {
    const done = data.lessonHistory.filter((l) => l.status === 'done').length
    return (
      <DHeader tab="history" title="История">
        {done > 0 && (
          <div className="dh-count">
            <b>{done}</b>
            <span>{lessonsWord(done)} пройдено</span>
          </div>
        )}
      </DHeader>
    )
  }
  return <DHeader tab="profile" title="Профиль" sticker="queen" />
}

type State = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: Cabinet }

export default function App({
  platform,
  initialAppearance,
}: {
  platform: 'ios' | 'base'
  initialAppearance: 'light' | 'dark'
}) {
  // Дизайн D (11.11.2026) — один: белый фон, чёрная шапка, фирменный красный. Тёмную тему
  // Telegram больше не повторяем: макет рассчитан на белое, а чёрного в нём и так много.
  void initialAppearance
  const appearance = 'light' as const
  const [tab, setTab] = useState<Tab>(initialTab())
  // Мгновенный рендер из кэша (если открывали раньше); свежие данные подтянет reload().
  const [state, setState] = useState<State>(() => {
    const cached = getCachedCabinet()
    return cached ? { status: 'ready', data: cached } : { status: 'loading' }
  })

  const reload = useCallback(async () => {
    try {
      const data = await fetchCabinet()
      setState({ status: 'ready', data })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'server'
      if (code === 'not_linked' || code === 'auth') {
        // личность не подтверждена (например после /reset или до привязки номера) —
        // показывать старый кэш нельзя: чистим его и показываем гейт «вернись в бота».
        clearCachedCabinet()
        setState({ status: 'error', code })
      } else {
        // транзиентная ошибка (сеть/сервер) — не рушим уже показанный экран
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', code }))
      }
    }
  }, [])

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])
  useEffect(() => {
    track('open')
    reload()
  }, [reload])

  // Пока база занятий не отвечает — сами пробуем снова: раз в 3 минуты и при возврате
  // в кабинет. Как только ответ полный, плашка исчезает и данные заменяются свежими.
  const fsDown = state.status === 'ready' && !!state.data.fsError
  useEffect(() => {
    if (!fsDown) return
    const t = window.setInterval(reload, 3 * 60000)
    const onVis = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fsDown, reload])

  function go(t: Tab) {
    haptic()
    window.scrollTo(0, 0)
    track('tab', t)
    setTab(t)
  }

  const shell = (children: ReactNode) => (
    <AppRoot className={`app-brand app-${appearance}`} platform={platform} appearance={appearance}>
      {/* Сплошная плашка над контентом в зоне брови и шапки Telegram — см. .top-cover */}
      <div className="top-cover" aria-hidden="true" />
      {children}
    </AppRoot>
  )

  if (state.status === 'loading') {
    return shell(
      <div className="d-loading" role="status" aria-label="Загрузка">
        <img src={queenWhite} alt="" aria-hidden="true" />
        <div className="d-loading-brand">
          REP CHESS <span>EDUCATION</span>
        </div>
        <div className="d-loading-txt">Расставляем фигуры…</div>
        <div className="d-loading-sq" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
      </div>,
    )
  }

  if (state.status === 'error') {
    const hint =
      state.code === 'not_linked'
        ? ' Вернитесь в бота и поделитесь номером телефона.'
        : state.code === 'auth'
          ? ' Откройте кабинет заново через бота.'
          : ''
    return shell(
      <div className="app-scroll">
        <Placeholder header="Не получилось открыть" description={errText(state.code) + hint}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
          <Button size="m" onClick={reload}>
            Повторить
          </Button>
        </Placeholder>
      </div>,
    )
  }

  const data = state.data
  const gate = !data.profile || (import.meta.env.DEV && window.location.hash === '#gate')

  if (gate) {
    return shell(
      <div className="app-scroll">
        <ProfileScreen data={data} gate onSaved={reload} />
      </div>,
    )
  }

  return shell(
    <>
      <div className="app-scroll">
        <TabHeader tab={tab} data={data} />
        {data.fsError && <FsAlert data={data} onReload={reload} />}
        {tab === 'home' && <HomeScreen data={data} onGoBook={() => go('book')} onReload={reload} />}
        {tab === 'book' && <BookScreen data={data} onReload={reload} />}
        {tab === 'events' && <EventsScreen data={data} />}
        {tab === 'history' && <HistoryScreen data={data} />}
        {tab === 'profile' && <ProfileScreen data={data} onSaved={reload} />}
      </div>

      <DTabbar tabs={TABS} icons={tabIcons} current={tab} onGo={go} />
    </>,
  )
}
