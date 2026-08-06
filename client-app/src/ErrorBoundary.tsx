import { Component, type ErrorInfo, type ReactNode } from 'react'

// Последний рубеж: любая ошибка рендера показывает дружелюбный экран с перезагрузкой,
// а не белый экран внутри Telegram.
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Rep Chess cabinet crashed:', error, info)
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children
    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '40px 24px',
          textAlign: 'center',
          color: '#e8e8e8',
          fontFamily: '-apple-system, system-ui, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ fontSize: 42 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Что-то пошло не так</div>
        <div style={{ fontSize: 14, color: '#8a8f9c', maxWidth: 260 }}>
          Попробуйте перезагрузить кабинет. Если не поможет — напишите нам.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            border: 'none',
            borderRadius: 12,
            padding: '12px 22px',
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            background: '#c94a42',
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      </div>
    )
  }
}
