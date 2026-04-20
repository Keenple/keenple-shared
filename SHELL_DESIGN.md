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

    // 게임오버 모달에 추가 정보 표시 (예: ELO, 예측 결과 등). 상세: §5.4
    gameOverExtras: (result, api) => HTMLElement,

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
api.endGame(result)        // 공식 게임 종료 알림 (v2.22.0+). AI/local 전용.
                           //   result: { winner?, reason?, titleOverride?, ...extras }
                           //   MP 모드 호출 시 console.warn + no-op — 서버가 권위자.
                           //   Spectator / 게임 시작 전 호출: 조용히 무시.
                           //   중복 호출은 handleGameOver 내부 가드로 차단.
                           //   상세: §5.4 GameOver 3종 API 역할 분리
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

### 5.2 장기 예측/스캔 (`customActions` · v2.15.0+)

예측/스캔은 **보드 옆 액션바에 상시 노출되는 N개 인스턴스 버튼** + **사용하면 used 회색 상태 유지**. 모달형 오버레이(`customOverlays`)로는 부족해서 별도 슬롯을 둡니다.

```js
hooks: {
  customActions: {
    prediction: {
      count: (state) => state.maxPredictions,   // number 또는 (state) => number
      render: (ctx) => {                        // 최초 1회. canvas 자유.
        const canvas = document.createElement('canvas');
        canvas.width = 40; canvas.height = 40;
        drawStamp(canvas.getContext('2d'), ctx.index);  // 도장 모양
        return canvas;
      },
      update: (el, ctx) => { /* 선택: state 변화 시 DOM 업데이트 */ },
      onClick: (ctx) => {                       // used/disabled면 shared가 차단
        ctx.api.emit('prediction:use', { index: ctx.index });
      },
      isUsed: (ctx) => ctx.state.predictions[ctx.index].used === true,
      isDisabled: (ctx) => ctx.state.gameOver || ctx.state.inPredictionMode,
    },
    scan: { /* 동일 구조 */ },
  },
}
```

Shell의 자동 처리:
- `#keenple-custom-actions` 컨테이너 생성 및 각 id별 그룹 DOM 주입.
- state 변화(`board.render` 호출 지점)마다 `isUsed`/`isDisabled`/`update` 재평가 → `data-used`·`disabled` 자동 토글.
- `api.addAction(id, spec)` / `api.removeAction(id)` — 예측 모드 진입 시 취소 버튼 동적 추가/제거.
- `api.refreshActions(id?)` — 타이머 등 외부 트리거로 상태 바뀔 때 수동 재평가.

**예약어**: `undo`, `surrender` 는 customActions id로 사용 불가 (throw).

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

### 5.4 GameOver 3종 API 역할 분리 (v2.22.0 + v2.23.0)

legacy-authoritative 게임(게임 자체 로직으로 승패 판정: 장기의 궁 잡기, 무르기 한도 초과, 예측 미스 등) 이 풍부한 종료 UI 를 구성할 때 세 API 를 역할 별로 조합한다. 꼼수(내부 state 조작, 직접 modal DOM 생성) 대신 공식 경로만 써야 재연결/rematch/다국어/테마가 깨지지 않는다.

| API | 책임 | 시그니처 | 예시 |
|-----|------|---------|------|
| `api.endGame(result)` | 게임 종료 알림 — GameOverModal 자동 표시 | `{ winner?, reason?, titleOverride?, ...extras }` | AI/local 에서 궁 잡기 판정 시 호출 |
| `result.titleOverride` | 모달 타이틀 문자열 교체 | `{ ko: string, en: string }` | `{ ko: '초(楚) 승리!', en: 'Cho wins!' }` |
| `hooks.gameOverExtras` | 모달 본문에 추가 DOM 삽입 | `(result, api) => HTMLElement` | ELO 변화, 예측 적중률, replay 버튼 등 |

**어느 걸 언제 쓰나**

- **기본 자동 문구("楚 승리")로 충분** → `api.endGame({ winner, reason })` 만. `config.roleLabel` 로 역할 문자열만 꾸미면 끝.
- **조사 처리, 이모지, reason 별 스타일 분기 필요** → `titleOverride` 추가. 자동 생성 덮어씀.
- **모달 본문에 ELO/replay/통계 등 구조화된 DOM 필요** → `gameOverExtras` 훅. 타이틀/배지는 건드리지 않음.

**절대 하지 말 것**
- MP 모드에서 `api.endGame` 호출 — 서버가 권위자. 항복은 `mp.surrender()`. shell 은 `console.warn` + no-op 으로 방어하지만 애초에 호출하지 말 것.
- 내부 state 직접 mutate 해서 종료 판정 우회 — reconnect/rematch 타이밍에 깨짐.
- 자체 modal DOM 생성 — 다국어 전환·backdrop·rematch 버튼이 shell 과 분리되어 유지 비용 폭증.

**MP 에서 `titleOverride` 쓸 때 주의**

shell 의 자동 시점 판단(`isMe = myRole === winner`)이 MP reason 기반 문구("상대 연결 끊김 — 승리!")를 양쪽 시점에 맞춰 생성한다. `titleOverride` 는 이 자동 분기를 전부 덮어쓰므로, 게임이 `api.getRole()` 로 내 역할을 직접 확인해서 시점별로 다른 문자열을 넘겨야 한다. 일반적으로 MP 에서는 자동 문구로 충분하므로 `titleOverride` 사용을 피하는 편이 안전.

**`resultStr` 배지 색상**

