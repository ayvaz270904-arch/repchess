// ── Инициализация Telegram Mini Apps SDK + безопасные зоны + dev-мок ──
// Вся «магия» брови/home-индикатора: viewport.bindCssVars() публикует CSS-переменные
//   --tg-viewport-safe-area-inset-*          (железо устройства: бровь, Dynamic Island, скругления)
//   --tg-viewport-content-safe-area-inset-*  (отступ от интерфейса самого Telegram, напр. его шапка)
// Мы комбинируем их с env(safe-area-inset-*) в styles.css.
import {
  init as initSDK,
  mockTelegramEnv,
  emitEvent,
  retrieveLaunchParams,
  miniApp,
  themeParams,
  viewport,
  backButton,
  initData,
} from '@telegram-apps/sdk-react'

// Тёмная тема Telegram — для локального превью вне клиента (в реальном Telegram придёт своя).
const DEV_THEME = {
  accent_text_color: '#6ab3f3',
  bg_color: '#17212b',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  destructive_text_color: '#ec3942',
  header_bg_color: '#17212b',
  hint_color: '#708499',
  link_color: '#6ab3f3',
  secondary_bg_color: '#232e3c',
  section_bg_color: '#17212b',
  section_header_text_color: '#6ab3f3',
  subtitle_text_color: '#708499',
  text_color: '#f5f5f5',
  section_separator_color: '#0e1621',
  bottom_bar_bg_color: '#17212b',
} as const

// Подделываем окружение Telegram, когда приложение открыто просто в браузере (npm run dev).
// Специально задаём safe area top:47 / bottom:34 (как на iPhone с бровью), чтобы визуально
// проверить, что контент не залезает под бровь и под home-индикатор.
function installDevMock(): void {
  const initDataRaw = new URLSearchParams([
    [
      'user',
      JSON.stringify({
        id: 6666696537,
        first_name: 'Александр',
        last_name: '',
        username: 'sasha_chess',
        language_code: 'ru',
        is_premium: true,
      }),
    ],
    ['auth_date', Math.floor(Date.now() / 1000).toString()],
    ['signature', 'dev-signature'],
    ['hash', 'dev-hash'],
  ]).toString()

  const safeArea = { top: 47, bottom: 34, left: 0, right: 0 }
  const contentSafeArea = { top: 0, bottom: 0, left: 0, right: 0 }

  mockTelegramEnv({
    launchParams: {
      tgWebAppData: initDataRaw,
      tgWebAppThemeParams: DEV_THEME,
      tgWebAppVersion: '8.4',
      tgWebAppPlatform: 'ios',
    },
    onEvent(event, next) {
      const [name] = event
      if (name === 'web_app_request_theme') {
        emitEvent('theme_changed', { theme_params: DEV_THEME })
        return
      }
      if (name === 'web_app_request_viewport') {
        emitEvent('viewport_changed', {
          height: window.innerHeight,
          width: window.innerWidth,
          is_expanded: true,
          is_state_stable: true,
        })
        return
      }
      if (name === 'web_app_request_safe_area') {
        emitEvent('safe_area_changed', safeArea)
        return
      }
      if (name === 'web_app_request_content_safe_area') {
        emitEvent('content_safe_area_changed', contentSafeArea)
        return
      }
      next()
    },
  })
}

export function bootstrapTelegram(): void {
  // В dev-режиме, если мы не внутри Telegram — включаем мок, чтобы приложение отрисовалось.
  if (import.meta.env.DEV) {
    let inTelegram = true
    try {
      retrieveLaunchParams()
    } catch {
      inTelegram = false
    }
    if (!inTelegram) installDevMock()
  }

  try {
    initSDK()
  } catch {
    // Не Telegram и мок не поставлен (напр. prod вне клиента) — тихо выходим.
    return
  }

  try {
    initData.restore()
  } catch {
    /* нет init data — гость/ошибка, приложение обработает выше */
  }

  // Mini App + тема (синхронно, где возможно) → CSS-переменные --tg-*
  try {
    if (miniApp.mountSync.isAvailable()) {
      miniApp.mountSync()
      miniApp.bindCssVars()
    }
  } catch {
    /* noop */
  }
  try {
    if (themeParams.mountSync.isAvailable()) {
      themeParams.mountSync()
      themeParams.bindCssVars()
    }
  } catch {
    /* noop */
  }

  // Viewport (асинхронно) → безопасные зоны в CSS-переменные
  try {
    if (viewport.mount.isAvailable()) {
      viewport
        .mount()
        .then(() => {
          try {
            viewport.bindCssVars()
          } catch {
            /* noop */
          }
        })
        .catch(() => {})
    }
  } catch {
    /* noop */
  }

  try {
    if (backButton.mount.isAvailable()) backButton.mount()
  } catch {
    /* noop */
  }
}

// ── Платформа и тема: читаем ЗНАЧЕНИЯ (не хуками), чтобы рендер App не зависел от
// порядка/числа SDK-хуков (иначе React ругается «Rendered more hooks…» из-за таймингов). ──
export function getPlatform(): 'ios' | 'base' {
  try {
    const lp = retrieveLaunchParams(true)
    const p = lp.tgWebAppPlatform
    return p === 'ios' || p === 'macos' ? 'ios' : 'base'
  } catch {
    return 'base'
  }
}

export function getAppearance(): 'light' | 'dark' {
  try {
    return themeParams.isDark() ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

// Подписка на смену темы Telegram (юзер переключил светлую/тёмную во время сессии).
export function subscribeAppearance(cb: (a: 'light' | 'dark') => void): () => void {
  try {
    return themeParams.isDark.sub(() => cb(themeParams.isDark() ? 'dark' : 'light'))
  } catch {
    return () => {}
  }
}
