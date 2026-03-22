# xray-desktop

Минимальная desktop-оболочка на Tauri для управления `xray-client-agent` через IPC.

Проект собирается в двух вариантах:

- `user` — для обычного пользователя (без admin-действий в UI)
- `admin` — для оператора control-plane (включая `Apply disguise`)

## Что внутри

- Backend bridge: `backend/desktop-bridge.cjs` (использует `xray-client-agent` как библиотеку)
- IPC команды Tauri:
  - `importToken(baseUrl, token)`
  - `connect()`
  - `disconnect()`
  - `status()`
- только в `admin` build:
  - `updateDisguise(baseUrl, serverId, adminApiKey, disguise)`
  - `serverLogin(baseUrl, adminApiKey, host, sshUser, password)`
- Frontend (минимальный, в обеих версиях):
  - поле `Share Token`
  - встроенный (`embedded`) URL control-plane
  - кнопки `Import / Connect / Disconnect`
  - tunnel-only режим (без переключателя mode)
  - строка disguise: `Disguised as traffic from <domain>`
  - статус `Connected/Disconnected + lastError`
  - версия приложения (`Version: X.Y.Z`)
  - кнопка `Copy logs path`
- только в `admin` build:
  - блок `Server Login (Admin)`:
    - `Server IP / Host`
    - `SSH Username`
    - `SSH Password`
    - кнопка `Login & install if needed`
  - presets (`vk.com`, `google.com`, `cloudflare.com`) + custom
  - поле `Admin API Key`
  - кнопка `Apply disguise` (через control-plane API)

## Предварительные требования

- Node.js 20+
- Rust toolchain + cargo
- Tauri system deps (WebView2 на Windows, WebKitGTK на Linux, Xcode CLT на macOS)

## Установка

1. Собрать библиотеку `xray-client-agent`:

```bash
cd ../xray-client-agent
npm install
npm run build
```

2. Установить зависимости desktop-проекта:

```bash
cd ../xray-desktop
npm install
```

## Запуск в dev

```bash
npm run dev
```

По умолчанию `npm run dev` запускает `user` build.

Дополнительно:

```bash
npm run dev:user
npm run dev:admin
npm run dev:admin:vps
```

## Сборка

```bash
npm run build
```

По умолчанию `npm run build` собирает `user` build.

Дополнительно:

```bash
npm run build:user
npm run build:admin
npm run build:admin:vps
npm run build:admin:vps:nsis
```

Для текущего VPS (`87.120.186.4`) используйте:

- `npm run dev:admin:vps`
- `npm run build:admin:vps`
- `npm run build:admin:vps:nsis` на Windows runner/машине, если нужен именно `.exe`

Эти команды уже зашивают `VITE_CONTROL_PLANE_BASE_URL=https://87-120-186-4.sslip.io`
и отключают локальный bootstrap backend.

Для Windows build скрипт автоматически докачивает официальный `node.exe` (ветка Node 20),
если bundled runtime ещё не подготовлен.

## Embedded control-plane URL

В desktop URL control-plane зашивается на этапе сборки:

- `VITE_CONTROL_PLANE_BASE_URL=https://cp.example.com npm run build:user`
- `VITE_CONTROL_PLANE_BASE_URL=https://cp.example.com npm run build:admin`

Если переменная не передана, используется fallback `http://127.0.0.1:3000`.

Локальный bootstrap control-plane в `admin` build по умолчанию выключен
(чтобы не конфликтовать с Docker/внешним API на том же порту).

Если нужно включить автоподнятие локального control-plane явно:

- `VITE_ENABLE_LOCAL_CONTROL_PLANE_BOOTSTRAP=true npm run build:admin`

## Release artifacts (win/mac/linux)

Сборка выполняется нативно на целевой OS (без кросс-компиляции по умолчанию):

1. **macOS** (на macOS runner/машине):
   - `npm run build:user`
   - `npm run build:admin`
   - артефакты: `src-tauri/target/release/bundle/macos/*.app`, `src-tauri/target/release/bundle/dmg/*.dmg`

2. **Windows** (на Windows runner/машине):
   - `npm run build:user`
   - `npm run build:admin`
   - `npm run build:admin:vps:nsis` для admin `.exe` c текущим VPS URL
   - артефакты: `src-tauri/target/release/bundle/msi/*.msi` и/или `src-tauri/target/release/bundle/nsis/*.exe`

3. **Linux** (на Linux runner/машине):
   - `npm run build:user`
   - `npm run build:admin`
   - артефакты: `src-tauri/target/release/bundle/appimage/*.AppImage`, `src-tauri/target/release/bundle/deb/*.deb` (в зависимости от дистрибутива и deps)

Рекомендуемый CI-подход: matrix по `ubuntu-latest`, `windows-latest`, `macos-latest` с одинаковым шагом `npm run build`.

Для этого репозитория уже добавлен workflow `.github/workflows/build-admin-windows.yml`,
который вручную собирает `admin` NSIS `.exe` на `windows-latest`.

Важно: текущий VPS `/opt/vpnator` содержит только server deployment без `xray-desktop`
и без toolchain (`node`, `npm`, `cargo`, `rustc`), поэтому собирать Windows desktop на нём нельзя.

## Tunnel Mode (macOS)

- Приложение работает только в tunnel-режиме (TUN-конфиг XRay)
- Режим рассчитан на macOS
- если для TUN не хватает прав, connect завершится ошибкой; запустите с повышенными привилегиями

## Disguise UI

- `user` build: только read-only отображение текущего disguise-домена
- `admin` build: можно менять disguise (`PATCH /servers/:id/xray-disguise`)
- Для `admin` build нужен `Admin API key` (Bearer ключ control-plane)
- После apply UI предлагает reconnect для применения на клиенте

## Admin server login flow

- `admin` build умеет “логинить” сервер напрямую в control-plane:
  - форма `Server IP / Host`, `SSH Username`, `SSH Password`
  - action вызывает `POST /servers/login`
- Если сервер уже в статусе `READY`, install не запускается повторно.
- Если сервер новый/не готов, автоматически ставится install job.

## Deep Link Import

Приложение поддерживает схему:

`xraycp://import?token=<urlencoded>`

Поведение:

- при открытии ссылки desktop автоматически запускает `Import`
- после успешного импорта показывает подсказку нажать `Connect`
- параметры ссылки валидируются (`scheme`, `action`, `token`)
- `baseUrl` в ссылке опционален; если передан, он должен совпадать с embedded URL
- токен не выводится в UI сообщения и не логируется приложением

Пример:

`xraycp://import?token=abcDEF123_token`

## Как генерировать share link для пользователя

1. На control-plane создать share token (например `POST /users/:id/share`).
2. Из ответа взять `token`.
3. Сформировать deep link:

```text
xraycp://import?token=<encodeURIComponent(token)>
```

Пример в JavaScript:

```js
const token = '...'; // из POST /users/:id/share
const link = `xraycp://import?token=${encodeURIComponent(token)}`;
```

Важно: `token` одноразовый и может иметь TTL, поэтому передавайте ссылку по защищенному каналу.
