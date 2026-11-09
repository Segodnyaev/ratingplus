# CORS-прокси для ratingplus (Yandex Cloud Functions)

Node.js-функция, которая скачивает страницу по адресу из параметра `?url=` и
возвращает её с CORS-заголовками (`Access-Control-Allow-Origin: *`). Нужна,
чтобы браузерная страница ratingplus могла читать страницы chess-results.com.

**Внешних зависимостей нет** — только встроенные модули Node.js, значит код
можно заливать одним файлом `index.js`, ничего не устанавливая.


## Как это работает

```
Браузер ──GET functions.yandexcloud.net/<id>?url=https%3A%2F%2Fs2.chess-results.com%2F...
              │
              ▼
        Функция скачивает страницу (редиректы следуются автоматически,
        таймаут 15 сек, ограничение 8 МБ)
              │
              ▼
Браузеру возвращается HTML + Access-Control-Allow-Origin: *
```

Два режима вызова:

- **GET `?url=<encoded>`** — просто скачать страницу;
- **POST JSON `{"url":..., "method":"POST", "body":"...", "contentType":"..."}`** — выполнить
  произвольный запрос к целевому сайту. Нужен для архивных турниров chess-results,
  где ссылка «Отобразить дополнительную информацию» — это ASP.NET-постбэк
  (`__EVENTTARGET=linkbutton_show` + `__VIEWSTATE`/`__EVENTVALIDATION`): приложение
  отправляет его через прокси и получает полную страницу с меню и «Стартовым списком».

- `OPTIONS` → `204` с CORS-заголовками (preflight).
- Ошибки возвращаются как JSON `{"error": "...", "details": "..."}` с кодами
  400 (нет/кривой url), 403 (хост запрещён), 502 (целевой сайт недоступен).
- Безопасность: по умолчанию разрешены только `chess-results.com` и его
  поддомены (`s2.chess-results.com`, `s3.chess-results.com` и т.п.). Чтобы разрешить любые сайты,
  задайте переменную окружения `ALLOWED_HOSTS=all` (не рекомендуется —
  открытый прокси могут использовать чужие люди за ваш счёт).

## Деплой в консоли Yandex Cloud

1. Откройте https://console.yandex.cloud → **Cloud Functions → Функции**.
2. Откройте **существующую** функцию (с HTTP-ссылкой
   `https://functions.yandexcloud.net/d4evjrchtid3alfj53dk`) — тогда ссылка
   не изменится и приложение продолжит работать без правок. Либо создайте
   новую функцию и скопируйте её HTTP-ссылку в
   `src/lib/fetchPage.ts` (константа в прокси `yandex-own`).
3. Вкладка **«Редактор»**:
   - Среда выполнения: **nodejs18** (или новее);
   - Способ: скопировать код `index.js` в редактор (или загрузить ZIP с
     `index.js` и `package.json`);
   - Точка входа: **index.handler**;
   - Память: 128 МБ;
   - **Таймаут: 20 секунд** (важно: chess-results иногда отвечает медленно,
     дефолтных 3–5 сек не хватает);
   - Переменные окружения (по желанию): `ALLOWED_HOSTS=chess-results.com`.
4. Нажмите **«Создать версию»**.
5. Убедитесь, что на вкладке **«Обзор»** включён **«Публичный доступ»**
   («Доступен всем»), иначе будет 403 без CORS-заголовков.

## Деплой через yc CLI

```bash
yc serverless function version create \
  --function-name=ratingplus-cors-proxy \
  --runtime=nodejs18 \
  --entrypoint=index.handler \
  --memory=128m \
  --execution-timeout=20s \
  --source-path=./ \
  --environment ALLOWED_HOSTS=chess-results.com
```

## Проверка после деплоя

```bash
# 1. Должен вернуться HTML страницы (200, Content-Type text/html)
curl "https://functions.yandexcloud.net/d4evjrchtid3alfj53dk?url=https%3A%2F%2Fs2.chess-results.com%2Ftnr1534208.aspx%3Flan%3D11%26art%3D9%26fed%3DFID%26snr%3D13" | head -c 300

# 2. Должен вернуть 400 JSON {"error":"Missing \"url\" parameter",...}
curl "https://functions.yandexcloud.net/d4evjrchtid3alfj53dk"

# 3. Preflight должен вернуть 204 и Access-Control-Allow-Origin: *
curl -i -X OPTIONS "https://functions.yandexcloud.net/d4evjrchtid3alfj53dk"
```

Клиентская часть (приложение ratingplus) уже умеет работать с этим прокси —
оно стоит первым в цепочке ретрансляторов `src/lib/fetchPage.ts`, а публичные
ретрансляторы остаются запасным вариантом.

## Что добавлено в этой версии (важно для архивных турниров)

- **Заголовок ответа `X-Final-Url`** — адрес цели после всех редиректов
  (chess-results.com балансировщиком перебрасывает на s1/s2/s3.chess-results.com).
  Клиент шлёт ASP.NET-постбэк «Отобразить дополнительную информацию» прямо на
  финальный адрес. Заголовок открыт клиенту через `Access-Control-Expose-Headers`.
- **Сохранение метода и тела при редиректах** — иначе после 302 постбэк
  превращается в GET без тела и сервер возвращает урезанную страницу.

Проверка постбэка (должен вернуться HTML с ссылками на игроков, ~35 КБ вместо ~26 КБ):

```bash
curl -s -X POST "https://functions.yandexcloud.net/d4evjrchtid3alfj53dk?mode=post" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://s3.chess-results.com/tnr1340398.aspx?lan=11&art=9&fed=FID&snr=16","method":"GET"}' \
  -o /dev/null -w "%{http_code} %{size_download}\n"
```
