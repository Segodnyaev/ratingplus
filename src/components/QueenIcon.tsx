/**
 * Классический ферзь (силуэт Staunton): корона с пятью шарами,
 * зигзаг зубцов, корпус и двухступенчатое основание.
 */
export default function QueenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 45 45" className={className} aria-hidden="true">
      <g fill="currentColor">
        <circle cx="6.2" cy="7.6" r="1.7" />
        <circle cx="13.6" cy="6.0" r="1.7" />
        <circle cx="22.5" cy="4.2" r="1.9" />
        <circle cx="31.4" cy="6.0" r="1.7" />
        <circle cx="38.8" cy="7.6" r="1.7" />
        <path d="M4 19.5 L6.2 9.8 L10.8 17.2 L13.6 8.2 L18 16.6 L22.5 6.4 L27 16.6 L31.4 8.2 L34.2 17.2 L38.8 9.8 L41 19.5 C41.6 21.6 40 23 37.6 23.4 L35 24.2 C32.2 27.4 30.6 30.6 29.8 34 L29.4 37.6 L15.6 37.6 L15.2 34 C14.4 30.6 12.8 27.4 10 24.2 L7.4 23.4 C5 23 3.4 21.6 4 19.5 Z" />
        <rect x="10.5" y="38.6" width="24" height="2.8" rx="1.4" />
        <rect x="8" y="41.8" width="29" height="2.7" rx="1.35" />
      </g>
    </svg>
  )
}
