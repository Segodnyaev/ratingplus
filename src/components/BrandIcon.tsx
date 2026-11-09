/**
 * Брендовая иконка «R+» — точно как favicon.svg:
 * градиентная плашка + шахматные клетки + белые «R+».
 */
const CELL_POSITIONS: Array<[number, number]> = [
  [0, 0],
  [2, 0],
  [1, 1],
  [3, 1],
  [0, 2],
  [2, 2],
  [1, 3],
  [3, 3],
]

export default function BrandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Рейтинг+">
      <defs>
        <linearGradient id="rplus-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <clipPath id="rplus-r">
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#rplus-g)" />
      <g clipPath="url(#rplus-r)">
        {CELL_POSITIONS.map(([i, j]) => (
          <rect
            key={`${i}-${j}`}
            x={i * 16}
            y={j * 16}
            width="16"
            height="16"
            fill="#0b1020"
            opacity="0.22"
          />
        ))}
      </g>
      <text
        x="32"
        y="43.5"
        textAnchor="middle"
        fontSize="30"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="Arial, 'Helvetica Neue', Helvetica, sans-serif"
      >
        R+
      </text>
    </svg>
  )
}
