import { useState } from 'react'
import { Button, Input } from '@telegram-apps/telegram-ui'
import type { Cabinet, UpcomingLesson } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { haptic, openUrl, shareReferral } from '../telegram/ui'
import { redeemCert, cancelIndiv, confirmDialog, track, safeAction, userPhoto } from '../data'
import { errText } from '../errors'
import mascot from '../assets/mascot.svg'

export function HomeScreen({
  data,
  onGoBook,
  onReload,
}: {
  data: Cabinet
  onGoBook: () => void
  onReload: () => void
}) {
  const [cert, setCert] = useState('')
  const [certMsg, setCertMsg] = useState('')
  const [certBusy, setCertBusy] = useState(false)
  const [showCert, setShowCert] = useState(false)
  const [homeMsg, setHomeMsg] = useState('')

  const buy = data.buyLinks[0]
  const initial = (data.name || '?').trim().charAt(0).toUpperCase() || '?'
  const photo = userPhoto()

  // Показываем только направления с ненулевым остатком: у типичного клиента три
  // из четырёх — нули, и четыре почти одинаковые плитки только мешают читать
  // первый экран. Сравнение именно с нулём, а не «> 0»: остаток может быть
  // отрицательным (долг), и его прятать нельзя.
  const cats = data.categories.filter((c) => c.count !== 0)

  async function redeem() {
    const code = cert.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (!code) {
      setCertMsg('Введите код с сертификата')
      return
    }
    haptic()
    setCertBusy(true)
    setCertMsg('Проверяю код…')
    const r = await safeAction(redeemCert(code))
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
    const r = await safeAction(cancelIndiv(u.id))
    if (r.ok) {
      setHomeMsg('')
      onReload()
    } else {
      setHomeMsg('⚠️ ' + errText(r.error))
    }
  }

  return (
    <div className="home">
      <div className="home-topbar">
        <div>
          <div className="greet">Привет, {data.name}</div>
          <div className="sub2">Личный кабинет</div>
        </div>
        <div className="ava" aria-hidden="true">
          {photo ? <img className="ava-photo" src={photo} alt="" /> : initial}
        </div>
      </div>

      <div className="home-hero">
        <img className="hero-mascot" src={mascot} alt="" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-num">{data.balanceTotal}</div>
          <div className="hero-cap">занятий на балансе</div>
          {data.nextExpiry && <div className="hero-pill">действуют до {data.nextExpiry}</div>}
        </div>
      </div>

      <div className="home-cta-wrap">
        {buy && (
          <Button
            stretched
            size="l"
            onClick={() => {
              haptic()
              track('link', buy[1])
              openUrl(buy[1])
            }}
          >
            Купить пакет
          </Button>
        )}
        <button className="ghost-btn" onClick={() => { haptic(); setShowCert((v) => !v) }}>
          Ввести сертификат
        </button>
        {showCert && (
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
        )}
        {certMsg && <div className="section-note">{certMsg}</div>}
      </div>

      {cats.length > 0 && (
        <>
          <div className="home-sec-title">По направлениям</div>
          <div className="home-grid">
            {/* Признаков различия три и они независимы: иконка = формат (pin/globe,
                они уже лежат в данных), жирная строка = вид занятия, приглушённая =
                формат словом. Раньше плитки различались одним словом в середине
                почти одинаковых подписей, а иконки были неотличимые user/users. */}
            {cats.map((c) => (
              <div className="home-tile" key={c.key}>
                <div className="tile-top">
                  <CellIcon name={c.icon} />
                  <span className={'tile-count' + (c.count < 0 ? ' debt' : '')}>{c.count}</span>
                </div>
                <div className="tile-label">
                  <span className="tl-group">{c.group === 'indiv' ? 'Индивидуальные' : 'Групповые'}</span>
                  <span className="tl-fmt">{(c.title || '').toLowerCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="home-sec-title">Ближайшее занятие</div>
      {data.upcoming.length ? (
        <div className="home-next-list">
          {data.upcoming.map((u) => (
            <div className="home-next" key={u.id}>
              <div className="next-date">
                {u.date}
                {u.time ? ` · ${u.time}` : ''}
              </div>
              <div className="next-meta">{[u.type, u.trainerName].filter(Boolean).join(' · ')}</div>
              {u.cancellable && (
                <div className="next-foot">
                  <button className="next-cancel" onClick={() => cancel(u)}>
                    Отменить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="home-empty">Нет запланированных занятий</div>
      )}
      {homeMsg && (
        <div className="book-msg" style={{ padding: '6px 20px 0' }}>
          {homeMsg}
        </div>
      )}

      <div className="home-actions">
        <button className="act-tile" onClick={() => { haptic(); onGoBook() }}>
          <CellIcon name="calendar" />
          <span className="act-lbl">Записаться</span>
        </button>
        {data.refLink && (
          <button
            className="act-tile red"
            onClick={() => {
              haptic()
              track('ref_share')
              shareReferral(data.refLink!)
            }}
          >
            <CellIcon name="gift" tone="red" />
            <span className="act-lbl">Пригласить друга</span>
          </button>
        )}
      </div>
    </div>
  )
}
