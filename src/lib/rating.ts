/**
 * Правила пересчёта национального рейтинга ФШР после турнира.
 * Источник: https://fenomenchess.ru/articles/reiting-fshr/#kak-pereschityvaetsya-reiting-posle-turnira
 *
 * Формула:  изменение рейтинга = K × (набранные очки − ожидаемые очки)
 *  - K зависит от рейтинга игрока на начало турнира (таблица ниже)
 *  - ожидаемые очки считаются по каждой партии через таблицу ожидаемых результатов
 *    (разница рейтингов больше 400 считается как 400; промежуточные значения
 *    интерполируются линейно между контрольными точками таблицы)
 *  - партии, на которые соперник не явился, в расчёт не идут
 *  - новичок без рейтинга считается имеющим рейтинг 1000
 *  - рейтинг не может опуститься ниже 1000
 *  - итоговое изменение округляется до целого числа
 */

export interface ExpectedTableRow {
  diff: number
  /** ожидаемый результат у более сильного игрока */
  strong: number
}

/** Контрольные точки таблицы ожидаемых результатов ФШР */
export const EXPECTED_TABLE: readonly ExpectedTableRow[] = [
  { diff: 0, strong: 0.5 },
  { diff: 50, strong: 0.57 },
  { diff: 100, strong: 0.64 },
  { diff: 150, strong: 0.7 },
  { diff: 200, strong: 0.76 },
  { diff: 300, strong: 0.85 },
  { diff: 400, strong: 0.92 },
]

export const MAX_RATING_DIFF = 400

/** Таблица коэффициента K для показа в интерфейсе */
export const K_TABLE: readonly { from: number; to: number | null; k: number }[] = [
  { from: 1000, to: 1199, k: 60 },
  { from: 1200, to: 1399, k: 50 },
  { from: 1400, to: 1599, k: 40 },
  { from: 1600, to: 1799, k: 35 },
  { from: 1800, to: 1999, k: 30 },
  { from: 2000, to: 2199, k: 25 },
  { from: 2200, to: 2399, k: 20 },
  { from: 2400, to: null, k: 10 },
]

/** Рейтинг новичка без рейтинга (а также нижняя граница рейтинга) */
export const DEFAULT_RATING = 1000

/**
 * Ожидаемый результат партии для игрока.
 * @param diff разница рейтингов: рейтинг соперника − рейтинг игрока.
 *             Положительная — соперник сильнее.
 */
export function expectedScore(diff: number): number {
  const d = Math.max(-MAX_RATING_DIFF, Math.min(MAX_RATING_DIFF, diff))
  const abs = Math.abs(d)

  let strong = EXPECTED_TABLE[EXPECTED_TABLE.length - 1].strong
  for (let i = 1; i < EXPECTED_TABLE.length; i++) {
    const prev = EXPECTED_TABLE[i - 1]
    const cur = EXPECTED_TABLE[i]
    if (abs <= cur.diff) {
      const span = cur.diff - prev.diff
      const t = span === 0 ? 0 : (abs - prev.diff) / span
      strong = prev.strong + t * (cur.strong - prev.strong)
      break
    }
  }

  // если соперник слабее (d < 0) — игрок «сильный» в этой паре
  return d >= 0 ? 1 - strong : strong
}

/** Коэффициент K по рейтингу на начало турнира */
export function kFactor(rating: number): number {
  const r = Math.max(DEFAULT_RATING, Math.round(rating))
  if (r < 1200) return 60
  if (r < 1400) return 50
  if (r < 1600) return 40
  if (r < 1800) return 35
  if (r < 2000) return 30
  if (r < 2200) return 25
  if (r < 2400) return 20
  return 10
}

export interface CalcGameInput {
  /** очки за партию: 1 / 0.5 / 0; null — партия без игры (неявка и т.п.) */
  score: number | null
  /** рейтинг соперника; null — считается как рейтинг новичка 1000 */
  oppRating: number | null
}

export interface CalcPerGame {
  score: number | null
  expected: number | null
  diff: number | null
  oppRating: number | null
  counted: boolean
  usedDefaultOppRating: boolean
}

export interface RatingChange {
  /** рейтинг, взятый для расчёта (1000 для новичка) */
  baseRating: number
  /** рейтинг игрока был неизвестен — взят рейтинг новичка */
  usedDefaultPlayerRating: boolean
  k: number
  /** партий, попавших в расчёт */
  playedGames: number
  /** набранные очки W */
  points: number
  /** ожидаемые очки We */
  expected: number
  /** изменение рейтинга (округлено до целого) */
  delta: number
  /** новый рейтинг, не ниже 1000 */
  newRating: number
  perGame: CalcPerGame[]
}

export function calculateRatingChange(
  playerRating: number | null,
  games: CalcGameInput[],
): RatingChange {
  const usedDefaultPlayerRating = playerRating == null
  const baseRating = usedDefaultPlayerRating ? DEFAULT_RATING : playerRating
  const k = kFactor(baseRating)

  let points = 0
  let expected = 0
  let playedGames = 0

  const perGame: CalcPerGame[] = games.map((g) => {
    if (g.score == null) {
      return {
        score: null,
        expected: null,
        diff: null,
        oppRating: g.oppRating,
        counted: false,
        usedDefaultOppRating: false,
      }
    }
    const usedDefaultOppRating = g.oppRating == null
    const oppRating = g.oppRating == null ? DEFAULT_RATING : g.oppRating
    const diff = oppRating - baseRating
    const exp = expectedScore(diff)
    points += g.score
    expected += exp
    playedGames += 1
    return {
      score: g.score,
      expected: exp,
      diff,
      oppRating: g.oppRating,
      counted: true,
      usedDefaultOppRating,
    }
  })

  const delta = playedGames > 0 ? Math.round(k * (points - expected)) : 0
  const newRating = Math.max(DEFAULT_RATING, baseRating + delta)

  return {
    baseRating,
    usedDefaultPlayerRating,
    k,
    playedGames,
    points,
    expected,
    delta,
    newRating,
    perGame,
  }
}
