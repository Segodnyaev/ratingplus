import { useCallback, useState } from 'react'
import {
  buildIndividualUrl,
  buildStartListUrl,
  parseChessResultsUrl,
  parseIndividualCrosstable,
  parseStartList,
  type CrosstableData,
  type GameInfo,
  type PlayerInfo,
  type ParsedSourceUrl,
  type StartListData,
  type StartListPlayer,
} from './lib/chessResults'
import { fetchPage } from './lib/fetchPage'
import { calculateRatingChange } from './lib/rating'
import ResultPanel, { type AnalysisResult } from './components/ResultPanel'
import BrandIcon from './components/BrandIcon'
import QueenIcon from './components/QueenIcon'
import WorkingSpinner from './components/WorkingSpinner'

const EXAMPLE_URL =
  'https://s2.chess-results.com/tnr1534208.aspx?lan=11&art=9&fed=FID&snr=13&SNode=S0'

type Phase = 'idle' | 'working' | 'done' | 'error'

interface ManualSlot<T> {
  data: T
  fileName: string
}

/** Нормализация имени для сопоставления («Фамилия, Имя» в разных страницах может отличаться пробелами/ё) */
function normName(s: string): string {
  return s.toUpperCase().replace(/Ё/g, 'Е').replace(/[\s,.;]+/g, ' ').trim()
}

/** Сопоставление соперников со стартовым списком и расчёт */
function buildResult(
  player: PlayerInfo,
  games: GameInfo[],
  sl: StartListData | null,
  src: ParsedSourceUrl | null,
  via: string,
  manual: boolean,
): AnalysisResult {
  // индексы стартового списка: по номеру (snr) и по нормализованному имени —
  // у архивных турниров ссылки на игроков спрятаны, номер берётся из «Ном.»,
  // а если и его нет — сопоставляем по имени
  const bySnr = new Map<number, StartListPlayer>()
  const byName = new Map<string, StartListPlayer>()
  if (sl) {
    for (const p of sl.players) {
      if (p.snr != null && !bySnr.has(p.snr)) bySnr.set(p.snr, p)
      const n = normName(p.name)
      if (n && !byName.has(n)) byName.set(n, p)
    }
  }

  // рейтинг самого игрока: сначала стартовый список (по snr, затем по имени), затем его страница
  let playerRating: number | null = null
  let playerRatingSource: AnalysisResult['playerRatingSource'] = 'none'
  const selfInList =
    (src?.playerSnr != null ? bySnr.get(src.playerSnr) : undefined) ??
    (player.name ? byName.get(normName(player.name)) : undefined)
  if (selfInList && selfInList.rating != null) {
    playerRating = selfInList.rating
    playerRatingSource = 'startlist'
  } else if (player.nationalRating != null) {
    playerRating = player.nationalRating
    playerRatingSource = 'playerPage'
  }

  const opponents = games.map((g) => {
    const inList =
      (g.oppSnr != null ? bySnr.get(g.oppSnr) : undefined) ??
      byName.get(normName(g.oppName)) ??
      (g.oppStartNo != null && /^\d+$/.test(g.oppStartNo) ? bySnr.get(Number(g.oppStartNo)) : undefined)
    let rating: number | null = null
    let ratingSource: AnalysisResult['opponents'][number]['ratingSource'] = 'unknown'
    if (inList && inList.rating != null) {
      rating = inList.rating
      ratingSource = 'startlist'
    } else if (g.oppNatRatingInTable != null && g.oppNatRatingInTable > 0) {
      // нац. рейтинг из колонки «Рейт.Нац.» таблицы партий (у архивных турниров)
      rating = g.oppNatRatingInTable
      ratingSource = 'crosstable'
    } else if (g.oppRatingInTable != null && g.oppRatingInTable > 0) {
      rating = g.oppRatingInTable
      ratingSource = 'crosstable'
    }
    return {
      round: g.round,
      name: g.oppName,
      color: g.color,
      rating,
      ratingSource,
      rawResult: g.rawResult,
      score: g.score,
    }
  })

  const calc = calculateRatingChange(
    playerRating,
    opponents.map((o) => ({ score: o.score, oppRating: o.rating })),
  )

  return {
    player,
    playerRatingSource,
    opponents,
    calc,
    startListTitle: sl?.tournamentTitle ?? null,
    via,
    manual,
  }
}

