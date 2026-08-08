import mascot from '../assets/mascot.svg'

// Пустое состояние с маскотом школы вместо голого текста.
export function MascotEmpty({ text }: { text: string }) {
  return (
    <div className="mascot-empty">
      <img src={mascot} alt="" aria-hidden="true" />
      <div className="mascot-empty-txt">{text}</div>
    </div>
  )
}
