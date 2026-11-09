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
  /**
   * POST-запрос к целевому сайту через прокси (нужен для ASP.NET-постбэков
   * архивных турниров). body — уже urlencoded строка.
   * Поддерживает только свой прокси — публичные ретрансляторы POST не умеют.
   */
  sendPost?: (url: string, body: string, contentType: string) => Promise<string>
}

const YANDEX_FUNC = 'https://functions.yandexcloud.net/d4evjrchtid3alfj53dk'

export const PROXIES: ProxyDef[] = [
  {
    // свой прокси — Yandex Cloud Functions (без лимитов публичных ретрансляторов).
    // Контракт: GET ?url=<encoded> — просто скачать страницу;
    // POST JSON {url, method, body, contentType} — произвольный запрос (постбэк).
    // Важно: в консоли Yandex Cloud у функции должен быть включён «Публичный доступ»,
    // иначе она отвечает 403 Forbidden — тогда цепочка просто переходит к следующим прокси.
    id: 'yandex-own',
    label: 'свой прокси',
    build: (u) => `${YANDEX_FUNC}?url=${encodeURIComponent(u)}`,
    sendPost: async (target, body, contentType) => {
      const res = await fetchWithTimeout(`${YANDEX_FUNC}?mode=post`, 25000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, method: 'POST', body, contentType }),
      })
      return res
    },
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

/*
 * Архивные турниры (например, на s3.chess-results.com) отдают урезанную страницу:
 * таблицы есть, но нет меню со ссылкой «Стартовый список». Вместо него внизу стоит
 * ссылка «Отобразить дополнительную информацию» — это ASP.NET-постбэк:
 *   <a id="linkbutton_show" href="javascript:__doPostBack('linkbutton_show','')">
 * Браузер при клике отправляет POST на эту же страницу с hidden-полями формы
 * (__EVENTTARGET=linkbutton_show, __VIEWSTATE, __VIEWSTATEGENERATOR,
 * __EVENTVALIDATION) — и сервер возвращает полную страницу.
 * Ниже мы делаем ровно то же самое без клика.
 */

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** Собирает тело постбэка из скрытых полей формы; null — постбэк не нужен/невозможен. */
export function buildPostBackBody(html: string): string | null {
  const link = /<a[^>]*id=["']linkbutton_show["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)
  if (!link) return null
  // на неархивных турнирах эта ссылка есть, но пустая — тогда постбэк не нужен
  if (!link[1].replace(/<[^>]+>/g, '').trim()) return null

  const fields: Record<string, string> = {}
  for (const m of html.matchAll(/<input[^>]*type=["']hidden["'][^>]*>/gi)) {
    const tag = m[0]
    const name = /name=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!name || fields[name] !== undefined) continue
    const value = /value=["']([^"']*)["']/i.exec(tag)?.[1]
    fields[name] = value === undefined ? '' : decodeHtmlEntities(value)
  }
  if (!fields['__VIEWSTATE']) return null
  fields['__EVENTTARGET'] = 'linkbutton_show'
  fields['__EVENTARGUMENT'] = ''
  return new URLSearchParams(fields).toString()
}

/** Адрес, на который отправляется постбэк (action формы, иначе — текущий URL). */
function postBackTarget(html: string, baseUrl: string): string {
  const action = /<form[^>]*action=["']([^"']*)["']/i.exec(html)?.[1] ?? ''
  try {
    return new URL(action, baseUrl).toString()
  } catch {
    return baseUrl
  }
}

/**
 * Если страница — урезанный архивный вариант со ссылкой «Отобразить дополнительную
 * информацию», выполняет постбэк через свой прокси и возвращает полную страницу.
 * При любой ошибке возвращает исходный HTML (приложение продолжит работать с ним).
 */
async function expandAdditionalInfo(
  html: string,
  baseUrl: string,
  onLog?: (line: string) => void,
): Promise<string> {
  const body = buildPostBackBody(html)
  if (!body) return html

  const proxy = PROXIES.find((p) => p.sendPost)
  if (!proxy?.sendPost) {
    onLog?.(
      'Архивная страница требует раскрытия «Отобразить дополнительную информацию», но свой прокси недоступен — работаем с урезанной версией',
    )
    return html
  }

  try {
    onLog?.('Архивный турнир: раскрываем «Отобразить дополнительную информацию»…')
    const target = postBackTarget(html, baseUrl)
    const full = await proxy.sendPost(target, body, 'application/x-www-form-urlencoded')
    if (!full || full.length < 1000) throw new Error('пустой ответ')
    // удавалось ли убрать саму ссылку — критерий полной страницы
    if (/<a[^>]*id=["']linkbutton_show["'][^>]*>[\s\S]*?\S/.test(full)) {
      onLog?.('Сервер вернул снова урезанную страницу — продолжаем с ней')
      return full
    }
    onLog?.('Полная версия страницы получена')
    return full
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onLog?.(`Раскрытие не удалось (${msg}) — работаем с урезанной страницей`)
    return html
  }
}

function looksLikeChessResults(html: string): boolean {
  return (
    html.length > 1000 &&
    (html.includes('CRs1') ||
      html.includes('CRdb') ||
      /tnr\d+\.aspx/i.test(html) ||
      /chess-results/i.test(html))
  )
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
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
    const raw = await fetchWithTimeout(url, timeoutMs)
    if (!looksLikeChessResults(raw)) throw new Error('ответ не похож на страницу chess-results')
    const html = await expandAdditionalInfo(raw, url, note)
    note('Загружено напрямую')
    return { html, via: 'напрямую', log }
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
        const first = proxy.extract ? proxy.extract(raw) : raw
        if (!looksLikeChessResults(first)) throw new Error('ответ не похож на страницу chess-results')
        const html = await expandAdditionalInfo(first, url, note)
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
    'Не удалось загрузить страницу ни напрямую, ни через ретрансляторы' +
    'Попробуйте позже или воспользуйтесь ручным режимом ниже — сохраните обе страницы (Ctrl+S) и загрузите их файлами.',
  )
}
