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
const DEV_THEME_DARK = {
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

// Светлая тема Telegram (значения из реального iOS-клиента). Нужна, чтобы светлую
// тему МОЖНО БЫЛО ПРОВЕРИТЬ локально: `npm run dev` + `?theme=light`.
// Раньше мок был только тёмный — из-за этого светлая уехала в прод сломанной.
const DEV_THEME_LIGHT = {
  accent_text_color: '#007aff',
  bg_color: '#ffffff',
  button_color: '#007aff',
  button_text_color: '#ffffff',
  destructive_text_color: '#ff3b30',
  header_bg_color: '#f7f7f7',
  hint_color: '#8e8e93',
  link_color: '#007aff',
  secondary_bg_color: '#efeff4',
  section_bg_color: '#ffffff',
  section_header_text_color: '#6d6d72',
  subtitle_text_color: '#8e8e93',
  text_color: '#000000',
  section_separator_color: '#c8c7cc',
  bottom_bar_bg_color: '#f7f7f7',
} as const

// ?theme=light в адресной строке (только dev) — переключатель темы для превью.
function devTheme() {
  const q = new URLSearchParams(window.location.search).get('theme')
  return q === 'light' ? DEV_THEME_LIGHT : DEV_THEME_DARK
}

// Подделываем окружение Telegram, когда приложение открыто просто в браузере (npm run dev).
// Специально задаём safe area top:47 / bottom:34 (как на iPhone с бровью), чтобы визуально
// проверить, что контент не залезает под бровь и под home-индикатор.
function installDevMock(): void {
  const theme = devTheme()
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
      tgWebAppThemeParams: theme,
      tgWebAppVersion: '8.4',
      tgWebAppPlatform: 'ios',
    },
    onEvent(event, next) {
      const [name] = event
      if (name === 'web_app_request_theme') {
        emitEvent('theme_changed', { theme_params: theme })
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
          // Полноэкранный режим (Bot API 8.0+). Где не поддержано (десктоп/старый клиент) —
          // тихо игнорируем. Контент под бровью закрывают safe-area инсеты в styles.css.
          try {
            if (viewport.requestFullscreen.isAvailable()) {
              viewport.requestFullscreen().catch(() => {})
            }
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

// Базисные фоны темы «Шахматный набор» — держать синхронно с --rc-bg в styles.css.
const APP_BG = { dark: '#0c0c0e', light: '#f2f2f3' } as const

/**
 * Ставит класс темы на <html> и красит «обвязку» Telegram под наш фон.
 *
 * Класс именно на <html>, а не только на AppRoot: <body> лежит ВНЕ AppRoot, и палитра,
 * объявленная внутри него, до фона страницы не доходила — в светлой теме получались
 * белые карточки и чёрный текст на тёмном фоне (баг до 2026-08-24).
 *
 * Заодно сообщаем цвет самому клиенту Telegram: иначе в полноэкранном режиме шапка и
 * низ остаются тёмными, а статус-бар держит белые часы поверх светлого фона.
 */
export function applyAppearance(a: 'light' | 'dark'): void {
  const el = document.documentElement
  el.classList.toggle('app-light', a === 'light')
  el.classList.toggle('app-dark', a === 'dark')

  const c = APP_BG[a]
  try {
    if (miniApp.setBackgroundColor.isAvailable()) miniApp.setBackgroundColor(c)
  } catch {
    /* старый клиент — не критично */
  }
  try {
    // supports.rgb — произвольный HEX (а не только ключи bg_color/secondary_bg_color),
    // появился в Bot API 6.9; на клиентах постарше шапку просто не трогаем.
    if (miniApp.setHeaderColor.isAvailable() && miniApp.setHeaderColor.supports.rgb()) {
      miniApp.setHeaderColor(c)
    }
  } catch {
    /* noop */
  }
  try {
    if (miniApp.setBottomBarColor.isAvailable()) miniApp.setBottomBarColor(c)
  } catch {
    /* noop */
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
