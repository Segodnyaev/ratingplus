/**
 * Шахматный конь — фирменная фигура приложения (стилизованный силуэт).
 * Один и тот же путь используется в логотипе, на фоне и в favicon (public/favicon.svg).
 */
export default function KnightIcon({
  eye = false,
  className,
}: {
  /** рисовать глаз (для логотипа на градиентной плашке) */
  eye?: boolean
  className?: string
}) {
  return (
    <svg viewBox="0 0 45 45" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {/* корпус коня */}
        <path d="M33 38.5C36.5 31 36 25 33 20C32 17 31.5 15.5 32 13L29.5 8.5L27 12.5C24.5 13 22 14.5 19.5 17C17.8 18.6 16 20.8 14.9 23.2C14.3 24.7 14.5 26 15.6 26.7C16.6 27.3 18 27.4 19.8 27.4L21.8 27.4C24.6 27.7 26.9 29.5 28.7 32.6C30.1 35.1 30.6 36.9 30.6 38.5Z" />
        {/* подставка */}
        <rect x="10.5" y="39" width="24" height="3" rx="1.5" />
        <rect x="8.5" y="42.3" width="28" height="2.7" rx="1.35" />
      </g>
      {eye && <circle cx="23.6" cy="15.9" r="1.3" fill="rgba(124,92,255,0.9)" />}
    </svg>
  )
}
