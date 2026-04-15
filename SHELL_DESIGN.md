# Keenple Game Shell 설계 문서 (v2.0)

**목표**: 50개 게임을 같은 UI로 찍어내기 위한 카테고리별 Shell 아키텍처. 각 게임은 규칙·보드만 제공하고 나머지 UI/UX는 shared가 전부 책임진다.

**범위(v2.0)**: 턴제 게임 카테고리 하나. 현존 3개(체스·알까기·장기) 이식 가능한 수준. 이후 카테고리(실시간·파티)는 v3+ 에서 추가.

---

## 1. 설계 원칙

1. **UI 고정** — 현재 3개 게임의 시각 레이아웃을 픽셀 수준으로 보존. 이식 전/후 스크린샷 비교가 동일해야 함.
2. **게임은 규칙 + 보드만** — 나머지(로비·모달·버튼·타이머·재연결 등) 전부 shell.
3. **카테고리별 고정 UI** — 같은 카테고리 게임은 **반드시** 같은 UI 요소 세트 사용. 게임이 임의로 추가/제거 불가.
4. **특화 훅은 슬롯으로만** — 장기 상차림 같은 고유 UI는 shell이 정해진 "슬롯"에 끼워 넣을 수 있게 열어둠.
5. **Breaking change는 메이저** — v2에서 v3로 갈 때만 시그니처 깨도 됨. 2.x 내에선 추가만.

---

## 2. 패키지 구조 (v2.0)

```
@keenple/shared/
├── shells/
│   └── turn-based.js          ← KeenpleShell.createTurnBased
├── common/
│   ├── lobby.js               ← 로비 어댑터 (Keenple.UI.Lobby 래핑)
│   ├── match-hud.js
│   ├── timer.js
│   ├── surrender-button.js
│   ├── undo-button.js
│   ├── game-over-modal.js
│   ├── disconnect-overlay.js
│   └── spectator-banner.js
├── styles/
│   └── turn-based.css         ← 표준 레이아웃 CSS (현재 UI 기준)
├── server-mp.js
├── client-mp.js
├── back-to-lobby.js
├── back-to-lobby.css
└── package.json
```

**주의**: 루트 평탄화 유지. `shells/`, `common/`, `styles/`는 내부 참조용이므로 게임이 직접 import할 일 거의 없음.

---

## 3. Shell API — `createTurnBased`

### 3.1 전체 시그니처

```js
const shell = KeenpleShell.createTurnBased({
  // ── 메타 ────────────────────────────────
  gameKey: 'chess',
  gameName: { ko: '체스', en: 'Chess' },
  version: '1.0.0',            // 게임 자체 버전 (선택)

  // ── 규칙 엔진 (game-module.js 계약) ─────
  module: ChessModule,         // createInitialState/validateMove/applyMove/isTerminal

  // ── 보드 ────────────────────────────────
  board: {
    type: 'dom-grid' | 'canvas',
    mount: (container, api) => void,          // 초기 렌더
    render: (state, api) => void,             // state 변경 시 재렌더
    handleInput: (event, state, api) => Move, // 입력 해석 → move 반환 (또는 null)
    // api: { t(ko,en), emit(event, data), getState(), applyLocalMove(move) }
  },

  // ── 모드 ────────────────────────────────
  modes: {
    ai: {
      enabled: true,
      difficulties: [
        { id: 'easy',   label: { ko: '쉬움', en: 'Easy' },   config: { depth: 2 } },
        { id: 'medium', label: { ko: '보통', en: 'Normal' }, config: { depth: 3 } },
        { id: 'hard',   label: { ko: '어려움', en: 'Hard' }, config: { depth: 4 } },
      ],
      // AI 실행은 게임 쪽에서 담당. shell은 "AI 모드 시작" 이벤트만 던짐.
      onStart: (difficulty, state, api) => void,
      onOpponentTurn: (state, api) => Promise<Move>,
    },
    local: {
      enabled: true,
    },
    mp: {
      enabled: true,
      roles: ['white', 'black'],
      minPlayers: 2,
      maxPlayers: 2,
      rankMatch: true,           // Keenple.Match.findGame 버튼 표시
      reconnectTimeout: 30000,
    },
  },

  // ── 방 만들기 옵션 (자동 모달 생성) ─────
  options: [
    {
      id: 'turnTimer',
      label: { ko: '턴 시간', en: 'Turn Timer' },
      type: 'choice',
      values: [
        { v: 0,   label: { ko: '없음', en: 'None' } },
        { v: 30,  label: { ko: '30초', en: '30s' } },
        { v: 60,  label: { ko: '60초', en: '60s' } },
      ],
      default: 0,
      applyTo: ['ai', 'mp'],    // 어느 모드에서 보여줄지
    },
    {
      id: 'difficulty',
      label: { ko: '난이도', en: 'Difficulty' },
      type: 'choice',
      values: [...],
      default: 'normal',
      applyTo: ['mp'],          // 방 만들기에서만
    },
  ],

  // ── 특화 훅 (선택) ──────────────────────
  hooks: {
    // 게임 시작 직전 실행. 상차림 선택 같은 특화 UI를 띄울 수 있음.
    // 반환값(설정)이 game.options에 병합됨.
    onBeforeGameStart: async (context) => ({ formation: 'cho' }),

    // 게임오버 모달에 추가 정보 표시 (예: ELO, 예측 결과 등)
    gameOverExtras: (result) => HTMLElement,

    // 자체 오버레이 (장기 prediction/scan 같은 것)
    customOverlays: {
      prediction: { render: () => HTMLElement, triggers: [...] },
    },
  },

  // ── 서버 설정 (server.js에서만) ─────────
  server: {
    port: process.argv.includes('--port') ? ... : 3000,
    io: io,                    // socket.io 인스턴스
  },
});
```

