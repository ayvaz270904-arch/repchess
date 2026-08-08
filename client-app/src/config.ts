// Бэкенд — тот же GAS веб-апп, что и у старого client.html.
export const BACKEND =
  'https://script.google.com/macros/s/AKfycbymBB1BkAnqLi_uLt9M1rVJ-rFGa0fK225hw-HvlhxgxsbVO4K5gka44FTFzYLss-tVZg/exec'

export const POLICY_URL = 'https://repchess.ru/policy'
export const OFFER_URL = 'https://repchess.ru/offer'
export const HELPER_URL = 'https://t.me/RepChess_Edu_Helper'

// Кнопки покупки на Главной. UTM — чтобы аналитика сайта видела переходы из бота.
export const BUY_LINKS: [string, string][] = [
  ['Выбрать пакет на сайте', 'https://repchess.ru/education?utm_source=telegram&utm_medium=bot_cabinet&utm_campaign=buy'],
]
