import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { List, Section, Cell, Button, LargeTitle, SegmentedControl, Spinner } from '@telegram-apps/telegram-ui'
import type { Cabinet, GroupLesson, IndivSlots } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { openUrl, haptic, selectionHaptic } from '../telegram/ui'
import { fetchSlots, bookIndiv, joinGroup, leaveGroup, confirmDialog, track, ApiError } from '../data'
import { errText } from '../errors'

export function BookScreen({ data, onReload }: { data: Cabinet; onReload: () => void }) {
  const [slots, setSlots] = useState<IndivSlots | null>(null)
  const [slotsErr, setSlotsErr] = useState('')
  const [fmt, setFmt] = useState<'offline' | 'online'>('offline')
  const [dayDate, setDayDate] = useState('')
  const [bookMsg, setBookMsg] = useState('')
  const [grpMsg, setGrpMsg] = useState('')

  const loadSlotsData = useCallback(async () => {
    setSlots(null)
    setSlotsErr('')
    try {
      const s = await fetchSlots()
      setSlots(s)
      setFmt(s.canOffline ? 'offline' : 'online')
      setDayDate(s.days[0]?.date ?? '')
    } catch (e) {
      setSlotsErr(e instanceof ApiError ? e.code : 'server')
    }
  }, [])

  useEffect(() => {
    loadSlotsData()
  }, [loadSlotsData])

  async function book(time: string) {
    const day = slots?.days.find((d) => d.date === dayDate) ?? slots?.days[0]
    if (!day) return
    const ok = await confirmDialog(`Записаться на ${day.label} в ${time} (${fmt === 'online' ? 'онлайн' : 'офлайн'})?`)
    if (!ok) return
    haptic()
    setBookMsg('Записываю…')
    const r = await bookIndiv(day.date, time, fmt)
    if (r.ok) {
      track('book_indiv')
      setBookMsg('✅ Вы записаны!')
      onReload()
      loadSlotsData()
    } else {
      setBookMsg('⚠️ ' + errText(r.error))
      if (r.error === 'slot_taken' || r.error === 'slot_gone') loadSlotsData()
    }
  }

  async function join(g: GroupLesson) {
    haptic()
    setGrpMsg('Записываю…')
    const r = await joinGroup(g.id)
    if (r.ok) {
      track('group_join')
      setGrpMsg('✅ Вы записаны!')
      onReload()
    } else {
      setGrpMsg('⚠️ ' + errText(r.error))
    }
  }

  async function leave(g: GroupLesson) {
    const ok = await confirmDialog('Отменить запись на групповое занятие?')
    if (!ok) return
    haptic()
    setGrpMsg('Отменяю…')
    const r = await leaveGroup(g.id)
    if (r.ok) {
      track('group_leave')
      setGrpMsg('↩️ Запись отменена')
      onReload()
    } else {
      setGrpMsg('⚠️ ' + errText(r.error))
    }
  }

  return (
    <List>
      <div className="screen-head">
        <LargeTitle weight="1">Запись</LargeTitle>
      </div>

      <Section header="Индивидуальное занятие" footer={slots?.trainer ? `Тренер: ${slots.trainer}` : undefined}>
        {slotsErr ? (
          <Cell multiline>{errText(slotsErr)}</Cell>
        ) : !slots ? (
          <div className="center-inline">
            <Spinner size="m" />
          </div>
        ) : (
          renderIndiv(slots, fmt, dayDate, setFmt, setDayDate, book, bookMsg)
        )}
      </Section>

      <Section header="Групповые занятия">
        {data.openGroups.length ? (
          data.openGroups.map((g) => <GroupRow key={g.id} g={g} onJoin={join} onLeave={leave} />)
        ) : (
          <Cell multiline>Сейчас открытых занятий нет.</Cell>
        )}
      </Section>
      {grpMsg && <div className="book-msg" style={{ padding: '0 22px' }}>{grpMsg}</div>}
    </List>
  )
}

