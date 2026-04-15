// ============================================
// @keenple/shared — Turn-Based Game Shell (v2.0)
//
// KeenpleShell.createTurnBased(config) 호출 한 번으로:
//  - 표준 DOM 레이아웃 주입
//  - Keenple.UI.Lobby · TopBar · MatchHud 자동 구성
//  - AI/로컬/MP 모드 버튼 + 옵션 모달
//  - Surrender · Undo · BackToLobby · Timer · SpectatorBanner · DisconnectOverlay
//  - 게임 루프 (validateMove → applyMove → broadcast → isTerminal)
//  - GameOverModal + Rematch
//
// 게임이 제공해야 하는 것:
//  - module (createInitialState/validateMove/applyMove/isTerminal)
//  - board.mount/render/handleInput
//  - (선택) modes.ai.onOpponentTurn
//  - (선택) hooks (onBeforeGameStart, gameOverExtras, customOverlays)
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
        el('div', { id: 'keenple-board-container', class: 'keenple-board-container' }),
        el('div', { id: 'keenple-controls', class: 'keenple-controls' }, [
          el('button', { id: 'keenple-undo-btn', class: 'keenple-ctrl-btn', style: { display: 'none' }, dataKo: '되돌리기', dataEn: 'Undo' }, '되돌리기'),
          el('button', { id: 'keenple-surrender-btn', class: 'keenple-surrender-btn', style: { display: 'none' }, dataKo: '항복', dataEn: 'Surrender' }, '항복'),
        ]),
        el('div', { id: 'keenple-overlays' }),  // customOverlays 슬롯
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
    return { gameArea, aiPicker, roomOptions };
  }

  // ============================================
  //  AI Picker Modal
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

  // ============================================
  //  Room Options Modal (방 만들기 옵션)
  // ============================================
  function renderRoomOptions(mount, options, currentMode, onConfirm, onCancel) {
    mount.innerHTML = '';
    mount.appendChild(el('h2', { dataKo: '방 옵션', dataEn: 'Room Options' }, '방 옵션'));

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

    const buttons = el('div', { style: { display: 'flex', gap: '12px', marginTop: '12px' } }, [
      el('button', { class: 'keenple-lobby-btn', onclick: () => onConfirm(values), dataKo: '확인', dataEn: 'Confirm' }, '확인'),
      el('button', { class: 'keenple-lobby-back', onclick: onCancel, dataKo: '뒤로', dataEn: 'Back' }, '뒤로'),
    ]);
    mount.appendChild(buttons);
  }

  // ============================================
  //  Undo Stack (shell-managed)
  // ============================================
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

    // ── State ─────────────────────────────────
    let state = null;
    let mode = null;             // 'ai' | 'local' | 'mp' | 'spectator'
    let gameOver = false;
    let aiDifficulty = null;
    let mp = null;               // GameClient (MP에서만)
    let myRole = null;
    let currentTurn = null;
    let gameOverState = null;    // { winner, reason }
    const undoStack = createUndoStack(undoMax);

    // ── DOM 주입 ─────────────────────────────
    const dom = mountStandardDom();
    const boardContainer = document.getElementById('keenple-board-container');
    const undoBtn = document.getElementById('keenple-undo-btn');
    const surrenderBtn = document.getElementById('keenple-surrender-btn');

    // ── SDK — TopBar + Lobby ─────────────────
    let lobbyApi = null;
    if (Keenple.UI && Keenple.UI.setTheme) Keenple.UI.setTheme({});
    if (Keenple.UI && Keenple.UI.TopBar) Keenple.UI.TopBar({ gameName: GAME_NAME });

    // ── API 객체 (board 콜백으로 전달) ────────
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
        if (o) o.style.display = '';
      },
      hideOverlay: (id) => {
        const o = document.getElementById('keenple-overlay-' + id);
        if (o) o.style.display = 'none';
      },
    };

    // ── Custom overlays 슬롯 생성 ─────────────
    if (hooks.customOverlays) {
      const overlayRoot = document.getElementById('keenple-overlays');
      Object.keys(hooks.customOverlays).forEach(id => {
        const o = el('div', { id: 'keenple-overlay-' + id, class: 'keenple-overlay', style: { display: 'none' } });
        const spec = hooks.customOverlays[id];
        if (spec.render) o.appendChild(spec.render(state, api));
        overlayRoot.appendChild(o);
      });
    }

    // ── 게임 시작 / 전환 ─────────────────────
    async function startGame(startMode, extras) {
      mode = startMode;
      extras = extras || {};
      gameOver = false;
      gameOverState = null;
      undoStack.clear();

      // 초기 state
      state = MOD.createInitialState(extras);

      // onBeforeGameStart 훅 — 추가 설정 수집 (예: 장기 상차림)
      if (hooks.onBeforeGameStart) {
        try {
          const extra = await hooks.onBeforeGameStart({ mode, role: myRole, ...extras }, api);
          if (extra) state = MOD.createInitialState(Object.assign({}, extras, extra));
        } catch (e) { console.error('[shell] onBeforeGameStart 실패', e); return; }
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

      // 보드 mount
      boardContainer.innerHTML = '';
      if (config.board.mount) config.board.mount(boardContainer, api);
      if (config.board.render) config.board.render(state, api);

      currentTurn = state.currentTurn || (state.turn != null ? state.turn : null);

      // AI 모드인데 AI 먼저 둘 차례면 즉시 호출
      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        const aiSide = extras.aiSide || 'black';
        if (currentTurn === aiSide) triggerAiMove();
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

      const term = MOD.isTerminal(state);
      if (term.terminal) { handleGameOver(term); return true; }

      // AI 차례면 trigger
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
      state = MOD.deserialize ? MOD.deserialize(prev) : prev;
      currentTurn = state.currentTurn || state.turn;
      if (config.board.render) config.board.render(state, api);
      if (!undoStack.size()) undoBtn.disabled = true;
    });

    // ── Surrender ─────────────────────────────
    surrenderBtn.addEventListener('click', () => {
      if (mode !== 'mp' || gameOver || !mp) return;
      if (!confirm(t('정말 항복하시겠습니까?', 'Are you sure you want to surrender?'))) return;
      mp.surrender();
    });

    // ── Game Over ─────────────────────────────
    function handleGameOver(result) {
      gameOver = true;
      gameOverState = result;
      const isMe = (mode === 'mp' && myRole) ? (result.winner === myRole) : null;
      const cfg = {
        title: result.winner
          ? t(result.winner + ' 승리', (result.winner.charAt(0).toUpperCase() + result.winner.slice(1)) + ' wins')
          : t('무승부', 'Draw'),
        message: result.reason ? t(result.reason, result.reason) : '',
        result: (mode !== 'mp') ? 'info' : (isMe === true ? 'win' : isMe === false ? 'lose' : 'info'),
        leave: { label: { ko: '나가기', en: 'Leave' }, onClick: () => backToLobby() },
      };
      if (mode === 'mp' && mp) cfg.rematch = { enabled: true, mp: mp, event: 'rematch' };
      if (hooks.gameOverExtras) {
        const extras = hooks.gameOverExtras(result, api);
        if (extras) cfg.extraContent = extras;
      }
      if (Keenple.UI && Keenple.UI.GameOverModal) Keenple.UI.GameOverModal(cfg);
    }

    // ── Back to Lobby ─────────────────────────
    function backToLobby() {
      try { if (mode === 'mp' && mp && !gameOver) mp.surrender(); } catch (e) {}
      if (mp) { mp.clearSession && mp.clearSession(); mp.disconnect && mp.disconnect(); mp = null; }
      mode = null; myRole = null; gameOver = false; state = null;
      undoStack.clear();
      dom.gameArea.style.display = 'none';
      document.getElementById('keenple-ai-picker').style.display = 'none';
      document.getElementById('keenple-room-options').style.display = 'none';
      if (lobbyApi) { lobbyApi.show(); lobbyApi.setStatus && lobbyApi.setStatus(''); lobbyApi.showCancel && lobbyApi.showCancel(false); }
    }

    // BackToLobby 버튼 (공용 헬퍼)
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
      mp.on('roomCreated', (data) => { myRole = data.role; });
      mp.on('roomJoined', (data) => {
        myRole = data.role;
        if (data.gameStarted && data.gameState) {
          // 관전자 또는 재접속
          state = MOD.deserialize ? MOD.deserialize(data.gameState) : data.gameState;
          mode = data.isSpectator ? 'spectator' : 'mp';
          currentTurn = state.currentTurn || state.turn;
          if (lobbyApi) lobbyApi.hide();
          dom.gameArea.style.display = '';
          if (config.board.mount) { boardContainer.innerHTML = ''; config.board.mount(boardContainer, api); }
          if (config.board.render) config.board.render(state, api);
          surrenderBtn.style.display = (mode === 'mp') ? '' : 'none';
        }
      });
      mp.on('gameStart', (data) => {
        myRole = data.yourRole || myRole;
        state = MOD.deserialize ? MOD.deserialize(data.gameState) : data.gameState;
        mode = 'mp';
        startGame('mp', { fromServer: true, gameState: state });
      });
      mp.on('gameOver', (data) => handleGameOver(data));
      mp.onServer('moveApplied', (data) => {
        if (data.state) {
          state = MOD.deserialize ? MOD.deserialize(data.state) : data.state;
          currentTurn = state.currentTurn || state.turn;
          if (config.board.render) config.board.render(state, api);
        }
      });
      return mp;
    }

    // ── Lobby 구성 ────────────────────────────
    function buildLobbyButtons() {
      const buttons = [];
      if (modes.mp && modes.mp.enabled !== false) {
        buttons.push({ id: 'create', label: { ko: '방 만들기', en: 'Create Room' }, primary: true, onClick: () => openRoomOptions('create') });
        if (modes.mp.rankMatch) {
          buttons.push({ id: 'rank', label: { ko: '랭크 매칭', en: 'Ranked Match' }, onClick: () => handleRankMatch() });
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
        ensureMp();
        mp.createRoom({ ...values }, getNickname(), getKeenpleUserId());
      }, () => {
        mount.style.display = 'none';
        if (lobbyApi) lobbyApi.show();
      });
    }

    function handleRankMatch() {
      if (!modes.mp || !modes.mp.rankMatch) return;
      ensureMp();
      if (Keenple.Match && Keenple.Match.findGame) {
        Keenple.Match.findGame({
          gameKey: GAME_KEY,
          onMatched: (data) => {
            if (data.isHost) mp.createRoom({ preferredCode: data.roomCode, matched: true }, getNickname(), getKeenpleUserId());
            else setTimeout(() => mp.joinRoom(data.roomCode, getNickname(), getKeenpleUserId()), 800);
          },
          onError: (e) => api.showToast({ ko: '매칭 실패', en: 'Matching failed' }, { type: 'error' }),
        });
      }
    }

    let _nickname = null, _userId = null;
    function getNickname() { return _nickname; }
    function getKeenpleUserId() { return _userId; }

    // ── 부트스트랩 ────────────────────────────
    async function bootstrap() {
      try {
        const user = await Keenple.getUser();
        if (user) { _nickname = user.nickname; _userId = user.id; }
      } catch (e) {}

      lobbyApi = Keenple.UI.Lobby({
        mount: '#lobby-mount',
        title: GAME_NAME,
        buttons: buildLobbyButtons(),
        joinInput: modes.mp && modes.mp.enabled !== false ? { enabled: true, onJoin: (code) => { ensureMp(); mp.joinRoom(code, getNickname(), getKeenpleUserId()); } } : undefined,
        roomList: modes.mp && modes.mp.enabled !== false ? { enabled: true, fetchRooms: () => fetch('api/rooms').then(r => r.json()).catch(() => []), pollInterval: 10000, onRoomClick: (r) => { ensureMp(); mp.joinRoom(r.code, getNickname(), getKeenpleUserId()); } } : undefined,
        onCancel: () => { if (mp) { mp.clearSession && mp.clearSession(); mp.disconnect && mp.disconnect(); mp = null; } },
      });
    }

    // keenple:langchange 이벤트 — 보드 재렌더
    window.addEventListener('keenple:langchange', () => {
      if (state && config.board.render) config.board.render(state, api);
    });

    bootstrap();

    // 외부 API (테스트/디버그용)
    return {
      getState: () => state,
      getMode: () => mode,
      backToLobby,
      _api: api,
    };
  }

  // ============================================
  //  Export
  // ============================================
  const KeenpleShell = { createTurnBased };
  if (typeof module === 'object' && module.exports) module.exports = KeenpleShell;
  else root.KeenpleShell = KeenpleShell;

})(typeof self !== 'undefined' ? self : this);
