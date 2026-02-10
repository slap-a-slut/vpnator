# Compatibility Contract

Этот документ фиксирует контракт между `xray-control-plane` и desktop/client агентом.

## 1) Share payload (`GET /share/:token`)

HTTP 200 response:

```json
{
  "userId": "uuid",
  "serverId": "uuid",
  "vlessLink": "vless://...",
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
- дополнительные поля в объекте не допускаются

## 2) VLESS link format

Ожидаемый формат:

```text
vless://{uuid}@{host}:{port}?security=reality&sni={serverName}&fp=chrome&pbk={publicKey}&sid={shortId}&type=tcp#XrayUser
```

Требования:

- `scheme`: `vless://`
- user part: UUID клиента (`user.uuid`)
- `host`: публичный хост сервера
- `port`: `1..65535`
- query параметры обязательны:
  - `security=reality`
  - `sni=<serverName>`
  - `fp=chrome`
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
