import type { ReactNode } from 'react'
import { EXPECTED_TABLE, K_TABLE, type RatingChange } from '../lib/rating'
import type { PlayerInfo } from '../lib/chessResults'

export interface OpponentRow {
  round: number
  name: string
  color: 'w' | 'b' | null
  rating: number | null
  ratingSource: 'startlist' | 'crosstable' | 'unknown'
  rawResult: string
  score: number | null
}

export interface AnalysisResult {
  player: PlayerInfo
  playerRatingSource: 'startlist' | 'playerPage' | 'none'
  opponents: OpponentRow[]
  calc: RatingChange
  startListTitle: string | null
  via: string
  manual: boolean
}

const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt2 = (n: number) => nf2.format(n)
const fmtSigned2 = (n: number) => (n > 0 ? '+' : '') + nf2.format(n)

function scoreBadge(score: number | null, raw: string): ReactNode {
  if (score === 1) return <span className="badge win">1</span>
  if (score === 0.5) return <span className="badge draw">½</span>
  if (score === 0) return <span className="badge loss">0</span>
  return (
    <span className="badge none" title="партия без игры — в расчёт рейтинга не идёт">
      {raw}
    </span>
  )
}

const SOURCE_LABEL: Record<OpponentRow['ratingSource'], string> = {
  startlist: 'из стартового списка',
  crosstable: 'из таблицы партий',
  unknown: 'нет рейтинга → считаем 1000',
}

