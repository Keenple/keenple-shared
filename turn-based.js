// ============================================
// @keenple/shared — Turn-Based Game Shell (v2.0.0-alpha.13)
//
// KeenpleShell.createTurnBased(config) 호출 한 번으로:
//  - 표준 DOM 레이아웃 주입
//  - Keenple.UI.Lobby · TopBar · MatchHud 자동 구성 (ELO 포함)
//  - AI/로컬/MP 모드 버튼 + 옵션 모달
//  - Surrender · Undo · BackToLobby · Timer · DisconnectOverlay
//  - 게임 루프 (validateMove → applyMove → broadcast → isTerminal)
//  - GameOverModal + Rematch + ELO 업데이트
//  - Spectator late-join · Reconnection 자동 처리
//  - roomList broadcast → 로비 목록 동기화
//
// 게임이 제공해야 하는 것:
//  - module (createInitialState/validateMove/applyMove/isTerminal)
//  - board.mount/render/handleInput
//  - (선택) modes.ai.onOpponentTurn
//  - (선택) hooks (onBeforeGameStart, gameOverExtras, customOverlays, onModeStart)
//
// 사전 요구: Keenple SDK, socket.io, client-mp.js, back-to-lobby.js 가 이미 로드돼 있어야 함.
// ============================================

(function (root) {
  'use strict';

  function t(ko, en) {
    return (typeof Keenple !== 'undefined' && Keenple.t) ? Keenple.t(ko, en) : ko;
  }

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      if (k === 'style') Object.assign(e.style, attrs[k]);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'class') e.className = attrs[k];
      else if (k === 'dataKo') e.setAttribute('data-ko', attrs[k]);
      else if (k === 'dataEn') e.setAttribute('data-en', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ============================================
  //  Standard DOM Layout
  // ============================================
  function mountStandardDom() {
    if (!document.getElementById('lobby-mount')) {
      document.body.appendChild(el('div', { id: 'lobby-mount' }));
    }
    let gameArea = document.getElementById('keenple-game-area');
    if (!gameArea) {
      gameArea = el('div', { id: 'keenple-game-area', class: 'keenple-game-area', style: { display: 'none' } }, [
        el('button', { id: 'keenple-back-to-lobby-btn', class: 'keenple-back-to-lobby back-to-lobby-fixed' }),
        el('div', { id: 'keenple-game-notice', class: 'keenple-game-notice', style: { display: 'none' } }),
        el('div', { id: 'keenple-board-container', class: 'keenple-board-container' }),
        el('div', { id: 'keenple-controls', class: 'keenple-controls' }, [
          el('button', { id: 'keenple-undo-btn', class: 'keenple-ctrl-btn', style: { display: 'none' }, dataKo: '되돌리기', dataEn: 'Undo' }, '되돌리기'),
          el('button', { id: 'keenple-surrender-btn', class: 'keenple-surrender-btn', style: { display: 'none' }, dataKo: '항복', dataEn: 'Surrender' }, '항복'),
        ]),
        el('div', { id: 'keenple-overlays' }),
      ]);
      document.body.appendChild(gameArea);
    }
    let aiPicker = document.getElementById('keenple-ai-picker');
    if (!aiPicker) {
      aiPicker = el('div', { id: 'keenple-ai-picker', class: 'keenple-picker-container', style: { display: 'none' } });
      document.body.appendChild(aiPicker);
    }
    let roomOptions = document.getElementById('keenple-room-options');
    if (!roomOptions) {
      roomOptions = el('div', { id: 'keenple-room-options', class: 'keenple-overlay', style: { display: 'none' } });
      document.body.appendChild(roomOptions);
    }
    let disconnectOverlay = document.getElementById('keenple-disconnect-overlay');
    if (!disconnectOverlay) {
      disconnectOverlay = el('div', { id: 'keenple-disconnect-overlay', class: 'keenple-disconnect-overlay', style: { display: 'none' } }, [
        el('h2', { dataKo: '상대방 연결 끊김', dataEn: 'Opponent Disconnected' }, '상대방 연결 끊김'),
        el('p', { dataKo: '재연결 대기 중...', dataEn: 'Waiting for reconnect...' }, '재연결 대기 중...'),
      ]);
      document.body.appendChild(disconnectOverlay);
    }
    let spectatorBanner = document.getElementById('keenple-spectator-banner');
    if (!spectatorBanner) {
      spectatorBanner = el('div', { id: 'keenple-spectator-banner', class: 'keenple-spectator-banner', style: { display: 'none' }, dataKo: '관전 모드', dataEn: 'Spectator Mode' }, '관전 모드');
      document.body.appendChild(spectatorBanner);
    }
    return { gameArea, aiPicker, roomOptions, disconnectOverlay, spectatorBanner };
  }

  // ============================================
  //  AI Picker / Room Options Modals
  // ============================================
  function renderAiPicker(mount, difficulties, onPick, onBack) {
    mount.innerHTML = '';
    mount.appendChild(el('h1', { class: 'keenple-picker-title', dataKo: 'AI 난이도 선택', dataEn: 'Select AI Difficulty' }, 'AI 난이도 선택'));
    const cards = el('div', { class: 'keenple-picker-cards' });
    difficulties.forEach(d => {
      const card = el('div', { class: 'keenple-picker-card', onclick: () => onPick(d) }, [
        el('h2', { dataKo: d.label.ko, dataEn: d.label.en }, d.label.ko),
        d.description ? el('p', { dataKo: d.description.ko, dataEn: d.description.en }, d.description.ko) : null,
      ]);
      cards.appendChild(card);
    });
    mount.appendChild(cards);
    mount.appendChild(el('button', { class: 'keenple-back-link', onclick: onBack, dataKo: '← 뒤로', dataEn: '← Back' }, '← 뒤로'));
  }

  function renderRoomOptions(mount, options, currentMode, onConfirm, onCancel, entryFee) {
    mount.innerHTML = '';
    mount.appendChild(el('h2', { dataKo: '방 옵션', dataEn: 'Room Options' }, '방 옵션'));

    if (entryFee > 0) {
      const badge = el('div', { class: 'keenple-fee-banner' }, [
        el('span', { class: 'keenple-fee-icon' }, '🪙'),
        el('span', { class: 'keenple-fee-label', dataKo: '입장료', dataEn: 'Entry Fee' }, '입장료'),
        el('span', { class: 'keenple-fee-amount' }, String(entryFee) + ' coin'),
      ]);
      mount.appendChild(badge);
    }

    const values = {};
    const visible = options.filter(o => !o.applyTo || o.applyTo.indexOf(currentMode) >= 0);
    visible.forEach(opt => {
      values[opt.id] = opt.default;
      const group = el('div', { class: 'keenple-opt-group', style: { margin: '10px 0' } });
      group.appendChild(el('label', { dataKo: opt.label.ko, dataEn: opt.label.en }, opt.label.ko));
      if (opt.type === 'choice') {
        const row = el('div', { class: 'keenple-opt-row' });
        opt.values.forEach(v => {
          const val = (typeof v === 'object') ? v.v : v;
          const lbl = (typeof v === 'object' && v.label) ? v.label : { ko: String(val), en: String(val) };
          const btn = el('button', {
            class: 'keenple-opt-btn' + (val === opt.default ? ' selected' : ''),
            dataKo: lbl.ko, dataEn: lbl.en,
            onclick: () => {
              row.querySelectorAll('.keenple-opt-btn').forEach(b => b.classList.remove('selected'));
              btn.classList.add('selected');
              values[opt.id] = val;
            },
          }, lbl.ko);
          row.appendChild(btn);
        });
        group.appendChild(row);
      }
      mount.appendChild(group);
    });

    const confirmLabel = entryFee > 0
      ? { ko: '확인 (' + entryFee + ' coin 차감)', en: 'Confirm (' + entryFee + ' coin)' }
      : { ko: '확인', en: 'Confirm' };
    const buttons = el('div', { style: { display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'center' } }, [
      el('button', { class: 'keenple-lobby-btn', onclick: () => onConfirm(values), dataKo: confirmLabel.ko, dataEn: confirmLabel.en }, confirmLabel.ko),
      el('button', { class: 'keenple-lobby-back', onclick: onCancel, dataKo: '뒤로', dataEn: 'Back' }, '뒤로'),
    ]);
    mount.appendChild(buttons);
  }

  function createUndoStack(maxSize) {
    const stack = [];
    return {
      push(state) { stack.push(state); if (stack.length > maxSize) stack.shift(); },
      pop() { return stack.pop(); },
      clear() { stack.length = 0; },
      size() { return stack.length; },
    };
  }

  // ============================================
  //  Fail-safe error display
  // ============================================
  // ============================================
  //  HUD 높이 자동 측정 → CSS var --keenple-hud-offset
  // ============================================
  function measureHudOffset() {
    let maxBottom = 0;
    document.querySelectorAll('body > *').forEach(el => {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') return;
      const rect = el.getBoundingClientRect();
      // 실제로 viewport 상단(0~20px)에 붙어있는 요소만 HUD로 판단
      if (rect.top <= 20 && rect.bottom > 0 && rect.bottom < 200) {
        if (rect.bottom > maxBottom) maxBottom = rect.bottom;
      }
    });
    return Math.ceil(maxBottom);
  }
  function updateHudOffsetVar() {
    const h = measureHudOffset();
    if (h > 0) document.documentElement.style.setProperty('--keenple-hud-offset', h + 'px');
  }
  // 초기 + 리사이즈 + DOM 변화 + 언어 전환 시 재측정
  if (typeof window !== 'undefined') {
    const kickoff = () => {
      setTimeout(updateHudOffsetVar, 0);
      setTimeout(updateHudOffsetVar, 200);  // SDK TopBar/Hud 생성 후
      setTimeout(updateHudOffsetVar, 800);
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      kickoff();
    } else {
      window.addEventListener('DOMContentLoaded', kickoff);
    }
    window.addEventListener('resize', updateHudOffsetVar);
    // SDK MatchHud가 ELO 응답 등으로 800ms 이후 늦게 렌더되는 경우 대응
    if (typeof MutationObserver !== 'undefined') {
      const start = () => new MutationObserver(updateHudOffsetVar)
        .observe(document.body, { childList: true, subtree: false });
      if (document.body) start();
      else window.addEventListener('DOMContentLoaded', start);
    }
    // 한/영 전환 시 HUD 텍스트 길이 변화로 줄바꿈/높이 변동
    window.addEventListener('keenple:langchange', updateHudOffsetVar);
  }

  function showShellError(label, err) {
    console.error('[KeenpleShell] ' + label, err);
    let box = document.getElementById('keenple-shell-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'keenple-shell-error';
      box.style.cssText = 'position:fixed;top:60px;left:20px;right:20px;background:#2d1020;border:2px solid #ff4466;border-radius:8px;padding:16px;z-index:9999;color:#ffaabb;font-family:monospace;font-size:12px;white-space:pre-wrap;max-height:70vh;overflow:auto;';
      document.body.appendChild(box);
    }
    const stack = (err && err.stack) ? err.stack : String(err);
    box.textContent = '[KeenpleShell ERROR — ' + label + ']\n' + stack + '\n\n' + (box.textContent || '');
  }
  window.addEventListener('error', (e) => showShellError('window.error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => showShellError('unhandledrejection', e.reason));

  // ============================================
  //  Main — createTurnBased
  // ============================================
  function createTurnBased(config) {
    if (!config || !config.module || !config.board) {
      throw new Error('[KeenpleShell] config.module 과 config.board 는 필수입니다');
    }

    const GAME_KEY = config.gameKey;
    const GAME_NAME = config.gameName || { ko: GAME_KEY, en: GAME_KEY };
    const MOD = config.module;
    const modes = config.modes || { local: { enabled: true } };
    const options = config.options || [];
    const hooks = config.hooks || {};
    const undoMax = (modes.local && modes.local.undoMax) || 5;
    const defaultEntryFee = config.entryFee || 0;

    // ── State ─────────────────────────────────
    let state = null;
    let mode = null;             // 'ai' | 'local' | 'mp' | 'spectator'
    let gameOver = false;
    let aiDifficulty = null;
    let mp = null;
    let myRole = null;
    let currentTurn = null;
    let gameOverState = null;
    let activeOverModal = null;
    let lastEndData = null;
    let pendingEloUpdate = null;
    let matchEloInfo = null;
    let hud = null;
    let turnDeadline = 0;
    let timerInterval = null;
    let activeMatch = null;
    const undoStack = createUndoStack(undoMax);

    // ── DOM 주입 ─────────────────────────────
    const dom = mountStandardDom();
    const boardContainer = document.getElementById('keenple-board-container');
    const undoBtn = document.getElementById('keenple-undo-btn');
    const surrenderBtn = document.getElementById('keenple-surrender-btn');
    const gameNotice = document.getElementById('keenple-game-notice');
    const disconnectOverlay = dom.disconnectOverlay;
    const spectatorBanner = dom.spectatorBanner;

    // ── SDK — TopBar + Lobby ─────────────────
    let lobbyApi = null;
    if (Keenple.UI && Keenple.UI.setTheme) Keenple.UI.setTheme({});
    if (Keenple.UI && Keenple.UI.TopBar) Keenple.UI.TopBar({ gameName: GAME_NAME });

    // ── API 객체 ─────────────────────────────
    const api = {
      t: t,
      getState: () => state,
      getMode: () => mode,
      getRole: () => myRole,
      getTurn: () => currentTurn,
      emit: (event, data) => { if (mp) mp.send(event, data); },
      applyLocalMove: (move) => tryApplyLocalMove(move),
      showToast: (msg, opts) => Keenple.UI && Keenple.UI.toast && Keenple.UI.toast(msg, opts),
      showConfirm: (msg) => window.confirm(typeof msg === 'string' ? msg : (msg.ko || msg.en)),
      showOverlay: (id) => {
        const o = document.getElementById('keenple-overlay-' + id);
        if (!o) return;
        // render-on-show: customOverlays 훅의 render를 매번 호출
        if (hooks.customOverlays && hooks.customOverlays[id] && hooks.customOverlays[id].render) {
          o.innerHTML = '';
          const content = hooks.customOverlays[id].render(state, api);
          if (content) o.appendChild(content);
        }
        o.style.display = '';
      },
      hideOverlay: (id) => {
        const o = document.getElementById('keenple-overlay-' + id);
        if (o) o.style.display = 'none';
      },
      setGameNotice: (msg) => {
        if (!msg) { gameNotice.style.display = 'none'; return; }
        gameNotice.textContent = typeof msg === 'string' ? msg : (msg[Keenple.getLang && Keenple.getLang()] || msg.ko || msg.en);
        gameNotice.style.display = '';
      },
    };

    // ── Custom overlays 슬롯 생성 ─────────────
    if (hooks.customOverlays) {
      const overlayRoot = document.getElementById('keenple-overlays');
      Object.keys(hooks.customOverlays).forEach(id => {
        overlayRoot.appendChild(el('div', { id: 'keenple-overlay-' + id, class: 'keenple-overlay', style: { display: 'none' } }));
      });
    }

    // ── Timer ──────────────────────────────────
    function startTimerDisplay(seconds) {
      turnDeadline = Date.now() + (seconds || 60) * 1000;
      stopTimerDisplay();
      updateTimerDisplay();
      timerInterval = setInterval(updateTimerDisplay, 250);
    }
    function stopTimerDisplay() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }
    function updateTimerDisplay() {
      const remaining = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      if (hud && hud.setTimer) hud.setTimer(remaining);
      if (remaining <= 0) stopTimerDisplay();
    }

    // ── HUD 초기화/업데이트 ─────────────────
    function ensureHud(data) {
      if (hud) return;
      const players = (data && data.players) || [];
      const rolesDef = (modes.mp && modes.mp.roles) || ['white', 'black'];
      const hudPlayers = rolesDef.map(role => {
        const p = players.find(pp => pp.role === role) || {};
        const isMe = mode === 'mp' && myRole === role;
        let elo = null;
        if (matchEloInfo) {
          if (isMe) elo = matchEloInfo.myElo;
          else if (matchEloInfo.opponent) elo = matchEloInfo.opponent.elo;
        }
        return {
          role,
          nickname: p.nickname || role,
          color: (config.hudColors && config.hudColors[role]) || '#e0e0e0',
          isMe, elo,
        };
      });
      if (Keenple.UI && Keenple.UI.MatchHud) {
        hud = Keenple.UI.MatchHud({
          players: hudPlayers,
          currentTurn: currentTurn || rolesDef[0],
        });
      }
    }
    function updateHudTurn() {
      if (hud && hud.setTurn && currentTurn) hud.setTurn(currentTurn);
    }
    function destroyHud() {
      if (hud && hud.destroy) hud.destroy();
      hud = null;
    }

    // ── 게임 시작 / 전환 ─────────────────────
    async function startGame(startMode, extras) {
      mode = startMode;
      extras = extras || {};
      gameOver = false;
      gameOverState = null;
      undoStack.clear();

      if (extras.gameState) {
        state = (typeof extras.gameState === 'string' && MOD.deserialize) ? MOD.deserialize(extras.gameState) : extras.gameState;
      } else {
        state = MOD.createInitialState(extras);
      }

      // onBeforeGameStart 훅
      if (hooks.onBeforeGameStart && !extras.fromServer) {
        try {
          const extra = await hooks.onBeforeGameStart({ mode, role: myRole, ...extras }, api);
          if (extra) state = MOD.createInitialState(Object.assign({}, extras, extra));
        } catch (e) { console.error('[shell] onBeforeGameStart 실패', e); return; }
      }

      // onModeStart 훅 (게임에 모드+extras 알림)
      if (hooks.onModeStart) {
        try { hooks.onModeStart(mode, extras, api); } catch (e) { console.error('[shell] onModeStart', e); }
      }

      // UI 전환
      if (lobbyApi) lobbyApi.hide();
      document.getElementById('keenple-ai-picker').style.display = 'none';
      document.getElementById('keenple-room-options').style.display = 'none';
      dom.gameArea.style.display = '';

      // 버튼 표시 제어
      surrenderBtn.style.display = (mode === 'mp') ? '' : 'none';
      undoBtn.style.display = (mode === 'ai' || mode === 'local') ? '' : 'none';
      undoBtn.disabled = true;

      // 관전자 배너
      spectatorBanner.style.display = (mode === 'spectator') ? '' : 'none';

      // 보드 mount
      boardContainer.innerHTML = '';
      if (config.board.mount) config.board.mount(boardContainer, api);
      if (config.board.render) config.board.render(state, api);

      currentTurn = state.currentTurn || (state.turn != null ? state.turn : null);

      // HUD 생성/업데이트
      ensureHud(extras);
      updateHudTurn();

      // AI 모드 선공 체크
      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        const aiSide = extras.aiSide || state.aiSide || 'black';
        if (currentTurn === aiSide) setTimeout(triggerAiMove, 200);
      }
    }

    // ── Local/AI에서 move 적용 ────────────────
    function tryApplyLocalMove(move) {
      if (gameOver) return false;
      const check = MOD.validateMove(state, move);
      if (!check.valid) {
        api.showToast(t('잘못된 수', 'Invalid move'), { type: 'error' });
        return false;
      }
      undoStack.push(MOD.serialize ? MOD.serialize(state) : JSON.parse(JSON.stringify(state)));
      undoBtn.disabled = false;
      state = MOD.applyMove(state, move);
      currentTurn = state.currentTurn || state.turn;
      if (config.board.render) config.board.render(state, api);
      updateHudTurn();

      const term = MOD.isTerminal(state);
      if (term.terminal) { handleGameOver(term); return true; }

      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        const aiSide = state.aiSide || 'black';
        if (currentTurn === aiSide) setTimeout(triggerAiMove, 300);
      }
      return true;
    }

    async function triggerAiMove() {
      if (gameOver) return;
      try {
        const move = await modes.ai.onOpponentTurn(state, api);
        if (move) tryApplyLocalMove(move);
      } catch (e) { console.error('[shell] AI turn 실패', e); }
    }

    // ── Undo ──────────────────────────────────
    undoBtn.addEventListener('click', () => {
      if (!undoStack.size() || gameOver) return;
      const prev = undoStack.pop();
      state = (typeof prev === 'string' && MOD.deserialize) ? MOD.deserialize(prev) : prev;
      currentTurn = state.currentTurn || state.turn;
      if (config.board.render) config.board.render(state, api);
      updateHudTurn();
      if (!undoStack.size()) undoBtn.disabled = true;
    });

    // ── Surrender ─────────────────────────────
    surrenderBtn.addEventListener('click', () => {
      if (mode !== 'mp' || gameOver || !mp) return;
      if (!confirm(t('정말 항복하시겠습니까?', 'Are you sure you want to surrender?'))) return;
      mp.surrender();
    });

    // ── Game Over ─────────────────────────────
    function computeGameOverCfg(result) {
      const isMe = (mode === 'mp' && myRole) ? (result.winner === myRole) : null;
      const extra = result || {};
      const rolesDef = (modes.mp && modes.mp.roles) || ['white', 'black'];
      let title = { ko: '게임 종료', en: 'Game Over' };
      let resultStr = 'info';

      if (mode === 'mp') {
        if (extra.reason === 'disconnect') {
          resultStr = isMe ? 'win' : 'lose';
          title = isMe ? { ko: '상대 연결 끊김 — 승리!', en: 'Opponent disconnected — Victory!' } : { ko: '연결 끊김 — 패배', en: 'Disconnected — Defeat' };
        } else if (extra.reason === 'surrender') {
          if (extra.surrenderedBy === myRole) { resultStr = 'lose'; title = { ko: '항복', en: 'Surrendered' }; }
          else { resultStr = 'win'; title = { ko: '상대 항복 — 승리!', en: 'Opponent surrendered — Victory!' }; }
        } else if (extra.reason === 'timeout') {
          if (extra.timedOutRole === myRole) { resultStr = 'lose'; title = { ko: '시간 초과 — 패배', en: 'Time out — Defeat' }; }
          else { resultStr = 'win'; title = { ko: '상대 시간 초과 — 승리!', en: 'Opponent timed out — Victory!' }; }
        } else {
          resultStr = isMe ? 'win' : (extra.winner ? 'lose' : 'draw');
          if (extra.winner) title = resultStr === 'win' ? { ko: '승리!', en: 'Victory!' } : { ko: '패배', en: 'Defeat' };
          else title = { ko: '무승부', en: 'Draw' };
        }
      } else {
        if (extra.winner) {
          const winnerLabel = rolesDef.indexOf(extra.winner) === 0 ? { ko: '선공', en: 'First' } : { ko: '후공', en: 'Second' };
          title = { ko: winnerLabel.ko + ' 승리', en: winnerLabel.en + ' wins' };
        } else {
          title = { ko: '무승부', en: 'Draw' };
        }
      }

      const cfg = {
        title, result: resultStr,
        leave: { label: { ko: '나가기', en: 'Leave' }, onClick: () => backToLobby() },
      };
      const canRematch = mode === 'mp' && extra.reason !== 'disconnect';
      if (canRematch && mp) cfg.rematch = { enabled: true, mp: mp, event: 'rematch' };
      if (pendingEloUpdate) cfg.elo = pendingEloUpdate;
      if (hooks.gameOverExtras) {
        const extras = hooks.gameOverExtras(result, api);
        if (extras) cfg.extraContent = extras;
      }
      return cfg;
    }

    function handleGameOver(result) {
      gameOver = true;
      gameOverState = result;
      lastEndData = result;
      surrenderBtn.style.display = 'none';
      undoBtn.style.display = 'none';
      stopTimerDisplay();
      if (hud && hud.setTimer) hud.setTimer(null);
      if (activeOverModal && activeOverModal.close) { activeOverModal.close(); activeOverModal = null; }
      const cfg = computeGameOverCfg(result);
      if (Keenple.UI && Keenple.UI.GameOverModal) {
        activeOverModal = Keenple.UI.GameOverModal(cfg);
      }
      pendingEloUpdate = null;
    }

    // ── Back to Lobby ─────────────────────────
    function backToLobby() {
      try { if (mode === 'mp' && mp && !gameOver) mp.surrender(); } catch (e) {}
      if (activeOverModal && activeOverModal.close) { activeOverModal.close(); activeOverModal = null; }
      if (mp) { mp.clearSession && mp.clearSession(); mp.disconnect && mp.disconnect(); mp = null; }
      if (activeMatch && activeMatch.cancel) { activeMatch.cancel(); activeMatch = null; }
      destroyHud();
      stopTimerDisplay();
      mode = null; myRole = null; gameOver = false; state = null;
      matchEloInfo = null; pendingEloUpdate = null;
      undoStack.clear();
      dom.gameArea.style.display = 'none';
      spectatorBanner.style.display = 'none';
      disconnectOverlay.style.display = 'none';
      gameNotice.style.display = 'none';
      document.getElementById('keenple-ai-picker').style.display = 'none';
      document.getElementById('keenple-room-options').style.display = 'none';
      if (lobbyApi) { lobbyApi.show(); lobbyApi.setStatus && lobbyApi.setStatus(''); lobbyApi.showCancel && lobbyApi.showCancel(false); }
    }

    // ── 입장료 예고 애니메이션 (방 입장 시) ─────
    function showFeePendingAnimation(fee) {
      var node = document.createElement('div');
      node.className = 'keenple-fee-deduct keenple-fee-pending';
      node.innerHTML =
        '<div class="keenple-fee-deduct-card keenple-fee-pending-card">' +
          '<div class="keenple-fee-deduct-icon">🪙</div>' +
          '<div class="keenple-fee-deduct-text">' +
            '<div class="keenple-fee-deduct-label">' + t('게임 시작 시 차감', 'Charged on Start') + '</div>' +
            '<div class="keenple-fee-deduct-amount">' + fee + ' coin</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(node);
      requestAnimationFrame(() => node.classList.add('keenple-fee-deduct-in'));
      setTimeout(() => {
        node.classList.remove('keenple-fee-deduct-in');
        node.classList.add('keenple-fee-deduct-out');
        setTimeout(() => node.remove(), 450);
      }, 2000);
    }

    // ── 입장료 차감 애니메이션 ─────────────────
    function showFeeDeductionAnimation(fee) {
      var node = document.createElement('div');
      node.className = 'keenple-fee-deduct';
      node.innerHTML =
        '<div class="keenple-fee-deduct-card">' +
          '<div class="keenple-fee-deduct-icon">🪙</div>' +
          '<div class="keenple-fee-deduct-text">' +
            '<div class="keenple-fee-deduct-label" data-ko="입장료 차감" data-en="Entry Fee Charged">' + t('입장료 차감', 'Entry Fee Charged') + '</div>' +
            '<div class="keenple-fee-deduct-amount">−' + fee + ' coin</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(node);
      requestAnimationFrame(() => node.classList.add('keenple-fee-deduct-in'));
      setTimeout(() => {
        node.classList.remove('keenple-fee-deduct-in');
        node.classList.add('keenple-fee-deduct-out');
        setTimeout(() => node.remove(), 450);
      }, 2200);
    }

    if (typeof BackToLobby !== 'undefined') {
      BackToLobby.attach(document.getElementById('keenple-back-to-lobby-btn'), {
        isInProgress: () => !!mode && !gameOver,
        onReset: backToLobby,
      });
    }

    // ── MP 연결 및 이벤트 처리 ─────────────────
    function ensureMp() {
      if (mp) return mp;
      mp = new GameClient({ gamePath: GAME_KEY });
      mp.connect();

      mp.on('connectionError', (data) => {
        lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '서버 연결 실패', en: 'Server connection failed' });
      });

      mp.on('roomCreated', (data) => {
        myRole = data.role;
        var feeText = '';
        if (data.entryFee > 0) feeText = ' (' + t('입장료: ' + data.entryFee + ' coin', 'Entry Fee: ' + data.entryFee + ' coin') + ')';
        lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({
          ko: '방 코드: ' + data.roomCode + ' — 상대를 기다리는 중...' + (data.entryFee > 0 ? ' (입장료: ' + data.entryFee + ' coin)' : ''),
          en: 'Room Code: ' + data.roomCode + ' — Waiting for opponent...' + (data.entryFee > 0 ? ' (Entry Fee: ' + data.entryFee + ' coin)' : ''),
        });
        lobbyApi && lobbyApi.showCancel && lobbyApi.showCancel(true);
      });

      mp.on('roomJoined', (data) => {
        myRole = data.role;
        // 관전자 late-join
        if (data.role === 'spectator' && data.gameStarted) {
          myRole = null;
          mode = 'spectator';
          const gs = data.gameState || {};
          startGame('spectator', { fromServer: true, gameState: gs, players: data.players });
          return;
        }
        // 재연결
        if (data.reconnected && data.gameStarted) {
          lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '재연결됨!', en: 'Reconnected!' });
          const gs = data.gameState || {};
          startGame('mp', { fromServer: true, gameState: gs, players: data.players, reconnected: true });
          if (gs.turnDeadline) {
            const remainMs = gs.turnDeadline - Date.now();
            if (remainMs > 0) startTimerDisplay(remainMs / 1000);
          }
          return;
        }
        var jFee = (data && data.entryFee) || (data && data.options && data.options.entryFee) || 0;
        if (jFee > 0) {
          showFeePendingAnimation(jFee);
          lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({
            ko: '입장 완료 — 게임 시작 시 ' + jFee + ' coin 차감',
            en: 'Joined — ' + jFee + ' coin will be charged on game start',
          });
        } else {
          lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '입장 완료! 대기 중...', en: 'Joined! Waiting...' });
        }
      });

      mp.on('playerJoined', () => {
        lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '상대 입장! 곧 시작합니다...', en: 'Opponent joined! Starting soon...' });
      });

      mp.on('readyToStart', () => {
        if (mp.role === (modes.mp && modes.mp.roles && modes.mp.roles[0])) mp.startGame();
      });

      mp.on('gameStart', (data) => {
        myRole = data.yourRole || myRole;
        if (mp) mp.role = data.yourRole;
        lobbyApi && lobbyApi.showCancel && lobbyApi.showCancel(false);
        startGame('mp', { fromServer: true, gameState: data.gameState, players: data.players });
        // 입장료 차감 시각적 피드백 + SDK 잔액 갱신 트리거
        var fee = (data && data.entryFee) || (data && data.options && data.options.entryFee) || 0;
        if (fee > 0) {
          showFeeDeductionAnimation(fee);
          try { window.dispatchEvent(new CustomEvent('keenple:wallet-changed', { detail: { reason: 'entry_fee', amount: -fee } })); } catch (e) {}
          if (Keenple.Wallet && Keenple.Wallet.refresh) { try { Keenple.Wallet.refresh(); } catch (e) {} }
        }
        // MP 기본 타이머 (옵션에 turnTimer 있으면 그 값, 없으면 skip — 서버의 turnTimer 이벤트 기다림)
      });

      mp.on('gameOver', (data) => handleGameOver(data));

      mp.onServer('entryFeeError', (data) => {
        lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({
          ko: '코인 부족',
          en: 'Not enough coins',
        });
      });

      mp.on('playerDisconnected', (data) => {
        disconnectOverlay.style.display = '';
        api.setGameNotice({ ko: '상대 연결 끊김... 재연결 대기 중', en: 'Opponent disconnected... waiting' });
      });
      mp.on('playerReconnected', () => {
        disconnectOverlay.style.display = 'none';
        api.setGameNotice(null);
      });

      mp.on('reconnectFailed', () => {
        api.setGameNotice({ ko: '서버 연결이 끊어졌습니다. 새로고침해주세요.', en: 'Connection lost. Please refresh.' });
      });

      mp.on('error', (data) => {
        lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '오류: ' + data.message, en: 'Error: ' + data.message });
      });

      // ── 서버 emit 커스텀 이벤트 ─────────────
      mp.onServer('moveApplied', (data) => {
        if (data.state) {
          state = (typeof data.state === 'string' && MOD.deserialize) ? MOD.deserialize(data.state) : data.state;
          currentTurn = state.currentTurn || state.turn;
          if (config.board.render) config.board.render(state, api);
          updateHudTurn();
        }
      });

      mp.onServer('syncState', (data) => {
        if (data.state) {
          state = (typeof data.state === 'string' && MOD.deserialize) ? MOD.deserialize(data.state) : data.state;
          currentTurn = state.currentTurn || state.turn;
          if (config.board.render) config.board.render(state, api);
          updateHudTurn();
        }
      });

      mp.onServer('turnTimer', (data) => {
        if (data.deadline) {
          const seconds = Math.max(0, (data.deadline - Date.now()) / 1000);
          startTimerDisplay(seconds);
        } else if (data.seconds) {
          startTimerDisplay(data.seconds);
        }
      });

      mp.onServer('eloUpdate', (data) => {
        pendingEloUpdate = { before: data.before, after: data.after, change: data.change };
        // 게임오버 모달이 이미 열려 있으면 재렌더
        if (activeOverModal && lastEndData) {
          const cfg = computeGameOverCfg(lastEndData);
          if (activeOverModal.close) activeOverModal.close();
          activeOverModal = Keenple.UI.GameOverModal(cfg);
          pendingEloUpdate = null;
        }
      });

      mp.onServer('roomList', (rooms) => {
        if (lobbyApi && lobbyApi.pushRooms) lobbyApi.pushRooms(rooms);
      });

      // 게임이 자체적으로 받고 싶은 MP 이벤트 추가 구독 (config.mp.customListeners)
      if (config.mp && config.mp.customListeners) {
        Object.keys(config.mp.customListeners).forEach(ev => {
          mp.onServer(ev, (data) => config.mp.customListeners[ev](data, api));
        });
      }

      return mp;
    }

    // ── Lobby 구성 ────────────────────────────
    function buildLobbyButtons() {
      const buttons = [];
      if (modes.mp && modes.mp.enabled !== false) {
        const createLabel = defaultEntryFee > 0
          ? { ko: '방 만들기 · ' + defaultEntryFee + ' coin', en: 'Create Room · ' + defaultEntryFee + ' coin' }
          : { ko: '방 만들기', en: 'Create Room' };
        buttons.push({ id: 'create', label: createLabel, primary: true, onClick: () => openRoomOptions('create') });
        if (modes.mp.rankMatch) {
          const rankLabel = defaultEntryFee > 0
            ? { ko: '랭크 매칭 · ' + defaultEntryFee + ' coin', en: 'Ranked Match · ' + defaultEntryFee + ' coin' }
            : { ko: '랭크 매칭', en: 'Ranked Match' };
          buttons.push({ id: 'rank', label: rankLabel, onClick: () => handleRankMatch() });
        }
      }
      if (modes.ai && modes.ai.enabled !== false && (modes.ai.difficulties || []).length) {
        buttons.push({ id: 'ai', label: { ko: 'AI 대전', en: 'vs AI' }, onClick: () => openAiPicker() });
      }
      if (modes.local && modes.local.enabled !== false) {
        buttons.push({ id: 'local', label: { ko: '로컬 2인', en: 'Local 2P' }, onClick: () => startGame('local') });
      }
      return buttons;
    }

    function openAiPicker() {
      if (lobbyApi) lobbyApi.hide();
      const picker = document.getElementById('keenple-ai-picker');
      picker.style.display = '';
      renderAiPicker(picker, modes.ai.difficulties, (d) => {
        picker.style.display = 'none';
        aiDifficulty = d.id;
        startGame('ai', { difficulty: d.id, difficultyConfig: d.config });
      }, () => {
        picker.style.display = 'none';
        if (lobbyApi) lobbyApi.show();
      });
    }

    function openRoomOptions(type) {
      if (lobbyApi) lobbyApi.hide();
      const mount = document.getElementById('keenple-room-options');
      mount.style.display = '';
      renderRoomOptions(mount, options, 'mp', (values) => {
        mount.style.display = 'none';
        if (defaultEntryFee > 0 && values.entryFee == null) values.entryFee = defaultEntryFee;
        // (onConfirm body follows)
        if (lobbyApi) {
          lobbyApi.show();
          lobbyApi.setStatus && lobbyApi.setStatus({ ko: '방 만드는 중...', en: 'Creating room...' });
        }
        ensureMp();
        const tryCreate = (attempts = 0) => {
          if (mp.connected) mp.createRoom(values, getNickname(), getKeenpleUserId());
          else if (attempts > 50) lobbyApi && lobbyApi.setStatus && lobbyApi.setStatus({ ko: '서버 연결 실패', en: 'Server connection failed' });
          else setTimeout(() => tryCreate(attempts + 1), 100);
        };
        tryCreate();
      }, () => {
        mount.style.display = 'none';
        if (lobbyApi) lobbyApi.show();
      }, defaultEntryFee);
    }

    function handleRankMatch() {
      if (!modes.mp || !modes.mp.rankMatch) return;
      if (!getKeenpleUserId()) {
        api.showToast({ ko: '랭크 매칭은 로그인 후 이용 가능합니다', en: 'Login required for ranked match' }, { type: 'error' });
        Keenple.login && Keenple.login(window.location.href);
        return;
      }
      ensureMp();
      if (Keenple.Match && Keenple.Match.findGame) {
        activeMatch = Keenple.Match.findGame({
          gameKey: GAME_KEY,
          onMatched: (data) => {
            activeMatch = null;
            matchEloInfo = { myElo: data.myElo, opponent: data.opponent };
            const tryMatched = (attempts = 0) => {
              if (mp && mp.connected) {
                if (data.isHost) mp.createRoom({ preferredCode: data.roomCode, matched: true }, getNickname(), getKeenpleUserId());
                else setTimeout(() => mp.joinRoom(data.roomCode, getNickname(), getKeenpleUserId()), 800);
              } else if (attempts > 50) {
                api.showToast({ ko: '서버 연결 실패', en: 'Server connection failed' }, { type: 'error' });
              } else { setTimeout(() => tryMatched(attempts + 1), 100); }
            };
            tryMatched();
          },
          onCancel: () => { activeMatch = null; },
          onError: (e) => {
            activeMatch = null;
            if (e.status === 401) Keenple.login && Keenple.login(window.location.href);
            else api.showToast({ ko: '매칭 시작 실패', en: 'Failed to start matching' }, { type: 'error' });
          },
        });
      }
    }

    let _nickname = null, _userId = null;
    function getNickname() { return _nickname; }
    function getKeenpleUserId() { return _userId; }

    // ── 부트스트랩 ────────────────────────────
    async function bootstrap() {
      try {
        if (typeof Keenple === 'undefined') throw new Error('Keenple SDK 미로드');
        if (!Keenple.UI || !Keenple.UI.Lobby) throw new Error('Keenple.UI.Lobby 없음');
        if (typeof GameClient === 'undefined') console.warn('[shell] GameClient 미정의 — MP 비활성');
        const user = await Keenple.getUser();
        if (user) { _nickname = user.nickname; _userId = user.id; }
      } catch (e) { showShellError('bootstrap-prechecks', e); }

      try {
      lobbyApi = Keenple.UI.Lobby({
        mount: '#lobby-mount',
        title: GAME_NAME,
        buttons: buildLobbyButtons(),
        joinInput: modes.mp && modes.mp.enabled !== false
          ? { enabled: true, onJoin: (code) => { ensureMp(); const tryJ = (a=0)=>{ if(mp.connected) mp.joinRoom(code, getNickname(), getKeenpleUserId()); else if(a>50) return; else setTimeout(()=>tryJ(a+1),100); }; tryJ(); } }
          : undefined,
        roomList: modes.mp && modes.mp.enabled !== false
          ? {
              enabled: true,
              fetchRooms: () => fetch('api/rooms').then(r => r.json()).catch(() => []),
              pollInterval: 10000,
              onRoomClick: (r) => { ensureMp(); const tryJ = (a=0)=>{ if(mp.connected) mp.joinRoom(r.code, getNickname(), getKeenpleUserId()); else if(a>50) return; else setTimeout(()=>tryJ(a+1),100); }; tryJ(); }
            }
          : undefined,
        onCancel: () => {
          if (mp) { mp.clearSession && mp.clearSession(); mp.disconnect && mp.disconnect(); mp = null; }
          if (activeMatch && activeMatch.cancel) { activeMatch.cancel(); activeMatch = null; }
        },
      });

      } catch (e) { showShellError('Keenple.UI.Lobby 호출 실패', e); return; }

      // 재연결 가능 여부 체크 (localStorage)
      try {
        const savedPid = localStorage.getItem('mp_playerId');
        const savedRoom = localStorage.getItem('mp_roomCode');
        if (savedPid && savedRoom) {
          lobbyApi.setStatus && lobbyApi.setStatus({ ko: '재연결 중...', en: 'Reconnecting...' });
          ensureMp();
        }
      } catch (e) { showShellError('reconnect-check', e); }
    }

    window.addEventListener('keenple:langchange', () => {
      try { if (state && config.board.render) config.board.render(state, api); }
      catch (e) { showShellError('langchange-render', e); }
    });

    // ── 탭 닫기·새로고침·뒤로가기 시 자동 항복 (MP만) ──
    function tryAutoSurrender() {
      if (mode !== 'mp' || gameOver || !mp || !mp.surrender) return;
      try { mp.surrender(); } catch (e) {}
    }
    window.addEventListener('beforeunload', tryAutoSurrender);
    window.addEventListener('pagehide', tryAutoSurrender);  // 모바일 safari 등

    bootstrap().catch(e => showShellError('bootstrap', e));

    return {
      getState: () => state,
      getMode: () => mode,
      backToLobby,
      _api: api,
    };
  }

  const KeenpleShell = { createTurnBased };
  if (typeof module === 'object' && module.exports) module.exports = KeenpleShell;
  else root.KeenpleShell = KeenpleShell;

})(typeof self !== 'undefined' ? self : this);
