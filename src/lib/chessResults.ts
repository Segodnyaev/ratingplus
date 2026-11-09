/**
 * Клиентский парсер chess-results.com (без сервера): строки страниц разбираются
 * прямо в браузере через DOMParser.
 *
 * Ожидаемые страницы:
 *  - art=9  — личная таблица игрока: метаданные + партии по турам
 *  - art=0  — стартовый список турнира (национальные рейтинги участников)
 */

export interface PlayerInfo {
  name: string
  startNumber: string | null
  nationalRating: number | null
  fideRating: number | null
  points: string | null
  performance: string | null
  place: string | null
  federation: string | null
  club: string | null
  born: string | null
}

export interface GameInfo {
  round: number
  board: string | null
  oppName: string
  oppSnr: number | null
  oppStartNo: string | null
  /** рейтинг соперника, показанный прямо в таблице партий (запасной источник; как правило межд.) */
  oppRatingInTable: number | null
  /** национальный рейтинг соперника из таблицы партий (колонка «Рейт.Нац.») */
  oppNatRatingInTable: number | null
  color: 'w' | 'b' | null
  /** исходная запись результата: 1 / ½ / 0 / + / − */
  rawResult: string
  /** партия состоялась и попадает в расчёт */
  played: boolean
  /** очки за партию, null — партия без игры */
  score: number | null
}

export interface CrosstableData {
  player: PlayerInfo
  games: GameInfo[]
  /** найденная на странице ссылка «Стартовый список» */
  startListUrl: string | null
  tournamentTitle: string | null
}

export interface StartListPlayer {
  /** номер игрока в турнире; null — не удалось определить (нет ссылки и колонки «Ном.») */
  snr: number | null
  name: string
  /** национальный рейтинг; null — рейтинга нет (считается 1000) */
  rating: number | null
  rawRating: string
}

export interface StartListData {
  players: StartListPlayer[]
  tournamentTitle: string | null
}

const CR_HOST = /(^|\.)chess-results\.com$/i

export interface ParsedSourceUrl {
  host: string
  tournamentId: string
  params: URLSearchParams
  playerSnr: number | null
}

/** Разбор и валидация пользовательской ссылки */
export function parseChessResultsUrl(raw: string): ParsedSourceUrl {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Введите ссылку на страницу игрока с chess-results.com')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    url = new URL(`https://${trimmed}`)
  }
  if (!CR_HOST.test(url.hostname)) {
    throw new Error(
      'Ссылка должна вести на chess-results.com, например: https://s2.chess-results.com/tnr1534208.aspx?lan=11&art=9&fed=FID&snr=13&SNode=S0',
    )
  }
  const m = url.pathname.match(/tnr(\d+)\.aspx/i)
  if (!m) {
    throw new Error('В ссылке не найден номер турнира (tnrNNNN.aspx)')
  }
  const snrRaw = url.searchParams.get('snr')
  const snr = snrRaw ? Number.parseInt(snrRaw, 10) : null
  return {
    host: url.hostname,
    tournamentId: m[1],
    params: new URLSearchParams(url.search),
    playerSnr: snr != null && Number.isFinite(snr) ? snr : null,
  }
}

/** Ссылка на личную таблицу игрока (art=9) */
export function buildIndividualUrl(src: ParsedSourceUrl): string {
  if (src.playerSnr == null) {
    throw new Error(
      'В ссылке нет номера игрока (snr). Откройте на chess-results.com личную таблицу игрока (art=9) и скопируйте её адрес.',
    )
  }
  const p = new URLSearchParams(src.params)
  p.set('art', '9')
  p.delete('rd')
  return `https://${src.host}/tnr${src.tournamentId}.aspx?${p.toString()}`
}

