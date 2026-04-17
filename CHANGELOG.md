# CHANGELOG

`@keenple/shared` 버전별 변경 내역. SemVer 정책은 [keenple-main `docs/API-VERSIONING.md`](https://github.com/Keenple/keenple-main/blob/main/docs/API-VERSIONING.md) 참조.

포맷: `Added` / `Changed` / `Breaking ⚠` / `Fixed`. v2.12.0부터 정식 작성. 그 이전 변경은 `git log` + 본 파일 하단의 "v2.12.0 이전 주요 변경" 섹션 참조.

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
