import type { CSSProperties } from 'react'

/**
 * Спиннер загрузки: шахматные фигуры по очереди выстраиваются в ряд
 * (пешка → конь → слон → ладья → ферзь → король), затем волна повторяется.
 * U+FE0E заставляет браузер показывать глифы как текст, а не эмодзи.
 */
const PIECES = ['♟', '♞', '♝', '♜', '♛', '♚'].map((p) => p + '\uFE0E')

export default function WorkingSpinner() {
  return (
    <div className="working" role="status" aria-live="polite">
      <div className="lineup">
        {PIECES.map((p, i) => (
          <span key={i} className="lineup-piece" style={{ '--i': i } as CSSProperties}>
            {p}
          </span>
        ))}
      </div>
      <div className="working-note">загружаем страницы турнира и считаем…</div>
    </div>
  )
}