### 3.2 Shell이 자동으로 하는 것

| UI 요소 | Shell 책임 | 게임 관여 |
|---------|-----------|-----------|
| TopBar | 자동 주입 (gameName 기반) | - |
| Lobby | SDK `Keenple.UI.Lobby` 호출. modes 기반 버튼 자동 생성 | - |
| AI 난이도 선택 | `modes.ai.difficulties` 기반 자동 모달 | - |
| 방 만들기 옵션 | `options` 배열 기반 자동 모달 | - |
| MatchHud | 자동 주입 (닉네임·타이머·ELO) | - |
| Board 컨테이너 | DOM 자리 제공 | `board.render` 구현 |
| Surrender | 자동 (MP 전용) | - |
| Undo | `modes.local.undo` / `modes.ai.undo` true면 표시 | 규칙 엔진에서 undo 지원 필요 |
| Timer | `options.turnTimer` 값 따라 자동 | - |
| Spectator Banner | 자동 (관전자 late-join 시) | - |
| Disconnect Overlay | 자동 (MP 재연결 대기) | - |
| GameOverModal | 자동 (SDK 사용, rematch 연결까지) | `gameOverExtras` 훅으로 추가 정보 주입 가능 |
| BackToLobby | 자동 (좌하단 고정 버튼) | - |
| Rematch | 자동 처리 (MP 양쪽 요청 수신 시 게임 재시작) | - |

### 3.3 Shell이 제공하는 `api` 객체 (board 콜백 안에서 사용)

```js
api.t(ko, en)              // 다국어 선택
api.getState()             // 현재 게임 상태
api.getMode()              // 'ai' | 'local' | 'mp' | 'spectator'
api.getRole()              // MP에서 내 역할 ('white' 등)
api.getTurn()              // 현재 턴 역할
api.emit(event, data)      // MP 이벤트 송신 (shell이 mp.send 래핑)
api.applyLocalMove(move)   // 로컬 모드에서 move 실행 (shell이 validateMove → applyMove 호출)
api.showToast(msg, type)   // 알림
api.showConfirm(msg)       // confirm 모달
api.setBoardCursor(type)   // 보드 커서 스타일
```

---

## 4. UI 보존 전략

### 4.1 현재 UI 베이스라인

- 화면 상단: `Keenple.UI.TopBar` (SDK) — 40px
- 그 아래: `Keenple.UI.MatchHud` (SDK) — 닉네임·점수·타이머
- 중앙: 보드 영역 (게임별 커스텀)
- 좌하단: "← 로비" 버튼
- 하단: Surrender · Undo 컨트롤 (게임별 배치)
- 우측 하단: 언어 드롭박스 (SDK v2.2+)

Shell v2는 이 레이아웃을 **그대로 유지**. 시각적 변경 없음.

### 4.2 CSS 테마 변수

게임별 색상/보드 스타일만 오버라이드 가능하도록 CSS 변수 노출:

```css
:root {
  --keenple-bg: #0f0f1a;
  --keenple-fg: #e0e0e0;
  --keenple-primary: #d4a574;
  --keenple-board-bg: #1a1a2e;
  --keenple-surrender-color: #ff6b6b;
  /* ... */
}
```

게임이 자기 `style.css`에서 이 변수들만 덮어씌워서 커스터마이징.

### 4.3 마이그레이션 전/후 시각 검증

각 게임 이식 후 체크리스트:
- [ ] 로비 화면 스크린샷 비교
- [ ] AI 옵션 모달 스크린샷 비교
- [ ] 방 만들기 모달 스크린샷 비교
- [ ] 게임 중 화면 (보드 + HUD + 버튼 배치)
- [ ] 게임 종료 모달
- [ ] 관전자 배너 표시
- [ ] 재연결 오버레이

**픽셀 완전 일치 어려우면 사용자에게 보고 후 결정.**

---

## 5. 특화 훅 설계 (게임별 고유 UI)

### 5.1 장기 상차림 (`onBeforeGameStart`)

```js
hooks: {
  onBeforeGameStart: async (context) => {
    // context: { mode: 'mp', role: 'cho', isHost, opponent }
    return new Promise(resolve => {
      showFormationUI(context.role, (formation) => {
        resolve({ formation });
      });
    });
  },
}
```

