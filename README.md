# @keenple/shared

Keenple 게임들이 공유하는 공통 모듈.

## 📖 읽는 순서 (처음 온 개발자용)

| 단계 | 문서 | 언제 |
|------|------|------|
| 1 | 이 README 아래 **체크리스트** | 5분, 주의사항 파악 |
| 2 | [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md) | 실전 이식 패턴 (v2.11+ 기준) |
| 3 | [`SHELL_DESIGN.md`](./SHELL_DESIGN.md) | 선언형 config 옵션 전체 레퍼런스 |
| 4 | [`CHANGELOG.md`](./CHANGELOG.md) | 버전별 breaking change |

**레퍼런스 게임** (실제 이식 완료된 코드 읽기):
- `체스 게임/` — 규칙 기반, **서버 권위 검증** 패턴
- `킨플 알까기/` — 물리 기반, **클라 신뢰 + merge** 패턴

**신규 게임 시작**: [`keenple-game-template`](https://github.com/Keenple/keenple-game-template) — `LOCAL_DEV_QUICK_START.md`로 시작.

---

## 새 게임 이식 담당 (Claude / 개발자) 체크리스트

**먼저 [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)를 읽으세요** (v2.11+ 실전 가이드, 체스 v2.2~v2.10 에피소드 요약). 체스가 v2.2 → v2.10 동안 reference 역할을 하며 같은 영역에서 반복 패치가 나왔습니다. 다음 게임은 이 지점들을 건너뛰세요.

- **경고 무시 금지** — v2.10부터 `validateConfig` · `checkServerConfig` · `isOpponentTurn` 미선언 경고가 콘솔에 나옵니다. warning이 보이면 설정이 빠진 것입니다.
- **선언만 사용** — `entryFee`, `rankMatch`, `modes.*.undoItem(freeCount 포함)`, `roles`/`roleLabel`, `isOpponentTurn` 는 모두 선언형 옵션으로 제공됩니다. 게임 코드에서 직접 지갑 차감 · DOM 트릭 · buyItem 수동 호출 금지.
- **mock 경고 체크** — `serverCall 미지정 — mock 모드` 경고가 뜨면 실제 차감이 안 되는 상태입니다. 의도된 경우에만 무시하세요.
- **AI 모드 주의** — 턴 감지는 `modes.ai.isOpponentTurn(state)` 콜백으로만. `aiSide='black'` 류 하드코딩은 v2.8.1에서 제거됐습니다. 무르기 스택(`undoMax`)은 모드별로 설정 가능, 기본 50.
- **하드코딩된 역할 금지** — `'white'/'black'/'red'/'blue'` 리터럴 직접 비교 대신 `config.roles` + `config.roleLabel(role)` 사용.
- **현재 reference** — `체스 게임/` (규칙 기반, 서버 권위 검증). `킨플 알까기/` (물리 기반, 클라 신뢰+merge). 상세 통합 가이드(INTEGRATION_GUIDE.md)는 알까기 이식 이후 v2.11+에서 작성 예정.

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

## SemVer · Breaking change 정책

shared는 엄격 SemVer(`MAJOR.MINOR.PATCH`)을 따릅니다. 핵심 3줄:

- **Patch** (`x.y.Z`) — 버그 수정, 동작 동일. 게임 업그레이드 안 해도 됨.
- **Minor** (`x.Y.0`) — 기능 추가, 하위 호환. 게임 코드 수정 불필요.
- **Major** (`X.0.0`) — 하위 호환 깨짐. 게임 코드 수정 동반. CHANGELOG의 `Breaking ⚠` 섹션 필독.

상세 정책(API 버전 규칙, 게임 레포 책임, FAQ 등)은 [keenple-main `docs/API-VERSIONING.md`](https://github.com/Keenple/keenple-main/blob/main/docs/API-VERSIONING.md)가 단일 진실원입니다.

버전별 변경 내역은 [`CHANGELOG.md`](./CHANGELOG.md) 참조.
