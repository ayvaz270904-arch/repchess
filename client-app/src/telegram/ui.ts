import { hapticFeedback, openLink, openTelegramLink } from '@telegram-apps/sdk-react'

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'

export function haptic(style: ImpactStyle = 'light'): void {
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred(style)
  } catch {
    /* вне Telegram — тихо */
  }
}

export function selectionHaptic(): void {
  try {
    if (hapticFeedback.selectionChanged.isAvailable()) hapticFeedback.selectionChanged()
  } catch {
    /* noop */
  }
}

// t.me — внутри Telegram, остальное — во внешнем браузере; вне клиента — window.open.
export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  try {
    if (/^https:\/\/t\.me\//i.test(url) && openTelegramLink.isAvailable()) {
      openTelegramLink(url)
      return
    }
    if (openLink.isAvailable()) {
      openLink(url)
      return
    }
  } catch {
    /* упадём в window.open ниже */
  }
  try {
    window.open(url, '_blank')
  } catch {
    /* noop */
  }
}

// Поделиться реферальной ссылкой: ссылку кладём последней строкой текста
// (Telegram показывает url-параметр первым, а нам нужно наоборот).
export function shareReferral(link: string): void {
  const text = 'Занимаюсь шахматами в Rep Chess Education — присоединяйся! Открой кабинет по ссылке:\n' + link
  const share = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text)
  openUrl(share)
}
