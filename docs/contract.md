# Compatibility Contract

Этот документ фиксирует контракт между `xray-control-plane` и desktop/client агентом.

## 1) Share payload (`GET /share/:token`)

HTTP 200 response:

```json
{
  "userId": "uuid",
  "serverId": "uuid",
  "vlessLink": "vless://...",
  "server": {
    "host": "vpn.example.com",
    "port": 443
  },
  "reality": {
    "publicKey": "...",
    "serverName": "vk.com",
    "fingerprint": "chrome",
    "shortId": "abcd1234",
    "dest": "vk.com:443"
  },
  "user": {
    "uuid": "uuid"
  },
  "meta": {
    "tokenId": "uuid",
    "expiresAt": "ISO-8601 datetime",
    "usedAt": "ISO-8601 datetime"
  }
}
```

Требования:

- `userId`, `serverId`, `meta.tokenId` — UUID
- `expiresAt`, `usedAt` — RFC3339/ISO-8601 datetime (`.toISOString()`)
- `vlessLink` — валидный VLESS+REALITY link формата ниже
- `server.host`, `server.port` — endpoint сервера из текущей инстанции
- `reality.serverName`, `reality.dest`, `reality.fingerprint`, `reality.shortId`, `reality.publicKey` — параметры маскировки для клиента
- дополнительные поля в объекте не допускаются

## 2) VLESS link format

Ожидаемый формат:

```text
vless://{uuid}@{host}:{port}?security=reality&sni={serverName}&fp={fingerprint}&pbk={publicKey}&sid={shortId}&type=tcp#XrayUser
```

Требования:

- `scheme`: `vless://`
- user part: UUID клиента (`user.uuid`)
- `host`: публичный хост сервера
- `port`: `1..65535`
- query параметры обязательны:
  - `security=reality`
  - `sni=<serverName>`
  - `fp=<fingerprint>`
  - `pbk=<realityPublicKey>`
  - `sid=<shortId>` (8-32 hex)
  - `type=tcp`
- fragment: `#XrayUser`

## 3) Version endpoint

`GET /version` возвращает semver версию control-plane:

```json
{
  "version": "X.Y.Z"
}
```
