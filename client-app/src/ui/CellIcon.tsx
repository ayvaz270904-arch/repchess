import type { ReactElement } from 'react'
import type { IconName } from '../types'

// Монохромные белые глифы на цветном квадрате — как иконки в настройках iOS.
const PATHS: Record<IconName, ReactElement> = {
  pin: (
    <>
      <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8M12 3.6c2.5 2.4 2.5 14.4 0 16.8M12 3.6c-2.5 2.4-2.5 14.4 0 16.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.7" y="4.7" width="16.6" height="15.6" rx="2.4" />
      <path d="M3.7 9.2h16.6M8 3v3.4M16 3v3.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.8 19c0-2.9 2.4-4.8 5.2-4.8s5.2 1.9 5.2 4.8" />
    </>
  ),
  check: <path d="M20 6.5 9.2 17.3 4 12.1" />,
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.7h18" />
    </>
  ),
  ticket: (
    <>
      <path d="M12.6 3.7H6A2.4 2.4 0 0 0 3.6 6.1v6.5a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.6-5.6a2 2 0 0 0 0-2.8l-7-7a2 2 0 0 0-1.4-.6z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="1.6" />
      <path d="M4 13.2h16M12 9v11M12 9S10.6 4.7 8.3 5.3C6.4 5.9 7.1 9 9 9zM12 9s1.4-4.3 3.7-3.7C17.6 5.9 16.9 9 15 9z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6V12l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.6 19.4c0-3.3 2.7-5.4 6.4-5.4s6.4 2.1 6.4 5.4" />
    </>
  ),
}

export function CellIcon({ name, tone = 'neutral' }: { name: IconName; tone?: 'neutral' | 'red' }) {
  return (
    <span className={'cell-icon' + (tone === 'red' ? ' cell-icon-red' : '')}>
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[name]}
      </svg>
    </span>
  )
}
