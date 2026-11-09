'use strict';

/**
 * CORS-прокси для проекта ratingplus (https://github.com/Segodnyaev/ratingplus).
 *
 * Клиент вызывает:  GET https://functions.yandexcloud.net/<id>?url=<urlencoded URL>
 * Функция скачивает страницу и возвращает её как есть, добавив CORS-заголовки
 * (Access-Control-Allow-Origin: *), чтобы браузер разрешил чтение ответа.
 *
 * Контракт сознательно совместим с прежней версией функции:
 *   GET ?url=...               — скачать страницу (также понимает заголовок x-target-url)
 *   POST {"url": ...}          — то же самое (JSON-конверт)
 *   POST {"url":..., "method":"POST", "body":"a=1&b=2", "contentType":"application/x-www-form-urlencoded"}
 *                              — произвольный запрос к целевому сайту (нужен для ASP.NET-постбэков
 *                                архивных турниров chess-results: «Отобразить дополнительную информацию»)
 *
 * Ответ содержит заголовок X-Final-Url — адрес после всех редиректов (клиент
 * использует его, чтобы слать POST-постбэк прямо на финальный хост s3.chess-results.com,
 * а не на исходный, который 302-редиректит).
 *   OPTIONS                     — 204 c CORS-заголовками (preflight)
 *   ошибка                      — JSON {"error": "...", "details": "..."}
 *
 * Runtime: nodejs18 (и новше), без внешних зависимостей — только встроенный https.
 * Entry point: index.handler
 *
 * Настройки (можно задать как переменные окружения функции):
 *   ALLOWED_HOSTS        — через запятую домены, которые разрешено запрашивать.
 *                          Пусто или "all" — разрешить любые хосты (не рекомендуется).
 *                          По умолчанию: chess-results.com (+ любые поддомены).
 *   UPSTREAM_TIMEOUT_MS  — таймаут запроса к целевому сайту, мс (по умолчанию 15000).
 */

const http = require('http');
const https = require('https');

// ---------------------------------------------------------------- настройки

let ALLOWED_HOSTS = ['chess-results.com'];
if (process.env.ALLOWED_HOSTS !== undefined) {
  const raw = String(process.env.ALLOWED_HOSTS).trim();
  if (raw === '' || raw.toLowerCase() === 'all') {
    ALLOWED_HOSTS = null; // открытый прокси для любых адресов
  } else {
    ALLOWED_HOSTS = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 МБ достаточно для любой страницы турнира

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

// CORS-заголовки отдаём на каждый ответ (и на ошибки — тоже, чтобы браузер
// показал тело ошибки, а не «failed to fetch»).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, x-target-url',
  // X-Final-Url читает браузер клиента — без Expose-Headers он будет скрыт
  'Access-Control-Expose-Headers': 'X-Final-Url',
  'Access-Control-Max-Age': '86400',
};

// ------------------------------------------------------------- вспомогалки

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function textResponse(statusCode, body, contentType, extraHeaders) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
    body,
  };
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/**
 * Разбирает запрос: целевой URL, метод, тело и его тип.
 * Поддерживает: query-параметр url, заголовок x-target-url, POST-тело
 * (JSON-конверт {url, method, body, contentType} / JSON {url} / форма / сырой адрес).
 */
function extractRequest(event) {
  const q = event.queryStringParameters || {};
  const fromQuery = q.url && String(q.url).trim() ? String(q.url).trim() : null;

  const fromHeader = getHeader(event.headers, 'x-target-url');
  const headerUrl = fromHeader && String(fromHeader).trim() ? String(fromHeader).trim() : null;

  if (event.body) {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : String(event.body);
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.url === 'string' && parsed.url.trim()) {
          const method = String(parsed.method || 'GET').toUpperCase();
          const reqBody = typeof parsed.body === 'string' ? parsed.body : undefined;
          const contentType = typeof parsed.contentType === 'string' ? parsed.contentType : undefined;
          if (reqBody !== undefined && method !== 'POST' && method !== 'PUT') {
            return { error: 'Invalid request', details: 'Тело запроса разрешено только для POST/PUT' };
          }
          if (reqBody !== undefined && reqBody.length > 1024 * 1024) {
            return { error: 'Invalid request', details: 'Тело запроса больше 1 МБ' };
          }
          return {
            target: parsed.url.trim(),
            method: method === 'POST' || method === 'PUT' ? method : 'GET',
            body: reqBody,
            contentType,
          };
        }
      } catch (_) { /* не JSON — попробуем формы ниже */ }
    }
    if (!fromQuery && !headerUrl && trimmed) {
      if (/^https?:\/\//i.test(trimmed)) return { target: trimmed, method: 'GET' };
      try {
        const form = new URLSearchParams(trimmed);
        const u = form.get('url');
        if (u && u.trim()) return { target: u.trim(), method: 'GET' };
      } catch (_) { /* ignore */ }
    }
  }

  if (fromQuery) return { target: fromQuery, method: 'GET' };
  if (headerUrl) return { target: headerUrl, method: 'GET' };
  return { error: null, target: null };
}

function hostAllowed(hostname) {
  if (!ALLOWED_HOSTS || ALLOWED_HOSTS.length === 0) return true;
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some(
    (allowed) => host === allowed.toLowerCase() || host.endsWith('.' + allowed.toLowerCase()),
  );
}

