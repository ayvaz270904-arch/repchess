import { useState, type ReactNode } from 'react'
import { List, Section, Input, Button, LargeTitle, Caption, SegmentedControl } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { openUrl, haptic, selectionHaptic } from '../telegram/ui'
import { saveProfile } from '../data'
import { errText } from '../errors'
import { POLICY_URL, OFFER_URL } from '../config'

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={'field' + (className ? ' ' + className : '')}>
      <div className="field-lbl">{label}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  )
}

export function ProfileScreen({
  data,
  gate = false,
  onSaved,
}: {
  data: Cabinet
  gate?: boolean
  onSaved?: () => void
}) {
  const p = data.profile || {}
  const [fio, setFio] = useState(p.fio || '')
  const [email, setEmail] = useState(p.email || '')
  const [age, setAge] = useState(p.age ? String(p.age) : '')
  const [city, setCity] = useState(p.city || '')
  const [level, setLevel] = useState(p.level || '')
  const [gender, setGender] = useState<'' | 'м' | 'ж'>(p.gender || '')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const emailLocked = !!p.email // любая сохранённая почта — менять только через админа

  async function save() {
    if (!fio.trim()) {
      setMsg('⚠️ Укажите ФИО')
      return
    }
    haptic()
    setBusy(true)
    setMsg('Сохраняю…')
    const r = await saveProfile({ fio, email, age, gender, city, level })
    setBusy(false)
    if (r.ok) {
      if (gate) {
        onSaved?.()
        return
      }
      setMsg(
        r.emailPending
          ? '✅ Сохранено! На эту почту нашлись покупки — администратор проверит и привяжет.'
          : '✅ Сохранено!',
      )
      onSaved?.()
    } else {
      setMsg('⚠️ ' + errText(r.error))
    }
  }

  const emailHint = emailLocked
    ? data.email === email
      ? '✅ подтверждена — изменить через администратора'
      : '🔒 чтобы изменить почту — напишите нам'
    : 'свяжет покупки, сделанные не с вашего номера'

  const cta = gate ? 'Открыть кабинет' : 'Сохранить'

  return (
    <List>
      {gate ? (
        <>
          <div className="screen-head">
            <LargeTitle weight="1">Знакомимся 👋</LargeTitle>
          </div>
          <div className="gate-intro">
            Заполните короткую анкету — и кабинет откроется: расписание недели, запись на занятия и баланс.
            {data.promoAvailable && (
              <b className="gate-promo"> 🎁 Первым 20 — бесплатное групповое онлайн-занятие сразу на баланс.</b>
            )}
          </div>
        </>
      ) : (
        <div className="screen-head">
          <LargeTitle weight="1">Профиль</LargeTitle>
        </div>
      )}

      <Section footer="Анкета помогает подбирать занятия под уровень. Если ученику меньше 18 лет — анкету заполняет родитель или законный представитель, укажите данные ученика.">
        <Field label="ФИО">
          <Input value={fio} onChange={(e) => setFio(e.currentTarget.value)} placeholder="Иванов Иван" />
        </Field>
        <Field label="Почта" hint={emailHint}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="you@mail.ru"
            disabled={emailLocked}
          />
        </Field>
        <div className="field-row">
          <Field label="Возраст" className="f-age">
            <Input type="number" value={age} onChange={(e) => setAge(e.currentTarget.value)} placeholder="12" />
          </Field>
          <Field label="Город" className="f-city">
            <Input value={city} onChange={(e) => setCity(e.currentTarget.value)} placeholder="Москва" />
          </Field>
        </div>
        <Field label="Пол">
          <SegmentedControl>
            <SegmentedControl.Item selected={gender === 'м'} onClick={() => { selectionHaptic(); setGender(gender === 'м' ? '' : 'м') }}>
              М
            </SegmentedControl.Item>
            <SegmentedControl.Item selected={gender === 'ж'} onClick={() => { selectionHaptic(); setGender(gender === 'ж' ? '' : 'ж') }}>
              Ж
            </SegmentedControl.Item>
          </SegmentedControl>
        </Field>
        <Field label="Уровень игры">
          <Input value={level} onChange={(e) => setLevel(e.currentTarget.value)} placeholder="1400 lichess / новичок" />
        </Field>
      </Section>

      <div className="screen-foot">
        <Button stretched size="l" loading={busy} onClick={save}>
          {cta}
        </Button>
        {msg && <div className="book-msg" style={{ textAlign: 'center' }}>{msg}</div>}
        <Caption level="1" className="consent">
          Нажимая «{cta}», вы даёте согласие на обработку персональных данных в соответствии с{' '}
          <a onClick={() => openUrl(POLICY_URL)}>политикой конфиденциальности</a>. Услуги оказываются на условиях{' '}
          <a onClick={() => openUrl(OFFER_URL)}>публичной оферты</a>. За ученика младше 18 лет согласие даёт родитель.
        </Caption>
      </div>
    </List>
  )
}