export default function App() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [manualCt, setManualCt] = useState<ManualSlot<CrosstableData> | null>(null)
  const [manualSl, setManualSl] = useState<ManualSlot<StartListData> | null>(null)

  const reset = () => {
    setPhase('idle')
    setResult(null)
    setError(null)
    setManualCt(null)
    setManualSl(null)
  }

  const run = useCallback(async () => {
    setResult(null)
    setError(null)
    setPhase('working')
    try {
      const src = parseChessResultsUrl(url)
      const individualUrl = buildIndividualUrl(src)
      const page1 = await fetchPage(individualUrl)
      const ct = parseIndividualCrosstable(page1.html, individualUrl)

      const slUrl = ct.startListUrl ?? buildStartListUrl(src)
      const page2 = await fetchPage(slUrl)
      const sl = parseStartList(page2.html)

      const res = buildResult(ct.player, ct.games, sl, src, `${page1.via} + ${page2.via}`, false)
      setResult(res)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [url])

  const finishManual = (ct: ManualSlot<CrosstableData>, sl: ManualSlot<StartListData>) => {
    const res = buildResult(ct.data.player, ct.data.games, sl.data, null, 'локальные файлы', true)
    setResult(res)
    setError(null)
    setPhase('done')
  }

  const onManualFile = async (kind: 'ct' | 'sl', file: File) => {
    try {
      const text = await file.text()
      if (kind === 'ct') {
        const data = parseIndividualCrosstable(text, 'https://chess-results.com/tnr0.aspx')
        const slot = { data, fileName: file.name }
        setManualCt(slot)
        if (manualSl) finishManual(slot, manualSl)
      } else {
        const data = parseStartList(text)
        const slot = { data, fileName: file.name }
        setManualSl(slot)
        if (manualCt) finishManual(manualCt, slot)
      }
    } catch (e) {
      setError(`Файл «${file.name}» не подошёл: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('error')
    }
  }

  return (
    <div className="app">
      {/* водяной знак — огромный ферзь на фоне */}
      <div className="bg-queen" aria-hidden="true">
        <QueenIcon />
      </div>
      <header className="top">
        <div className="logo">
          <BrandIcon />
        </div>
        <div>
          <h1>Рейтинг+</h1>
          <div className="subtitle">
            насколько вырастет национальный рейтинг ФШР по результатам турнира
          </div>
        </div>
      </header>

      <section className="card hero fade-up">
        <label className="field-label" htmlFor="url">
          Ссылка на личную таблицу игрока с chess-results.com
        </label>
        <div className="input-row">
          <input
            id="url"
            className="url-input"
            type="url"
            value={url}
            placeholder={EXAMPLE_URL}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim() && phase !== 'working') void run()
            }}
          />
          <button
            className="btn"
            onClick={() => void run()}
            disabled={phase === 'working' || !url.trim()}
          >
            {phase === 'working' ? 'Считаем…' : 'Рассчитать'}
          </button>
        </div>
        <div className="hero-foot">
          <button className="example-chip" onClick={() => setUrl(EXAMPLE_URL)}>
            вставить пример
          </button>
          <span className="hint">
            страница игрока, где видны партии по турам (в адресе — art=9 и snr)
          </span>
        </div>

        {phase === 'working' && <WorkingSpinner />}
      </section>

      {phase === 'error' && error && (
        <section className="card error-card fade-up">
          <div className="error-title">Не получилось</div>
          <div className="error-text">{error}</div>
        </section>
      )}

      {phase === 'done' && result && <ResultPanel result={result} onReset={reset} />}

      <details className="card manual">
        <summary>Ручной режим — если прокси недоступны</summary>
        <p className="hint">
          Сохраните две страницы chess-results.com на диск (Ctrl+S): 1 — личную таблицу игрока,
          2 — «Стартовый список» турнира, и загрузите оба файла. Разбор и расчёт выполняются
          локально, без сети.
        </p>
        <div className="manual-row">
          <label className="btn-ghost file-btn">
            <input
              type="file"
              accept=".html,.htm,.aspx,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onManualFile('ct', f)
              }}
            />
            Файл 1 — личная таблица игрока
          </label>
          {manualCt && <span className="chip ok">✓ {manualCt.fileName}</span>}
        </div>
        <div className="manual-row">
          <label className="btn-ghost file-btn">
            <input
              type="file"
              accept=".html,.htm,.aspx,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onManualFile('sl', f)
              }}
            />
            Файл 2 — стартовый список
          </label>
          {manualSl && <span className="chip ok">✓ {manualSl.fileName}</span>}
        </div>
      </details>

      <footer className="foot">
        Оценка по правилам пересчёта рейтинга ФШР. Официальный пересчёт выполняет федерация; рейтинги берутся из стартового списка на
        chess-results.com.
      </footer>
    </div>
  )
}