export default function ResultPanel({
  result,
  onReset,
}: {
  result: AnalysisResult
  onReset: () => void
}) {
  const { player, calc, opponents } = result
  const unplayed = opponents.filter((o) => o.score == null).length
  const unknownOpp = opponents.filter((o) => o.rating == null && o.score != null).length
  const lastDiff = EXPECTED_TABLE[EXPECTED_TABLE.length - 1].diff

  return (
    <div className="result">
      <section className="card player-card fade-up">
        <div className="player-top">
          <h2>{player.name}</h2>
          <span className="chip">{result.manual ? 'локальные файлы' : `источник: ${result.via}`}</span>
        </div>
        {result.startListTitle && <div className="player-meta">{result.startListTitle}</div>}
        <div className="player-meta">
          {[player.club, player.born ? `г.р. ${player.born}` : null, player.federation]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div className="stats">
          <div className="stat">
            <div className="k">Рейтинг до турнира</div>
            <div className="v">{calc.baseRating}</div>
            <div className="src">
              {result.playerRatingSource === 'startlist'
                ? 'из стартового списка'
                : result.playerRatingSource === 'playerPage'
                  ? 'со страницы игрока'
                  : 'нет — считаем как у новичка (1000)'}
            </div>
          </div>
          <div className="stat">
            <div className="k">Очки в турнире</div>
            <div className="v">{player.points ?? '—'}</div>
            <div className="src">
              {calc.playedGames} партий в расчёте{unplayed > 0 ? `, ${unplayed} без игры` : ''}
            </div>
          </div>
          {player.performance && (
            <div className="stat">
              <div className="k">Перфоманс</div>
              <div className="v">{player.performance}</div>
              <div className="src">рейтинговый перфоманс</div>
            </div>
          )}
          {player.place && (
            <div className="stat">
              <div className="k">Место</div>
              <div className="v">{player.place}</div>
              <div className="src">итоговое положение</div>
            </div>
          )}
        </div>
      </section>

      <section className="card delta-banner fade-up">
        <div className="delta-label">Изменение национального рейтинга ФШР</div>
        <div className={`delta-num ${calc.delta > 0 ? 'pos' : calc.delta < 0 ? 'neg' : 'zero'}`}>
          {calc.delta > 0 ? `+${calc.delta}` : calc.delta}
        </div>
        <div className="delta-sub">
          новый рейтинг ≈ <b>{calc.newRating}</b> (было {calc.baseRating})
        </div>
        <div className="chips">
          <span className="chip">K = {calc.k}</span>
          <span className="chip">очки W = {fmt2(calc.points)}</span>
          <span className="chip">ожидание We = {fmt2(calc.expected)}</span>
          <span className="chip">Δ = K × (W − We)</span>
        </div>
        {calc.usedDefaultPlayerRating && (
          <div className="warn-line">
            У игрока нет национального рейтинга — расчёт выполнен как для новичка с рейтингом 1000.
          </div>
        )}
        {unknownOpp > 0 && (
          <div className="warn-line">
            У {unknownOpp} соперника(ов) нет национального рейтинга — для них взято значение 1000.
          </div>
        )}
        {calc.playedGames === 0 && (
          <div className="warn-line">Нет сыгранных партий — рассчитать изменение не возможно.</div>
        )}
      </section>

      <section className="card fade-up">
        <h3 className="sec-title">Соперники и ожидаемые результаты</h3>
        <div className="table-wrap">
          <table className="res">
            <thead>
              <tr>
                <th className="num">Тур</th>
                <th>Соперник</th>
                <th>Цвет</th>
                <th className="num">Рейтинг</th>
                <th>Рез.</th>
                <th className="num">Ожид.</th>
                <th className="num">Вклад</th>
              </tr>
            </thead>
            <tbody>
              {opponents.map((o, i) => {
                const pg = calc.perGame[i]
                const counted = pg?.counted ?? false
                const contribution =
                  counted && pg.score != null ? fmtSigned2(pg.score - (pg.expected ?? 0)) : '—'
                return (
                  <tr key={`${o.round}-${i}`}>
                    <td className="num">{o.round}</td>
                    <td>{o.name}</td>
                    <td>
                      {o.color ? (
                        <span
                          className={`color-chip ${o.color}`}
                          title={o.color === 'w' ? 'белыми' : 'чёрными'}
                        >
                          {'\u265A\uFE0E'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">
                      {o.rating != null ? (
                        <span title={SOURCE_LABEL[o.ratingSource]} className="has-src">
                          <span className={`src-dot ${o.ratingSource}`} />
                          {o.rating}
                        </span>
                      ) : (
                        <span className="muted" title={SOURCE_LABEL.unknown}>
                          нет → 1000
                        </span>
                      )}
                    </td>
                    <td>{scoreBadge(o.score, o.rawResult)}</td>
                    <td className="num">{counted ? fmt2(pg.expected ?? 0) : '—'}</td>
                    <td className="num">{contribution}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Итого</td>
                <td className="num">{fmt2(calc.points)}</td>
                <td className="num">{fmt2(calc.expected)}</td>
                <td className="num">{calc.delta > 0 ? `+${calc.delta}` : calc.delta}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="legend">
          <span>
            <span className="src-dot startlist" /> рейтинг из стартового списка
          </span>
          <span>
            <span className="src-dot crosstable" /> из таблицы партий
          </span>
          <span>
            <span className="src-dot unknown" /> нет рейтинга → 1000
          </span>
        </div>
      </section>

      <details className="card formula fade-up">
        <summary>Как считается (правила ФШР)</summary>
        <div className="formula-grid">
          <div>
            <h4>Коэффициент K по рейтингу</h4>
            <table className="mini">
              <thead>
                <tr>
                  <th>Рейтинг</th>
                  <th className="num">K</th>
                </tr>
              </thead>
              <tbody>
                {K_TABLE.map((r) => (
                  <tr key={r.from} className={r.k === calc.k ? 'hl' : ''}>
                    <td>
                      {r.from}
                      {r.to ? `–${r.to}` : '+'}
                    </td>
                    <td className="num">{r.k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Ожидаемый результат за партию</h4>
            <table className="mini">
              <thead>
                <tr>
                  <th>Разница рейтингов*</th>
                  <th className="num">У сильного</th>
                  <th className="num">У слабого</th>
                </tr>
              </thead>
              <tbody>
                {EXPECTED_TABLE.map((r) => (
                  <tr key={r.diff}>
                    <td>
                      {r.diff === 0 ? '0' : r.diff === lastDiff ? `${r.diff} и больше` : r.diff}
                    </td>
                    <td className="num">{r.strong.toFixed(2).replace('.', ',')}</td>
                    <td className="num">{(1 - r.strong).toFixed(2).replace('.', ',')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              * насколько рейтинг соперника выше рейтинга игрока; разница больше 400 считается как
              400, промежуточные значения интерполируются линейно.
            </p>
          </div>
        </div>
        <ul className="notes">
          <li>
            Изменение рейтинга: <b>Δ = K × (W − We)</b>, где W — набранные очки, We — ожидаемые
            очки. Итог округляется до целого числа.
          </li>
          <li>Партии, на которые соперник не явился, в расчёт не включаются.</li>
          <li>
            Новичок без рейтинга считается имеющим рейтинг 1000; рейтинг не опускается ниже 1000.
          </li>
          <li>
            Национальные рейтинги игрока и соперников берутся из «Стартового списка» турнира на
            chess-results.com.
          </li>
          <li>
            Источник правил:{' '}
            <a
              href="https://fenomenchess.ru/articles/reiting-fshr/"
              target="_blank"
              rel="noreferrer"
            >
              fenomenchess.ru
            </a>
            . Официальный пересчёт выполняет ФШР — результат здесь оценочный.
          </li>
        </ul>
      </details>

      <div className="result-actions">
        <button className="btn-ghost" onClick={onReset}>
          Посчитать ещё
        </button>
      </div>
    </div>
  )
}
