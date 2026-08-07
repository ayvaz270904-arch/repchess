import { useState, type ReactNode } from 'react'
import { List, Section, Input, Button, Caption, SegmentedControl } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { openUrl, haptic, selectionHaptic } from '../telegram/ui'
import { saveProfile } from '../data'
import { errText } from '../errors'
import { POLICY_URL, OFFER_URL } from '../config'

// Маска ввода даты рождения: цифры → дд.мм.гггг
function maskBdate(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  const parts: string[] = []
  if (d.length > 0) parts.push(d.slice(0, 2))
  if (d.length > 2) parts.push(d.slice(2, 4))
  if (d.length > 4) parts.push(d.slice(4, 8))
  return parts.join('.')
}
// Валидна ли дата рождения (реальная дата + возраст 3..99)
function validBdate(s: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim())
  if (!m) return false
  const d = +m[1],
    mo = +m[2],
    y = +m[3]
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() < mo - 1 || (now.getMonth() === mo - 1 && now.getDate() < d)) age--
  return age >= 3 && age <= 99
}
function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
}

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
  const [birthdate, setBirthdate] = useState(p.birthdate || '')
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
    if (gate) {
      // Первая анкета — все поля обязательны (включая почту и дату рождения)
      if (!validBdate(birthdate)) return setMsg('⚠️ Укажите дату рождения (дд.мм.гггг)')
      if (!gender) return setMsg('⚠️ Укажите пол')
      if (!city.trim()) return setMsg('⚠️ Укажите город')
      if (!level.trim()) return setMsg('⚠️ Укажите уровень игры')
      if (!validEmail(email)) return setMsg('⚠️ Укажите корректную почту')
    } else if (birthdate && !validBdate(birthdate)) {
      return setMsg('⚠️ Проверьте дату рождения (дд.мм.гггг)')
    }
    haptic()
    setBusy(true)
    setMsg('Сохраняю…')
    const r = await saveProfile({ fio, email, birthdate, gender, city, level })
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
          <div className="screen-title">Знакомимся 👋</div>
          <div className="gate-intro">
            Заполните короткую анкету — и кабинет откроется: расписание недели, запись на занятия и баланс.
            {data.promoAvailable && (
              <b className="gate-promo"> 🎁 Первым 20 — бесплатное групповое онлайн-занятие сразу на баланс.</b>
            )}
          </div>
        </>
      ) : (
        <div className="screen-title">Профиль</div>
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
        <Field label="Дата рождения" hint="для поздравлений и подарков 🎁">
          <Input
            inputMode="numeric"
            value={birthdate}
            onChange={(e) => setBirthdate(maskBdate(e.currentTarget.value))}
            placeholder="дд.мм.гггг"
          />
        </Field>
        <Field label="Город">
          <Input value={city} onChange={(e) => setCity(e.currentTarget.value)} placeholder="Москва" />
        </Field>
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
