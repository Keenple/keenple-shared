# @keenple/shared 게임 이식 실전 가이드

> **이 문서의 목적**
> 체스(`체스 게임/`)가 2026-04-09 ~ 04-17 동안 v2.2 → v2.10 릴레이 마이그레이션하며 **같은 영역에서 7번 재수정**된 패턴을 다음 게임이 건너뛸 수 있도록 정리했습니다. 여기 적힌 "권장/비권장"은 전부 실제 시행착오에서 나온 것입니다.
>
> SHELL_DESIGN.md는 "왜 이렇게 설계됐나"(설계자 시점), 이 문서는 "어떻게 붙이나"(사용자 시점)입니다.

---

## 읽기 전에

새 게임을 이식한다면 **이 문서를 먼저**, 그 다음 SHELL_DESIGN.md, 그리고 `체스 게임/game.js`·`server.js`를 실제 참조로 엽니다. 체스는 **규칙 기반 + 서버 권위 검증** 패턴의 현재 레퍼런스입니다 (`킨플 알까기/`는 물리 기반 + 클라 신뢰+merge 패턴 — 카테고리가 다르면 참조도 다름).

---

## 1. 입장료 / 지갑

### 원칙

`entryFee` + `payoutPolicy`를 **선언만** 한다. 게임 코드에서 `wallet.spend`를 직접 호출하거나 애니메이션을 수동 제어하지 않는다.

### 권장

```js
// server.js
const mp = createMultiplayerServer(io, {
  roles: ['roleA', 'roleB'],
  entryFee: 1,                  // 방 시작 시 자동 차감
  gameId: 'your-game',          // wallet 트랜잭션 기록
  payoutPolicy: 'refund-on-abort', // 기본: 서버 crash·abort 시 양쪽 환불
  rankMatch: { enabled: true, buildReport, dispatchUpdate },
});

// game.js
KeenpleShell.createTurnBased({
  entryFee: 1,           // 서버와 같은 값. 불일치 시 v2.5.1+ console.warn
  // ...
});
```

### 비권장 (체스가 v2.2 이전 잠깐 겪은 패턴)

```js
// ❌ 게임이 spend 직접 호출
const result = await wallet.spend({ userId, amount: 1, ... });
// rematch에서 재차감 누락, 코인 부족 사전 차단 없음, 애니메이션 수동 제어
```

### 배경 (v2.2.0 → v2.2.7 = 8연패)

자동 차감 → UI 피드백 → 사전 차단 → rematch 재차감 → 코인 부족 사전 모달 → idempotency-key 자동 생성까지 7번 릴레이 수정했습니다. 선언만 사용하면 전부 shared가 처리합니다.

---

## 2. AI 모드

### 원칙

- **턴 감지는 `modes.ai.isOpponentTurn(state)` 콜백으로만**. `aiSide = 'black'` 류 하드코딩은 v2.8.1에서 제거됐습니다.
- **AI 모드는 라운드당 half-move 2개**(플레이어 + AI)가 스택에 쌓입니다. 무르기 한 번 = 내 턴까지 반복 pop(= 2번 pop). 이건 v2.9.0부터 shared가 자동 처리.
- **`undoMax`는 모드별 선언** 가능. 기본 50 (AI 모드 25라운드 버퍼).

### 권장

```js
modes: {
  ai: {
    enabled: true,
    difficulties: [
      { id: 'easy',   label: {ko:'쉬움',   en:'Easy'} },
      { id: 'medium', label: {ko:'보통',   en:'Normal'} },
      { id: 'hard',   label: {ko:'어려움', en:'Hard'} },
    ],
    onOpponentTurn: async (state) => computeAiMove(state),
    isOpponentTurn: (state) => state.turn === <GAME_SPECIFIC_OPPONENT_TURN>,
    undoMax: 100,   // 긴 대국 허용하려면 상향
  },
},
```

### 비권장

