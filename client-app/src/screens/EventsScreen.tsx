import { List, Section, Cell, Button } from '@telegram-apps/telegram-ui'
import type { Cabinet, IconName, FeaturedEvent, ScheduleDay } from '../types'
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

// «29 августа, сб» → «сб 29» для чипа в полоске дней
function chipLabel(day: ScheduleDay, isToday: boolean): string {
  if (isToday) return 'Сегодня'
  const parts = (day.label || '').split(',')
  const num = (parts[0] || '').trim().split(' ')[0]
  const dow = (parts[1] || '').trim()
  return dow ? dow + ' ' + num : day.label
}

// Запасной выбор главного события, если бот ещё старый и поле featured не прислал.
// Здесь нельзя брать «первое с билетами» без оглядки на дату — именно из-за этого
// в баннере неделями висел понедельничный турнир. Берём ближайшее непрошедшее.
function pickFeatured(days: ScheduleDay[], today: string): FeaturedEvent | null {
  let fallback: FeaturedEvent | null = null
  for (const d of days) {
    if (d.date < today) continue
    for (const it of d.items) {
      const out: FeaturedEvent = { ...it, date: d.date, label: d.label }
      if (it.ticketUrl) return out
      if (!fallback) fallback = out
    }
  }
  return fallback
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

  // Главное событие считает бот (можно закрепить вручную в /admin). Локальный выбор —
  // только страховка на время, пока не задеплоен новый бот.
  const featured = s.featured || pickFeatured(s.days, today)

  // Полоска дней — якоря по всей неделе. Прошедшие дни из расписания НЕ выкидываем:
  // владелец просил видеть неделю целиком, они просто приглушены.
  function goToDay(date: string) {
    haptic()
    document.getElementById('evday-' + date)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <List>
      <div className="screen-title">Афиша</div>

      <div className="ev-strip">
        {s.days.map((d) => {
          const isToday = d.date === today
          const past = d.date < today
          return (
            <button
              key={d.date}
              className={'ev-chip' + (isToday ? ' on' : '') + (past ? ' past' : '')}
              onClick={() => goToDay(d.date)}
            >
              {chipLabel(d, isToday)}
            </button>
          )
        })}
      </div>

      {featured && (
        <div className="ev-banner">
          <span className="ev-banner-chip">
            {featured.label}
            {featured.time ? ' · ' + featured.time : ''}
          </span>
          <div className="ev-banner-title">{featured.title}</div>
          {featured.ticketUrl ? (
            <button
              className="ev-banner-btn"
              onClick={() => { haptic(); openUrl(featured.ticketUrl!) }}
            >
              {featured.ticketLabel || 'Регистрация'}
            </button>
          ) : featured.url ? (
            <button className="ev-banner-btn" onClick={() => { haptic(); openUrl(featured.url!) }}>
              Подробнее
            </button>
          ) : null}
        </div>
      )}

      {/* Событие из баннера остаётся и в списке. Раньше оно вырезалось, и день, где оно
          было единственным, исчезал из расписания целиком — неделя выглядела дырявой. */}
      {s.days.map((d) => {
        const isToday = d.date === today
        const past = d.date < today
        if (!d.items.length) return null
        return (
          <div key={d.date} id={'evday-' + d.date} className={'ev-day day-sec' + (past ? ' past' : '')}>
            {/* Свой заголовок вместо header у Section — тот липнет к первой ячейке
                и по-разному выглядит для строки и для элемента (см. BookScreen). */}
            <div className={'day-sec-title' + (isToday ? ' today' : '')}>
              {d.label}
              {isToday && <span className="ev-badge-today">сегодня</span>}
            </div>
            <Section>
              {d.items.map((it, i) => (
                <Cell
                  key={i}
                  multiline
                  before={<CellIcon name={eventIcon(it.title)} tone={isToday ? 'red' : 'neutral'} />}
                  onClick={it.url ? () => { haptic(); openUrl(it.url!) } : undefined}
                  readOnly={!it.url}
                  after={
                    it.ticketUrl ? (
                      // Была mode="bezeled" — красный текст на красноватой заливке, то есть
                      // ровно тот же вид, что у статус-пилюли «пропуск» в Истории. На разборе
                      // это и прозвучало: «кажется, что это какой-то статус, а не кнопка».
                      // Заливка + белый текст: действие ни с чем не спутать.
                      <Button size="s" onClick={() => { haptic(); openUrl(it.ticketUrl!) }}>
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
          </div>
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