function renderIndiv(
  s: IndivSlots,
  fmt: 'offline' | 'online',
  dayDate: string,
  setFmt: (f: 'offline' | 'online') => void,
  setDayDate: (d: string) => void,
  book: (time: string) => void,
  bookMsg: string,
): ReactNode {
  if (!s.canOffline && !s.canOnline) {
    return <Cell multiline>Для записи нужен активный пакет индивидуальных занятий.</Cell>
  }
  if (s.remaining < 1) {
    return <Cell multiline>Занятия на балансе закончились — продлите пакет, и запись откроется.</Cell>
  }
  if (!s.days.length) {
    return <Cell multiline>У тренера нет свободных слотов на ближайшие 2 недели.</Cell>
  }

  const bothPacks = s.canOffline && s.canOnline
  const day = s.days.find((d) => d.date === dayDate) ?? s.days[0]
  const list = day.slots.filter((sl) => sl.format === 'both' || sl.format === fmt)

  return (
    <div className="indiv-body">
      {bothPacks && (
        <div className="seg-wrap" style={{ paddingTop: 6 }}>
          <SegmentedControl>
            <SegmentedControl.Item selected={fmt === 'offline'} onClick={() => { selectionHaptic(); setFmt('offline') }}>
              📍 Офлайн
            </SegmentedControl.Item>
            <SegmentedControl.Item selected={fmt === 'online'} onClick={() => { selectionHaptic(); setFmt('online') }}>
              💻 Онлайн
            </SegmentedControl.Item>
          </SegmentedControl>
        </div>
      )}

      <div className="day-strip">
        {s.days.map((x) => (
          <button
            key={x.date}
            className={'day-chip' + (x.date === day.date ? ' on' : '')}
            onClick={() => { selectionHaptic(); setDayDate(x.date) }}
          >
            <span className="dw">{x.dow}</span>
            <span className="dt">{x.label}</span>
          </button>
        ))}
      </div>

      {list.length ? (
        <div className="slot-grid">
          {list.map((sl) => (
            <button key={sl.time} className="slot" onClick={() => book(sl.time)}>
              {sl.time}
              <span className="sf">{sl.format === 'offline' ? '📍' : sl.format === 'online' ? '💻' : ''}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="book-note">в этот день нет слотов под выбранный формат</div>
      )}

      {bookMsg && <div className="book-msg">{bookMsg}</div>}
    </div>
  )
}

function GroupRow({
  g,
  onJoin,
  onLeave,
}: {
  g: GroupLesson
  onJoin: (g: GroupLesson) => void
  onLeave: (g: GroupLesson) => void
}) {
  const iconName = g.format === 'online' ? 'globe' : 'pin'
  const color = g.format === 'online' ? '#a98bff' : '#e8a13a'
  const spots = g.max ? `${g.count}/${g.max} чел.` : `${g.count} чел.`
  const sub = [g.venue, g.trainerName, spots].filter(Boolean).join(' · ')
  const full = !!g.max && g.count >= g.max

  let after: ReactNode
  if (g.joined) {
    after = (
      <Button size="s" mode="bezeled" onClick={() => onLeave(g)}>
        Отменить
      </Button>
    )
  } else if (g.regOpen === false) {
    after = <span className="grp-status">🔒 {g.opensAt ? `с ${g.opensAt}` : 'скоро'}</span>
  } else if (full) {
    after = <span className="grp-status">мест нет</span>
  } else if (g.canJoin === false) {
    after = <span className="grp-status">нужен пакет</span>
  } else {
    after = (
      <Button size="s" onClick={() => onJoin(g)}>
        Записаться
      </Button>
    )
  }

  const showLinks = g.joined && g.format === 'online'
  const linksOpen = g.linksOpen && (g.voiceUrl || g.studioUrl)

  return (
    <>
      <Cell multiline before={<CellIcon name={iconName} color={color} />} subtitle={sub} after={after}>
        {g.date}
        {g.time ? ` · ${g.time}` : ''} · {g.format === 'online' ? 'онлайн' : 'офлайн'}
      </Cell>
      {showLinks &&
        (linksOpen ? (
          <div className="grp-links">
            {g.voiceUrl && (
              <Button size="s" stretched onClick={() => openUrl(g.voiceUrl!)}>
                🎙 Войс-чат
              </Button>
            )}
            {g.studioUrl && (
              <Button size="s" stretched mode="bezeled" onClick={() => openUrl(g.studioUrl!)}>
                ♟ Студия
              </Button>
            )}
          </div>
        ) : g.hasLinks ? (
          <div className="grp-hint">🔗 Ссылки на занятие откроются за 10 минут до начала</div>
        ) : null)}
    </>
  )
}