```js
// ❌ isOpponentTurn 생략 → v2.8.1+ 경고 + AI 응답 실패 가능
// ❌ aiSide: 'black'  ← v2.8.0까지 존재. 지금은 무시됨
// ❌ 게임 코드에서 undoStack 수동 관리 → shared와 충돌
```

### 배경 (v2.8.1, v2.9.0, v2.9.1 = 3연패)

체스 AI 첫 실동작에서 `state.turn === 'black'` 가정 깨짐 · AI half-move/라운드 비대칭 · `undoMax` 기본값 5가 AI 모드 2.5라운드 만에 소진.

---

## 3. 무르기 아이템

### 원칙

**`modes.{ai|local}.undoItem` 선언만** 사용한다. `api.buyItem`·`api.undo`를 게임 코드에서 직접 호출하지 않는다.

### 권장

```js
modes: {
  ai: {
    enabled: true,
    undoItem: {
      itemId: 'your_game_undo_1',
      name: { ko: '무르기 1회', en: 'Undo 1 move' },
      price: 5,
      currency: 'keen',     // 'keen' 또는 'coin'
      freeCount: 2,         // 매 게임 앞 2회는 무료, 3회째부터 유료
      serverCall: async () => fetch('api/purchase/item', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: 'your_game_undo_1' }),
      }).then((r) => r.json()),
    },
  },
  local: {
    enabled: true,
    undoItem: { /* 로컬 2P도 원하면 동일 구조. 미선언 시 무료 무제한 */ },
  },
},
```

### 비권장 (체스가 v2.6.x 때 시도했다가 폐기)

```js
// ❌ api.buyItem 직접 호출 — shared 기본 리스너와 충돌, 헬퍼 30줄 필요
undoBtn.onclick = () => api.buyItem({ itemId, price, onSuccess: performUndo });
```

### 배경 (v2.6.0 → v2.8.0 = 5연패)

`buyItem` API → 통화 양쪽 지원 → DOM 헬퍼 → 선언적 `undoItem` config → `freeCount`까지 5번 릴레이. 지금은 선언 한 블록으로 끝납니다.

---

## 4. 일반 아이템

### 원칙 (v2.11.0부터 강제)

**`price > 0` 이면 `serverCall` 필수.** 조용한 mock 실패(새로고침 시 잔액 원복)를 shared가 차단합니다.

### 권장

```js
// game.js — 구매 버튼 트리거
api.createItemButton({
  itemId: 'your_game_hint',
  name: { ko: '힌트', en: 'Hint' },
  price: 3,
  currency: 'keen',
  serverCall: async () => fetch('api/purchase/item', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: 'your_game_hint' }),
  }).then((r) => r.json()),
  onSuccess: () => showHint(),
});
```

서버 엔드포인트(`/api/purchase/item` 등)는 게임 server.js가 자체 구현:
- 쿠키 → `KEENPLE_MAIN_URL/auth/me`로 유저 ID 확인
- 카탈로그에서 가격·화폐 서버가 읽음 (클라 body의 price는 **신뢰 금지**)
- `wallet.spend({ currency, amount, type: 'item_purchase', gameId, refType: 'item', refId: itemId, idempotencyKey })` 호출
- `{ ok, balance? }` 또는 `{ ok: false, error }` 반환

### 비권장

```js
// ❌ serverCall 생략 → v2.11.0+ 토스트로 차단, 감산도 안 됨
// ❌ 서버에서 req.body.price·currency 그대로 사용 → 클라가 1원으로 위조 가능
```

### 테스트 중 mock으로 돌리고 싶다면

```js
KeenpleShell.createTurnBased({
  dev: { allowMockPurchase: true },   // serverCall 없어도 mock 통과
  // ...
});
```

이 플래그가 true면 매 구매마다 `console.warn('MOCK 구매 — 로컬 잔액만 감산')`. 프로덕션 배포 전 반드시 제거.

### 배경 (v2.7.1, v2.9.1, v2.11.0)

