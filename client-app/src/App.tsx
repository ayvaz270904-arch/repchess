import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppRoot, Tabbar, Spinner, Placeholder, Button } from '@telegram-apps/telegram-ui'
import { subscribeAppearance, applyAppearance } from './telegram/env'
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

type State = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: Cabinet }

export default function App({
  platform,
  initialAppearance,
}: {
  platform: 'ios' | 'base'
  initialAppearance: 'light' | 'dark'
}) {
  const [appearance, setAppearance] = useState<'light' | 'dark'>(initialAppearance)
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
    subscribeAppearance(setAppearance)
  }, [])
  // Пользователь переключил тему прямо в Telegram — перекрашиваем <html> и обвязку клиента.
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
      <div className="center-screen">
        <Spinner size="l" />
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
        {data.fsError && <FsAlert data={data} onReload={reload} />}
        {tab === 'home' && <HomeScreen data={data} onGoBook={() => go('book')} onReload={reload} />}
        {tab === 'book' && <BookScreen data={data} onReload={reload} />}
        {tab === 'events' && <EventsScreen data={data} />}
        {tab === 'history' && <HistoryScreen data={data} />}
        {tab === 'profile' && <ProfileScreen data={data} onSaved={reload} />}
      </div>

      <Tabbar className="app-tabbar">
        {TABS.map((t) => (
          <Tabbar.Item key={t.id} selected={tab === t.id} text={t.label} onClick={() => go(t.id)}>
            {tabIcons[t.id]}
          </Tabbar.Item>
        ))}
      </Tabbar>
    </>,
  )
}
