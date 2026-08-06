import type { IndivSlots } from '../types'

// Мок слотов для dev-превью (в проде приходит из GAS action=indivSlots).
export const MOCK_SLOTS: IndivSlots = {
  trainer: 'Артём',
  canOffline: true,
  canOnline: true,
  remaining: 4,
  days: [
    {
      date: '2026-08-07',
      dow: 'Чт',
      label: '07.08',
      slots: [
        { time: '15:00', format: 'offline' },
        { time: '16:00', format: 'both' },
        { time: '18:00', format: 'online' },
      ],
    },
    {
      date: '2026-08-08',
      dow: 'Пт',
      label: '08.08',
      slots: [
        { time: '14:00', format: 'both' },
        { time: '17:00', format: 'both' },
      ],
    },
    {
      date: '2026-08-09',
      dow: 'Сб',
      label: '09.08',
      slots: [
        { time: '11:00', format: 'offline' },
        { time: '12:00', format: 'offline' },
        { time: '13:00', format: 'both' },
        { time: '19:00', format: 'online' },
      ],
    },
    { date: '2026-08-11', dow: 'Пн', label: '11.08', slots: [] },
  ],
}
