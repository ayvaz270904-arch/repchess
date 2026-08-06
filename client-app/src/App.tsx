import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppRoot, Tabbar, Spinner, Placeholder, Button } from '@telegram-apps/telegram-ui'
import { subscribeAppearance } from './telegram/env'
import { haptic } from './telegram/ui'
import { tabIcons } from './ui/icons'
import { fetchCabinet, track, ApiError } from './data'
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
  const [state, setState] = useState<State>({ status: 'loading' })

  const reload = useCallback(async () => {
    try {
      const data = await fetchCabinet()
      setState({ status: 'ready', data })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'server'
      // фоновое обновление после действия не должно рушить уже показанный экран
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', code }))
    }
  }, [])

  useEffect(() => {
    subscribeAppearance(setAppearance)
  }, [])
  useEffect(() => {
    track('open')
    reload()
  }, [reload])

  function go(t: Tab) {
    haptic()
    window.scrollTo(0, 0)
    track('tab', t)
    setTab(t)
  }

  const shell = (children: ReactNode) => (
    <AppRoot className="app-brand" platform={platform} appearance={appearance}>
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
