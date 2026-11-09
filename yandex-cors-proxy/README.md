# CORS-прокси для ratingplus (Yandex Cloud Functions)

Node.js-функция, которая скачивает страницу по адресу из параметра `?url=` и
возвращает её с CORS-заголовками (`Access-Control-Allow-Origin: *`). Нужна,
чтобы браузерная страница ratingplus могла читать страницы chess-results.com.

**Внешних зависимостей нет** — только встроенные модули Node.js, значит код
можно заливать одним файлом `index.js`, ничего не устанавливая.

## Файлы

| Файл           | Назначение                                 |
| -------------- | ------------------------------------------ |
| `index.js`     | Код функции (entry point: `index.handler`) |
| `package.json` | Манифест (нужен только для сборки архива)  |

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
2. Откройте **существующую** функцию
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
