import { List, Section, Cell } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { MascotEmpty } from '../ui/MascotEmpty'

function money(n: number): string {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
}

export function HistoryScreen({ data }: { data: Cabinet }) {
  const done = data.lessonHistory.filter((h) => h.status === 'done').length
  const absent = data.lessonHistory.filter((h) => h.status === 'absent').length
  const purchases = data.purchaseHistory.length

  return (
    <List>
      <div className="screen-title">История</div>

      {data.lessonHistory.length > 0 && (
        <div className="stat-strip">
          <div className="stat-card">
            <div className="stat-num">{done}</div>
            <div className="stat-lbl">Пройдено</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{absent}</div>
            <div className="stat-lbl">Пропущено</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{purchases}</div>
            <div className="stat-lbl">Покупок</div>
          </div>
        </div>
      )}

      <div className="home-sec-title">Занятия</div>
      {data.lessonHistory.length ? (
        <Section>
          {data.lessonHistory.map((h) => (
            <Cell
              key={h.id}
              multiline
              before={
                <CellIcon
                  name={h.status === 'absent' ? 'clock' : 'check'}
                  tone={h.status === 'absent' ? 'red' : 'neutral'}
                />
              }
              subtitle={h.notes}
              after={
                <span className={'pill ' + (h.status === 'absent' ? 'pill-warn' : 'pill-ok')}>
                  {h.status === 'absent' ? 'пропуск' : 'проведено'}
                </span>
              }
            >
              {h.date}
              {h.time ? ` · ${h.time}` : ''} · {h.type}
            </Cell>
          ))}
        </Section>
      ) : (
        <MascotEmpty text="Занятий пока не было — запишись на первое!" />
      )}

      <div className="home-sec-title">Покупки</div>
      {data.purchaseHistory.length ? (
        <Section>
          {data.purchaseHistory.map((p) => (
            <Cell
              key={p.id}
              multiline
              before={<CellIcon name="card" />}
              subtitle={p.date + (p.expired ? ' · истёк' : '')}
              after={<span className="cell-price">{money(p.price)}</span>}
            >
              {p.label}
            </Cell>
          ))}
        </Section>
      ) : (
        <MascotEmpty text="Покупок пока нет" />
      )}
    </List>
  )
}
