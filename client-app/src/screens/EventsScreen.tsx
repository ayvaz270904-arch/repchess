import { List, Section, Cell, Button, Placeholder } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { openUrl, haptic } from '../telegram/ui'

export function EventsScreen({ data }: { data: Cabinet }) {
  const s = data.schedule

  if (!s || !s.days.length) {
    return (
      <List>
        <div className="screen-title">Афиша</div>
        <Placeholder header="Скоро" description="Расписание на неделю появится здесь, как только выйдет в канале.">
          <div style={{ fontSize: 48 }}>📅</div>
        </Placeholder>
      </List>
    )
  }

  return (
    <List>
      <div className="screen-title">Афиша</div>

      {s.days.map((d) => (
        <Section key={d.date} header={d.label}>
          {d.items.map((it, i) => (
            <Cell
              key={i}
              multiline
              before={<span className="ev-time">{it.time}</span>}
              onClick={it.url ? () => { haptic(); openUrl(it.url!) } : undefined}
              after={
                it.ticketUrl ? (
                  <Button size="s" mode="bezeled" onClick={() => { haptic(); openUrl(it.ticketUrl!) }}>
                    {it.ticketLabel === 'Регистрация' ? 'Регистрация' : 'Билеты'}
                  </Button>
                ) : it.url ? (
                  <span className="chev">›</span>
                ) : undefined
              }
            >
              {it.title}
            </Cell>
          ))}
        </Section>
      ))}

      {s.note && (
        <Section>
          <Cell
            multiline
            before={<CellIcon name="gift" tone="red" />}
            onClick={s.note.url ? () => openUrl(s.note!.url!) : undefined}
            after={s.note.url ? <span className="chev">›</span> : undefined}
          >
            {s.note.text}
          </Cell>
        </Section>
      )}

      {s.postUrl && (
        <div className="screen-foot">
          <Button stretched mode="bezeled" onClick={() => openUrl(s.postUrl!)}>
            Открыть пост в канале
          </Button>
        </div>
      )}
    </List>
  )
}