/**
 * Скачивает URL по http(s). Возвращает { status, headers, buffer, finalUrl }.
 * Редиректы (301/302/303/307/308) обрабатываются автоматически.
 *
 * ВАЖНО про POST и редиректы: chess-results.com балансирует нагрузку 302-редиректом
 * даже POST-запросы (POST на chess-results.com → 302 на s3.chess-results.com).
 * По HTTP-стандарту после 301/302/303 клиент должен повторить запрос методом GET
 * без тела — но тогда ASP.NET-постбэк теряется и сервер возвращает урезанную
 * страницу. Поэтому метод и тело сохраняются при всех редиректах.
 */
function fetchUpstream(url, redirectsLeft, opts) {
  const options = opts || {};
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      reject(new Error('неверный URL'));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const requestHeaders = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru,en;q=0.8',
    };
    if (options.body !== undefined) {
      requestHeaders['Content-Type'] = options.contentType || 'application/x-www-form-urlencoded';
      requestHeaders['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = lib.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: requestHeaders,
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume(); // слить тело, чтобы соединение освободилось
          if (redirectsLeft <= 0) {
            reject(new Error('слишком много редиректов'));
            return;
          }
          const next = new URL(location, parsed).toString();
          // сохраняем method/body/contentType — см. комментарий выше про POST и 302
          fetchUpstream(next, redirectsLeft - 1, options).then(resolve, reject);
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new Error('ответ больше ' + Math.round(MAX_RESPONSE_BYTES / 1024 / 1024) + ' МБ'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, headers: res.headers, buffer: Buffer.concat(chunks), finalUrl: url }),
        );
        res.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('сервер не ответил за ' + Math.round(UPSTREAM_TIMEOUT_MS / 1000) + ' сек'));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** Достаёт charset из Content-Type, а если там пусто — из <meta charset> в начале HTML. */
function detectCharset(buffer, contentType) {
  const fromCt = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromCt) return fromCt[1].toLowerCase();
  const head = buffer.slice(0, 4096).toString('latin1');
  const meta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ||
    /<\?xml[^>]+encoding=["']?([\w-]+)/i.exec(head);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

/** Декодирует байты в строку с учётом charset (Node с полным ICU знает windows-1251 и пр.). */
function decodeText(buffer, charset) {
  if (['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) {
    return buffer.toString('utf8');
  }
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch (_) {
    return buffer.toString('utf8'); // неизвестная кодировка — почти всегда это UTF-8
  }
}

// ------------------------------------------------------------------ handler

exports.handler = async (event, context) => {
  const started = Date.now();
  const method = String(event.httpMethod || 'GET').toUpperCase();

  // 1. Preflight-запрос браузера — просто подтверждаем CORS
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 2. Куда и как идём
  const request = extractRequest(event);
  if (request.error || !request.target) {
    return jsonResponse(400, {
      error: request.error || 'Missing "url" parameter',
      details:
        request.details ||
        'Usage: https://functions.yandexcloud.net/<function-id>?url=<urlencoded URL>',
    });
  }

  let parsed;
  try {
    parsed = new URL(request.target);
  } catch (_) {
    return jsonResponse(400, { error: 'Invalid URL', details: 'Не удалось разобрать адрес: ' + request.target });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return jsonResponse(400, { error: 'Invalid URL', details: 'Разрешены только http:// и https://' });
  }
  if (!hostAllowed(parsed.hostname)) {
    return jsonResponse(403, {
      error: 'Host is not allowed',
      details:
        'Хост "' + parsed.hostname + '" не входит в ALLOWED_HOSTS. ' +
        'Этот прокси обслуживает только chess-results.com (см. README).',
    });
  }

  // 3. Скачиваем и отдаём
  try {
    const upstream = await fetchUpstream(parsed.toString(), MAX_REDIRECTS, {
      method: request.method,
      body: request.body,
      contentType: request.contentType,
    });
    const contentType = upstream.headers['content-type'] || 'text/html; charset=utf-8';
    const ms = Date.now() - started;

    const finalUrl = upstream.finalUrl || parsed.toString();
    const isText = /^\s*(text\/|application\/(json|javascript|xml|xhtml))/i.test(contentType);
    if (isText) {
      const charset = detectCharset(upstream.buffer, contentType);
      const body = decodeText(upstream.buffer, charset);
      console.log('[proxy] 200', parsed.host + ' → ' + new URL(finalUrl).host + parsed.pathname, ms + 'ms', charset, body.length + 'B');
      return textResponse(
        upstream.status,
        body,
        'text/html; charset=utf-8',
        { 'X-Final-Url': finalUrl },
      );
    }

    // Не текст (картинка, pdf и т.п.) — отдаём как base64, чтобы не испортить байты
    console.log('[proxy] 200 (binary)', parsed.host + parsed.pathname, ms + 'ms', upstream.buffer.length + 'B');
    return {
      statusCode: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Final-Url': finalUrl },
      body: upstream.buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = (err && err.message) || String(err);
    console.log('[proxy] FAIL', parsed.host + parsed.pathname, message);
    return jsonResponse(502, { error: 'Proxy error', details: message });
  }
};
