import type { Cabinet } from '../types'

// Временные данные для превью всех экранов. На фазе бэкенда заменим на реальный ответ GAS.
export const MOCK_CABINET: Cabinet = {
  name: 'Александр',
  role: 'ученик',
  balanceTotal: 12,
  nextExpiry: '30 сентября',
  categories: [
    { key: 'io', icon: 'pin', color: '#2ea6ff', title: 'Офлайн', until: 'до 30 сентября', count: 4, group: 'indiv' },
    { key: 'in', icon: 'globe', color: '#4dc27a', title: 'Онлайн', until: 'до 30 сентября', count: 0, group: 'indiv' },
    { key: 'go', icon: 'pin', color: '#e8a13a', title: 'Офлайн', until: 'до 15 октября', count: 0, group: 'group' },
    { key: 'gn', icon: 'globe', color: '#a98bff', title: 'Онлайн', until: 'до 15 октября', count: 8, group: 'group' },
  ],
  upcoming: [
    { id: 'u1', date: 'Ср, 7 авг', time: '16:00', type: 'Индивидуальное', trainerName: 'Артём', cancellable: true },
    { id: 'u2', date: 'Пт, 9 авг', time: '18:00', type: 'Групповое онлайн', trainerName: 'Мария' },
  ],
  // ВАЖНО: дата тут ровно в том виде, в каком её шлёт бот — «dd.MM.yyyy» (_fmtDate).
  // Раньше в моке лежало «Пт, 9 авг», и он прятал разбор даты, на котором держится
  // группировка по дням в «Записи».
  openGroups: [
    {
      id: 'g1', date: '01.09.2026', time: '18:00', format: 'online', venue: '',
      trainerName: 'Мария', count: 5, max: 8, joined: true, regOpen: true,
      hasLinks: true, linksOpen: true, voiceUrl: 'https://t.me/repchess', studioUrl: 'https://lichess.org/study',
    },
    {
      id: 'g2', date: '01.09.2026', time: '20:00', format: 'offline', venue: 'Пешка на Чистых',
      trainerName: 'Артём', count: 6, max: 8, joined: false, regOpen: true, canJoin: true,
    },
    {
      id: 'g3', date: '03.09.2026', time: '12:00', format: 'offline', venue: 'ул. Пушкина, 10',
      trainerName: 'Артём', count: 6, max: 6, joined: false, regOpen: true, canJoin: false,
    },
    {
      id: 'g4', date: '05.09.2026', time: '15:00', format: 'online', venue: '',
      trainerName: 'Мария', count: 2, max: 8, joined: false, regOpen: false, opensAt: '03.09 в 10:00',
    },
  ],
  // Неделя целиком, включая уже прошедшие дни — так приходит с бота и так это
  // должно выглядеть в кабинете (прошедшее приглушено, «Сегодня» в полоске дней).
  schedule: {
    days: [
      { date: '2026-08-24', label: '24 августа, пн', items: [
        { time: '20:00', title: 'шахматный турнир для начинающих в Кривоколенном', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты' },
      ] },
      { date: '2026-08-25', label: '25 августа, вт', items: [
        { time: '20:00', title: 'обучение шахматам с нуля в Пешке', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты' },
      ] },
      { date: '2026-08-26', label: '26 августа, ср', items: [
        { time: '19:30', title: 'шведки в Trend Island', url: 'https://t.me/repchess' },
        { time: '20:00', title: 'обучение шахматам для начинающих в Пешке', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты' },
      ] },
      { date: '2026-08-29', label: '29 августа, сб', items: [
        { time: '13:00', title: 'турнир для начинающих в МИРА бистро', url: 'https://t.me/repchess' },
        { time: '15:00', title: 'занятие «Шахматы с нуля» в КУБе', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты' },
      ] },
      { date: '2026-08-30', label: '30 августа, вс', items: [
        { time: '14:00', title: 'занятие по шахматам для начинающих в Yauza Place', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты' },
        { time: '15:00', title: 'сеанс одновременной игры на фестивале «Фонарик»', url: 'https://t.me/repchess' },
      ] },
    ],
    featured: {
      date: '2026-08-30', label: '30 августа, вс', time: '14:00',
      title: 'занятие по шахматам для начинающих в Yauza Place',
      ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Билеты', manual: false,
    },
    note: { text: 'Приведи друга — занятие в подарок', url: 'https://edu.repchess.ru' },
    postUrl: 'https://t.me/RepChessEducation',
  },
  // Даты и подписи — ровно как их шлёт бот: дата dd.MM.yyyy (_fmtDate), тип
  // «Индив. · офлайн» / «Групповое · онлайн» (fmtItem), заметка тренера коротким
  // словом (как в жизни — из-за неё в разборе и не поняли строку «тактика»).
  lessonHistory: [
    { id: 'h1', date: '02.08.2026', time: '16:00', type: 'Индив. · офлайн', status: 'done', notes: 'тактика' },
    { id: 'h2', date: '30.07.2026', time: '18:00', type: 'Групповое · онлайн', status: 'done' },
    { id: 'h3', date: '26.07.2026', time: '16:00', type: 'Индив. · офлайн', status: 'absent' },
  ],
  // Подпись покупки собирает identifyProduct: «<категория> ×<занятий>». Строка
  // с ценой 0 — это сертификат или подарочное занятие, в кабинете она помечается
  // «подарок», а не «0 ₽».
  purchaseHistory: [
    { id: 'p1', date: '20.07.2026', label: 'Индив. офлайн ×4', price: 6000 },
    { id: 'p2', date: '05.06.2026', label: 'Групп. онлайн ×10', price: 8000 },
    { id: 'p3', date: '01.06.2026', label: 'Групп. онлайн ×1', price: 0 },
    { id: 'p4', date: '12.04.2026', label: 'Индив. онлайн ×1', price: 500, expired: true },
  ],
  profile: {
    fio: 'Иванов Александр',
    email: 'sasha@mail.ru',
    age: '12',
    gender: 'м',
    city: 'Москва',
    level: '1400 lichess',
  },
  email: 'sasha@mail.ru',
  emailPending: false,
  refLink: 'https://t.me/RepChessEducation_bot?start=ref_6666696537',
  buyLinks: [['Выбрать пакет на сайте', 'https://edu.repchess.ru']],
  promoAvailable: false,
}
