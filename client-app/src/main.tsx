import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@telegram-apps/telegram-ui/dist/styles.css'
import './styles.css'
import { bootstrapTelegram, getPlatform, getAppearance } from './telegram/env'
import { ErrorBoundary } from './ErrorBoundary'
import App from './App'

// Инициализируем Telegram SDK (и dev-мок вне клиента) ДО первого рендера,
// затем считываем платформу/тему как значения и передаём в App пропсами.
bootstrapTelegram()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App platform={getPlatform()} initialAppearance={getAppearance()} />
    </ErrorBoundary>
  </StrictMode>,
)
