import { useState } from 'react'
import { Button, Input } from '@telegram-apps/telegram-ui'
import type { Cabinet, UpcomingLesson } from '../types'
import { haptic, openUrl, shareReferral } from '../telegram/ui'
import { redeemCert, cancelIndiv, confirmDialog, track, safeAction } from '../data'
import { errText } from '../errors'
import { ruDate, lessonType } from '../format'
import sun from '../assets/star-sun.png'

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

  // Показываем только направления с ненулевым остатком: у типичного клиента три
  // из четырёх — нули, и четыре почти одинаковые плитки только мешают читать
  // первый экран. Сравнение именно с нулём, а не «> 0»: остаток может быть
  // отрицательным (долг), и его прятать нельзя.
  // При сбое базы без копии остаток от бота завышен (без проведённых занятий) — не показываем его
  const noData = !!data.fsError && data.staleAt === undefined   // сбой базы и нет сохранённой копии
  const cats = noData ? [] : data.categories.filter((c) => c.count !== 0)

  async function redeem() {
    const code = cert.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (!code) {
      setCertMsg('Введите промокод')
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
      {cats.length > 0 && (
        <div className={'d-cats' + (cats.length === 1 ? ' one' : '')}>
          {/* Вид занятия — знаком, а не цветом (дизайн D): чёрный квадрат = группа,
              контурный = индивидуальное. Формат пишем словом. */}
          {cats.map((c) => (
            <div className="d-cat" key={c.key}>
              <div className="d-cat-lbl">
                <i className={'d-mark ' + (c.group === 'indiv' ? 'indiv' : 'group')} />
                {(c.group === 'indiv' ? 'Индив. ' : 'Групп. ') + (/онлайн/i.test(c.title) ? 'онлайн' : /офлайн/i.test(c.title) ? 'офлайн' : (c.title || '').toLowerCase())}
              </div>
              <div className={'d-cat-num' + (c.count < 0 ? ' debt' : '')}>{c.count}</div>
            </div>
          ))}
        </div>
      )}

      <div className="d-cap">Ближайшее</div>
      {data.upcoming.length ? (
        <div className="d-next-list">
          {data.upcoming.map((u, i) => {
            const { kind, fmt } = lessonType(u.type)
            return (
              <div className={'d-next' + (i === 0 ? ' first' : '')} key={u.id}>
                {i === 0 && <img className="d-next-star" src={sun} alt="" aria-hidden="true" />}
                <div className="d-next-row">
                  <div className="d-next-time">{u.time || '—'}</div>
                  <div className="d-next-date">{ruDate(u.date)}</div>
                </div>
                <div className="d-next-meta">{[kind, fmt, u.trainerName].filter(Boolean).join(' · ')}</div>
                {/* Заметка тренера к будущему занятию — «что будет». */}
                {u.notes && <div className="d-next-note">{u.notes.trim()}</div>}
                {u.cancellable && (
                  <button className="d-next-cancel" onClick={() => cancel(u)}>
                    Отменить
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="d-empty-line">{noData ? 'Не удалось загрузить занятия' : 'Нет запланированных занятий'}</div>
      )}
      {homeMsg && <div className="book-msg" style={{ padding: '6px 18px 0' }}>{homeMsg}</div>}

      <div className="d-actions">
        <button className="d-btn d-btn-red" onClick={() => { haptic(); onGoBook() }}>
          Записаться на занятие
        </button>
        {buy && (
          <button
            className="d-btn d-btn-line"
            onClick={() => {
              haptic()
              track('link', buy[1])
              openUrl(buy[1])
            }}
          >
            Купить пакет
          </button>
        )}
        <div className="d-actions-row">
          {/* «Промокод», а не «сертификат»: код один и тот же (REP-XXXX-XX, action=redeemCert),
              но клиенты получают его как промокод — под этим словом и ищут. */}
          <button className="d-link" onClick={() => { haptic(); setShowCert((v) => !v) }}>
            Ввести промокод
          </button>
          {data.refLink && (
            <button
              className="d-link"
              onClick={() => {
                haptic()
                track('ref_share')
                shareReferral(data.refLink!)
              }}
            >
              Пригласить друга
            </button>
          )}
        </div>
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
    </div>
  )
}
