/**
 * Загрузка страниц chess-results.com из браузера.
 *
 * Прямой fetch не работает: chess-results.com не отдаёт заголовок
 * Access-Control-Allow-Origin, поэтому браузер (по политике CORS) не отдаст
 * странице ответ. Поэтому используется цепочка публичных CORS-ретрансляторов —
 * тот же fetch, только URL указывает на ретранслятор, добавляющий нужный заголовок.
 * Для chess-results.com это выглядит как обычный заход с чужого сервера.
 *
 * Крайний случай: ручная загрузка сохранённых страниц (Ctrl+S) — см. ручной режим в UI.
 */

export interface ProxyDef {
  id: string
  label: string
  build: (url: string) => string
  extract?: (raw: string) => string
}

export const PROXIES: ProxyDef[] = [
  {
    id: 'yandex-own',
    label: 'свой прокси',
    build: (u) =>
      `https://functions.yandexcloud.net/d4evjrchtid3alfj53dk?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'allorigins-json',
    label: 'AllOrigins',
    build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    extract: (raw) => {
      const data = JSON.parse(raw) as { contents?: string }
      if (!data.contents) throw new Error('пустой ответ')
      return data.contents
    },
  },
  {
    id: 'corslol',
    label: 'cors.lol',
    build: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'allorigins-raw',
    label: 'AllOrigins (raw)',
    build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'cfw',
    label: 'cors.workers.dev',
    build: (u) => `https://test.cors.workers.dev/?${u}`,
  },
]

function looksLikeChessResults(html: string): boolean {
  return (
    html.length > 1000 &&
    (html.includes('CRs1') ||
      html.includes('CRdb') ||
      /tnr\d+\.aspx/i.test(html) ||
      /chess-results/i.test(html))
  )
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

export interface FetchedPage {
  html: string
  /** как получили: «напрямую» или название прокси */
  via: string
  /** журнал попыток для показа пользователю */
  log: string[]
}

/**
 * Пытается получить HTML страницы: сначала прямой запрос (вдруг CORS разрешён),
 * затем по очереди публичные ретрансляторы.
 */
export async function fetchPage(
  url: string,
  onLog?: (line: string) => void,
  timeoutMs = 20000,
): Promise<FetchedPage> {
  const log: string[] = []
  const errors: string[] = []
  const note = (line: string) => {
    log.push(line)
    onLog?.(line)
  }

  // 1. прямой запрос — работает только если сайт вдруг отдаёт CORS-заголовок
  try {
    note('Пробуем загрузить напрямую…')
    const html = await fetchWithTimeout(url, timeoutMs)
    if (looksLikeChessResults(html)) {
      note('Загружено напрямую')
      return { html, via: 'напрямую', log }
    }
    throw new Error('ответ не похож на страницу chess-results')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    note(`Напрямую не получилось (${msg}) — переходим к прокси`)
    errors.push(`напрямую: ${msg}`)
  }

  // 2. цепочка ретрансляторов (два круга — 429-лимиты часто снимаются через несколько секунд)
  for (let round = 1; round <= 2; round++) {
    for (const proxy of PROXIES) {
      try {
        note(`Прокси ${proxy.label}…`)
        const raw = await fetchWithTimeout(proxy.build(url), timeoutMs)
        const html = proxy.extract ? proxy.extract(raw) : raw
        if (!looksLikeChessResults(html)) throw new Error('ответ не похож на страницу chess-results')
        note(`Загружено через ${proxy.label}`)
        return { html, via: proxy.label, log }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        note(`Прокси ${proxy.label} недоступен (${msg})`)
        errors.push(`${proxy.label}: ${msg}`)
      }
    }
    if (round < 2) {
      note('Все ретрансляторы заняты — пауза 6 секунд и повторная попытка…')
      await new Promise((r) => setTimeout(r, 6000))
    }
  }

  throw new Error(
    `Не удалось загрузить страницу ни напрямую, ни через ретрансляторы (${errors.join('; ')}). ` +
    'Попробуйте позже или воспользуйтесь ручным режимом ниже — сохраните обе страницы (Ctrl+S) и загрузите их файлами.',
  )
}
