import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@telegram-apps/telegram-ui/dist/styles.css'
import './styles.css'
import { bootstrapTelegram, getPlatform, getAppearance, applyAppearance } from './telegram/env'
import { ErrorBoundary } from './ErrorBoundary'
import App from './App'
import { trackError } from './data'

// Ошибки скрипта вне экранов (обработчики, промисы) — в события; сам кабинет не трогаем
window.addEventListener('error', (e) => trackError('js', (e && e.message) || 'error'))
window.addEventListener('unhandledrejection', (e) => {
  const r = e && (e as PromiseRejectionEvent).reason
  trackError('js', 'promise: ' + ((r && (r.message || r.code)) || String(r)))
})

// Инициализируем Telegram SDK (и dev-мок вне клиента) ДО первого рендера,
// затем считываем платформу/тему как значения и передаём в App пропсами.
bootstrapTelegram()

// Тему на <html> ставим ДО рендера — иначе первый кадр рисуется чужой палитрой.
const appearance = getAppearance()
applyAppearance(appearance)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App platform={getPlatform()} initialAppearance={appearance} />
    </ErrorBoundary>
  </StrictMode>,
)