`serverCall` 미지정 시 `console.warn` 한 줄로만 알리고 mock으로 떨어졌던 설계가 프로덕션에서 조용한 실패를 냈습니다. v2.11.0부터 `price > 0`이면 즉시 차단.

### 가격 단일 소스 — Catalog 우선 (v2.12.0+)

**가격·통화·이름은 main DB(`syncCatalog` 등록값)가 단일 소스.** game.js의 `undoItem.price` / `createItemButton({ price })`는 **fallback** 역할만 하고, 게임 시작 시 shell이 `Keenple.Catalog.load(gameKey)`로 main에서 가져온 값으로 덮어씁니다.

- `startGame()` 진입 시 `hasPaidItems(mode) && Keenple.Catalog`면 `await Keenple.Catalog.load(config.gameKey, true)` (force=true → 매 게임 fresh).
- 로드 실패 시 **유료 아이템 있는 모드는 시작 차단 + 에러 모달** (다른 모드는 정상 진입).
- `Keenple.Catalog` 자체가 없는 환경(구버전 main, SDK 미로드)은 차단 없이 fallback 진행.
- `purchaseItem` · `currentUndoItem` · `createItemButton` 모두 한 헬퍼(`resolveItemFromCatalog`)를 거쳐 일관된 가격/라벨 보장.

**관리자가 가격을 바꾸면 게임 클라 재배포 없이 즉시 반영**되는 게 목적입니다. game.js의 `price`는 단지 main 도달 불가 시 화면이 깨지지 않게 하는 안전망입니다.

---

## 5. 모드별 설정 사고법

### 원칙

공통 설정은 `config` 최상위, 모드별 차이는 `modes.{local|ai|mp}.X`. **글로벌 단일값**을 가정하지 말 것.

### 예시

```js
KeenpleShell.createTurnBased({
  // 공통 — 모든 모드에서 같음
  gameKey: 'your-game',
  entryFee: 1,              // MP에서만 실제 차감, 다른 모드는 no-op
  roles: ['roleA', 'roleB'],
  roleLabel: (role) => role === 'roleA' ? {ko:'라벨A', en:'LabelA'} : {ko:'라벨B', en:'LabelB'},

  // 모드별
  modes: {
    local: { enabled: true, undoMax: 50 },
    ai:    { enabled: true, undoMax: 100, isOpponentTurn, onOpponentTurn, undoItem: {...} },
    mp:    { enabled: true, minPlayers: 2, maxPlayers: 2, rankMatch: true },
  },
});
```

### 비권장

```js
// ❌ 단일 undoMax를 최상위에 두고 모든 모드에 적용
{ undoMax: 5 }   // AI 모드가 라운드당 2개씩 쌓여 2.5라운드에 꽉 참
```

### 배경

shared는 `getUndoMax(mode)` 가 `modes[mode].undoMax` → `modes.local.undoMax` → 50 순서로 해결. 모드별 선언하면 각 모드의 특성(half-move 2개/라운드 등)에 맞춰진다.

---

## 6. 빈틈 보고 채널

새 게임 이식 중 "shared가 이걸 제공해줬으면" 싶은 마찰점을 발견하면:

1. 게임 쪽에 workaround를 적은 PR을 한 번 올려 동작 확보
2. 그 workaround를 shared에 흡수하는 제안서(before/after 코드·acceptance·reference)를 **shared 담당 세션**에 전달
3. shared에 흡수되면 게임 쪽 workaround 제거 PR

체스는 이 채널로 2026-04-16 하루에 제안서 6건(v2.2~v2.9 + v2.11)을 shared에 보냈고, 매번 게임 코드 순감(-19줄, -23줄 등)으로 끝났습니다. **마찰점이 보이기 시작하는 순간이 shared 흡수의 적기**입니다.

---

## 7. 구버전 → v2.14.0 업그레이드 가이드

알까기(v1.1.0), 장기(v2.1.0) 등 구버전 shared를 쓰는 게임이 최신으로 올리는 체크리스트.

