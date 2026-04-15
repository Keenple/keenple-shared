# @keenple/shared

Keenple 게임들이 공유하는 공통 모듈.

## 설치

각 게임 `package.json`의 `dependencies`에 추가:

```json
"dependencies": {
  "@keenple/shared": "github:Keenple/keenple-shared#v1.1.0"
}
```

그리고 `npm install`.

## 파일 구조 (v1.1.0부터 플랫)

```
@keenple/shared/
├── server-mp.js          ← 서버 멀티플레이어 모듈
├── client-mp.js          ← 클라이언트 멀티플레이어 모듈
├── back-to-lobby.js      ← "로비로" 버튼 헬퍼 (UMD)
└── back-to-lobby.css     ← 버튼 스타일
```

## 사용법

**서버 (Node.js):**
```js
const { createMultiplayerServer } = require('@keenple/shared/server-mp');
const mp = createMultiplayerServer(io, { minPlayers: 2, roles: ['red', 'blue'] });

// 클라 정적 서빙 (server.js에 추가)
app.use('/keenple-shared', express.static(
  path.join(__dirname, 'node_modules', '@keenple', 'shared')
));
```

**클라이언트 (브라우저):**
```html
<link rel="stylesheet" href="keenple-shared/back-to-lobby.css">

<script src="socket.io/socket.io.js"></script>
<script src="keenple-shared/client-mp.js"></script>
<script src="keenple-shared/back-to-lobby.js"></script>

<button id="back-to-lobby-btn" class="keenple-back-to-lobby back-to-lobby-fixed"></button>
```

```js
BackToLobby.attach(document.getElementById('back-to-lobby-btn'), {
  isInProgress: () => !!mode && !gameOver,
  onReset: () => { /* 상태 리셋 + 로비 복귀 */ },
});
```

## 버전 관리

- semver 태그 (`v1.1.0`, `v1.2.0`) 로 릴리즈
- 각 게임은 `package.json`에서 원하는 버전 고정 사용
- 업데이트: `npm install @keenple/shared@github:Keenple/keenple-shared#v1.2.0`

## Breaking change 정책

- **1.x.y** 이내에서 backward-compatible만 추가
- 인자 시그니처 변경·이벤트 이름 변경·**파일 경로 재구성** 등은 메이저(2.0.0) 올림
- v1.0.0 → v1.1.0: 파일을 루트로 플랫화 (기존 서브폴더 경로 깨짐). 원칙상 메이저지만 사용처가 4곳뿐이라 마이너로 처리하고 소비자 측을 동시 업데이트.
