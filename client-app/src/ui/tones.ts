// Цвет квадрата-иконки по ВИДУ занятия или события. Логика одна на все экраны —
// просьба дизайнера: «группы под одним цветом, индив под другим». Сами цвета —
// в styles.css (--rc-c-*), здесь только правило, что каким цветом красить.
export type IconTone = 'neutral' | 'red' | 'indiv' | 'group' | 'tour' | 'master'

export function kindTone(kind: 'indiv' | 'group'): IconTone {
  return kind === 'indiv' ? 'indiv' : 'group'
}

// Тип занятия с бота: «Индив. · офлайн» / «Групповое · онлайн» (fmtItem в bot.gs).
export function lessonTone(type: string): IconTone {
  const t = String(type || '').toLowerCase()
  if (/индив/.test(t)) return 'indiv'
  if (/групп/.test(t)) return 'group'
  return 'neutral'
}

// Подпись покупки: «Индив. офлайн ×4», «Групп. онлайн ×10», у сертификата —
// «Сертификат REP-… — Индив. офлайн, 4 занятия» (identifyProduct). Если вид по
// подписи не понять — нейтральный, а не выдуманный.
export function purchaseTone(label: string): IconTone {
  return lessonTone(label)
}

// Событие афиши — по словам в названии. Порядок важен: «турнир для начинающих»
// должен стать турниром, а не занятием из-за слова «начинающих».
export function eventTone(title: string): IconTone {
  const t = String(title || '').toLowerCase()
  if (/турнир|блиц|рапид|матч|шведк|швейцар/.test(t)) return 'tour'
  if (/мастер-класс|мастер класс|лекц|разбор|вебинар|сеанс|симультан/.test(t)) return 'master'
  if (/индивид/.test(t)) return 'indiv'
  if (/заняти|обучени|урок|групп|с нуля|для начинающих/.test(t)) return 'group'
  return 'neutral'
}
