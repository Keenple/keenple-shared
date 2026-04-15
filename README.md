# @keenple/shared

Keenple 게임들이 공유하는 공통 모듈.

## 설치

각 게임 `package.json`의 `dependencies`에 추가:

```json
"dependencies": {
  "@keenple/shared": "github:Keenple/keenple-shared#v1.0.0"
}
```

그리고 `npm install`.

## 포함 모듈

### `multiplayer/` — 방 관리 · 재연결 · 관전자 · 항복 · 라이프사이클

**서버 (Node.js):**
```js
const { createMultiplayerServer } = require('@keenple/shared/server-mp');
const mp = createMultiplayerServer(io, { minPlayers: 2, roles: ['red', 'blue'] });
```

**클라이언트 (브라우저):** — `node_modules/@keenple/shared/multiplayer/client-mp.js`를 서빙한 뒤 `<script>` 로드:
```html
<script src="keenple-shared/client-mp.js"></script>
```
(server.js에서 `express.static('node_modules/@keenple/shared', ...)` 설정 참고)

### `core/back-to-lobby.js` — 공통 "로비로" 버튼 헬퍼 (UMD)

```html
<script src="keenple-shared/back-to-lobby.js"></script>
<link rel="stylesheet" href="keenple-shared/back-to-lobby.css">

<button id="back-to-lobby-btn" class="keenple-back-to-lobby back-to-lobby-fixed"></button>
```

```js
BackToLobby.attach(document.getElementById('back-to-lobby-btn'), {
  isInProgress: () => !!mode && !gameOver,
  onReset: () => { /* 상태 리셋 + 로비 복귀 */ },
});
```

### `styles/back-to-lobby.css` — 위 버튼 스타일

---

## 게임 서버에서 브라우저로 서빙하는 법

`server.js`에 한 줄 추가:

```js
const path = require('path');
app.use('/keenple-shared', express.static(
  path.join(__dirname, 'node_modules', '@keenple', 'shared')
));
```

그러면 클라이언트에서 `keenple-shared/client-mp.js`, `keenple-shared/back-to-lobby.js`로 접근 가능.

## 버전 관리

- semver 태그 (`v1.0.0`, `v1.1.0`) 로 릴리즈
- 각 게임은 `package.json`에서 원하는 버전 고정 사용
- 업데이트: `npm install @keenple/shared@github:Keenple/keenple-shared#v1.1.0`

## Breaking change 정책

- **1.x.y** 이내에서 backward-compatible만 추가
- 인자 시그니처 변경·이벤트 이름 변경 등 깨지는 변경은 **2.0.0**으로 메이저 올림
