import sun from '../assets/star-sun.png'
import checker from '../assets/star-checker.png'

// Пустое состояние с картинкой вместо голого текста. По макету дизайнера
// (2026-09-29) маскот-ферзь из пустых состояний убран — он живёт на Главной, —
// а здесь две «звезды»: жёлтая с лицом и оранжевая в шашечку.
export function MascotEmpty({ text, pic = 'sun' }: { text: string; pic?: 'sun' | 'checker' }) {
  return (
    <div className="mascot-empty">
      <img src={pic === 'checker' ? checker : sun} alt="" aria-hidden="true" />
      <div className="mascot-empty-txt">{text}</div>
    </div>
  )
}
