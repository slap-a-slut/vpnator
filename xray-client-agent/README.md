# xray-client-agent

CLI агент для импорта клиентской конфигурации XRAY и локального управления `xray-core`.

## Стек

- Node.js 20+
- TypeScript
- CLI: `yargs`
- Локальное состояние: JSON в OS app data (`env-paths`)
- Логи: `pino` в `logs/agent.log` (в app data каталоге)

## Установка

```bash
npm i
npm run build
```

Для удобного глобального запуска:

```bash
npm link
```

После этого доступна команда:

```bash
agent --help
```

## Команды

### Import

```bash
agent import --token <token> --base-url <url>
```

- Делает `GET <base-url>/share/<token>`
- Сохраняет полученный payload локально
- Не сохраняет plaintext токен

### Connect

```bash
agent connect
```

- При первом запуске проверяет локальный бинарник в app data: `bin/xray` (или `bin/xray.exe` на Windows)
- Если бинарник отсутствует, пытается взять его из локальных assets, затем скачать по `XRAY_CORE_BASE_URL`
- Проверяет SHA-256 через `XRAY_CORE_SHA256_<platform>`
- На Unix выставляет `chmod +x`
- Генерирует локальный `config.json`
- Поднимает `xray-core` через supervisor-процесс
- После старта проверяет, что SOCKS5 порт `127.0.0.1:1080` слушается (таймаут 10 сек)
- Если health-check не прошел, процесс останавливается и возвращается `STARTUP_FAILED`
- При падении `xray-core` выполняет до 3 автоматических рестартов с backoff `1s, 2s, 4s`
- MVP режим: локальный SOCKS5 на `127.0.0.1:1080`

Ожидаемые имена файлов в `XRAY_CORE_BASE_URL`:

- `xray-linux-x64`
- `xray-linux-arm64`
- `xray-macos-x64`
- `xray-macos-arm64`
- `xray-windows-x64.exe`
- `xray-windows-arm64.exe`

Опциональный локальный embedded путь:

- `XRAY_CORE_EMBEDDED_DIR` (по умолчанию: `./assets/xray/<target>/`)

### Disconnect

```bash
agent disconnect
```

Останавливает `xray-core` процесс.

### Status

```bash
agent status
```

Показывает:

- `running`
- `pid`
- `supervisorPid`
- `lastError`
- состояние импорта и proxy

### Logs

```bash
agent logs --tail 200 --source agent
agent logs --tail 200 --source xray
agent logs --tail 200 --source all
```

Читает последние строки из `agent.log` и/или `xray.log`.

### System Proxy

```bash
agent proxy-on
agent proxy-off
```

- **Windows**: использует `netsh winhttp set/reset proxy`
- **macOS**: использует `networksetup -setwebproxy/-setsecurewebproxy`
  - если нет прав, команда вернет инструкции с `sudo`
- **Linux**: печатает инструкции (GNOME/KDE различаются), авто-применение не выполняется

## Где хранятся данные

Пути берутся из `env-paths('xray-client-agent')`.
Внутри app data каталога создаются:

- `state.json`
- `bin/xray` (или `bin/xray.exe`)
- `runtime/config.json`
- `logs/agent.log`
- `logs/xray.log`

На Unix для `state.json` и `runtime/config.json` выставляются права `600`.

## Переменные окружения для бинарника

- `XRAY_CORE_BASE_URL` — базовый URL для скачивания бинарников
- `XRAY_CORE_EMBEDDED_DIR` — локальный каталог с embedded бинарниками (опционально)
- `XRAY_CORE_SHA256_LINUX_X64`
- `XRAY_CORE_SHA256_LINUX_ARM64`
- `XRAY_CORE_SHA256_MACOS_X64`
- `XRAY_CORE_SHA256_MACOS_ARM64`
- `XRAY_CORE_SHA256_WINDOWS_X64`
- `XRAY_CORE_SHA256_WINDOWS_ARM64`

Ошибки установки бинарника:

- `XRAY_DOWNLOAD_FAILED`
- `XRAY_HASH_MISMATCH`
- `XRAY_UNSUPPORTED_PLATFORM`

## Примеры

```bash
agent import --token abc123 --base-url https://cp.example.com
agent connect
agent status
agent proxy-on
agent logs --tail 100 --source all
agent proxy-off
agent disconnect
```

## Тесты

```bash
npm test
```

Покрыто:

- построение `xray` конфигурации из `vless://` ссылки
- управление процессом (start/stop) с моками
- выбор целевой платформы бинарника
- проверка sha256 бинарника
- reconnect state machine (рестарты + backoff + startup failure)

## Разработка

```bash
npm run dev -- status
npm run lint
npm run build
```