### 단계 1: package.json 업데이트

```json
"@keenple/shared": "github:Keenple/keenple-shared#v2.14.0"
```

`npm install` 후 서버·클라 양쪽 기동 → 콘솔 에러/경고 확인.

### 단계 2: Breaking change 3건 대응 (v2.10.0 / v2.11.0 / v2.12.0)

#### ⚠ v2.10.0 — validateConfig (throw)

`createTurnBased` 호출 시 다음이 없으면 즉시 throw:

| 필수 항목 | 예시 |
|-----------|------|
| `config.gameKey` (string) | `'janggi'` |
| `config.module.createInitialState` (function) | GameModule |
| `config.module.validateMove` (function) | GameModule |
| `config.module.applyMove` (function) | GameModule |
| `config.module.isTerminal` (function) | GameModule |
| `config.board.mount` (function) | `(container, api) => { ... }` |
| AI 모드 시 `modes.ai.difficulties` (배열) | `[{ id: 'easy', label, config }]` |
| AI 모드 시 `modes.ai.onOpponentTurn` (function) | `(state, api) => move` |
| MP 모드 시 `config.roles` 또는 `modes.mp.roles` (배열, 2+) | `['black', 'white']` |

**에러 메시지가 정확히 어떤 항목인지 알려주므로** 콘솔 보고 하나씩 추가하면 됨.

#### ⚠ v2.11.0 — serverCall 강제 (차단)

`price > 0`인 아이템에 `serverCall` 미지정 시 **구매 즉시 차단** (이전엔 mock 경고만).

```js
// ✅ 올바른 예
undoItem: {
  itemId: 'game_undo_1', price: 5, currency: 'keen',
  serverCall: async () => fetch('/api/purchase/item', { ... }).then(r => r.json()),
}

// ❌ v2.11.0 이후 차단됨
undoItem: { price: 5 }  // serverCall 없음 → 토스트 에러, 구매 안 됨
```

테스트 중 mock이 필요하면 `createTurnBased({ dev: { allowMockPurchase: true } })`.

#### ⚠ v2.12.0 — Catalog 우선 조회 (startGame gating)

`Keenple.Catalog` SDK가 로드된 환경에서 유료 아이템 있는 모드 진입 시 `await Keenple.Catalog.load(gameKey, true)` 선행. **로드 실패 시 해당 모드 시작 차단 + 에러 모달.**

대응:
- server.js 기동 시 `wallet.syncCatalog(gameId, items)` 호출 확인 (아이템이 DB에 등록되어야 Catalog API가 반환)
- `Keenple.Catalog` SDK 미존재 환경(구버전 main)은 자동 fallback — 차단 없음

### 단계 3: 새 기능 활용 (선택)

| 버전 | 기능 | 활용 시점 |
|------|------|-----------|
| v2.10.0 | `config.roleLabel(role)` 콜백 | HUD·게임오버에 역할명 한국어 표시 원할 때 |
| v2.10.1 | `api.destroy()` | SPA 라우팅으로 shell 인스턴스 정리 시 |
| v2.12.0 | Catalog 가격 단일 소스 | 관리자가 가격 변경 시 재배포 없이 반영 원할 때 |
| v2.13.0 | wallet-client v1 prefix 자동 | 업그레이드만 하면 자동 적용 |
| v2.14.0 | `createGameMenu` | 다중 모드 게임(장기 표준/속기 등)의 모드 선택 페이지 |
| v2.15.0 | `hooks.customActions` | 액션바에 상시 노출되는 N개 인스턴스 버튼(used 상태) — 장기 예측/스캔, 체스 기보 버튼 등 |

### 단계 4: 물리 기반 게임 참고 (알까기)

알까기처럼 `flick → result → 턴 변경` 패턴은 `createTurnBased`의 `validateMove → applyMove → isTerminal` 루프와 다를 수 있음. 두 가지 접근:

