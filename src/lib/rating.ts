/**
 * Правила пересчёта национального рейтинга ФШР после турнира.
 *
 * Источники:
 *  - ruchess.ru/news/report/zachem_nam_nuzhem_rossiyskiy_rating — формула
 *    Rо = Rн + ΣΔR × K, ΔR = N − PD и таблица коэффициентов K;
 *  - «Таблица преобразования разности рейтингов» (таблица Эло) из регламентов
 *    турниров с обсчётом российского рейтинга: 000–003 → 0,50 … 375–391 → 0,91,
 *    392–411 → 0,92; в системе ФШР значения выше 0,92 нет — разница больше 400
 *    считается как 400;
 *  - точность сверена с официальным пересчётом на ratings.ruchess.ru
 *    (турнир 250182: 43 игрока, 238 партии — все ожидаемые результаты E и все
 *    итоговые изменения рейтинга воспроизведены без расхождений).
 *
 * Формула:  Δ = K × (W − We)
 *  - K зависит от рейтинга игрока на начало турнира (таблица ниже)
 *  - We — ожидаемые очки: по каждой партии берётся значение из таблицы
 *    преобразования разности рейтингов (интерполяции нет)
 *  - разница рейтингов больше 400 считается как 400
 *  - партии, на которые соперник не явился, в расчёт не идут
 *  - игрок или соперник без рейтинга считается имеющим рейтинг 1000
 *  - итог округляется до целого (0,5 — в большую сторону)
 *  - рейтинг не опускается ниже 1000
 */

export interface ExpectedTableRow {
  /** нижняя граница разницы рейтингов (включительно) */
  from: number
  /** верхняя граница (включительно); null — «и больше» */
  to: number | null
  /** вероятность победы более сильного (выше рейтингом) игрока */
  strong: number
}

/**
 * Таблица преобразования разности рейтингов (таблица Эло).
 * Вероятность указана для более сильного игрока; у слабого — дополнение до 1.
 */
export const EXPECTED_TABLE: readonly ExpectedTableRow[] = [
  { from: 0, to: 3, strong: 0.5 },
  { from: 4, to: 10, strong: 0.51 },
  { from: 11, to: 17, strong: 0.52 },
  { from: 18, to: 25, strong: 0.53 },
  { from: 26, to: 32, strong: 0.54 },
  { from: 33, to: 39, strong: 0.55 },
  { from: 40, to: 46, strong: 0.56 },
  { from: 47, to: 53, strong: 0.57 },
  { from: 54, to: 61, strong: 0.58 },
  { from: 62, to: 68, strong: 0.59 },
  { from: 69, to: 76, strong: 0.6 },
  { from: 77, to: 83, strong: 0.61 },
  { from: 84, to: 91, strong: 0.62 },
  { from: 92, to: 98, strong: 0.63 },
  { from: 99, to: 106, strong: 0.64 },
  { from: 107, to: 113, strong: 0.65 },
  { from: 114, to: 121, strong: 0.66 },
  { from: 122, to: 129, strong: 0.67 },
  { from: 130, to: 137, strong: 0.68 },
  { from: 138, to: 145, strong: 0.69 },
  { from: 146, to: 153, strong: 0.7 },
  { from: 154, to: 162, strong: 0.71 },
  { from: 163, to: 170, strong: 0.72 },
  { from: 171, to: 179, strong: 0.73 },
  { from: 180, to: 188, strong: 0.74 },
  { from: 189, to: 197, strong: 0.75 },
  { from: 198, to: 206, strong: 0.76 },
  { from: 207, to: 215, strong: 0.77 },
  { from: 216, to: 225, strong: 0.78 },
  { from: 226, to: 235, strong: 0.79 },
  { from: 236, to: 245, strong: 0.8 },
  { from: 246, to: 256, strong: 0.81 },
  { from: 257, to: 267, strong: 0.82 },
  { from: 268, to: 278, strong: 0.83 },
  { from: 279, to: 290, strong: 0.84 },
  { from: 291, to: 302, strong: 0.85 },
  { from: 303, to: 315, strong: 0.86 },
  { from: 316, to: 328, strong: 0.87 },
  { from: 329, to: 344, strong: 0.88 },
  { from: 345, to: 357, strong: 0.89 },
  { from: 358, to: 374, strong: 0.9 },
  { from: 375, to: 391, strong: 0.91 },
  { from: 392, to: null, strong: 0.92 },
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
 * Ожидаемый результат партии для игрока (по таблице преобразования разности
 * рейтингов; без интерполяции).
 * @param diff разница рейтингов: рейтинг соперника − рейтинг игрока.
 *             Положительная — соперник сильнее.
 */
export function expectedScore(diff: number): number {
  const d = Math.max(-MAX_RATING_DIFF, Math.min(MAX_RATING_DIFF, diff))
  const abs = Math.abs(d)

  const row =
    EXPECTED_TABLE.find((r) => r.to == null || abs <= r.to) ??
    EXPECTED_TABLE[EXPECTED_TABLE.length - 1]

  // row.strong — вероятность более сильного игрока в паре:
  // если соперник выше рейтингом (d > 0), игрок «слабый»
  return d > 0 ? 1 - row.strong : row.strong
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
  /** изменение рейтинга (округлено до целого, 0,5 — в большую сторону) */
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

  // Итог округляется до целого; 0,5 уходит в большую сторону (как на
  // ratings.ruchess.ru: −20,5 → −20, +6,5 → +7). Чтобы ошибки двоичной
  // арифметики не сдвигали полусуммы (3.5 − 3.91 ≠ −0.41 во float),
  // считаем в сотых долях — очки и ожидания всегда кратны 0,01.
  const pointsH = Math.round(points * 100)
  const expectedH = Math.round(expected * 100)
  const delta = playedGames > 0 ? Math.round((k * (pointsH - expectedH)) / 100) : 0
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
