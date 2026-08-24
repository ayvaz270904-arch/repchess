import { List, Section, Cell, Button } from '@telegram-apps/telegram-ui'
import type { Cabinet, IconName, ScheduleItem } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { MascotEmpty } from '../ui/MascotEmpty'
import { openUrl, haptic } from '../telegram/ui'

// Иконка категории события по ключевым словам в названии
function eventIcon(title: string): IconName {
  const t = (title || '').toLowerCase()
  if (/турнир|блиц|рапид|матч/.test(t)) return 'ticket'
  if (/лекц|разбор|вебинар|онлайн/.test(t)) return 'globe'
  if (/групп/.test(t)) return 'users'
  if (/индивид/.test(t)) return 'user'
  return 'calendar'
}

export function EventsScreen({ data }: { data: Cabinet }) {
  const s = data.schedule
  // Сегодняшняя дата в формате YYYY-MM-DD по МСК — совпадает с d.date из расписания
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())

  if (!s || !s.days.length) {
    return (
      <List>
        <div className="screen-title">Афиша</div>
        <MascotEmpty text="Расписание на неделю появится здесь, как только выйдет в канале." />
      </List>
    )
  }

  // Главное событие для баннера — первое с регистрацией/билетом
  let featured: ScheduleItem | null = null
  let featuredLabel = ''
  for (const d of s.days) {
    const it = d.items.find((x) => x.ticketUrl)
    if (it) {
      featured = it
      featuredLabel = d.label
      break
    }
  }

  return (
    <List>
      <div className="screen-title">Афиша</div>

      {featured && (
        <div className="ev-banner">
          <span className="ev-banner-chip">
            {featuredLabel} · {featured.time}
          </span>
          <div className="ev-banner-title">{featured.title}</div>
          <button className="ev-banner-btn" onClick={() => { haptic(); openUrl(featured!.ticketUrl!) }}>
            {featured.ticketLabel || 'Регистрация'}
          </button>
        </div>
      )}

      {s.days.map((d) => {
        const isToday = d.date === today
        const items = d.items.filter((it) => it !== featured)
        if (!items.length) return null
        return (
          <Section
            key={d.date}
            header={isToday ? <span>{d.label} <span className="ev-badge-today">сегодня</span></span> : d.label}
          >
            {items.map((it, i) => (
              <Cell
                key={i}
                multiline
                before={<CellIcon name={eventIcon(it.title)} tone={isToday ? 'red' : 'neutral'} />}
                onClick={it.url ? () => { haptic(); openUrl(it.url!) } : undefined}
                readOnly={!it.url}
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
                <span className={'ev-time' + (isToday ? ' ev-today' : '')}>{it.time}</span> {it.title}
              </Cell>
            ))}
          </Section>
        )
      })}

      {s.note && (
        <Section>
          <Cell
            multiline
            before={<CellIcon name="gift" tone="red" />}
            onClick={s.note.url ? () => openUrl(s.note!.url!) : undefined}
            readOnly={!s.note.url}
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
