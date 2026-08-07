import { useState } from 'react'
import { List, Section, Cell, Button, Input, LargeTitle, Caption, SegmentedControl } from '@telegram-apps/telegram-ui'
import type { Cabinet, UpcomingLesson } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { haptic, openUrl, shareReferral } from '../telegram/ui'
import { redeemCert, cancelIndiv, confirmDialog, track } from '../data'
import { errText } from '../errors'

export function HomeScreen({
  data,
  onGoBook,
  onReload,
}: {
  data: Cabinet
  onGoBook: () => void
  onReload: () => void
}) {
  const [group, setGroup] = useState<'indiv' | 'group'>('indiv')
  const [cert, setCert] = useState('')
  const [certMsg, setCertMsg] = useState('')
  const [certBusy, setCertBusy] = useState(false)
  const [homeMsg, setHomeMsg] = useState('')
  const cats = data.categories.filter((c) => c.group === group)

  async function redeem() {
    const code = cert.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (!code) {
      setCertMsg('Введите код с сертификата')
      return
    }
    haptic()
    setCertBusy(true)
    setCertMsg('Проверяю код…')
    const r = await redeemCert(code)
    setCertBusy(false)
    if (r.ok) {
      track('cert_redeem')
      setCert('')
      setCertMsg('✅ Активирован: ' + (r.label || ''))
      onReload()
    } else {
      setCertMsg('⚠️ ' + errText(r.error))
    }
  }

  async function cancel(u: UpcomingLesson) {
    const ok = await confirmDialog(`Отменить занятие ${u.date}${u.time ? ' · ' + u.time : ''}?`)
    if (!ok) return
    haptic()
    setHomeMsg('Отменяю…')
    const r = await cancelIndiv(u.id)
    if (r.ok) {
      setHomeMsg('')
      onReload()
    } else {
      setHomeMsg('⚠️ ' + errText(r.error))
    }
  }

  return (
    <List>
      <div className="home-head">
        <LargeTitle weight="1">Кабинет</LargeTitle>
        <Caption level="1" className="home-sub">
          {data.name} · {data.role}
        </Caption>
      </div>

      <div className="balance-hero">
        <div className="balance-num">{data.balanceTotal}</div>
        <Caption level="1" className="balance-cap">
          занятий на балансе{data.nextExpiry ? ` · действуют до ${data.nextExpiry}` : ''}
        </Caption>
      </div>

      {data.balanceTotal > 0 && (
        <div className="hero-cta">
          <Button stretched size="l" onClick={() => { haptic(); onGoBook() }}>
            Записаться на занятие
          </Button>
        </div>
      )}

      <div className="seg-wrap">
        <SegmentedControl>
          <SegmentedControl.Item className="seg-item" selected={group === 'indiv'} onClick={() => setGroup('indiv')}>
            Личные
          </SegmentedControl.Item>
          <SegmentedControl.Item className="seg-item" selected={group === 'group'} onClick={() => setGroup('group')}>
            Групповые
          </SegmentedControl.Item>
        </SegmentedControl>
      </div>

      <Section header="Баланс">
        {cats.map((c) => (
          <Cell
            key={c.key}
            before={<CellIcon name={c.icon} />}
            subtitle={c.until}
            after={<span className={'cell-count' + (c.count === 0 ? ' zero' : '')}>{c.count}</span>}
          >
            {c.title}
          </Cell>
        ))}
      </Section>

      {data.buyLinks.length > 0 && (
        <Section header="Купить занятия">
          <div className="section-foot">
            {data.buyLinks.map((b, i) => (
              <Button key={i} stretched size="l" onClick={() => { haptic(); track('link', b[1]); openUrl(b[1]) }}>
                {b[0]}
              </Button>
            ))}
          </div>
        </Section>
      )}

      <Section header="Ближайшее">
        {data.upcoming.length ? (
          data.upcoming.map((u) => (
            <Cell
              key={u.id}
              multiline
              before={<CellIcon name="calendar" />}
              subtitle={[u.type, u.trainerName].filter(Boolean).join(' · ')}
              after={
                u.cancellable ? (
                  <Button size="s" mode="bezeled" onClick={() => cancel(u)}>
                    Отменить
                  </Button>
                ) : undefined
              }
            >
              {u.date}
              {u.time ? ` · ${u.time}` : ''}
            </Cell>
          ))
        ) : (
          <Cell>нет запланированных занятий</Cell>
        )}
      </Section>
      {homeMsg && <div className="book-msg" style={{ padding: '0 22px' }}>{homeMsg}</div>}

      {data.refLink && (
        <Section header="Приведи друга">
          <Cell multiline before={<CellIcon name="gift" tone="red" />}>
            Друг перейдёт по твоей ссылке и оплатит первое занятие — тебе бесплатное групповое онлайн-занятие на баланс.
          </Cell>
          <div className="section-foot">
            <Button stretched onClick={() => { haptic(); track('ref_share'); shareReferral(data.refLink!) }}>
              Поделиться приглашением
            </Button>
          </div>
        </Section>
      )}

      <Section header="Есть сертификат?">
        <div className="cert-row">
          <Input
            className="cert-inp"
            value={cert}
            onChange={(e) => setCert(e.currentTarget.value.toUpperCase())}
            placeholder="REP-XXXX-XX"
          />
          <Button size="l" loading={certBusy} onClick={redeem}>
            OK
          </Button>
        </div>
        {certMsg && <div className="section-note">{certMsg}</div>}
      </Section>
    </List>
  )
}
