# xray-control-plane

Backend-сервис для управления control plane (XRAY). Node.js 20+, TypeScript, Fastify, Prisma, PostgreSQL.

## Быстрый старт (локально)

1. Установить зависимости:

```bash
npm i
```

2. Поднять PostgreSQL + Redis + применить миграции:

```bash
docker compose up -d postgres redis

# применить миграции (локально, из репозитория)
npm run prisma:migrate:deploy

# или применить миграции через отдельный compose-сервис
# docker compose run --rm migrate
```

3. Создать `.env` (можно скопировать пример):

```bash
cp .env.example .env
```

⚠️ В `.env` обязательны:

- `ADMIN_API_KEYS` — список Bearer API ключей через запятую
- `CORS_ORIGINS` — allowlist origins через запятую
- `REDIS_URL` — Redis для очередей задач (BullMQ)
- `ROLE` — роль процесса: `api` или `worker`
- `MASTER_KEY` — base64 от 32 байт (AES-256-GCM ключ)
- `TOKEN_SALT` — соль для хеширования share-токенов

4. Запустить API и worker (два процесса):

```bash
npm run dev
npm run dev:worker
```

Проверка:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/version
```

Swagger UI (если `SWAGGER_ENABLED=true`):

- http://localhost:3000/docs

## Security baseline

- Все эндпоинты, кроме `GET /health`, `GET /version` и `GET /share/:token`, требуют `Authorization: Bearer <api-key>`
- При отсутствии/невалидном ключе возвращается ошибка: `{ code: "UNAUTHORIZED", message, details }`
- Для audit используется masked actor id: `adminKey:<first6>`
- Глобальный rate limit: `120 req/min` по IP
- Для тяжелых операций:
  - `POST /servers/:id/install` — `10 req/min` по IP
  - `POST /servers/:id/repair` — `10 req/min` по IP
- Включены `helmet` (security headers) и CORS allowlist через `CORS_ORIGINS`
- `Authorization` не логируется (redact), `x-request-id` всегда присутствует

## Versioning and Docker tags

- `GET /version` возвращает semver версию API в формате `{ "version": "X.Y.Z" }`
- Версия берется из `APP_VERSION` (если задана) или из `package.json`
- Для Docker image используйте два тега на один и тот же build:
  - `latest`
  - `vX.Y.Z` (например `v0.1.0`)

Пример тегирования:

```bash
VERSION=$(node -p "require('./package.json').version")
docker build -t your-registry/xray-control-plane:latest -t your-registry/xray-control-plane:v${VERSION} .
docker push your-registry/xray-control-plane:latest
docker push your-registry/xray-control-plane:v${VERSION}
```

## Provision (SSH)

- `POST /servers/:id/ssh-test` — проверка SSH-доступа к серверу (`uname -a`, `id`)
- `POST /servers/:id/install` — ставит задачу установки XRAY, ответ: `{ jobId }`
- `POST /servers/:id/repair` — ставит задачу диагностики/ремонта, ответ: `{ jobId }`
- `PATCH /servers/:id/xray-disguise` — обновляет REALITY disguise (`serverName`, `dest`, `fingerprint`, `shortIds`) и ставит job repair
- `GET /servers/:id/status` — статус установки + метаданные `xrayInstance`
- `GET /servers/:id/logs?type=install|xray&tail=200` — observability логи
- `GET /servers/:id/health` — runtime health-checks (ssh/docker/container/port)
- Поддерживаются `SSH_PASSWORD` и `SSH_KEY`
- Таймауты: connect `10s`, command `60s`
- SSH wrapper с ретраями сетевых ошибок: `1s`, `2s`, `4s` (`HOST_UNREACHABLE`, `TIMEOUT`)
- `AUTH_FAILED` не ретраится
- Ошибки: `AUTH_FAILED`, `HOST_UNREACHABLE`, `TIMEOUT`, `COMMAND_FAILED`
- `XRAY_STORE_MODE=file|grpc` — режим обновления клиентов XRAY

## Jobs (BullMQ + Redis)

- Очередь задач: BullMQ в Redis (`REDIS_URL`)
- Логи задач (`jobLogs`) хранятся в Postgres (`JobLog`)
- API:
  - `GET /jobs/:id` — `{ id, status, progress, result?, error? }`
  - `GET /jobs/:id/logs?tail=200` — последние логи задачи
  - `POST /jobs/:id/cancel` — запросить отмену задачи
- Статусы: `QUEUED`, `ACTIVE`, `COMPLETED`, `FAILED`
- Прогресс: `0..100`
- Install/repair берут distributed lock на сервер: `lock:server:<id>` (TTL 15 минут)
- Если lock занят, API возвращает `409 { code: "SERVER_BUSY" }`

## Audit

- Таблица `AuditEvent` хранит события действий по write-операциям API
- Поля события: `actor`, `action`, `entityType`, `entityId`, `meta`, `ts`
- `GET /audit?entityId=&limit=50` — получить последние audit events (default `limit=50`)

### Install flow

- HTTP `POST /servers/:id/install` ставит job в очередь и сразу возвращает `jobId`
- Повторный install для `READY` сервера идемпотентен: выполняется проверка/repair без поломки состояния
- Внутри job: `status=INSTALLING` → проверка OS (`ubuntu`/`debian`) → установка Docker/Compose plugin
- создание `/opt/xray-cp` и `/var/log/xray`
- генерация `docker-compose.yml` и `config.json` (VLESS + REALITY), запуск `docker compose up -d`
- идемпотентное открытие TCP-порта через `ufw` или `iptables`
- upsert записи `xrayInstance`, затем `status=READY` (или `status=ERROR` + `lastError`)
- в `PROVISION_DRY_RUN=true` SSH не используется, но install завершает сервер в `READY` и создает/обновляет `xrayInstance`

### Repair flow

- HTTP `POST /servers/:id/repair` ставит job в очередь и сразу возвращает `jobId`
- Проверки по SSH: Docker/Compose, состояние контейнера `xray`, слушает ли порт (`ss -lntp`), optional probe доступности порта через `nc`
- Если Docker отсутствует: установка Docker + Compose plugin
- Если `docker-compose.yml`/`config.json` отсутствуют или расходятся с целевым состоянием: перегенерация файлов
- Если контейнер не запущен: `docker compose up -d`
- Если порт не слушается: `docker compose restart xray`, затем повторная проверка
- Результат job (`GET /jobs/:id`) содержит `{ actions, statusBefore, statusAfter }`
- в `PROVISION_DRY_RUN=true` SSH не используется, но repair завершает сервер в `READY` и создает/обновляет `xrayInstance`

### Observability

- `type=install`: логи читаются из локального хранилища control-plane (`INSTALL_LOG_DIR`)
- `type=xray`: логи читаются по SSH из `/var/log/xray/error.log` и `/var/log/xray/access.log` (tail)
- Ограничение `tail`: `1..1000` (default `200`)
- Логи проходят санитайзинг, чтобы не отдавать секреты/ключи/токены

### Xray client store

- Интерфейс `XrayClientStore`: `sync`, `addUser`, `removeUser`
- `file` (по умолчанию): `FileConfigStore` — перегенерация `config.json` и `restart xray`
- `grpc`: `XrayGrpcApiStore` — add/remove пользователей через `xray api` без рестарта
- `POST /servers/:id/users` вызывает `addUser`
- `PATCH /users/:id` с `enabled=false` вызывает `removeUser`

### Share and client config

- `POST /users/:id/share` создает одноразовый share-token
- `GET /share/:token` — публичный endpoint consume токена (без auth), возвращает payload для клиента
- Share payload включает:
  - `server.host`, `server.port`
  - `reality.publicKey`, `reality.serverName`, `reality.fingerprint`, `reality.shortId`, `reality.dest`
  - `user.uuid`
- `GET /users/:id/config` возвращает VLESS+REALITY ссылку с `fp=<fingerprint>`

#### `grpc` режим

- В `config.json` автоматически включается API inbound XRAY:
  - `tag=api`, `services=["HandlerService"]`
  - inbound `dokodemo-door` на `127.0.0.1:10085` (только localhost, наружу не публикуется)
- Перед `add/remove/sync` выполняется health-check API (`inboundusercount`)
- Если gRPC API недоступен, выполняется fallback в `file` режим (`config` + `restart`) и пишется warning в лог

Как включить:

```bash
XRAY_STORE_MODE=grpc
```

Плюсы `grpc`:

- Без рестарта XRAY при добавлении/удалении клиента
- Меньше downtime и быстрее операции управления клиентами

Минусы `grpc`:

- Требуется рабочий API inbound внутри XRAY-конфига
- Сложнее диагностировать ошибки API по сравнению с полным `config`-перезапуском

### REALITY keys

- Выбран способ через утилиту XRAY внутри контейнера:
  `docker run --rm ghcr.io/xtls/xray-core:latest xray x25519`
- В `PROVISION_DRY_RUN=true` SSH-команды не исполняются, логируется только план, а ключи генерируются локально как тестовые значения.

## Скрипты

- `npm run dev` — запуск API с watch
- `npm run dev:worker` — запуск worker с watch
- `npm run build` — сборка в `dist/`
- `npm run start` — запуск собранного API
- `npm run start:worker` — запуск собранного worker
- `npm run test` — vitest
- `npm run test:e2e` — e2e dry-run сценарий (`PROVISION_DRY_RUN=true`): create server → install job → create user → share → consume share → get user config
- `npm run lint` — eslint
- `npm run prisma:migrate:dev` — создать новую миграцию и применить (dev)
- `npm run prisma:migrate:deploy` — применить миграции (prod-like)
- `npm run prisma:seed` — сидинг (опционально)

## Operations

- `npm run export -- --out ./export.json` — экспорт снапшота данных:
  - `secrets` (только `ciphertext`, без decrypt/plaintext),
  - `servers`,
  - `users`,
  - `xrayInstances`,
  - `shareTokens` (только `tokenHash`, без plaintext token),
  - `auditSummary` (агрегаты по действиям/сущностям).
- `npm run import -- --in ./export.json` — импорт снапшота в **пустую** базу с сохранением `id`.
- `GET /admin/export` — API-экспорт в том же формате (требует `Authorization: Bearer <api-key>`).
