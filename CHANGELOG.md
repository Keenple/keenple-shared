# CHANGELOG

`@keenple/shared` 버전별 변경 내역. SemVer 정책은 [keenple-main `docs/API-VERSIONING.md`](https://github.com/Keenple/keenple-main/blob/main/docs/API-VERSIONING.md) 참조.

포맷: `Added` / `Changed` / `Breaking ⚠` / `Fixed`. v2.12.0부터 정식 작성. 그 이전 변경은 `git log` + 본 파일 하단의 "v2.12.0 이전 주요 변경" 섹션 참조.

---

## v2.26.0 (2026-04-21)

### Added
- **`modes.mp.matchVariantLabel: { ko, en }`** — 랭크 매칭 대기 오버레이에 표시될 variant 의 사람용 i18n 라벨. `Keenple.Match` SDK(main 커밋 `8ca377f`) 가 `"[variantLabel] 상대를 찾는 중..."` 형태로 기본 문구 앞에 prefix. variant 머신 id (`modes.mp.matchVariant`) 와 별개.
  - 예: `matchVariant: 'full-prediction'` + `matchVariantLabel: { ko: '완전예측', en: 'Full Prediction' }` → 오버레이 "[완전예측] 상대를 찾는 중..." / "[Full Prediction] Finding opponent...".
  - 다변형 게임이 3개 variant 를 동시 큐에 띄우면 사용자가 자기가 어떤 variant 대기 중인지 명확히 인지 가능 → variant 불일치로 대기만 길어지는 케이스 UX 개선.
- `validateConfig` — `modes.mp.matchVariantLabel` 선언 시 `{ ko, en }` 형식 강제. 잘못된 포맷이면 throw.

### Changed
- `validateConfig` 내부 `_checkI18n` 헬퍼를 AI 블록 밖으로 끌어올려 AI/MP 양쪽에서 공유. 동작 변화 없음.

### Breaking ⚠
- (없음 — 새 옵션 추가. 미선언 게임은 이전 동작 그대로 "상대를 찾는 중..." 만 표시됨.)

### 마이그레이션 메모
- **장기 등 다변형 게임**: `modes.mp.matchVariantLabel` 한 줄 추가로 variant 인지 UX 개선. 기존 `matchVariant` 머신 id 는 그대로.
- **variant 미사용 게임**: 변경 필요 없음. `matchVariantLabel` 미선언 시 SDK 는 기본 문구만 표시.
- **Main 의존성**: main 커밋 `8ca377f` 가 라이브 배포되어 있어야 오버레이에 반영됨. SDK 가 해당 필드를 아직 받지 못하는 환경(구버전 main)에서는 shared 가 넘겨도 무시되므로 크래시 없이 no-op.

---

## v2.25.0 (2026-04-21)

### Added
- **`modes.ai.difficulties[i].description` 형식 검증** — `validateConfig` 이 `description` 선언 시 `{ ko, en }` 문자열 객체를 강제. 위반 시 throw. 기존엔 잘못된 포맷이면 picker 렌더 시 `dataKo={undefined}` 로 DOM 이 깨지는데 원인이 불명확했음. `pickerSubtitle` 과 동일한 `_checkI18n` 재사용.

### Docs
- **AI picker 텍스트 배치 정식 문서화** — `difficulty.description` 옵션(카드 안 `<p>` 로 렌더, `.keenple-picker-card p` 스타일) 은 v2.14.0부터 구현돼 있었으나 CHANGELOG · INTEGRATION_GUIDE 어디에도 명시되지 않았음. 체스(v2.2~) · 예측 장기(v2.25 직전 이관) 실사용 중. INTEGRATION_GUIDE `§2 AI 모드` 에 옵션 + 배치 원칙 섹션 추가.
- 배치 원칙: **카드별 차이는 `difficulties[i].description`, 전체 공통 UX 안내는 `modes.ai.pickerSubtitle`**. 난이도별 차이를 subtitle 하나에 몰아쓰지 말 것 (장기 이관 중 직접 확인된 선례).

### Changed
- (없음)

### Breaking ⚠
- (없음 — 기존 소비 게임 audit 결과 체스(`게임/game.js:609-613`) · 예측 장기(`프로젝트/game.js:1665-1669`) 모두 이미 `{ ko, en }` 포맷 사용. 잘못된 포맷 게임 0건 확인 후 릴리즈. 오목 · 알까기 · game-template 은 AI 모드 미사용.)

### 마이그레이션 메모
- 기존 게임: 이미 `description: { ko, en }` 쓰고 있으면 변경 불필요.
- 신규 게임: `description` 선언 시 반드시 `{ ko, en }` 객체. 문자열 선언은 `validateConfig` 가 throw 하므로 picker 모달이 뜨지 않음 → 즉시 발견.
- 난이도 공통 안내는 `pickerSubtitle` 로 (v2.21.0+), 난이도별 차이는 `description` 으로.

---

## v2.24.0 (2026-04-20)

### Fixed
- **`matchVariant` 재설계 — composite gameKey 제거** — v2.18.0 이후 `modes.mp.matchVariant` 가 `gameKey: 'janggi::mode1'` 형태 composite key 로 전송돼 main `/api/match/queue` 에서 400 거부되던 문제. 장기 등 다변형 게임이 매칭을 전혀 못 쓰던 상태였음.
  - v2.24.0+ 부터 gameKey 는 순수 `GAME_KEY` 유지, variant 는 별도 필드로 전달: `Keenple.Match.findGame({ gameKey, variant, ... })`.
  - main 측 (커밋 `be529d4`) 이 `(gameKey, variant)` 쌍 큐 분리 배포 완료 → shared 한 줄 패치로 복구.
  - ELO/리더보드는 gameKey 기준 유지 (variant 로 쪼개지 않음). NULL variant 는 NULL 끼리만 매칭.

### Changed
- `validateConfig` — `modes.mp.matchVariant` 값이 main 제약(`^[a-z0-9_-]{1,32}$`) 에 맞는지 조기 검증. 위반 시 throw (이전엔 main 이 400 으로 늦게 반환).

### Breaking ⚠
- (없음 — v2.18.0~v2.23.0 의 matchVariant 는 main 에서 이미 400 거부 상태였으므로 동작 복구이지 깨는 변경 아님. `modes.mp.matchVariant` 옵션은 유지, 내부 전송 방식만 교체.)

### 마이그레이션 메모
- 장기 등 다변형 게임: v2.18.0~v2.23.0 에서 임시로 `matchVariant` 제거한 코드를 `matchVariant: difficultyMode` 한 줄로 복구. variant 는 소문자·숫자·언더스코어·하이픈·최대 32자 내에서.
- 기존 게임(variant 미사용): 아무 변경 필요 없음.

---

## v2.23.0 (2026-04-20)

### Added
- **`api.endGame(result)` 의 `result.titleOverride` 필드** — 게임오버 모달 타이틀을 게임이 풍부하게 지정할 수 있게 함. 형식 `{ ko, en }` 문자열 객체. `computeGameOverCfg` 마지막 단계에서 자동 생성 문구(`roleLabel + ' 승리'`, MP reason 기반 `'상대 연결 끊김 — 승리!'` 등)를 덮어씀. 형식 불일치 시 `console.warn` + 무시.
  - 사용 예: `api.endGame({ winner: 'cho', reason: 'captureKing', titleOverride: { ko: '초(楚) 승리!', en: 'Cho wins!' } })`
  - 조사 처리, 이모지/강조, reason 별 formatting 등 커스텀 타이틀 필요한 게임용.

### Changed
- `computeGameOverCfg` — `result.titleOverride` 가 유효할 때만 title 덮어씀. `resultStr` (win/lose/draw 배지) 는 자동 추론 그대로 유지.

### Breaking ⚠
- (없음 — 새 필드. 기존 `api.endGame(result)` 호출 동작 변경 없음.)

### 마이그레이션 메모
- **MP 에서 titleOverride 쓸 땐 주의**: shell 의 자동 시점 판단(`isMe`)을 우회하므로, 게임이 내 역할 vs 상대 역할을 직접 고려해야 한다 (예: "상대 연결 끊김 — 승리!" 같은 시점 기반 문구를 override 하면 상대편에게는 어색한 문구가 나갈 수 있음).
- **resultStr 배지 색상**: 여전히 자동 추론. 색상까지 커스텀이 필요하면 별도 제안.
- **타이틀 자동 생성 유지가 필요한 경우**: `titleOverride` 를 그냥 생략하면 기존 로직 그대로.

---

## v2.22.0 (2026-04-20)

### Added
- **`api.endGame(result)` 공식 게임 종료 API** — legacy-authoritative 게임(장기 `captureKing` 등)에서 자체 로직으로 종료 판정 시 사용. `result: { winner?, reason?, ...extras }` 는 기존 `computeGameOverCfg` 포맷과 동일.
  - AI/local: `handleGameOver` 직통.
  - MP: `console.warn` + no-op — 서버가 권위자이므로 항복은 `mp.surrender()` 로 명시 유도. auto-redirect 대신 hint 메시지.
  - Spectator / 게임 시작 전 호출: 경고 없이 무시.
- **`createGameMenu` hero / header / footer 슬롯** — `HTMLElement | ((ctx) => HTMLElement)`, ctx = `{ t, getLang }`. 레이아웃: `header` → 타이틀 → `hero` → 카드 → `footer`. 기존 `::before` CSS 우회를 실 DOM 으로 이관해 접근성/i18n/lazy-load 처리 가능.
- **`--keenple-title-gradient` CSS 변수** — `.keenple-game-menu-title` 하드코딩 gradient 를 변수로 노출. 게임이 `!important` 없이 덮어쓰기 가능. 미지정 시 기존 gradient 폴백.

### Changed
- `handleGameOver` — 중복 호출 가드(`if (gameOver) return`) 추가. `api.endGame` + `mp.on('gameOver')` 동시 수신 같은 레이스 무력화.

### Breaking ⚠
- (없음 — 전부 additive. 기존 호출/설정 동작 그대로.)

### 마이그레이션 메모
- **api.endGame**: MP 모드에서 호출 시 경고 + no-op 이다. auto-redirect 로 `mp.surrender()` 연결하지 않는다는 점 주의 — 명시적으로 `mp.surrender()` 호출할 것.
- **createGameMenu 슬롯**: 기존 `config.title` + `config.modes` 만 쓰던 게임은 동작 변화 없음. 장식을 `::before` 로 넣던 게임은 `hero` 슬롯으로 이관 권장.
- **title-gradient 변수**: `.keenple-picker-title` 는 현재 gradient 아니라 이번 범위에서 제외 (필요 시 별도 제안).
- **main SDK 이관 대기**: `.kp-lobby-title` 의 `--kp-title-gradient` 변수화는 main 팀 쪽 작업. 장기는 여전히 `.kp-lobby-title` 오버라이드 시 `!important` 필요 (main 릴리즈 전까지).

---

## v2.21.0 (2026-04-20)

### Added
- **`config.gameName` 폴백 체인 확장** — `gameName` 미지정 시 `config.title` → `gameKey` 순으로 폴백. `createGameMenu` 에서 쓰는 `title` 과 키 일관화. 변형별 이름이 다른 게임(예측 장기 등)은 기존대로 `gameName` 을 명시해야 한다 (폴백은 실수 방지 안전망).
- **AI picker 타이틀/부제 커스텀** — `modes.ai.pickerTitle` / `modes.ai.pickerSubtitle` (`{ko,en}`) 옵션. 미지정 시 기본 문구("AI 난이도 선택"). `.keenple-picker-subtitle` CSS 클래스 신규.
- **`config.topBar: false` opt-out** — shell 자동 `Keenple.UI.TopBar` 호출 건너뜀. 게임이 변형별 제목 등으로 TopBar 를 직접 제어하는 경우 로딩 깜빡임(슬러그 → 실제 이름) 방지. `createTurnBased` · `createGameMenu` 양쪽 지원. 미래 object 확장 여지 둠.

### Changed
- `renderAiPicker(mount, difficulties, onPick, onBack, opts)` 시그니처 — 5번째 인자 `opts: { title?, subtitle? }` 추가. 기존 호출(4인자) 동작 변경 없음.

### Breaking ⚠
- (없음 — 전부 additive. 기존 설정/호출 그대로 동작.)

### 마이그레이션 메모
- 기존 게임 추가 작업 불필요. 깜빡임 이슈가 있던 변형 게임은 `config.topBar: false` 로 전환 권장.
- `config.topBar` 타입은 현재 boolean 만 허용. `{ enabled: false, ... }` 형태 object 확장은 추후 필요 시 추가.

---

## v2.20.0 (2026-04-20)

### Added
- **게임 시작 전 상대 이탈 즉시 처리** — lobby/matchmaking/상차림(formation) 단계에서 한쪽이 탭을 닫거나 나가면 남은 플레이어가 30초 기다리지 않고 **즉시 로비로 복귀**.
- 서버 신규 이벤트 `peerLeftBeforeStart` — payload `{ role, nickname }`. `server-mp.js`의 `disconnect` 핸들러가 `!room.gameStarted && anyConnected` 분기에서 브로드캐스트 후 방 즉시 destroy.
- `client-mp.js` passthroughEvents 에 `peerLeftBeforeStart` 추가 — `mp.on('peerLeftBeforeStart', ...)` 로 수신 가능.
- `turn-based.js` 기본 핸들러 — `peerLeftBeforeStart` 수신 시 토스트("상대가 방에서 나갔습니다") + `backToLobby()`. shell 사용 게임은 별도 구현 불필요.

### Changed
- 서버 `disconnect` 핸들러 — 시작 전 상대 이탈 분기 추가. 기존 시작 후 경로(`playerDisconnected` + `reconnectTimeout` 타이머 + 기본 `endGame(disconnect)`)는 변경 없음.

### Breaking ⚠
- (없음 — 신규 이벤트 추가 + 서버 분기 추가. 기존 `playerDisconnected`/`gameOver(reason:disconnect)` 흐름은 그대로.)

### Fixed
- 장기 상차림 단계에서 상대 탭 닫기 시 30초 `reconnectTimeout` 대기 후에야 `endGame` 발화되던 어색한 UX. 이젠 즉시 로비 복귀.
- lobby에서 방 만들고 상대 대기 중 방장 탭 닫기 → 빈 방 정리는 기존에도 동작했으나, 반대(참가자가 방 주인 대기 중 나감) 케이스에서 30초 대기하던 문제.

### 마이그레이션 메모
- **기존 게임 추가 작업 불필요** — shell 사용 게임(체스/장기/알까기)은 기본 핸들러로 자동 처리.
- 저수준 `client-mp` 직접 사용 게임은 `mp.on('peerLeftBeforeStart', (data) => { ... })` 리스너 추가 권장. 미구현 시에도 서버는 방을 정리하므로 broken state는 아니지만, 남은 플레이어에게 "상대 나감" 피드백이 없음.
- `onSurrender` lifecycle 은 시작 전 이탈에는 발화 안 함 (게임 룰 상 항복 아님). 시작 후 surrender 시에만 기존대로.

---

## v2.19.0 (2026-04-20)

### Added
- **MP 옵션 위치 일관화** — `customListeners` 를 `modes.mp` 하위로 통합. 이제 모든 MP 관련 옵션(`enabled`, `roles`, `minPlayers`, `maxPlayers`, `rankMatch`, `handshakeQuery`, `roomListUrl`, `filterRoomList`, `matchVariant`, `customListeners`)이 `modes.mp.*` 단일 경로에 있음.
- `validateConfig` — `modes.mp.customListeners` / `config.mp.customListeners` 구조 검증 (객체 + 값이 함수). 양쪽에 동시 선언 시 warn.

### Changed
- `config.mp.customListeners` 읽기 지점 — `modes.mp.customListeners` 우선, `config.mp.customListeners` 는 legacy fallback. legacy 사용 시 1회 deprecation warning.

### Breaking ⚠
- (없음 — legacy `config.mp.customListeners` fallback 유지. 다음 major 에 제거 예정.)

### Fixed
- `config.mp.customListeners` 가 유일한 `config.mp.*` 사용처였던 비대칭. 여러 게임이 `modes.mp` 안에 선언해도 동작 안 하는 UX 함정(장기 이식 중 MP 전체 먹통) 해소.

### 마이그레이션 메모
- **새 게임**: 처음부터 `modes.mp.customListeners` 에 선언.
- **기존 게임**: 선언 위치만 `config.mp` → `modes.mp` 로 옮기면 됨. 내용 변경 없음.
  ```diff
  - mp: { customListeners: { moveApplied: (data, api) => {...} } }
    modes: {
      mp: {
        enabled: true,
  +     customListeners: { moveApplied: (data, api) => {...} },
      }
    }
  ```
- legacy 경로는 deprecation warn 뜨지만 동작. 다음 major(v3.0) 에서 제거.

---

## v2.18.0 (2026-04-20)

### Added
- **variant 분리 — 다변형 게임이 방 리스트·매칭 큐를 variant별로 분리** (장기 완전예측/행마예측/일반, 오목 6목/7목 등). `modes.mp` 하위 4개 옵션 추가. 전부 선택 — 미선언 시 기존 동작 그대로.
  - `modes.mp.handshakeQuery: object` — socket.io handshake query로 서버에 variant 전달. shell이 `GameClient.connect({ query: ... })`로 패스스루. 서버가 `socket.handshake.query.variant`로 읽어 roomList emit 전 필터 가능.
  - `modes.mp.roomListUrl: string` — HTTP poll URL 오버라이드 (기본 `'api/rooms'`). 예: `'api/rooms?variant=full'`.
  - `modes.mp.filterRoomList: (room, ctx) => boolean` — 클라측 방 리스트 필터. socket `roomList` push + HTTP poll 결과 양쪽에 적용. `ctx = { gameKey, variant }`.
  - `modes.mp.matchVariant: string` — `Keenple.Match.findGame`에 전달하는 `gameKey`를 `GAME_KEY::variant` composite로 합성. 같은 gameKey 다변형 게임의 매칭 큐 자연 분리.

### Changed
- `mp.onServer('roomList')` 리스너 — `applyRoomListFilter(rooms)` 경유 후 `lobbyApi.pushRooms`.
- `Keenple.UI.Lobby` fetchRooms — `getRoomListUrl()` + `applyRoomListFilter()` 경유.
- `ensureMp` — `modes.mp.handshakeQuery` 존재 시 `mp.connect({ query })` 주입.

### Breaking ⚠
- (없음 — 네 옵션 모두 선택. 기존 게임은 옵션 생략 시 현 동작.)

### Fixed
- (없음)

### 알려진 한계 · 후속 작업
- **joinRoom 서버 검증은 shared 강제 불가** — `filterRoomList`로 방을 숨겨도, 룸 코드를 직접 입력하면 참가 가능. 각 게임 서버의 `mp:joinRoom` 핸들러가 `room.variant === socket.handshake.query.variant` 검증을 직접 구현해야 참가까지 차단.
- **`matchVariant` composite key 의존** — `Keenple.Match` SDK가 `gameKey`를 opaque 큐 버킷으로 다룬다는 전제. SDK가 gameKey로 API path나 DB 조회를 구성한다면 `::` 포함 키가 깨질 수 있음. 장기/체스에서 sanity check 후 문제 있으면 SDK에 별도 `matchKey` 파라미터 요청.
- **variant leak via handshake** — 악의적 클라가 `handshakeQuery`를 스푸핑해 다른 variant 방 리스트 조회 가능. variant별 민감 정보 없으면 무시 가능. ELO/보상 차등 정책 도입 시 재검토.

---

## v2.17.0 (2026-04-20)

### Added
- **pre-lobby 메뉴 백 내비게이션** — 변형이 여러 개인 게임(장기 완전예측/행마예측/일반, 체스 변형 등)이 shell 안에서 pre-lobby 메뉴로 복귀할 수 있는 표준 경로.
- `createTurnBased` config 옵션: `onBackToMenu: () => void` — 선언 시 shell이 자동으로:
  - lobby 상태(`mode` 미설정)에서 좌하단 fixed "← 메뉴" 버튼 표시. 게임 상태에서는 자동 숨김 (back-to-lobby 버튼이 대신 노출).
  - 버튼 클릭 시 `BackToLobby` 패턴 재사용 — 게임 진행 중이면 confirm 모달 → MP 세션 정리 → `destroy({ removeDom:true })` → `onBackToMenu()` 콜백.
  - `BackToLobby` UMD 미로드 환경에서는 `window.confirm` fallback.
- `createTurnBased().destroy(opts)` — `opts.removeDom === true` 시 shell이 mount한 body-level DOM 7종(`#keenple-game-area`, `#keenple-ai-picker`, `#keenple-room-options`, `#keenple-disconnect-overlay`, `#keenple-spectator-banner`, `#keenple-back-to-menu-btn`, `#keenple-shell-error`) + `lobbyApi.destroy()`(존재 시) 철거. 기존 `destroy()` 호출자는 영향 없음 — opts 생략 시 기존 동작 그대로.

### Changed
- `startGame` / `backToLobby` 내부에서 back-to-menu 버튼 visibility 갱신. (`mode` 변화에 따라 자동 show/hide.)

### Breaking ⚠
- (없음 — onBackToMenu 미선언 게임은 기존 동작 그대로.)

### Fixed
- (없음)

### 마이그레이션 메모
- **기존 게임 추가 작업 불필요** — `onBackToMenu` 옵션 생략 시 메뉴 버튼 안 뜸.
- 변형이 여러 개인 게임만 `onBackToMenu`에 "현재 페이지를 pre-lobby 메뉴로 되돌리는 로직"을 넘기면 됨. 예: `location.reload()` 또는 SPA 라우터 push.
- `onBackToMenu` 콜백 전에 shell DOM이 이미 정리된 상태이므로, 콜백에서 새 `createGameMenu(...)` 호출 가능.

---

## v2.16.0 (2026-04-20)

### Added
- **shared 소유 wallet 사운드** — `keenple:wallet-changed` 이벤트 발생 시 shared가 직접 Web Audio로 청각 피드백 재생. 게임 고유 사운드(move/capture 등)와 분리된, wallet 흐름 전용.
  - `entry_fee` (입장료 차감): 하강 두 톤 (520→390→290Hz, triangle). 고정.
  - `refund` (환불): 상승 두 톤 (290→390→520Hz, triangle) — entry_fee 대칭. 고정.
  - `item_purchase` (아이템 구매 성공): **4개 프리셋 중 게임이 선택**.
    - `coin` (기본) — 짧은 고주파 ping + 살짝 noise (k-ching 축소).
    - `chime` — 경쾌한 상승 3음 (C5-E5-G5, sine).
    - `pop` — 짧은 저음 탭 (220→180Hz, sine).
    - `soft` — 은은한 상승 한 음 (440→520Hz, sine).
- `createTurnBased` config 옵션: `audio: { purchaseSound: 'coin' | 'chime' | 'pop' | 'soft' }` — 게임 전체 기본 프리셋 지정. 생략 시 `'coin'`.
- `buyItem(opts)` / `createItemButton(opts)` / `modes.{local|ai}.undoItem` 에 `sound` 필드 — **호출별 override** (config 기본값보다 우선). 예: 기본은 `'chime'`이지만 이 아이템만 `'pop'`.
- 내부 `AudioContext` 싱글톤 + 첫 `pointerdown`/`keydown`에서 자동 `resume()` (자동재생 정책 대응). 모든 createTurnBased 인스턴스가 하나의 ctx 공유.

### Changed
- `keenple:wallet-changed` 구독 리스너 — 모든 게임에 바인딩되도록 변경 (이전엔 `defaultEntryFee > 0`일 때만). item_purchase는 입장료 없는 게임에서도 발생 가능.
- `runPurchase` dispatch — detail에 `sound` 힌트 포함 (호출자가 `opts.sound` 넘겼을 때만).

### Breaking ⚠
- (없음 — audio 미선언 게임도 기본값 `'coin'`으로 자동 재생. 기존 무음 상태에서 소리가 추가되는 UX 변경이지만 API 호환.)

### Fixed
- (없음)

### 마이그레이션 메모
- **기존 게임 추가 작업 불필요** — `audio` 옵션 생략 시 `'coin'` 프리셋으로 자동 재생.
- 기본 사운드가 게임 분위기와 맞지 않으면 `audio.purchaseSound`로 4개 프리셋 중 선택. 차감/환불 사운드는 shared 표준이라 커스터마이즈 불가 (일관성 의도).
- **음소거 기능은 shared에 없음**. 필요하면 게임이 자체 구현 (체스의 Sound 모듈 참고).

---

## v2.15.1 (2026-04-17)

### Added
- `client-mp.js` — `entryFeeError` passthrough 추가 (`mp.on('entryFeeError', ...)`으로 수신 가능). 리스너 미등록 시 1회 `console.warn` — 저수준 사용자가 서버 차단을 놓쳐 사용자에게 "멈춘 화면"을 주는 실수 예방.
- `INTEGRATION_GUIDE.md` 섹션 9 — "서버 → 클라 emit 이벤트 목록". passthrough 11종 + onServer 전용 7종 표로 정리. `entryFeeError` 처리 권장 코드 포함.

### Changed
- (없음)

### Breaking ⚠
- (없음)

### Fixed
- `entryFeeError`가 `client-mp.js`의 passthroughEvents에 누락돼 있어 저수준 사용자는 반드시 `mp.onServer(...)`로만 받을 수 있던 비일관성.

---

## v2.15.0 (2026-04-17)

### Added
- `hooks.customActions` — 액션바(`#keenple-controls`) 하단에 게임 고유의 커스텀 버튼 슬롯. 장기 예측/스캔 같은 "상시 토글 + N개 인스턴스 + used 상태" UX를 선언적으로 지원.
  - **스펙 필드**: `count`(number 또는 `(state) => number`), `render(ctx) → HTMLElement`(최초 1회·canvas 자유), `update(el, ctx)`(선택: state 변화 시 DOM 업데이트), `onClick(ctx)`, `isUsed(ctx) → bool`(→ `data-used` 자동 세팅 + disabled), `isDisabled(ctx) → bool`.
  - **자동 재평가 타이밍**: `board.render` 호출 지점(초기 mount, local/AI move, undo, mp `moveApplied`/`syncState`, 언어 전환)마다 shared가 `isUsed`/`isDisabled`/`update` 재호출. 추가 트리거 필요 시 `api.refreshActions(id?)` 수동 호출.
  - **런타임 추가/제거**: `api.addAction(id, spec)` / `api.removeAction(id)` — 예측 모드 진입 시 취소 버튼 등 동적 주입.
  - **예약어**: `undo`, `surrender` 은 customActions id로 사용 불가 (throw).
- `.keenple-custom-actions` · `.keenple-action-group` · `.keenple-action-item` CSS — 게임이 `data-id` 선택자로 색/크기/아이콘 override 가능.

### Changed
- `mountStandardDom` — `#keenple-controls` 내부에 `#keenple-custom-actions` 컨테이너 추가. undo/surrender 버튼 배치는 그대로.

### Breaking ⚠
- (없음 — customActions 미선언 게임은 기존 동작 그대로.)

### Fixed
- (없음)

---

## v2.14.1 (2026-04-17)

### Added
- INTEGRATION_GUIDE Section 7: "구버전 → v2.14.0 업그레이드 가이드" — 알까기(v1.1.0)/장기(v2.1.0) 등 구버전에서 올리는 체크리스트. Breaking 3건 대응 + 물리 기반 게임 참고 + 장기 이벤트 통일.

### Fixed
- (없음)

---

## v2.14.0 (2026-04-17)

### Added
- `KeenpleShell.createGameMenu(config)` — 여러 변형/모드를 가진 게임의 루트 페이지용 모드 선택 카드 UI.
  - SDK TopBar 자동 구성 + 한/영 전환 자동 대응.
  - 각 카드에 `href`(MPA 페이지 이동) 또는 `onClick`(SPA 콜백) 지정 가능.
  - `badge`(라벨 배지), `disabled`(비활성 카드), `description` 지원.
  - `destroy()` 메서드로 정리 가능.
- `turn-based.css`에 `.keenple-game-menu-*` 카드 스타일 추가 (CSS 변수 오버라이드 가능).

### Changed
- (없음)

### Breaking ⚠
- (없음 — 새 함수 추가만. 기존 `createTurnBased` 무변경.)

### Fixed
- (없음)

---

## v2.13.0 (2026-04-17)

### Added
- `wallet-client.js` 내부에서 `/api/*` 호출을 `/api/v1/*`로 자동 치환 (path가 이미 `/api/v`로 시작하면 그대로). 호출 코드 변경 불필요. `postJson`·`getJson` 둘 다 적용. (개선 #4-C)
- `server-mp.js`의 `/api/match/result` 호출도 동일한 v1 prefix 자동 치환.
- `CHANGELOG.md` 신설 (이 파일).
- README에 SemVer 핵심 3줄 + main 정식 정책 문서 링크.

### Changed
- (없음)

### Breaking ⚠
- (없음 — main이 `/api/*` 레거시 alias 유지 중이라 fail-safe)

### Fixed
- (없음)

---

## v2.12.0 (2026-04-17)

### Added
- `Keenple.Catalog` 통합 — 게임 내 아이템 가격이 main DB(`syncCatalog` 등록값)를 단일 소스로 사용.
  - `resolveItemFromCatalog(opts)` 헬퍼 — Catalog.get(itemId)로 price/currency/name 덮어쓰기. SDK 미존재/캐시 미스 시 opts 그대로 반환.
  - `hasPaidItems(modeName)` 헬퍼 — modes[mode].undoItem.price > 0 검사.
  - `startGame()` Catalog gating — 유료 모드에서 `await Keenple.Catalog.load(config.gameKey, true)`. 실패 시 에러 모달 + 게임 시작 중단 (로비 유지).
  - `purchaseItem` · `buildItemButton` · `currentUndoItem` 진입부에서 resolve 통과 → undoItem · createItemButton · 직접 buyItem 모두 일관된 가격/라벨.

### Changed
- (없음)

### Breaking ⚠
- (없음 — `Keenple.Catalog` 미존재 환경에서는 차단 없이 fallback. 기존 게임 안 깨짐.)

### Fixed
- (없음)

---

## v2.12.0 이전 주요 변경

전체 변경 내역은 `git log --oneline` 참조. 주요 breaking change만 정리:

- **v2.11.0** — `serverCall` 강제. `price > 0`인 아이템 구매에서 `serverCall` 미지정 시 즉시 차단(이전엔 mock 경고만). 테스트 중에는 `dev.allowMockPurchase: true` 명시.
- **v2.10.0** — `createTurnBased` 옵션 검증(`validateConfig`) 추가. 다음 항목 미선언 시 throw:
  - `config.gameKey` (string, 필수)
  - `config.module.{createInitialState, validateMove, applyMove, isTerminal}`
  - `config.board.mount` (function)
  - AI 모드 활성 시 `modes.ai.difficulties` (배열) + `modes.ai.onOpponentTurn` (function)
  - MP 모드 활성 시 `config.roles` 또는 `modes.mp.roles` (2개 이상)
- **v1.0.0 → v1.1.0** — 파일을 루트로 플랫화 (서브폴더 경로 깨짐). 원칙상 메이저지만 사용처 4곳뿐이라 마이너로 처리하고 소비자 동시 업데이트.
