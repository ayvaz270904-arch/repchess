import { List, Section, Cell } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { MascotEmpty } from '../ui/MascotEmpty'
import { plural, ruDate, lessonType } from '../format'

function money(n: number): string {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
}

export function HistoryScreen({ data }: { data: Cabinet }) {
  const done = data.lessonHistory.filter((h) => h.status === 'done').length
  const purchases = data.purchaseHistory.length
  // Сертификаты и подарочные занятия приходят строкой с ценой 0. Считать их
  // «покупками» молча — неправда, поэтому в той же карточке показываем разбивку.
  const paid = data.purchaseHistory.filter((p) => p.price > 0).length
  const gifts = purchases - paid

  // Прогресс по остатку. Знаменатель считаем по НЕотрицательному остатку: при долге
  // (остаток < 0) шкала — это только пройденные занятия, полоса заполнена целиком,
  // а сам долг выносим в подпись справа. Иначе долг «съедал» бы шкалу и полоса
  // показывала бы больше 100%.
  const left = data.balanceTotal
  const scale = done + Math.max(0, left)

  return (
    <List>
      <div className="screen-title">История</div>

      {/* Счётчика «Пропущено» здесь намеренно НЕТ: кабинет не журнал посещаемости
          («человек не обязан, это не университет»). Статус конкретного занятия
          в списке ниже остаётся — иначе непонятно, куда делось оплаченное. */}
      {data.lessonHistory.length > 0 && (
        <div className="stat-strip stat-strip-2">
          <div className="stat-card">
            <div className="stat-num">{done}</div>
            <div className="stat-lbl">Пройдено</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{purchases}</div>
            <div className="stat-lbl">Покупок</div>
            {/* Разбивку показываем, только если подарки вообще есть: у большинства
                клиентов их нет, и строка «· 0 подарков» была бы шумом. */}
            {gifts > 0 && (
              <div className="stat-split">
                {paid > 0 && <>{paid} {plural(paid, 'платная', 'платные', 'платных')} · </>}
                {gifts} {plural(gifts, 'подарок', 'подарка', 'подарков')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Здесь была полоса из 12 квадратиков (красный — проведено, пустой — пропуск).
          Она ничем не подписывалась и отмечала ровно то же, что убранный счётчик
          «Пропущено». Заменена на прогресс по остатку: то же место, но про
          продвижение вперёд, а не про то, где человек не пришёл. */}
      {scale > 0 && (
        <div className="prog-bar-wrap">
          <div className="prog-bar-top">
            {/* Именно доля, а не «Пройдено N»: число пройденных уже стоит в карточке
                выше, а знаменатель есть только здесь. */}
            <span className="pb-done">
              {done} из {scale}
            </span>
            <span className={'pb-left' + (left < 0 ? ' debt' : '')}>
              {left > 0 ? `осталось ${left}` : left === 0 ? 'занятия закончились' : `долг ${-left}`}
            </span>
          </div>
          <div className="prog-bar">
            <div className="prog-bar-fill" style={{ width: Math.round((done / scale) * 100) + '%' }} />
          </div>
        </div>
      )}

      <div className="home-sec-title">Занятия</div>
      {data.lessonHistory.length ? (
        <Section>
          {/* Подписи под занятием. Раньше сюда падала голая заметка тренера — на разборе
              человек читал строку «тактика» и не понимал, что это такое; теперь она
              подписана «тема».
              И главное: у пропуска сказано, что занятие НЕ списано. Проверено по коду
              (lessonsInfo): статус 'absent' уходит в историю до used++, то есть с баланса
              не снимается. Красная пилюля «пропуск» без этой строки читалась как штраф. */}
          {data.lessonHistory.map((h) => {
            const { kind, fmt } = lessonType(h.type)
            const absent = h.status === 'absent'
            return (
              <Cell
                key={h.id}
                multiline
                readOnly
                before={<CellIcon name={absent ? 'clock' : 'check'} tone={absent ? 'red' : 'neutral'} />}
                subtitle={
                  [fmt, h.time, absent ? 'занятие не списано' : '', h.notes ? 'тема: ' + h.notes : '']
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                // Пилюля осталась ТОЛЬКО у пропуска. «Проведено» — обычное состояние
                // каждой строки, и значок слева его уже показывает: badge на норме
                // отнимал место у заголовка (из-за него «Групповое · онлайн» уезжало
                // на вторую строку) и глушил единственное, что стоит замечать.
                after={absent ? <span className="pill pill-warn">пропуск</span> : undefined}
              >
                {ruDate(h.date)} · {kind}
              </Cell>
            )
          })}
        </Section>
      ) : (
        <MascotEmpty text="Занятий пока не было — запишись на первое!" />
      )}

      <div className="home-sec-title">Покупки</div>
      {data.purchaseHistory.length ? (
        <Section>
          {data.purchaseHistory.map((p) => (
            <Cell
              key={p.id}
              multiline
              readOnly
              before={<CellIcon name={p.price ? 'card' : 'gift'} />}
              // Было просто «истёк» — непонятно, что именно: оплата, доступ, занятия.
              subtitle={ruDate(p.date) + (p.expired ? ' · срок действия истёк' : '')}
              // Сертификат и подарочное занятие приходят строкой с ценой 0 — и в списке
              // покупок это выглядело как «0 ₽», то есть как ошибка счёта. Отличить
              // сертификат от промо-подарка клиент всё равно не может (обе строки
              // нулевые), поэтому слово нейтральное и верное для обоих случаев.
              after={p.price ? <span className="cell-price">{money(p.price)}</span> : <span className="pill pill-ok">подарок</span>}
            >
              {p.label}
            </Cell>
          ))}
        </Section>
      ) : (
        <MascotEmpty text="Покупок пока нет" />
      )}
    </List>
  )
}
