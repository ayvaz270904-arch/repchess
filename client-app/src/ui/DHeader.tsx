import type { ReactNode } from 'react'
import queenWhite from '../assets/mascot.svg'
import sun from '../assets/star-sun.png'
import checker from '../assets/star-checker.png'

// Шапка дизайна D (11.11.2026): чёрная плашка, надпись REP CHESS EDUCATION, красная линия
// «ходом коня» и полоса шахматных клеток снизу. Линия на всех экранах входит слева и выходит
// справа на ОДНОЙ высоте (y=60), а ступенька у каждой вкладки своя — при переключении
// разделов кажется, что линия продолжается с экрана на экран.
// Ступенька задаётся в процентах ширины: экран Telegram бывает от 320 до 500+ px.
const STEPS: Record<string, [number, number]> = {
  home: [31, 77],
  book: [15, 62],
  events: [51, 67],
  history: [10, 85],
  profile: [28, 44],
}

export type Sticker = 'queen' | 'sun' | 'checker' | 'none'

export function DHeader({
  tab,
  right,
  title,
  children,
  sticker = 'none',
  tall,
}: {
  tab: string
  right?: ReactNode
  title?: ReactNode
  children?: ReactNode
  sticker?: Sticker
  tall?: boolean
}) {
  const [a, b] = STEPS[tab] || STEPS.home
  return (
    <div className={'dh' + (tall ? ' dh-tall' : '')}>
      <div className="dh-black">
        <svg className="dh-line" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={`M0 60 H${a} V84 H${b} V60 H100`}
            fill="none"
            stroke="#c94a42"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="dh-top">
          <div className="dh-brand">
            REP CHESS <span>EDUCATION</span>
          </div>
          {right && <div className="dh-right">{right}</div>}
        </div>
        <div className="dh-body">
          {title && <h1 className="dh-title">{title}</h1>}
          {children}
        </div>
        {sticker === 'sun' && <img className="dh-st dh-st-sun" src={sun} alt="" aria-hidden="true" />}
        {sticker === 'checker' && <img className="dh-st dh-st-checker" src={checker} alt="" aria-hidden="true" />}
      </div>
      <div className="dh-strip" aria-hidden="true" />
      {/* Ферзь вне чёрной плашки: он заходит на полосу клеток, а плашка обрезает звёзды */}
      {sticker === 'queen' && <img className="dh-st dh-st-queen" src={queenWhite} alt="" aria-hidden="true" />}
    </div>
  )
}

// Нижний бар дизайна D (из варианта B): чёрная плавающая плашка, открытый раздел — белая «таблетка».
export function DTabbar<T extends string>({
  tabs,
  icons,
  current,
  onGo,
}: {
  tabs: { id: T; label: string }[]
  icons: Record<string, ReactNode>
  current: T
  onGo: (t: T) => void
}) {
  return (
    <nav className="dtab" aria-label="Разделы">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'dtab-item' + (t.id === current ? ' on' : '')}
          aria-current={t.id === current ? 'page' : undefined}
          onClick={() => onGo(t.id)}
        >
          {icons[t.id]}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
