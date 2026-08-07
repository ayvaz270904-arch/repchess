import { List, Section, Cell } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'

function money(n: number): string {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
}

export function HistoryScreen({ data }: { data: Cabinet }) {
  return (
    <List>
      <div className="screen-title">История</div>

      <div className="home-sec-title">Занятия</div>
      <Section>
        {data.lessonHistory.length ? (
          data.lessonHistory.map((h) => (
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
          ))
        ) : (
          <Cell>занятий пока не было</Cell>
        )}
      </Section>

      <div className="home-sec-title">Покупки</div>
      <Section>
        {data.purchaseHistory.length ? (
          data.purchaseHistory.map((p) => (
            <Cell
              key={p.id}
              multiline
              before={<CellIcon name="card" />}
              subtitle={p.date + (p.expired ? ' · истёк' : '')}
              after={<span className="cell-price">{money(p.price)}</span>}
            >
              {p.label}
            </Cell>
          ))
        ) : (
          <Cell>покупок пока нет</Cell>
        )}
      </Section>
    </List>
  )
}
