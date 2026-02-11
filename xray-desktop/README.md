# xray-desktop

Минимальная desktop-оболочка на Tauri для управления `xray-client-agent` через IPC.

## Что внутри

- Backend bridge: `backend/desktop-bridge.cjs` (использует `xray-client-agent` как библиотеку)
- IPC команды Tauri:
  - `importToken(baseUrl, token)`
  - `connect()`
  - `setMode(mode)`
  - `updateDisguise(baseUrl, serverId, adminApiKey, disguise)`
  - `disconnect()`
  - `status()`
- Frontend (минимальный):
  - поля `Base URL` и `Share Token`
  - кнопки `Import / Connect / Disconnect`
  - переключатель mode: `proxy | vpn`
  - блок disguise:
    - строка `Disguised as traffic from <domain>`
    - presets (`vk.com`, `google.com`, `cloudflare.com`) + custom
    - кнопка Apply (через control-plane API)
  - статус `Connected/Disconnected + lastError`
  - версия приложения (`Version: X.Y.Z`)
  - кнопка `Copy logs path`

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

## Сборка

```bash
npm run build
```

## Release artifacts (win/mac/linux)

Сборка выполняется нативно на целевой OS (без кросс-компиляции по умолчанию):

1. **macOS** (на macOS runner/машине):
   - `npm run build`
   - артефакты: `src-tauri/target/release/bundle/macos/*.app`, `src-tauri/target/release/bundle/dmg/*.dmg`

2. **Windows** (на Windows runner/машине):
   - `npm run build`
   - артефакты: `src-tauri/target/release/bundle/msi/*.msi` и/или `src-tauri/target/release/bundle/nsis/*.exe`

3. **Linux** (на Linux runner/машине):
   - `npm run build`
   - артефакты: `src-tauri/target/release/bundle/appimage/*.AppImage`, `src-tauri/target/release/bundle/deb/*.deb` (в зависимости от дистрибутива и deps)

Рекомендуемый CI-подход: matrix по `ubuntu-latest`, `windows-latest`, `macos-latest` с одинаковым шагом `npm run build`.

## Примечания по proxy

Системные привилегии в оболочке не реализованы.
Если нужен `proxy-on/proxy-off`, используйте CLI `agent` напрямую.
На macOS команда может потребовать `sudo`.

## VPN mode (macOS)

- UI поддерживает mode switch `proxy|vpn`
- `vpn` mode использует TUN-конфиг XRay и рассчитан на macOS
- если для TUN не хватает прав, connect завершится ошибкой; запустите с повышенными привилегиями или используйте `proxy` mode

## Disguise UI

- Для применения disguise нужен `Admin API key` (Bearer ключ control-plane)
- UI вызывает `PATCH /servers/:id/xray-disguise`
- После apply UI предлагает reconnect для применения на клиенте

## Deep Link Import

Приложение поддерживает схему:

`xraycp://import?baseUrl=<urlencoded>&token=<urlencoded>`

Поведение:

- при открытии ссылки desktop автоматически запускает `Import`
- после успешного импорта показывает подсказку нажать `Connect`
- параметры ссылки валидируются (`scheme`, `action`, `baseUrl`, `token`)
- токен не выводится в UI сообщения и не логируется приложением

Пример:

`xraycp://import?baseUrl=https%3A%2F%2Fcp.example.com&token=abcDEF123_token`

## Как генерировать share link для пользователя

1. На control-plane создать share token (например `POST /users/:id/share`).
2. Из ответа взять `token`.
3. Сформировать deep link:

```text
xraycp://import?baseUrl=<encodeURIComponent(baseUrl)>&token=<encodeURIComponent(token)>
```

Пример в JavaScript:

```js
const baseUrl = 'https://cp.example.com';
const token = '...'; // из POST /users/:id/share
const link = `xraycp://import?baseUrl=${encodeURIComponent(baseUrl)}&token=${encodeURIComponent(token)}`;
```

Важно: `token` одноразовый и может иметь TTL, поэтому передавайте ссылку по защищенному каналу.
