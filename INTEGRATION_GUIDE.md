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

## 새 게임 CLAUDE.md에 넣을 한 줄

새 게임의 `CLAUDE.md` → `## 개발 시 반드시 지킬 것` 섹션(또는 최상단) 맨 앞에 다음 줄을 추가:

```markdown
- 게임 이식 전 `keenple-shared/INTEGRATION_GUIDE.md`를 먼저 읽을 것. v2.2~v2.10 체스 시행착오를 요약해둔 실전 가이드.
```

이 한 줄이 새 게임에서 뜨는 Claude 세션이 작업 시작 전에 이 문서를 열도록 유도합니다.