- **(a) createTurnBased 활용**: `board.handleInput`에서 flick 이벤트 발생 → `applyMove`가 물리 시뮬레이션 결과를 state에 반영 → `isTerminal` 판정. 비동기 애니메이션은 `board.render`에서 처리. **체스와 구조 동일하게 맞출 수 있으면 이 방식 권장.**
- **(b) server-mp + client-mp만 사용**: 로비/HUD/모달/입장료/아이템은 직접 SDK 호출, 게임 루프만 자체 구현. 현재 알까기가 이 상태. **shared의 UI 기능을 못 쓰는 대신 유연.**

어느 방식이든 **server-mp의 `onGameEvent`/`broadcastToAll`/`endGame` 패턴은 공통**이므로 서버 측은 그대로 활용.

### 단계 5: 장기 이벤트명 통일 (장기만 해당)

장기(예측 장기)는 서버가 `mp:createRoom`/`mp:game`, 클라가 `createRoom`/`move`로 이벤트명 불일치 상태. shared의 client-mp.js 이벤트 규격(prefix 없는 `createRoom`/`move`)에 서버를 맞추는 게 표준.

---

## 8. customActions — 액션바 상시 버튼 (v2.15.0+)

예측·스캔·기보 같은 **"보드 옆 액션바에 항상 떠 있는, N개 인스턴스, 사용하면 used 회색"** 패턴은 `hooks.customActions`로 선언합니다. 모달형 `customOverlays`와 구분:

| 패턴 | 사용 훅 |
|------|---------|
| 뜰 때만 보이는 모달 (승급 선택, 결과 팝업) | `customOverlays` |
| 게임 내내 액션바에 떠 있는 버튼 | `customActions` |

### 최소 예시 (장기 예측)

```js
KeenpleShell.createTurnBased({
  gameKey: 'janggi',
  // ...
  hooks: {
    customActions: {
      prediction: {
        count: (state) => state.maxPredictions,       // 3이면 도장 3개
        render: (ctx) => {                             // 최초 1회. canvas 자유.
          const c = document.createElement('canvas');
          c.width = 40; c.height = 40;
          drawStamp(c.getContext('2d'), ctx.index);
          return c;
        },
        onClick: (ctx) => {                            // used/disabled면 shared가 차단
          ctx.api.emit('prediction:start', { index: ctx.index });
        },
        isUsed:     (ctx) => !!ctx.state.predictions[ctx.index].used,
        isDisabled: (ctx) => ctx.state.gameOver,
      },
    },
  },
});
```

### 동작 원리

- **render는 최초 1번만 호출** — canvas 재그리기 없음 → flicker 없음.
- **state 변화 시** (local move · undo · MP `moveApplied`/`syncState` · 언어 전환) shared가 각 인스턴스의 `isUsed`/`isDisabled` 재평가 → `data-used` 속성 + `disabled` 자동 토글. canvas 재그리기 필요하면 `update(el, ctx)` 훅 사용.
- **외부 트리거** (타이머 만료 등)로 상태가 바뀌면 `api.refreshActions(id?)` 수동 호출.

### 런타임 추가/제거

예측 모드 진입 시 "취소" 버튼을 잠깐 추가:

```js
ctx.api.addAction('predictionCancel', {
  count: 1,
  render: () => { const b = document.createElement('span'); b.textContent = '✕'; return b; },
  onClick: () => { /* 취소 로직 */ ctx.api.removeAction('predictionCancel'); },
});
```

### 제약

- `undo`, `surrender` 는 예약어 — id로 사용 시 throw.
- 비주얼 override는 `.keenple-action-item[data-id="prediction"]` 선택자로 덮어쓰기. shared CSS는 border/hover/used 기본만 제공.
- 서버 상태 동기화는 customActions가 관여 안 함 — `api.emit` + `mp.customListeners`로 게임이 직접.

---

## 9. 서버 → 클라 emit 이벤트 목록 (저수준 client-mp 사용자용)