/** Ссылка на стартовый список (art=0) */
export function buildStartListUrl(src: ParsedSourceUrl): string {
  const p = new URLSearchParams(src.params)
  p.set('art', '0')
  p.delete('snr')
  p.delete('rd')
  return `https://${src.host}/tnr${src.tournamentId}.aspx?${p.toString()}`
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function parseRatingCell(text: string): number | null {
  const m = clean(text).match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const v = Number.parseFloat(m[0].replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

/**
 * Результат партии в запись «очки».
 * 1 / ½ / 0 — сыгранные партии; всё остальное (+, −, Z, пусто) — без игры.
 */
export function resultToScore(raw: string): number | null {
  const s = clean(raw).replace(',', '.')
  if (s === '1') return 1
  if (s === '0.5' || s === '1/2' || s === '½') return 0.5
  if (s === '0') return 0
  return null
}

function metaValue(pairs: string[][], re: RegExp): string | null {
  for (const cells of pairs) {
    if (cells.length >= 2 && re.test(cells[0])) {
      return cells[1] || null
    }
  }
  return null
}

function parseMetaTable(pairs: string[][]): PlayerInfo {
  return {
    name: clean(metaValue(pairs, /^имя[:.]?$|^name[:.]?$/i) ?? ''),
    startNumber: metaValue(pairs, /стартовое место|start no/i),
    nationalRating: parseRatingCell(metaValue(pairs, /нац\.?\s*рейтинг|nat\.?\s*rating/i) ?? ''),
    fideRating: parseRatingCell(metaValue(pairs, /междун|intern/i) ?? ''),
    points: metaValue(pairs, /^очки|points/i),
    performance: metaValue(pairs, /перфоманс|performance/i),
    place: metaValue(pairs, /^место[:.]?$|^rank/i),
    federation: metaValue(pairs, /федераци|^fed/i),
    club: metaValue(pairs, /клуб|club/i),
    born: metaValue(pairs, /год рожд|born/i),
  }
}

/**
 * Карта колонок таблицы партий по её заголовку (Тур / Bo. / Ст.ном. / Имя / Рейт.Межд. / Рейт.Нац.).
 * Нужна для архивных страниц, где имена — без ссылок snr, и для надёжного
 * разделения межд. и нац. рейтингов.
 */
interface TableCols {
  round: number
  board: number
  startNo: number
  name: number
  fide: number
  nat: number
}

function colsFromHeader(headerCells: string[]): TableCols | null {
  const find = (re: RegExp) => headerCells.findIndex((h) => re.test(h))
  // ВАЖНО: \b в JS работает только с ASCII — для кириллических заголовков («Тур»)
  // он никогда не совпадёт, поэтому якорим через $ и явные знаки
  const round = find(/^тур\.?$|^rnd\.?$|^round\.?$/i)
  if (round === -1) return null
  return {
    round,
    board: find(/^bo\.?$|^brett|^board$/i),
    startNo: find(/^ст\.?\s?ном|^start\s?no/i),
    name: find(/^имя$|^name$/i),
    fide: find(/^рейт\.?\s?межд|^rtg\.?\s?fide|^fide\b/i),
    nat: find(/^рейт\.?\s?нац|^нац\.?\s?рейт|^nat\.?\s?rtg|national/i),
  }
}

function parseGameRow(row: HTMLTableRowElement, cols: TableCols | null): GameInfo | null {
  const cells = Array.from(row.cells)
  if (cells.length < 6) return null

  const roundText = clean(cells[0].textContent)
  const round = Number.parseInt(roundText, 10)
  if (!Number.isFinite(round)) return null

  // ячейка с именем соперника: в полной версии — та, где есть ссылка с snr=;
  // в архивной (ссылки спрятаны до постбэка) — колонка «Имя» из заголовка таблицы
  let nameIdx = -1
  let snr: number | null = null
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i].querySelector('a[href*="snr="]')
    const href = a?.getAttribute('href') ?? ''
    const m = href.match(/snr=(\d+)/)
    if (m) {
      nameIdx = i
      snr = Number.parseInt(m[1], 10)
      break
    }
  }
  if (nameIdx === -1 && cols && cols.name >= 0) nameIdx = cols.name
  if (nameIdx === -1) return null

  const oppName = clean(cells[nameIdx].textContent)
  if (!oppName) return null

  // рейтинги соперника: по заголовкам (нац. и межд.), иначе — ячейка справа от имени
  let fideRating: number | null = null
  let natRating: number | null = null
  if (cols && (cols.fide >= 0 || cols.nat >= 0)) {
    if (cols.fide >= 0 && cells[cols.fide])
      fideRating = parseRatingCell(cells[cols.fide].textContent ?? '')
    if (cols.nat >= 0 && cells[cols.nat])
      natRating = parseRatingCell(cells[cols.nat].textContent ?? '')
  } else {
    const ratingCell = cells[nameIdx + 1]
    fideRating = ratingCell ? parseRatingCell(ratingCell.textContent ?? '') : null
  }

  const last = cells[cells.length - 1]
  const colorDiv = last.querySelector('div[class*="Farbe"]')
  let color: 'w' | 'b' | null = null
  if (colorDiv) {
    const cls = colorDiv.className
    color = /farbew/i.test(cls) ? 'w' : /farbes/i.test(cls) ? 'b' : null
  }
  const rawResult = clean(last.textContent)
  const score = resultToScore(rawResult)

  const board =
    cols && cols.board >= 0 ? clean(cells[cols.board]?.textContent) : clean(cells[1]?.textContent)
  const startNo =
    cols && cols.startNo >= 0
      ? clean(cells[cols.startNo]?.textContent)
      : clean(cells[2]?.textContent)

  return {
    round,
    board: board || null,
    oppName,
    oppSnr: snr,
    oppStartNo: startNo || null,
    oppRatingInTable: fideRating,
    oppNatRatingInTable: natRating,
    color,
    rawResult: rawResult || '—',
    played: score != null,
    score,
  }
}

function safeResolve(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

/** Поиск ссылки «Стартовый список» на странице игрока */
export function findStartListLink(doc: Document, baseUrl: string): string | null {
  let fallback: string | null = null
  const anchors = Array.from(doc.querySelectorAll('a'))
  for (const a of anchors) {
    const href = a.getAttribute('href') ?? ''
    if (!/art=0(&|$)/.test(href)) continue
    const url = safeResolve(href, baseUrl)
    if (!url) continue
    const text = clean(a.textContent)
    if (/стартов|start list|startliste/i.test(text)) return url
    if (!fallback) fallback = url
  }
  return fallback
}

/** Разбор страницы личной таблицы игрока (art=9) */
export function parseIndividualCrosstable(html: string, baseUrl: string): CrosstableData {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tournamentTitle = clean(doc.title) || null
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>('table.CRs1'))

  if (tables.length === 0) {
    throw new Error(
      'На странице не найдено таблиц. Убедитесь, что ссылка ведёт на личную таблицу игрока (art=9).',
    )
  }

  // 1. метаданные игрока
  let player: PlayerInfo | null = null
  for (const table of tables) {
    const rows = Array.from(table.rows)
    if (rows.length < 4) continue
    const pairs = rows.map((r) => Array.from(r.cells).map((c) => clean(c.textContent)))
    const isMeta = pairs.some((cs) => cs.length >= 2 && /^имя[:.]?$|^name[:.]?$/i.test(cs[0]))
    if (isMeta) {
      player = parseMetaTable(pairs)
      break
    }
  }
  if (!player || !player.name) {
    throw new Error('Не удалось определить имя игрока на странице')
  }

  // 2. таблица партий — та, где больше всего строк со ссылками snr=
  //    (или просто строк с номером тура — у архивных страниц ссылки спрятаны)
  let games: GameInfo[] = []
  for (const table of tables) {
    const rows = Array.from(table.rows)
    // карта колонок по заголовку (первая строка со <th>); null — старый режим по ссылкам
    const headerRow = rows.find((r) => r.cells.length > 0 && Array.from(r.cells).some((c) => c.tagName === 'TH'))
    const cols = headerRow
      ? colsFromHeader(Array.from(headerRow.cells).map((c) => clean(c.textContent)))
      : null
    const parsed: GameInfo[] = []
    for (const row of rows) {
      const g = parseGameRow(row, cols)
      if (g) parsed.push(g)
    }
    if (parsed.length > games.length) games = parsed
  }
  if (games.length === 0) {
    throw new Error('На странице не найдено партий. Нужна ссылка на личную таблицу игрока (art=9, в адресе есть snr).')
  }
  games.sort((a, b) => a.round - b.round)

  const startListUrl = findStartListLink(doc, baseUrl)

  return { player, games, startListUrl, tournamentTitle }
}

/** Разбор стартового списка (art=0) */
export function parseStartList(html: string): StartListData {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tournamentTitle = clean(doc.title) || null
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>('table.CRs1'))

  for (const table of tables) {
    const rows = Array.from(table.rows)
    if (rows.length < 2) continue

    const headerCells = Array.from(rows[0].cells)
    const headerTexts = headerCells.map((c) => clean(c.textContent))
    const nameIdx = headerTexts.findIndex((h) => /^имя|имя$|^name$/i.test(h))
    if (nameIdx === -1) continue

    // национальный рейтинг: колонка «Рейт.Нац.» / «Нац.рейтинг» / «Nat.Rtg»
    let ratingIdx = headerTexts.findIndex((h) =>
      /рейт\.?\s*нац|нац\.?\s*рейт|nat\.?\s*(rtg|rating)|national/i.test(h),
    )
    if (ratingIdx === -1) {
      ratingIdx = headerTexts.findIndex((h) => /нац|nat\b/i.test(h))
    }
    if (ratingIdx === -1) {
      ratingIdx = headerTexts.findIndex((h) => /рейт|rtg|rating/i.test(h))
    }

    // номер игрока: в полной версии — из ссылки на его страницу,
    // в архивной (ссылки спрятаны) — колонка «Ном.» / «Ст.ном.»
    const nomIdx = headerTexts.findIndex((h) => /^ном\.?$|^ст\.?\s?ном|^start\s?no/i.test(h))

    const players: StartListPlayer[] = []
    for (let ri = 1; ri < rows.length; ri++) {
      const cells = Array.from(rows[ri].cells)
      const nameCell = cells[nameIdx]
      if (!nameCell) continue
      const name = clean(nameCell.textContent)
      if (!name) continue
      const a = nameCell.querySelector('a[href*="snr="]')
      const m = (a?.getAttribute('href') ?? '').match(/snr=(\d+)/)
      let snr = m ? Number.parseInt(m[1], 10) : null
      if (snr == null && nomIdx >= 0 && cells[nomIdx]) {
        const v = Number.parseInt(clean(cells[nomIdx].textContent), 10)
        if (Number.isFinite(v)) snr = v
      }
      const rawRating =
        ratingIdx >= 0 && cells[ratingIdx] ? clean(cells[ratingIdx].textContent) : ''
      const rating = parseRatingCell(rawRating)
      players.push({
        snr,
        name,
        // 0 или пустая ячейка — рейтинга нет
        rating: rating != null && rating > 0 ? rating : null,
        rawRating,
      })
    }

    if (players.length > 0) {
      return { players, tournamentTitle }
    }
  }

  throw new Error('Не удалось разобрать стартовый список: не найдены строки игроков')
}

/** Определение типа сохранённой страницы (для ручного режима) */
export function classifyPage(html: string, baseUrl: string): 'crosstable' | 'startlist' {
  try {
    const ct = parseIndividualCrosstable(html, baseUrl)
    if (ct.games.length > 0) return 'crosstable'
  } catch {
    // не личная таблица — пробуем стартовый список
  }
  const sl = parseStartList(html)
  if (sl.players.length > 0) return 'startlist'
  throw new Error('Файл не похож на страницу chess-results.com')
}
