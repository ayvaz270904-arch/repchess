import { List, Section, Cell } from '@telegram-apps/telegram-ui'
import type { Cabinet } from '../types'
import { CellIcon } from '../ui/CellIcon'
import { MascotEmpty } from '../ui/MascotEmpty'

function money(n: number): string {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
}

export function HistoryScreen({ data }: { data: Cabinet }) {
  const done = data.lessonHistory.filter((h) => h.status === 'done').length
  const purchases = data.purchaseHistory.length

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
          {data.lessonHistory.map((h) => (
            <Cell
              key={h.id}
              multiline
              readOnly
              before={
                <CellIcon
                  name={h.status === 'absent' ? 'clock' : 'check'}
                  tone={h.status === 'absent' ? 'red' : 'neutral'}
                />
              }
              subtitle={h.notes}
              after={
                <span className={'pill ' + (h.status === 'absent' ? 'pill-warn' : 'pill-ok')}>
                  {h.status === 'absent' ? 'пропуск' : 'проведено'}
                </span>
              }
            >
              {h.date}
              {h.time ? ` · ${h.time}` : ''} · {h.type}
            </Cell>
          ))}
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
              before={<CellIcon name="card" />}
              subtitle={p.date + (p.expired ? ' · истёк' : '')}
              after={<span className="cell-price">{money(p.price)}</span>}
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