**`createTurnBased` 사용 중이면 shared가 모두 자동 처리 — 읽을 필요 없습니다.** 아래는 `client-mp.js` + `createMultiplayerServer`를 저수준으로 직접 쓰는 게임(과거 장기, 커스텀 파생 등)이 놓치기 쉬운 서버 emit 이벤트 목록입니다.

### 9.1 `client-mp.js`가 `mp.on(event, ...)` 으로 기본 제공 (passthroughEvents)

| 이벤트 | 시점 | payload |
|---|---|---|
| `roomCreated` | 방 생성 성공 | `{ roomCode, playerId, role, minPlayers, maxPlayers, entryFee, serverConfig }` |
| `roomJoined` | 방 참가/재접속/관전 성공 | `{ playerId, role, reconnected, options, entryFee, serverConfig, players, ... }` |
| `playerJoined` | 상대가 방에 들어옴 | `{ playerId, role, nickname }` |
| `playerDisconnected` | 상대 연결 끊김 | `{ playerId }` |
| `playerReconnected` | 상대 재접속 | `{ playerId }` |
| `readyToStart` | 최소 인원 충족 | `{ players }` |
| `gameStart` | 게임 시작 | `{ players, gameState, options, entryFee, serverConfig }` |
| `gameOver` | 게임 종료 (broadcastToAll) | `{ ...data }` (게임이 넘긴 데이터 전부) |
| `spectatorJoined` | 관전자로 입장 성공 | (빈) |
| `error` | 일반 서버 오류 | `{ message }` |
| **`entryFeeError`** | **입장료 차감 실패** | **`{ error: 'wallet_unavailable' \| 'login_required' \| 'insufficient_funds', required? }`** |

### 9.2 `mp.onServer(event, ...)` 로 직접 구독해야 하는 것 (server-mp.js 또는 게임 서버가 emit)

| 이벤트 | emitter | payload |
|---|---|---|
| `eloUpdate` | server-mp.js | `{ before, after, change }` |
| `payoutResult` | server-mp.js | `{ amount, reason, balanceAfter }` |
| `moveApplied` | 게임 서버 | `{ state, ... }` (게임 규격) |
| `syncState` | 게임 서버 | `{ state }` (재접속 시 전체 state 동기화) |
| `turnTimer` | 게임 서버 | `{ deadline? }` 또는 `{ seconds? }` |
| `roomList` | 게임 서버 (로비용) | `rooms[]` |
| `playerLeft` | server-mp.js (broadcastToRoom) | `{ playerId, role }` |

### 9.3 `entryFeeError`는 반드시 리스너를 붙이세요

서버가 `entryFeeError` emit → 게임 시작 차단. 클라가 리스너 안 달면 **사용자에게 "게임 시작 실패" 피드백이 없어서 멈춘 것처럼 보입니다.**

```js
mp.on('entryFeeError', (data) => {
  const msg = {
    wallet_unavailable: { ko: '지갑 서버 연결 불가',  en: 'Wallet server unreachable' },
    login_required:     { ko: '로그인이 필요합니다',  en: 'Login required' },
    insufficient_funds: { ko: '코인이 부족합니다 (' + data.required + ' coin 필요)', en: 'Not enough coins (' + data.required + ' required)' },
  }[data.error] || { ko: '입장료 오류', en: 'Entry fee error' };
  Keenple.UI.toast(msg, { type: 'error' });
  // 로비 상태 복구 — setStatus/showCancel 등
});
```

v2.15.1+ 부터 `client-mp.js`는 `entryFeeError`에 리스너가 없으면 1회 `console.warn`을 띄워 조용한 멈춤을 사전 경고합니다.

---

## 10. wallet 사운드 (v2.16.0+)

shared가 소유한 wallet 흐름(입장료 차감·환불·아이템 구매)에 대해 **shared가 직접 Web Audio로 짧은 효과음을 재생**합니다. 게임 고유 사운드(move/capture 등)와는 분리된 레이어 — 게임은 아무것도 안 해도 기본 재생됩니다.

