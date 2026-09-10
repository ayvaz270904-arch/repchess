import { useState, type ReactNode } from 'react'
import { List, Section, Input, Button, Caption, SegmentedControl } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { openUrl, haptic, selectionHaptic } from '../telegram/ui'
import { saveProfile, claimPhone, userPhoto, safeAction } from '../data'
import { errText } from '../errors'
import { POLICY_URL, OFFER_URL, HELPER_URL } from '../config'
import mascot from '../assets/mascot.svg'

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

// Маска российского номера: цифры → +7 999 123-45-67. Ведущую 8 переводим в 7,
// чтобы «8 912…» и «+7 912…» давали один и тот же номер (бот всё равно сравнивает
// последние 10 цифр, но человек должен видеть привычный вид).
function maskPhone(v: string): string {
  let d = v.replace(/\D/g, '')
  if (!d) return ''
  if (d[0] === '8') d = '7' + d.slice(1)
  if (d[0] !== '7') d = '7' + d
  const t = d.slice(1, 11)
  if (!t.length) return '' // осталась одна «семёрка» — поле стирают, не залипаем на «+7»
  let s = '+7 ' + t.slice(0, 3)
  if (t.length > 3) s += ' ' + t.slice(3, 6)
  if (t.length > 6) s += '-' + t.slice(6, 8)
  if (t.length > 8) s += '-' + t.slice(8, 10)
  return s
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: ReactNode
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

  // «Номер покупок»: оплаты с сайта ищутся по телефону, а кабинет привязан к номеру
  // Telegram-аккаунта. Если они разные — кабинет пуст, и человек должен иметь возможность
  // сказать об этом сам. Меняет номер не он, а администратор по заявке (claimPhone).
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneMsg, setPhoneMsg] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneSent, setPhoneSent] = useState('') // до перезагрузки кабинета помним локально
  const phonePending = phoneSent || data.phonePending || ''

  const emailLocked = !!p.email // любая сохранённая почта — менять только через админа

  async function sendPhone() {
    if (phone.replace(/\D/g, '').length < 11) {
      setPhoneMsg('⚠️ Введите номер полностью')
      return
    }
    haptic()
    setPhoneBusy(true)
    setPhoneMsg('Проверяю номер…')
    const r = await safeAction(claimPhone(phone))
    setPhoneBusy(false)
    // Успехом считаем ТОЛЬКО явное pending. Бот, задеплоенный до этой правки, не знает
    // action=claimPhone и молча отдаёт обычный кабинет с ok:true — по одному ok мы бы
    // показали «заявка отправлена», хотя не отправлено ничего.
    if (r.ok && 'pending' in r && r.pending) {
      setPhoneSent(r.phone || phone)
      setPhoneOpen(false)
      setPhone('')
      setPhoneMsg('')
    } else {
      setPhoneMsg('⚠️ ' + errText(('error' in r && r.error) || 'server'))
    }
  }

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
    const r = await safeAction(saveProfile({ fio, email, birthdate, gender, city, level }))
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

  const emailHint: ReactNode = emailLocked ? (
    data.email === email ? (
      <>
        ✅ подтверждена — <a onClick={() => openUrl(HELPER_URL)}>изменить через поддержку</a>
      </>
    ) : (
      <>
        🔒 чтобы изменить почту — <a onClick={() => openUrl(HELPER_URL)}>напишите нам</a>
      </>
    )
  ) : // Подписи у незаполненной почты нет намеренно. Прежняя — «свяжет покупки, сделанные
  // не с вашего номера» — была неправдой: баланс кабинет ищет ПО ТЕЛЕФОНУ (clientBalance →
  // usePhone), почта покупки не связывает, а совпадение с базой лишь отправляет заявку
  // администратору. Для случая «покупал с другого номера» есть «Номер для поиска покупок».
  undefined

  const cta = gate ? 'Открыть кабинет' : 'Сохранить'

  // Ачивки — вехи из реальной истории занятий (фишки: пешка/конь/ладья/ферзь)
  const doneCount = data.lessonHistory.filter((h) => h.status === 'done').length
  const groupDone = data.lessonHistory.filter((h) => h.status === 'done' && /групп/i.test(h.type)).length
  const achievements = [
    { pc: '♟', label: 'Дебют', earned: doneCount >= 1 },
    { pc: '♞', label: '10 партий', earned: doneCount >= 10 },
    { pc: '♜', label: 'Командный', earned: groupDone >= 1 },
    { pc: '♛', label: 'Мастер', earned: doneCount >= 25 },
  ]
  const photo = userPhoto()

  return (
    <List>
      {gate ? (
        <>
          <div className="screen-title">Знакомимся 👋</div>
          <div className="gate-intro">
            Заполните короткую анкету — и кабинет откроется: расписание недели, запись на занятия и баланс.
            {/* Строка живёт только пока акция включена (promoAvailable = _promoActive() в боте):
                выключил подарок в /admin — она исчезает сама, править текст не нужно. Поэтому
                в ней нет ни срока, ни счётчика мест: обещание должно быть верным всё время,
                пока строка на экране, и не оставлять следов, когда её нет. */}
            {data.promoAvailable && (
              <b className="gate-promo"> 🎁 Дарим групповое онлайн-занятие — начислим сразу на баланс.</b>
            )}
          </div>
        </>
      ) : (
        <div className="screen-title">Профиль</div>
      )}

      {!gate && (
        <>
          <div className="prof-header">
            <div className="prof-ava">
              {photo ? (
                <img className="ava-photo" src={photo} alt="" />
              ) : (
                <img src={mascot} alt="" aria-hidden="true" />
              )}
            </div>
            <div className="prof-info">
              <div className="prof-name">{p.fio || data.name}</div>
              {p.level && <span className="prof-badge">{p.level}</span>}
            </div>
          </div>
          <div className="ach-row">
            {achievements.map((a) => (
              <span key={a.label} className={'ach ' + (a.earned ? 'earned' : 'locked')}>
                <span className="pc">{a.pc}</span>
                {a.label}
              </span>
            ))}
          </div>
        </>
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

      {/* Номер, по которому кабинет ищет оплаты. Показываем всем: человек должен видеть,
          по какому номеру его ищут, — иначе пустой баланс выглядит как поломка. */}
      {!gate && (
        <Section footer="Оплаты с сайта кабинет ищет по этому номеру. Если оформляли на другой — укажите его: администратор сверит и привяжет покупки.">
          <div className="field">
            <div className="field-lbl">Номер для поиска покупок</div>
            {phonePending ? (
              <div className="phone-wait">
                ⏳ Проверяем номер <b>{phonePending}</b> — администратор подтвердит, и покупки появятся
                в кабинете.
              </div>
            ) : phoneOpen ? (
              <>
                <Input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.currentTarget.value))}
                  placeholder="+7 912 345-67-89"
                />
                <div className="phone-acts">
                  <Button size="m" loading={phoneBusy} onClick={sendPhone}>
                    Отправить на проверку
                  </Button>
                  <button
                    className="phone-cancel"
                    onClick={() => {
                      setPhoneOpen(false)
                      setPhone('')
                      setPhoneMsg('')
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </>
            ) : (
              <div className="phone-row">
                <span className="phone-val">{data.phone || '—'}</span>
                <button
                  className="phone-edit"
                  onClick={() => {
                    haptic()
                    setPhoneOpen(true)
                  }}
                >
                  Другой номер
                </button>
              </div>
            )}
            {phoneMsg && <div className="phone-msg">{phoneMsg}</div>}
          </div>
        </Section>
      )}

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