win/lose/draw/info 배지 색상은 자동 추론 유지. 지금은 override 없음 — 색상까지 커스텀 필요 시 별도 제안.

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

## 9. 확정된 설계 결정 (사용자 승인 완료)

| # | 항목 | 결정 | 비고 |
|---|------|------|------|
| 1 | AI 실행 위치 | **게임 소유** | 각 게임이 자기 `worker.js` 보유. Shell은 "AI 턴이다" 이벤트만 던지고, 진행 중 UI(thinking 표시)는 표준화. 기존 장기 worker 재활용 가능. |
| 2 | Undo 스택 | **Shell 관리** | Shell이 move 이력 배열을 보관, 버튼/단축키 자동. 게임 module은 `applyMove`만 구현하면 됨. 통일된 정책(기본 5회). |
| 3 | i18n 확장 | **지원 예정** | 향후 ja/zh/es 추가 계획. SDK `Keenple.t()` 객체형 오버로드 필요 (아래 §10 참조). |
| 4 | 관전자 채팅/리액션 | **v2 레이아웃 슬롯만 확보** | 기능 자체는 v2.1+ 에서. Shell은 "chat-panel" 영역만 예약해두고 기본 비표시. |
| 5 | 오목 이식 | **언젠가 이식** | 지금은 건드리지 않지만, v2 설계에서 오목 호환성 배려(아래 §10 참조). |

---

## 10. 오목 안전성 + SDK 협업 항목

### 10.1 오목은 작업 중 **절대 파손 금지**

현재 오목은 `@keenple/shared` 미사용, 자체 로컬 copies 유지. 따라서:

- **shell v2 코드는 오목과 무관** — import 안 하니 영향 0
- **오목 기존 로컬 `multiplayer/`, CSS는 그대로 유지**
- shell v2 변경 시 오목 touch 금지

### 10.2 잠재 위험 1곳 — SDK `Keenple.t`

i18n 확장을 위해 `Keenple.t`가 다언어 지원해야 하는데, 오목을 포함한 모든 기존 코드가 `Keenple.t('한', 'Eng')` 2-인자 패턴을 쓰고 있음. 따라서 **SDK 변경은 반드시 backward-compatible 오버로드**:

```js
// 둘 다 동작해야 함
Keenple.t('한글', 'English');                        // 기존
Keenple.t({ ko: '한글', en: 'English', ja: '日本語' }); // 신규
```

이 변경은 **keenple-main 담당에게 요청해야 할 작업**. Shell v2는 SDK 수정 완료 후 객체형 사용 가능. 완료 전까지는 2-인자 유지.

### 10.2.1 게임 코드 제약 — `position:fixed; top:0` 요소 금지

shell의 HUD 자동 측정(`measureHudOffset`)은 viewport 상단(top ≤ 20px, height < 200px)에 붙은 fixed 요소를 HUD로 간주한다. 게임 코드가 같은 조건의 banner/toast/notice를 띄우면 HUD로 오인되어 게임 화면이 그만큼 아래로 밀린다.

- 토스트/알림은 `top` 대신 `bottom` 또는 화면 중앙 사용
- 부득이 상단에 띄울 경우 `top: 60px` 이상으로 띄워 측정 윈도우 밖에 두기

### 10.3 검증 체크리스트 (오목용)

shell v2 이식 진행 중 매 마일스톤마다 오목 동작 확인:
- [ ] P1 완료 후: `keenple.com/omok/` 로그인 · 플레이 · 언어 변환 OK
- [ ] P3 완료 후 (알까기 이식): 위 동일 확인
- [ ] P5 완료 후 (장기 이식): 위 동일 확인
- [ ] SDK i18n 변경 후: 오목의 `Keenple.t('한','Eng')` 호출이 여전히 동작하는지

### 10.4 오목 이식 대비 설계 고려사항

`customOverlays` 훅이 충분히 유연해야 오목 특화 UI(예: 예측 오목의 예측 기능)를 담을 수 있음. 체스·장기·알까기 이식 경험으로 훅 설계를 안정화 → 언젠가 오목 이식 시 설계 변경 불필요하도록.

---

## 11. 로드맵 업데이트

오목 안전성 체크포인트 + SDK 작업 의존성 반영:

| Phase | 작업 | 산출물 | 오목 체크 |
|-------|------|--------|-----------|
| P0 | 설계 문서 리뷰 완료 | SHELL_DESIGN.md 확정 | - |
| P1 | `shells/turn-based.js` 클라 구현 | shared v2.0.0-alpha.1 | ✅ 확인 |
| P2 | `shells/turn-based-server.js` 서버 구현 | v2.0.0-alpha.2 | - |
| P3 | 알까기 파일럿 이식 + 시각 검증 | 알까기 배포 | ✅ 확인 |
| P4 | 체스 이식 + 시각 검증 | 체스 배포 | - |
| P5 | 장기 이식 (formation/prediction 훅) + 시각 검증 | 장기 배포 | ✅ 확인 |
| P6 | shared v2.0.0 안정판 릴리즈 | 태그 v2.0.0 | - |
| P7 | 템플릿 업데이트 + "50개 게임 빌드 가이드" | 템플릿 배포 | - |
| P8 (병행) | **keenple-main에 `Keenple.t` 객체형 오버로드 요청** | SDK 갱신 완료 | ✅ 확인 |

P8 완료 후에야 shell v2에서 ja/zh 등 실제 추가 가능. 그 전까지는 ko/en 유지.

---

## 12. 다음 단계

설계 결정이 확정됐으므로 P1(구현) 들어갑니다.