### 10.1 재생 시점

`window` 에 dispatch되는 `keenple:wallet-changed` 이벤트의 `detail.reason`에 따라:

| reason | 언제 | 사운드 | 커스터마이즈 |
|---|---|---|---|
| `entry_fee` | MP 방 게임 시작 시 입장료 차감 | 하강 두 톤 (520→390→290Hz, triangle) | 없음 (고정) |
| `refund` | 게임 취소/payout 환불 | 상승 두 톤 (290→390→520Hz) — entry_fee 대칭 | 없음 (고정) |
| `item_purchase` | `buyItem`/`createItemButton`/`undoItem` 구매 성공 | 4개 프리셋 중 선택 (기본 `coin`) | 게임이 선택 |

`detail.mock: true` 인 이벤트는 재생 skip (mock 구매는 실 차감 아님).

### 10.2 item_purchase 프리셋 4종

| 이름 | 느낌 | 합성 |
|---|---|---|
| `coin` (기본) | 카지노 k-ching 축소 — 짧은 고주파 ping + noise burst | 1000→1300Hz sine 40ms + filtered noise 50ms |
| `chime` | 경쾌한 상승 3음 (보상감) | C5-E5-G5 sine arpeggio, 50ms 씩, 40ms stagger |
| `pop` | 부드러운 저음 탭 (은은) | 220→180Hz sine 60ms |
| `soft` | 은은한 상승 한 음 (미니멀) | 440→520Hz sine 100ms, 낮은 vol |

### 10.3 게임 기본 프리셋 지정

```js
createTurnBased({
  gameKey: 'chess',
  ...
  audio: {
    purchaseSound: 'chime',  // 'coin' | 'chime' | 'pop' | 'soft'. 생략 시 'coin'.
  },
})
```

허용되지 않는 값이면 `createTurnBased` 호출 시 throw.

### 10.4 호출별 override

개별 구매에서 기본값과 다른 사운드를 쓰고 싶을 때 `sound` 필드 전달:

```js
// 특정 아이템만 'pop'
api.buyItem({
  itemId: 'chess_undo_premium',
  price: 15,
  serverCall: ...,
  sound: 'pop',
});

// createItemButton도 동일
api.createItemButton({ itemId: 'hint', price: 3, ..., sound: 'soft' });

// 무르기 아이템 — modes 설정에 sound 필드 지원
modes: {
  local: {
    undoItem: { price: 3, itemId: 'chess_undo', serverCall: ..., sound: 'pop' }
  }
}
```

호출별 `sound` 없으면 `config.audio.purchaseSound` → `'coin'` 순으로 fallback.

### 10.5 자동재생 정책

Web Audio의 자동재생 정책 대응으로 shared가 document에 1회성 `pointerdown`/`keydown` 리스너를 걸어 첫 상호작용에서 AudioContext를 `resume()`합니다. 게임이 별도 처리할 필요 없음.

### 10.6 음소거는 지원하지 않음

v2.16.0 현재 shared에는 mute API가 없습니다. "모든 사운드 끄기"가 필요하면 **게임이 자체 구현**하세요 (체스의 Sound 모듈이 참고 예시). 향후 필요성이 구체화되면 `audio.isMuted` 콜백 기반으로 도입 고려.

---

## 새 게임 CLAUDE.md에 넣을 한 줄

새 게임의 `CLAUDE.md` → `## 개발 시 반드시 지킬 것` 섹션(또는 최상단) 맨 앞에 다음 줄을 추가:

```markdown
- 게임 이식 전 `keenple-shared/INTEGRATION_GUIDE.md`를 먼저 읽을 것. v2.2~v2.10 체스 시행착오를 요약해둔 실전 가이드.
```

이 한 줄이 새 게임에서 뜨는 Claude 세션이 작업 시작 전에 이 문서를 열도록 유도합니다.
