import { List, Section, Cell, LargeTitle } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'

function money(n: number): string {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
}

export function HistoryScreen({ data }: { data: Cabinet }) {
  return (
    <List>
      <div className="screen-head">
        <LargeTitle weight="1">История</LargeTitle>
      </div>

      <Section header="Занятия">
        {data.lessonHistory.length ? (
          data.lessonHistory.map((h) => (
            <Cell
              key={h.id}
              multiline
              before={
                <CellIcon
                  name={h.status === 'absent' ? 'clock' : 'check'}
                  color={h.status === 'absent' ? '#8a8f9c' : '#22c55e'}
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

      <Section header="Покупки">
        {data.purchaseHistory.length ? (
          data.purchaseHistory.map((p) => (
            <Cell
              key={p.id}
              multiline
              before={<CellIcon name="card" color={p.expired ? '#8a8f9c' : '#2ea6ff'} />}
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
