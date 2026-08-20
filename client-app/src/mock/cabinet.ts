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
  openGroups: [
    {
      id: 'g1', date: 'Пт, 9 авг', time: '18:00', format: 'online', venue: 'Zoom + Lichess',
      trainerName: 'Мария', count: 5, max: 8, joined: true, regOpen: true,
      hasLinks: true, linksOpen: true, voiceUrl: 'https://t.me/repchess', studioUrl: 'https://lichess.org/study',
    },
    {
      id: 'g2', date: 'Сб, 10 авг', time: '12:00', format: 'offline', venue: 'ул. Пушкина, 10',
      trainerName: 'Артём', count: 6, max: 6, joined: false, regOpen: true, canJoin: false,
    },
    {
      id: 'g3', date: 'Вс, 11 авг', time: '15:00', format: 'online', venue: 'Zoom + Lichess',
      trainerName: 'Мария', count: 2, max: 8, joined: false, regOpen: false, opensAt: '9 авг, 10:00',
    },
  ],
  schedule: {
    days: [
      { date: '2026-08-07', label: 'Четверг, 7 авг', items: [
        { time: '16:00', title: 'Индивидуальные занятия' },
        { time: '19:00', title: 'Онлайн-лекция: испанская партия', url: 'https://t.me/repchess' },
      ] },
      { date: '2026-08-09', label: 'Суббота, 9 авг', items: [
        { time: '12:00', title: 'Групповое офлайн, младшая группа' },
        { time: '18:00', title: 'Турнир выходного дня', ticketUrl: 'https://edu.repchess.ru', ticketLabel: 'Регистрация' },
      ] },
    ],
    note: { text: 'Приведи друга — занятие в подарок', url: 'https://edu.repchess.ru' },
    postUrl: 'https://t.me/RepChessEducation',
  },
  lessonHistory: [
    { id: 'h1', date: '2 авг', time: '16:00', type: 'Индивидуальное', status: 'done', notes: 'Разобрали дебют, эндшпиль' },
    { id: 'h2', date: '30 июл', time: '18:00', type: 'Групповое онлайн', status: 'done' },
    { id: 'h3', date: '26 июл', time: '16:00', type: 'Индивидуальное', status: 'absent' },
  ],
  purchaseHistory: [
    { id: 'p1', date: '20 июл', label: 'Индивидуальные, 4 занятия', price: 6000 },
    { id: 'p2', date: '5 июн', label: 'Групповые онлайн, 10 занятий', price: 8000 },
    { id: 'p3', date: '12 апр', label: 'Пробное занятие', price: 500, expired: true },
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