Shell은 이 Promise가 resolve될 때까지 **게임 시작을 지연**. MP에선 양쪽 모두 resolve될 때까지 대기.

### 5.2 장기 예측/스캔 (`customOverlays`)

```js
hooks: {
  customOverlays: {
    prediction: {
      render: (state, api) => createPredictionUI(state, api),
      triggers: ['prediction-mode-enter', 'prediction-mode-exit'],
    },
    scan: { ... },
  },
}
```

Shell은 이 오버레이들의 표시/숨김 상태만 관리. 실제 로직은 게임이.

### 5.3 체스 승급 모달 (`promotion`)

```js
hooks: {
  customOverlays: {
    promotion: {
      render: (state, api) => createPromotionModal(state, api),
    },
  },
}
```

게임이 `api.showOverlay('promotion')` 호출 → shell이 해당 오버레이 표시.

---

## 6. 서버 측 API — `createTurnBasedServer`

서버도 shell이 대부분 처리:

```js
const shell = KeenpleShell.createTurnBasedServer({
  gameKey: 'chess',
  module: ChessModule,
  io: io,
  modes: {
    mp: { roles: ['white','black'] },
  },
  hooks: {
    // 특화 이벤트 처리 (예: 장기 scan)
    onGameEvent: {
      scan: (room, player, data) => {...},
    },
  },
});
```

Shell이 자동 처리:
- 방 생성/입장/재연결/관전자
- 기본 move 이벤트 (`validateMove → applyMove → broadcast → isTerminal 체크`)
- Surrender · Timeout · Disconnect → endGame
- Rematch 협상
- ELO 보고 (keenple-main에 매칭 결과 전송)
- /api/status · /api/rooms 엔드포인트

게임이 구현:
- `module` (규칙)
- 필요시 `onGameEvent` 커스텀 핸들러

---

## 7. 이식 작업 예시 — 알까기

### Before (현재)

```
game.js: 890줄
server.js: 282줄
index.html: 31줄
style.css: 100줄
```

### After (shell 기반)

```js
// game.js (클라) — 규칙·보드만
const AlkkagiModule = require('./game-module');

KeenpleShell.createTurnBased({
  gameKey: 'alkkagi',
  gameName: { ko: '알까기', en: 'Alkkagi' },
  module: AlkkagiModule,
  board: {
    type: 'canvas',
    mount: (root) => createAlkkagiCanvas(root),
    render: (state) => drawBoard(state),
    handleInput: (event, state, api) => {
      if (event.type === 'flick-end') {
        api.emit('flickResult', { pieces: event.pieces });
      }
    },
  },
  modes: {
    local: {},
    mp: { roles: ['red', 'blue'], rankMatch: true },
  },
  options: [
    { id: 'turnTimer', type: 'choice', values: [15], default: 15, hidden: true },
  ],
});
```

예상 라인 수:
- game.js: ~300줄 (65% 감소)
- server.js: ~80줄 (70% 감소)
- index.html: ~10줄 (70% 감소)

---

## 8. 로드맵

| Phase | 작업 | 산출물 |
|-------|------|--------|
| P0 | 이 설계 문서 리뷰 + 승인 | SHELL_DESIGN.md 확정 |
| P1 | `shells/turn-based.js` 클라 구현 | shared v2.0.0-alpha.1 |
| P2 | `shells/turn-based-server.js` 서버 구현 | v2.0.0-alpha.2 |
| P3 | 알까기 파일럿 이식 + 시각 검증 | 알까기 배포 |
| P4 | 체스 이식 + 시각 검증 | 체스 배포 |
| P5 | 장기 이식 (formation/prediction 훅) + 시각 검증 | 장기 배포 |
| P6 | shared v2.0.0 안정판 릴리즈 | 태그 v2.0.0 |
| P7 | 템플릿 업데이트 + "50개 게임 빌드 가이드" 문서 | 템플릿 배포 |

**예상 총 기간: 7~10 영업일**

---

## 9. 열린 질문

승인 전에 확인해야 할 항목:

1. **AI 실행 위치** — shell이 워커에서 실행할지, 게임이 자기 worker.js 가질지. 장기는 이미 worker.js 있음. 호환 방식 필요.
2. **Undo 스택 관리** — shell이 관리 vs 게임의 game-module이 관리. 후자가 깔끔하지만 기존 게임들 모두 shell 방식이어야 하면 이식 부담.
3. **국제화 확장** — 현재 ko/en 2개. 앞으로 일/중/스페인 추가 가능성? `Keenple.t`가 2개 인자만 받게 돼 있어 SDK 쪽 변경 필요할 수도.
4. **스펙테이터 상호작용** — 관전자가 채팅/리액션 보낼지? shell v2에 chat 포함할지.
5. **오목 제외 확정** — 50개 중 오목은 제외고, 이후에도 shell 이식 안 할 건지 최종 확인.

---

## 10. 다음 단계

이 문서를 읽고 **수정 요구 / 승인**을 주시면 P1(구현) 들어갑니다. 이슈가 있거나 모호한 부분은 인라인으로 표시해주세요.
