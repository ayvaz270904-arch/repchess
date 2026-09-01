// Общие форматтеры подписей для экранов кабинета.
// Все даты приходят с бота строкой «dd.MM.yyyy» (_fmtDate в bot.gs) — разбираем тут,
// чтобы не плодить копии разбора по экранам.

// Русское склонение по числу: plural(2, 'место', 'места', 'мест') → 'места'
export function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return one
  if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few
  return many
}

// «27.08.2026» → «27 августа». Год дописываем, только если он не текущий:
// в списке из десятка занятий «.2026» в каждой строке — чистый шум, но и
// потерять год у прошлогодней записи нельзя.
export function ruDate(d: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || '')
  if (!m) return d || ''
  const dt = new Date(m[3] + '-' + m[2] + '-' + m[1] + 'T12:00:00')
  if (isNaN(dt.getTime())) return d
  const sameYear = dt.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(dt)
}

// Бот шлёт тип занятия сокращённо: «Индив. · офлайн» / «Групповое · онлайн»
// (см. fmtItem в bot.gs). В кабинете сокращение разворачиваем и разводим по
// строкам: вид занятия — в заголовок, формат — в подпись.
export function lessonType(t: string): { kind: string; fmt: string } {
  const parts = String(t || '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
  const raw = parts[0] || ''
  const kind = /^индив/i.test(raw) ? 'Индивидуальное' : raw
  return { kind: kind || String(t || ''), fmt: parts[1] || '' }
}
