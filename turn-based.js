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
//  - (선택) hooks (onBeforeGameStart, gameOverExtras, customOverlays, customActions, onModeStart)
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
          el('div', { id: 'keenple-custom-actions', class: 'keenple-custom-actions' }),
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
  //  Audio — wallet 사운드 (shared 소유, v2.16.0+)
  //    AudioContext 싱글톤 + tone/noise primitive + 프리셋
  //    재생 이벤트: entry_fee (차감), refund (환불),
  //                item_purchase (구매 — 게임이 variant 선택)
  //    음소거 미제공 — 필요 시 게임이 자체 처리 (아직 shared에는 API 없음)
  // ============================================
  const _audio = (function () {
    let ctx = null;
    let resumeBound = false;

    function ensureCtx() {
      if (ctx) return ctx;
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      try { ctx = new AC({ latencyHint: 0 }); }
      catch (e) { try { ctx = new AC(); } catch (_) { return null; } }
      bindResume();
      return ctx;
    }

    function bindResume() {
      if (resumeBound || typeof document === 'undefined') return;
      resumeBound = true;
      const resume = function () {
        if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      };
      document.addEventListener('pointerdown', resume, { once: true, capture: true });
      document.addEventListener('keydown', resume, { once: true, capture: true });
    }

    function tone(opts) {
      const c = ensureCtx(); if (!c) return;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      const when = (typeof opts.when === 'number') ? opts.when : c.currentTime;
      const dur = opts.dur != null ? opts.dur : 0.08;
      const vol = opts.vol != null ? opts.vol : 0.10;
      const attack = opts.attack != null ? opts.attack : 0;
      const release = opts.release != null ? opts.release : Math.min(0.06, dur);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(opts.freq, when);
      if (opts.toFreq != null) o.frequency.linearRampToValueAtTime(opts.toFreq, when + dur);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vol, when + attack);
      g.gain.linearRampToValueAtTime(0, when + dur + release);
      o.connect(g).connect(c.destination);
      o.start(when);
      o.stop(when + dur + release + 0.02);
    }

    function noise(opts) {
      const c = ensureCtx(); if (!c) return;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      const when = (typeof opts.when === 'number') ? opts.when : c.currentTime;
      const dur = opts.dur != null ? opts.dur : 0.05;
      const vol = opts.vol != null ? opts.vol : 0.08;
      const cutoff = opts.cutoff != null ? opts.cutoff : 3000;
      const frames = Math.max(1, Math.floor(c.sampleRate * dur));
      const buffer = c.createBuffer(1, frames, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1);
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = cutoff;
      const g = c.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vol, when + 0.002);
      g.gain.linearRampToValueAtTime(0, when + dur);
      src.connect(filt).connect(g).connect(c.destination);
      src.start(when);
      src.stop(when + dur + 0.02);
    }

    // ── 프리셋: entry_fee (하강 두 톤) ───────────
    function playEntryFee() {
      const c = ensureCtx(); if (!c) return;
      const now = c.currentTime;
      tone({ freq: 520, toFreq: 390, type: 'triangle', dur: 0.06, vol: 0.12, release: 0.04, when: now });
      tone({ freq: 390, toFreq: 290, type: 'triangle', dur: 0.08, vol: 0.10, release: 0.06, when: now + 0.06 });
    }

    // ── 프리셋: refund (상승 두 톤 — entry_fee 대칭) ───
    function playRefund() {
      const c = ensureCtx(); if (!c) return;
      const now = c.currentTime;
      tone({ freq: 290, toFreq: 390, type: 'triangle', dur: 0.06, vol: 0.10, release: 0.04, when: now });
      tone({ freq: 390, toFreq: 520, type: 'triangle', dur: 0.08, vol: 0.12, release: 0.06, when: now + 0.06 });
    }

    // ── 프리셋: item_purchase variants ───────────
    //   coin  : 짧은 고주파 ping + 살짝 noise (k-ching 축소 — 기본)
    //   chime : 경쾌한 상승 3음 (C5-E5-G5 arpeggio, sine)
    //   pop   : 짧은 저음 탭 (220→180Hz, sine)
    //   soft  : 은은한 상승 한 음 (440→520Hz, sine, 길고 낮은 vol)
    const PURCHASE_VARIANTS = {
      coin: function (now) {
        tone({ freq: 1000, toFreq: 1300, type: 'sine', dur: 0.04, vol: 0.10, release: 0.02, when: now });
        noise({ dur: 0.05, vol: 0.07, cutoff: 3500, when: now + 0.03 });
      },
      chime: function (now) {
        tone({ freq: 523, type: 'sine', dur: 0.05, vol: 0.09, release: 0.04, when: now });
        tone({ freq: 659, type: 'sine', dur: 0.05, vol: 0.09, release: 0.04, when: now + 0.04 });
        tone({ freq: 784, type: 'sine', dur: 0.07, vol: 0.09, release: 0.06, when: now + 0.08 });
      },
      pop: function (now) {
        tone({ freq: 220, toFreq: 180, type: 'sine', dur: 0.06, vol: 0.13, attack: 0.003, release: 0.04, when: now });
      },
      soft: function (now) {
        tone({ freq: 440, toFreq: 520, type: 'sine', dur: 0.10, vol: 0.08, attack: 0.01, release: 0.08, when: now });
      },
    };
    const PURCHASE_VARIANT_NAMES = Object.keys(PURCHASE_VARIANTS);

    function playItemPurchase(variant) {
      const c = ensureCtx(); if (!c) return;
      const name = (variant && PURCHASE_VARIANTS[variant]) ? variant : 'coin';
      PURCHASE_VARIANTS[name](c.currentTime);
    }

    return {
      variants: PURCHASE_VARIANT_NAMES,
      tone: tone,
      noise: noise,
      playEntryFee: playEntryFee,
      playRefund: playRefund,
      playItemPurchase: playItemPurchase,
    };
  })();

  // ============================================
  //  Main — createTurnBased
  // ============================================
  function validateConfig(config) {
    if (!config) throw new Error('[KeenpleShell] config 인자가 필요합니다');
    if (typeof config.gameKey !== 'string' || !config.gameKey) {
      throw new Error('[KeenpleShell] config.gameKey (string) 은 필수입니다');
    }
    if (!config.module) throw new Error('[KeenpleShell] config.module 은 필수입니다');
    const modReq = ['createInitialState', 'validateMove', 'applyMove', 'isTerminal'];
    for (const fn of modReq) {
      if (typeof config.module[fn] !== 'function') {
        throw new Error('[KeenpleShell] config.module.' + fn + ' (function) 이 없습니다');
      }
    }
    if (!config.board) throw new Error('[KeenpleShell] config.board 는 필수입니다');
    if (typeof config.board.mount !== 'function') {
      throw new Error('[KeenpleShell] config.board.mount (function) 이 없습니다');
    }
    const modes = config.modes || {};
    if (modes.ai && modes.ai.enabled) {
      if (!Array.isArray(modes.ai.difficulties) || modes.ai.difficulties.length === 0) {
        throw new Error('[KeenpleShell] modes.ai.difficulties (non-empty array) 가 필요합니다');
      }
      if (typeof modes.ai.onOpponentTurn !== 'function') {
        throw new Error('[KeenpleShell] modes.ai.onOpponentTurn (function) 이 필요합니다');
      }
      if (typeof modes.ai.isOpponentTurn !== 'function') {
        console.warn('[KeenpleShell] modes.ai.isOpponentTurn 미선언 — state.turn 비교 기반 기본 감지가 실패하면 AI가 응답하지 않습니다');
      }
    }
    if (modes.mp && modes.mp.enabled) {
      const roles = config.roles || modes.mp.roles;
      if (!Array.isArray(roles) || roles.length < 2) {
        throw new Error('[KeenpleShell] config.roles 또는 modes.mp.roles (배열, 2개 이상) 가 필요합니다');
      }
      if (typeof modes.mp.minPlayers !== 'number' || typeof modes.mp.maxPlayers !== 'number') {
        console.warn('[KeenpleShell] modes.mp.minPlayers / maxPlayers 미지정 — 서버 기본값을 사용합니다');
      }
    }
    if (Array.isArray(config.options)) {
      for (const opt of config.options) {
        if (!opt || typeof opt.id !== 'string') {
          console.warn('[KeenpleShell] options 항목에 id(string) 누락', opt);
        }
      }
    }
    if (typeof config.roleLabel !== 'function' && (config.roles || (modes.mp && modes.mp.roles))) {
      console.warn('[KeenpleShell] config.roleLabel(role) 미선언 — 게임오버 모달·HUD에 역할 문자열(예: "white")이 그대로 노출됩니다');
    }
    // onBackToMenu (v2.17.0+) — 선택 콜백. 선언 시 shell이 lobby에 "메뉴" 버튼 자동 주입.
    if (config.onBackToMenu != null && typeof config.onBackToMenu !== 'function') {
      throw new Error('[KeenpleShell] config.onBackToMenu 는 함수여야 합니다');
    }
    // audio (v2.16.0+) — 선택 옵션. 선언되었으면 형식 검증.
    if (config.audio != null) {
      if (typeof config.audio !== 'object') {
        throw new Error('[KeenpleShell] config.audio 는 객체여야 합니다');
      }
      if (config.audio.purchaseSound != null) {
        const allowed = _audio.variants;
        if (allowed.indexOf(config.audio.purchaseSound) === -1) {
          throw new Error('[KeenpleShell] config.audio.purchaseSound "' + config.audio.purchaseSound +
            '" 는 허용된 값이 아닙니다 (' + allowed.join(' / ') + ')');
        }
      }
    }
  }

  function createTurnBased(config) {
    validateConfig(config);

    const GAME_KEY = config.gameKey;
    const GAME_NAME = config.gameName || { ko: GAME_KEY, en: GAME_KEY };
    const MOD = config.module;
    const modes = config.modes || { local: { enabled: true } };
    const options = config.options || [];
    const hooks = config.hooks || {};
    function getUndoMax(m) {
      if (m && modes[m] && typeof modes[m].undoMax === 'number') return modes[m].undoMax;
      if (modes.local && typeof modes.local.undoMax === 'number') return modes.local.undoMax;
      return 50;
    }
    function getRolesDef() {
      return config.roles || (modes.mp && modes.mp.roles) || null;
    }
    function getRoleLabel(role) {
      if (typeof config.roleLabel === 'function') {
        try {
          const l = config.roleLabel(role);
          if (l && typeof l.ko === 'string' && typeof l.en === 'string') return l;
        } catch (e) { console.warn('[KeenpleShell] roleLabel 호출 실패', e); }
      }
      return { ko: String(role), en: String(role) };
    }
    const defaultEntryFee = config.entryFee || 0;
    let _aiSideWarned = false;
    const _mismatchWarned = {};
    function checkOptionMismatch(key, clientValue, serverValue, context) {
      if (_mismatchWarned[key]) return;
      if (serverValue === undefined) return;
      if (clientValue !== serverValue) {
        _mismatchWarned[key] = true;
        console.warn(
          '[KeenpleShell] ' + key + ' 설정 불일치 — 클라: ' + JSON.stringify(clientValue) +
          ', 서버: ' + JSON.stringify(serverValue) + ' (' + context + '). 서버 값을 신뢰하지만 양쪽 config를 맞추세요.'
        );
      }
    }
    function checkFeeMismatch(serverFee, context) {
      if (serverFee == null) return;
      checkOptionMismatch('entryFee', defaultEntryFee, serverFee, context);
    }
    function checkServerConfig(serverConfig, context) {
      if (!serverConfig) return;
      if ('entryFee' in serverConfig) checkOptionMismatch('entryFee', defaultEntryFee, serverConfig.entryFee, context);
      const clientRankMatch = !!(modes.mp && modes.mp.rankMatch);
      if ('rankMatch' in serverConfig) checkOptionMismatch('rankMatch', clientRankMatch, !!serverConfig.rankMatch, context);
      if ('payoutPolicy' in serverConfig && config.payoutPolicy != null) {
        const clientPolicy = typeof config.payoutPolicy === 'function' ? 'custom' : config.payoutPolicy;
        checkOptionMismatch('payoutPolicy', clientPolicy, serverConfig.payoutPolicy, context);
      }
    }

    // Catalog 가격 단일 소스: opts(게임 선언)에 main DB 가격을 덮어쓴다.
    // Catalog 미존재/캐시 미스 시 opts 그대로 반환 (fallback).
    function resolveItemFromCatalog(opts) {
      if (!opts || !opts.itemId) return opts;
      if (typeof Keenple === 'undefined' || !Keenple.Catalog) return opts;
      const cat = Keenple.Catalog.get(opts.itemId);
      if (!cat) return opts;
      const out = Object.assign({}, opts);
      if (cat.price && cat.price.amount != null) out.price = cat.price.amount;
      if (cat.price && cat.price.currency) out.currency = cat.price.currency;
      if (cat.name) out.name = cat.name;
      return out;
    }
    function hasPaidItems(modeName) {
      const m = modes[modeName];
      if (!m) return false;
      if (m.undoItem && m.undoItem.price > 0) return true;
      return false;
    }

    const _shellListeners = [];
    function addShellListener(target, event, handler, opts) {
      target.addEventListener(event, handler, opts);
      _shellListeners.push({ target: target, event: event, handler: handler, opts: opts });
      return handler;
    }
    function removeShellListeners() {
      for (const l of _shellListeners) {
        try { l.target.removeEventListener(l.event, l.handler, l.opts); } catch (e) {}
      }
      _shellListeners.length = 0;
    }

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
    let aiMoveTimer = null;
    let activeMatch = null;
    let undoStack = createUndoStack(getUndoMax(null));
    let undoUsedCount = 0;

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
      // 아이템 즉시 구매 (힌트·스킨 등 게임 고유 소비형).
      //   opts: {
      //     itemId:   'chess_hint_1',
      //     name:     { ko:'힌트', en:'Hint' },
      //     price:    5,
      //     currency: 'coin' | 'keen',              // 기본 'coin'
      //     confirm:  true,                          // 구매 확인 모달 (기본 true)
      //     serverCall: async () => ({ ok:true }),   // 실제 차감 호출. 생략 시 mock(클라만 감산, 새로고침 시 원복)
      //     onSuccess: () => { ... },                // 구매 성공 → 효과 발동
      //     onCancel:  () => { ... },                // 선택
      //     sound:    'coin' | 'chime' | 'pop' | 'soft',  // v2.16.0+. 이 호출만 다른 사운드.
      //                                              // 생략 시 config.audio.purchaseSound → 'coin'.
      //   }
      //
      // ⚠ 무르기(undo)는 shared가 이미 기본 버튼과 리스너를 달고 있음.
      //   유료 무르기는 여기서 buyItem을 직접 호출하지 말고,
      //   createTurnBased config의 modes.{local|ai}.undoItem 에 선언할 것.
      buyItem: (opts) => purchaseItem(opts),
      // 표준 아이템 구매 버튼 DOM 생성. 게임이 반환값을 원하는 위치에 appendChild.
      //   opts: buyItem의 opts 전부 + { icon?: '↩️' | HTMLElement, className?: '' }
      //   반환: HTMLButtonElement (클릭 시 buyItem 플로우 실행)
      createItemButton: (opts) => buildItemButton(opts),
      // customActions 런타임 추가/제거/재평가 (v2.15.0).
      //   addAction(id, spec):    예측 모드 진입 시 취소 버튼 등 동적 버튼.
      //                           spec: { count?, render, update?, onClick, isUsed?, isDisabled? }
      //   removeAction(id):       동적으로 추가한 action 제거.
      //   refreshActions(id?):    state 변화 시 자동 호출되지만, 외부 트리거(타이머 등)로
      //                           isUsed/isDisabled가 바뀌는 경우 수동 호출.
      addAction: (id, spec) => {
        if (customActionsMap[id]) {
          console.warn('[KeenpleShell] addAction: "' + id + '" 이미 존재 — removeAction 후 다시 추가');
          return;
        }
        mountCustomAction(id, spec);
      },
      removeAction: (id) => unmountCustomAction(id),
      refreshActions: (id) => refreshCustomActions(id),
    };

    // ── Custom overlays 슬롯 생성 ─────────────
    if (hooks.customOverlays) {
      const overlayRoot = document.getElementById('keenple-overlays');
      Object.keys(hooks.customOverlays).forEach(id => {
        overlayRoot.appendChild(el('div', { id: 'keenple-overlay-' + id, class: 'keenple-overlay', style: { display: 'none' } }));
      });
    }

    // ── Custom actions (action-bar 슬롯) ─────────
    //   hooks.customActions[id] = {
    //     count:      number | (state) => number,   // 인스턴스 개수 (기본 1)
    //     render:     (ctx) => HTMLElement,          // 최초 1회. canvas 자유.
    //                                                 // ctx: { index, state, api, getState, getMode }
    //     update?:    (el, ctx) => void,             // state 변화 시 호출 (canvas 재그리기 등)
    //     onClick:    (ctx) => void,                 // 클릭 핸들러. used/disabled면 shared가 차단.
    //     isUsed?:    (ctx) => boolean,              // true → data-used="true" + disabled
    //     isDisabled?:(ctx) => boolean,              // true → disabled
    //   }
    //   예약어: 'undo', 'surrender' (에러).
    const RESERVED_ACTION_IDS = ['undo', 'surrender'];
    const customActionsRoot = document.getElementById('keenple-custom-actions');
    const customActionsMap = {};   // id -> { spec, groupEl, items: [{ el, index }] }

    function validateActionSpec(id, spec) {
      if (RESERVED_ACTION_IDS.indexOf(id) !== -1) {
        throw new Error('[KeenpleShell] customActions id "' + id + '" 은 예약어입니다 (undo/surrender)');
      }
      if (!spec || typeof spec !== 'object') throw new Error('[KeenpleShell] customActions.' + id + ' spec 객체가 필요합니다');
      if (typeof spec.render !== 'function') throw new Error('[KeenpleShell] customActions.' + id + '.render (function) 이 필수입니다');
      if (typeof spec.onClick !== 'function') throw new Error('[KeenpleShell] customActions.' + id + '.onClick (function) 이 필수입니다');
    }

    function resolveActionCount(spec) {
      if (typeof spec.count === 'function') {
        try { return Math.max(0, spec.count(state) | 0); }
        catch (e) { console.error('[shell] customActions count 에러', e); return 0; }
      }
      if (typeof spec.count === 'number') return Math.max(0, spec.count | 0);
      return 1;
    }

    function buildActionCtx(index) {
      return { index: index, state: state, api: api, getState: () => state, getMode: () => mode };
    }

    function mountCustomAction(id, spec) {
      validateActionSpec(id, spec);
      const count = resolveActionCount(spec);
      const groupEl = el('div', { class: 'keenple-action-group', 'data-id': id });
      const items = [];
      for (let i = 0; i < count; i++) {
        const ctx = buildActionCtx(i);
        const btn = el('button', { class: 'keenple-action-item', 'data-index': String(i) });
        let inner = null;
        try { inner = spec.render(ctx); }
        catch (e) { console.error('[shell] customActions.' + id + '.render', e); }
        if (inner instanceof HTMLElement) btn.appendChild(inner);
        btn.addEventListener('click', (function (idx) {
          return function () {
            if (btn.disabled) return;
            try { spec.onClick(buildActionCtx(idx)); }
            catch (e) { console.error('[shell] customActions.' + id + '.onClick', e); }
          };
        })(i));
        groupEl.appendChild(btn);
        items.push({ el: btn, index: i });
      }
      customActionsRoot.appendChild(groupEl);
      customActionsMap[id] = { spec: spec, groupEl: groupEl, items: items };
      refreshCustomAction(id);
    }

    function refreshCustomAction(id) {
      const entry = customActionsMap[id];
      if (!entry) return;
      const spec = entry.spec;
      entry.items.forEach(function (item) {
        const btn = item.el;
        const ctx = buildActionCtx(item.index);
        let used = false, disabled = false;
        if (typeof spec.isUsed === 'function') {
          try { used = !!spec.isUsed(ctx); } catch (e) { console.error('[shell] customActions.' + id + '.isUsed', e); }
        }
        if (typeof spec.isDisabled === 'function') {
          try { disabled = !!spec.isDisabled(ctx); } catch (e) { console.error('[shell] customActions.' + id + '.isDisabled', e); }
        }
        btn.dataset.used = used ? 'true' : 'false';
        btn.disabled = used || disabled;
        if (typeof spec.update === 'function') {
          try { spec.update(btn, ctx); } catch (e) { console.error('[shell] customActions.' + id + '.update', e); }
        }
      });
    }

    function refreshCustomActions(id) {
      if (id) return refreshCustomAction(id);
      Object.keys(customActionsMap).forEach(refreshCustomAction);
    }

    function unmountCustomAction(id) {
      const entry = customActionsMap[id];
      if (!entry) return;
      if (entry.groupEl && entry.groupEl.parentNode) {
        entry.groupEl.parentNode.removeChild(entry.groupEl);
      }
      delete customActionsMap[id];
    }

    function mountAllCustomActions() {
      if (!hooks.customActions) return;
      Object.keys(hooks.customActions).forEach(function (id) {
        if (customActionsMap[id]) return;
        try { mountCustomAction(id, hooks.customActions[id]); }
        catch (e) { console.error('[shell] customActions mount 실패: ' + id, e); }
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
      const rolesDef = getRolesDef();
      if (!rolesDef) return;
      const players = (data && data.players) || [];
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
      extras = extras || {};
      // Catalog gating: 유료 아이템 있는 모드는 main 가격 로드 실패 시 시작 차단.
      // Catalog SDK 미존재 환경(구버전 main, SDK 미로드)은 그대로 진행 → config fallback.
      if (hasPaidItems(startMode) && typeof Keenple !== 'undefined' && Keenple.Catalog) {
        try {
          await Keenple.Catalog.load(config.gameKey, true);
        } catch (e) {
          console.error('[KeenpleShell] Catalog 로드 실패 — 유료 아이템 모드 시작 차단', e);
          showCatalogLoadErrorModal();
          return;
        }
      }
      mode = startMode;
      updateBackToMenuVisibility();
      gameOver = false;
      gameOverState = null;
      undoStack = createUndoStack(getUndoMax(startMode));
      undoUsedCount = 0;
      updateUndoBtnLabel();

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

      // customActions 최초 mount (config.hooks.customActions 에 선언된 것)
      // 게임마다 mount 1회. state 변화 시 자동 refresh는 아래 각 render 호출 지점에서.
      Object.keys(customActionsMap).forEach(unmountCustomAction);
      mountAllCustomActions();

      currentTurn = state.currentTurn || (state.turn != null ? state.turn : null);

      // HUD 생성/업데이트
      ensureHud(extras);
      updateHudTurn();

      // AI 모드 선공 체크
      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        if (isAiTurn(state, extras)) scheduleAiMove(200);
      }
    }

    // AI 턴 판정. 게임이 isOpponentTurn 콜백 제공 시 그걸 우선.
    // 레거시 폴백: aiSide 문자열과 state.turn/currentTurn 동등 비교.
    function isAiTurn(st, extras) {
      if (!modes.ai) return false;
      if (typeof modes.ai.isOpponentTurn === 'function') {
        try { return !!modes.ai.isOpponentTurn(st); }
        catch (e) { console.error('[shell] modes.ai.isOpponentTurn 에러', e); return false; }
      }
      const aiSide = (extras && extras.aiSide) || (st && st.aiSide) || modes.ai.aiSide;
      if (aiSide == null) {
        if (!_aiSideWarned) {
          _aiSideWarned = true;
          console.warn('[KeenpleShell] modes.ai.isOpponentTurn(state) 또는 modes.ai.aiSide 미선언 — AI 턴 감지 불가. game.js에서 선언 필요.');
        }
        return false;
      }
      const turn = (st && (st.currentTurn != null ? st.currentTurn : st.turn));
      return turn === aiSide;
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
      refreshCustomActions();
      updateHudTurn();

      const term = MOD.isTerminal(state);
      if (term.terminal) { handleGameOver(term); return true; }

      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        if (isAiTurn(state)) scheduleAiMove(300);
      }
      return true;
    }

    function scheduleAiMove(delay) {
      if (aiMoveTimer) clearTimeout(aiMoveTimer);
      aiMoveTimer = setTimeout(triggerAiMove, delay);
    }
    async function triggerAiMove() {
      aiMoveTimer = null;
      if (mode !== 'ai' || gameOver || !state) return;
      try {
        const move = await modes.ai.onOpponentTurn(state, api);
        if (mode !== 'ai' || gameOver) return;
        if (move) tryApplyLocalMove(move);
      } catch (e) { console.error('[shell] AI turn 실패', e); }
    }

    // ── Undo ──────────────────────────────────
    function popOnce() {
      const prev = undoStack.pop();
      state = (typeof prev === 'string' && MOD.deserialize) ? MOD.deserialize(prev) : prev;
      currentTurn = state.currentTurn || state.turn;
    }
    function performUndoInternal() {
      if (!undoStack.size() || gameOver) return;
      popOnce();
      // AI 모드: "내가 다시 둘 수 있는 상태"까지 반복 pop (AI half-move도 되감기)
      if (mode === 'ai' && modes.ai && modes.ai.onOpponentTurn) {
        while (undoStack.size() && isAiTurn(state)) popOnce();
        // 엣지: 스택 소진 후에도 AI 턴이면 (예: AI 선공 직후) AI에게 돌려줌 → 화면 얼음 방지
        if (isAiTurn(state)) scheduleAiMove(300);
      }
      if (config.board.render) config.board.render(state, api);
      refreshCustomActions();
      updateHudTurn();
      if (!undoStack.size()) undoBtn.disabled = true;
    }
    function currentUndoItem() {
      const modeConfig = modes && modes[mode];
      const item = modeConfig && modeConfig.undoItem;
      if (!item) return null;
      return resolveItemFromCatalog(item);
    }
    function updateUndoBtnLabel() {
      const item = currentUndoItem();
      if (!item) {
        undoBtn.textContent = t('되돌리기', 'Undo');
        undoBtn.setAttribute('data-ko', '되돌리기');
        undoBtn.setAttribute('data-en', 'Undo');
        return;
      }
      const freeCount = item.freeCount || 0;
      const remaining = Math.max(0, freeCount - undoUsedCount);
      const currency = item.currency || 'coin';
      if (remaining > 0) {
        const ko = '무르기 (무료 ' + remaining + ')';
        const en = 'Undo (' + remaining + ' free)';
        undoBtn.textContent = t(ko, en);
        undoBtn.setAttribute('data-ko', ko); undoBtn.setAttribute('data-en', en);
      } else if (item.price > 0) {
        const ko = '무르기 (' + item.price + ' ' + currency + ')';
        const en = 'Undo (' + item.price + ' ' + currency + ')';
        undoBtn.textContent = t(ko, en);
        undoBtn.setAttribute('data-ko', ko); undoBtn.setAttribute('data-en', en);
      } else {
        undoBtn.textContent = t('되돌리기', 'Undo');
        undoBtn.setAttribute('data-ko', '되돌리기');
        undoBtn.setAttribute('data-en', 'Undo');
      }
    }
    undoBtn.addEventListener('click', () => {
      if (!undoStack.size() || gameOver) return;
      const undoItem = currentUndoItem();
      const freeCount = (undoItem && undoItem.freeCount) || 0;
      const paidMode = undoItem && undoItem.price > 0 && undoUsedCount >= freeCount;
      if (paidMode) {
        purchaseItem({
          itemId: undoItem.itemId || (GAME_KEY + '_undo'),
          name: undoItem.name || { ko: '무르기 1회', en: 'Undo 1 move' },
          price: undoItem.price,
          currency: undoItem.currency || 'coin',
          serverCall: undoItem.serverCall,
          sound: undoItem.sound,
          onSuccess: () => { performUndoInternal(); undoUsedCount++; updateUndoBtnLabel(); },
        });
      } else {
        performUndoInternal();
        if (undoItem) { undoUsedCount++; updateUndoBtnLabel(); }
      }
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
          const label = getRoleLabel(extra.winner);
          title = { ko: label.ko + ' 승리', en: label.en + ' wins' };
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
      if (aiMoveTimer) { clearTimeout(aiMoveTimer); aiMoveTimer = null; }
      mode = null; myRole = null; gameOver = false; state = null;
      matchEloInfo = null; pendingEloUpdate = null;
      undoStack.clear();
      undoUsedCount = 0;
      dom.gameArea.style.display = 'none';
      spectatorBanner.style.display = 'none';
      disconnectOverlay.style.display = 'none';
      gameNotice.style.display = 'none';
      document.getElementById('keenple-ai-picker').style.display = 'none';
      document.getElementById('keenple-room-options').style.display = 'none';
      if (lobbyApi) { lobbyApi.show(); lobbyApi.setStatus && lobbyApi.setStatus(''); lobbyApi.showCancel && lobbyApi.showCancel(false); }
      updateBackToMenuVisibility();
    }

    // ── 입장 확인 모달 (입장료 > 0 시) ───────────
    function confirmEntryFee(fee, onConfirm) {
      var overlay = document.createElement('div');
      overlay.className = 'keenple-fee-confirm-overlay';
      overlay.innerHTML =
        '<div class="keenple-fee-confirm-card">' +
          '<div class="keenple-fee-confirm-icon">🪙</div>' +
          '<div class="keenple-fee-confirm-title">' + t('방 입장 확인', 'Join Room?') + '</div>' +
          '<div class="keenple-fee-confirm-msg">' +
            t('이 방은 게임 시작 시', 'This room charges') + ' <b>' + fee + ' coin</b> ' + t('차감됩니다.', 'on game start.') +
          '</div>' +
          '<div class="keenple-fee-confirm-buttons">' +
            '<button class="keenple-fee-confirm-ok">' + t('참가', 'Join') + '</button>' +
            '<button class="keenple-fee-confirm-cancel">' + t('취소', 'Cancel') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { overlay.classList.add('keenple-fee-confirm-out'); setTimeout(function(){ overlay.remove(); }, 200); };
      overlay.querySelector('.keenple-fee-confirm-ok').onclick = function () { close(); onConfirm(); };
      overlay.querySelector('.keenple-fee-confirm-cancel').onclick = close;
      overlay.onclick = function (e) { if (e.target === overlay) close(); };
      requestAnimationFrame(function () { overlay.classList.add('keenple-fee-confirm-in'); });
    }

    function joinRoomWithConfirm(code, fee) {
      var doJoin = function () {
        ensureMp();
        var tryJ = function (a) {
          a = a || 0;
          if (mp.connected) mp.joinRoom(code, getNickname(), getKeenpleUserId());
          else if (a > 50) return;
          else setTimeout(function () { tryJ(a + 1); }, 100);
        };
        tryJ();
      };
      var resolvedFee = fee != null ? fee : defaultEntryFee;
      if (resolvedFee > 0 && _coinBalance != null && _coinBalance < resolvedFee) {
        showInsufficientCoinsModal(resolvedFee, _coinBalance);
        return;
      }
      if (resolvedFee > 0) confirmEntryFee(resolvedFee, doJoin);
      else doJoin();
    }

    // 현재 노출 중인 입장료 예고 애니메이션 (차감 시 즉시 정리)
    var _pendingFeeNode = null;
    function dismissPendingFee(immediate) {
      if (!_pendingFeeNode) return;
      var node = _pendingFeeNode;
      _pendingFeeNode = null;
      if (immediate) { node.remove(); return; }
      node.classList.remove('keenple-fee-deduct-in');
      node.classList.add('keenple-fee-deduct-out');
      setTimeout(function () { node.remove(); }, 200);
    }

    // ── 입장료 예고 애니메이션 (방 입장 시) ─────
    function showFeePendingAnimation(fee) {
      dismissPendingFee(true);
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
      _pendingFeeNode = node;
      requestAnimationFrame(() => node.classList.add('keenple-fee-deduct-in'));
      setTimeout(() => {
        if (_pendingFeeNode !== node) return; // 이미 차감으로 교체됨
        node.classList.remove('keenple-fee-deduct-in');
        node.classList.add('keenple-fee-deduct-out');
        setTimeout(() => { node.remove(); if (_pendingFeeNode === node) _pendingFeeNode = null; }, 450);
      }, 2000);
    }

    // ── 표준 아이템 버튼 DOM 생성 ────────────────
    function buildItemButton(opts) {
      opts = resolveItemFromCatalog(opts || {});
      var currency = opts.currency === 'keen' ? 'keen' : 'coin';
      var label = opts.label || opts.name || { ko: '아이템', en: 'Item' };
      var btn = document.createElement('button');
      btn.className = 'keenple-item-btn' + (opts.className ? ' ' + opts.className : '');
      btn.type = 'button';

      var iconNode;
      if (opts.icon instanceof HTMLElement) iconNode = opts.icon;
      else if (opts.icon) { iconNode = document.createElement('span'); iconNode.className = 'keenple-item-btn-icon'; iconNode.textContent = String(opts.icon); }

      var labelNode = document.createElement('span');
      labelNode.className = 'keenple-item-btn-label';
      var labelText = typeof label === 'string' ? label : (label.ko || label.en || '');
      labelNode.textContent = labelText;
      if (typeof label === 'object') {
        if (label.ko) labelNode.setAttribute('data-ko', label.ko);
        if (label.en) labelNode.setAttribute('data-en', label.en);
      }

      var priceNode = document.createElement('span');
      priceNode.className = 'keenple-item-btn-price keenple-item-btn-price-' + currency;
      priceNode.innerHTML = '<span class="keenple-item-btn-price-icon">🪙</span>' +
                            '<span class="keenple-item-btn-price-amount">' + (opts.price || 0) + '</span>';

      if (iconNode) btn.appendChild(iconNode);
      btn.appendChild(labelNode);
      btn.appendChild(priceNode);

      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        purchaseItem({
          itemId: opts.itemId,
          name: label,
          price: opts.price,
          currency: currency,
          confirm: opts.confirm,
          serverCall: opts.serverCall,
          onSuccess: opts.onSuccess,
          onCancel: opts.onCancel,
          sound: opts.sound,
        });
      });

      return btn;
    }

    // ── 아이템 구매 플로우 ───────────────────────
    function purchaseItem(opts) {
      opts = resolveItemFromCatalog(opts || {});
      var price = opts.price || 0;
      var currency = opts.currency === 'keen' ? 'keen' : 'coin';
      var name = opts.name || { ko: '아이템', en: 'Item' };
      if (!_userId) { requireLogin('아이템 구매'); return; }
      var bal = getBalance(currency);
      if (price > 0 && bal != null && bal < price) {
        showInsufficientModal(price, bal, currency);
        return;
      }
      var proceed = function () {
        runPurchase(opts, currency);
      };
      if (opts.confirm === false) { proceed(); return; }
      showPurchaseConfirmModal(name, price, currency, proceed, opts.onCancel);
    }

    function showCatalogLoadErrorModal() {
      var overlay = document.createElement('div');
      overlay.className = 'keenple-fee-confirm-overlay keenple-catalog-error';
      overlay.innerHTML =
        '<div class="keenple-fee-confirm-card">' +
          '<div class="keenple-fee-confirm-icon">⚠️</div>' +
          '<div class="keenple-fee-confirm-title">' + t('아이템 정보 로드 실패', 'Failed to Load Item Info') + '</div>' +
          '<div class="keenple-fee-confirm-msg">' +
            t('서버에서 가격 정보를 가져올 수 없어 게임을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.',
              'Cannot start the game without item pricing info from server. Please try again later.') +
          '</div>' +
          '<div class="keenple-fee-confirm-buttons">' +
            '<button class="keenple-fee-confirm-ok">' + t('확인', 'OK') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { overlay.classList.add('keenple-fee-confirm-out'); setTimeout(function(){ overlay.remove(); }, 200); };
      overlay.querySelector('.keenple-fee-confirm-ok').onclick = close;
      overlay.onclick = function (e) { if (e.target === overlay) close(); };
      requestAnimationFrame(function () { overlay.classList.add('keenple-fee-confirm-in'); });
    }

    function showPurchaseConfirmModal(name, price, currency, onOk, onCancel) {
      var label = typeof name === 'string' ? name : (name[Keenple.getLang && Keenple.getLang()] || name.ko || name.en);
      var overlay = document.createElement('div');
      overlay.className = 'keenple-fee-confirm-overlay keenple-item-confirm';
      overlay.innerHTML =
        '<div class="keenple-fee-confirm-card">' +
          '<div class="keenple-fee-confirm-icon">🛒</div>' +
          '<div class="keenple-fee-confirm-title">' + t('아이템 구매', 'Purchase Item') + '</div>' +
          '<div class="keenple-fee-confirm-msg">' +
            '<b>' + label + '</b>' + t('을(를)', '') + ' <b>' + price + ' ' + currency + '</b>' +
            t('에 구매하시겠습니까?', '?') +
          '</div>' +
          '<div class="keenple-fee-confirm-buttons">' +
            '<button class="keenple-fee-confirm-ok">' + t('구매', 'Buy') + '</button>' +
            '<button class="keenple-fee-confirm-cancel">' + t('취소', 'Cancel') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { overlay.classList.add('keenple-fee-confirm-out'); setTimeout(function(){ overlay.remove(); }, 200); };
      overlay.querySelector('.keenple-fee-confirm-ok').onclick = function () { close(); onOk(); };
      overlay.querySelector('.keenple-fee-confirm-cancel').onclick = function () { close(); if (onCancel) onCancel(); };
      overlay.onclick = function (e) { if (e.target === overlay) { close(); if (onCancel) onCancel(); } };
      requestAnimationFrame(function () { overlay.classList.add('keenple-fee-confirm-in'); });
    }

    async function runPurchase(opts, currency) {
      var price = opts.price || 0;
      var hasServerCall = typeof opts.serverCall === 'function';
      var mockAllowed = !!(config.dev && config.dev.allowMockPurchase);

      // price > 0인데 serverCall 미구현이고 mock 허용도 안 된 경우 — 조용한 실패 차단
      if (price > 0 && !hasServerCall && !mockAllowed) {
        console.error(
          '[KeenpleShell] buyItem: serverCall 필수 (price>0). ' +
          '실제 차감 엔드포인트를 opts.serverCall로 제공하거나, ' +
          '테스트 중이면 createTurnBased({ dev: { allowMockPurchase: true } }) 선언 필요.'
        );
        api.showToast({ ko: '현재 구매 불가', en: 'Purchase unavailable' }, { type: 'error' });
        return;
      }

      var isMock = !hasServerCall;
      try {
        if (hasServerCall) {
          var result = await opts.serverCall();
          if (!result || !result.ok) {
            var err = (result && result.error) || 'purchase_failed';
            var bal = getBalance(currency);
            if (err === 'insufficient_funds' && bal != null) {
              showInsufficientModal(price, bal, currency);
            } else if (err === 'login_required') {
              api.showToast({ ko: '로그인이 필요합니다', en: 'Login required' }, { type: 'error' });
            } else {
              api.showToast({ ko: '구매 실패', en: 'Purchase failed' }, { type: 'error' });
            }
            return;
          }
        } else {
          // mockAllowed === true 인 경로 — 개발자 명시 opt-in. 매 호출 warn
          console.warn('[KeenpleShell] MOCK 구매 — 로컬 잔액만 감산됨 (dev.allowMockPurchase)');
          var curBal = getBalance(currency);
          if (curBal != null && price > 0) setBalanceLocal(currency, Math.max(0, curBal - price));
        }
        if (price > 0) showFeeDeductionAnimation(price, currency);
        try { window.dispatchEvent(new CustomEvent('keenple:wallet-changed', { detail: { reason: 'item_purchase', amount: -price, currency: currency, mock: isMock, sound: opts.sound } })); } catch (e) {}
        if (!isMock) {
          if (Keenple.Wallet && Keenple.Wallet.refresh) { try { Keenple.Wallet.refresh(); } catch (e) {} }
          refreshCoinBalance();
        }
        if (typeof opts.onSuccess === 'function') opts.onSuccess();
      } catch (e) {
        console.error('[KeenpleShell] purchase 에러', e);
        api.showToast({ ko: '구매 중 오류', en: 'Purchase error' }, { type: 'error' });
      }
    }

    // ── 환불 애니메이션 (abort/payout) ─────────
    function showFeeRefundAnimation(amount) {
      dismissPendingFee(true);
      var node = document.createElement('div');
      node.className = 'keenple-fee-deduct keenple-fee-refund';
      node.innerHTML =
        '<div class="keenple-fee-deduct-card keenple-fee-refund-card">' +
          '<div class="keenple-fee-deduct-icon">🪙</div>' +
          '<div class="keenple-fee-deduct-text">' +
            '<div class="keenple-fee-deduct-label">' + t('환불', 'Refunded') + '</div>' +
            '<div class="keenple-fee-deduct-amount">+' + amount + ' coin</div>' +
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

    // ── 입장료 차감 애니메이션 ─────────────────
    function showFeeDeductionAnimation(fee, currency) {
      currency = currency || 'coin';
      dismissPendingFee(true);
      var node = document.createElement('div');
      node.className = 'keenple-fee-deduct';
      node.innerHTML =
        '<div class="keenple-fee-deduct-card">' +
          '<div class="keenple-fee-deduct-icon">🪙</div>' +
          '<div class="keenple-fee-deduct-text">' +
            '<div class="keenple-fee-deduct-label">' + t('차감', 'Charged') + '</div>' +
            '<div class="keenple-fee-deduct-amount">−' + fee + ' ' + currency + '</div>' +
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

    // ── Back to pre-lobby Menu 버튼 (v2.17.0+) ─
    // onBackToMenu 선언된 게임만: lobby(+ai-picker/room-options) 상태에서 bottom-left fixed 버튼 표시.
    // 게임 중에는 keenple-back-to-lobby-btn 이 대신 표시되므로 자연스럽게 숨김.
    let backToMenuBtn = null;
    if (typeof config.onBackToMenu === 'function') {
      backToMenuBtn = document.createElement('button');
      backToMenuBtn.type = 'button';
      backToMenuBtn.id = 'keenple-back-to-menu-btn';
      backToMenuBtn.className = 'keenple-back-to-lobby back-to-lobby-fixed keenple-back-to-menu';
      backToMenuBtn.setAttribute('data-ko', '← 메뉴');
      backToMenuBtn.setAttribute('data-en', '← Menu');
      backToMenuBtn.textContent = t('← 메뉴', '← Menu');
      document.body.appendChild(backToMenuBtn);
      if (typeof BackToLobby !== 'undefined') {
        BackToLobby.attach(backToMenuBtn, {
          isInProgress: () => !!mode && !gameOver,
          onReset: () => {
            try { destroy({ removeDom: true }); } catch (e) { showShellError('onBackToMenu:destroy', e); }
            try { config.onBackToMenu(); } catch (e) { showShellError('onBackToMenu:callback', e); }
          },
        });
      } else {
        // BackToLobby 미로드 환경 — 기본 confirm fallback
        backToMenuBtn.addEventListener('click', () => {
          if (!!mode && !gameOver) {
            if (!window.confirm(t('진행 중인 게임이 종료됩니다. 메뉴로 돌아가시겠습니까?', 'This will end the current game. Return to menu?'))) return;
          }
          try { destroy({ removeDom: true }); } catch (e) { showShellError('onBackToMenu:destroy', e); }
          try { config.onBackToMenu(); } catch (e) { showShellError('onBackToMenu:callback', e); }
        });
      }
    }
    function updateBackToMenuVisibility() {
      if (!backToMenuBtn) return;
      // mode 미설정(로비/ai-picker/room-options 중) 시에만 표시.
      backToMenuBtn.style.display = mode ? 'none' : '';
    }
    updateBackToMenuVisibility();

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
        checkServerConfig(data.serverConfig, 'roomCreated');
        checkFeeMismatch(data.entryFee, 'roomCreated');
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
        checkServerConfig(data && data.serverConfig, 'roomJoined');
        checkFeeMismatch(data && data.entryFee, 'roomJoined');
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
        checkServerConfig(data && data.serverConfig, 'gameStart');
        checkFeeMismatch(data && data.entryFee, 'gameStart');
        if (fee > 0) {
          showFeeDeductionAnimation(fee);
          try { window.dispatchEvent(new CustomEvent('keenple:wallet-changed', { detail: { reason: 'entry_fee', amount: -fee, mock: false } })); } catch (e) {}
          if (Keenple.Wallet && Keenple.Wallet.refresh) { try { Keenple.Wallet.refresh(); } catch (e) {} }
        }
        // MP 기본 타이머 (옵션에 turnTimer 있으면 그 값, 없으면 skip — 서버의 turnTimer 이벤트 기다림)
      });

      mp.on('gameOver', (data) => handleGameOver(data));

      mp.onServer('payoutResult', (data) => {
        if (data && data.amount > 0) {
          showFeeRefundAnimation(data.amount);
          try { window.dispatchEvent(new CustomEvent('keenple:wallet-changed', { detail: { reason: 'refund', amount: data.amount, mock: false } })); } catch (e) {}
          if (Keenple.Wallet && Keenple.Wallet.refresh) { try { Keenple.Wallet.refresh(); } catch (e) {} }
        }
      });

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
          refreshCustomActions();
          updateHudTurn();
        }
      });

      mp.onServer('syncState', (data) => {
        if (data.state) {
          state = (typeof data.state === 'string' && MOD.deserialize) ? MOD.deserialize(data.state) : data.state;
          currentTurn = state.currentTurn || state.turn;
          if (config.board.render) config.board.render(state, api);
          refreshCustomActions();
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
    // 한국어 조사 자동 선택 (받침 유무로 은/는, 이/가, 을/를 선택)
    function josa(word, withBatchim, withoutBatchim) {
      if (!word) return withBatchim;
      var last = word.charCodeAt(word.length - 1);
      if (last >= 0xAC00 && last <= 0xD7A3) {
        return (last - 0xAC00) % 28 === 0 ? withoutBatchim : withBatchim;
      }
      return withBatchim;  // 한글 아니면 기본
    }

    function requireLogin(actionLabel) {
      var label = actionLabel || '이 기능';
      api.showToast({
        ko: label + josa(label, '은', '는') + ' 로그인 후 이용 가능합니다',
        en: 'Login required — ' + (actionLabel || 'this feature'),
      }, { type: 'info' });
    }

    function buildLobbyButtons() {
      const buttons = [];
      const loggedIn = !!_userId;
      if (modes.mp && modes.mp.enabled !== false) {
        const createLabel = !loggedIn
          ? { ko: '방 만들기 🔒', en: 'Create Room 🔒' }
          : defaultEntryFee > 0
          ? { ko: '방 만들기 · ' + defaultEntryFee + ' coin', en: 'Create Room · ' + defaultEntryFee + ' coin' }
          : { ko: '방 만들기', en: 'Create Room' };
        buttons.push({
          id: 'create',
          label: createLabel,
          primary: true,
          onClick: () => loggedIn ? openRoomOptions('create') : requireLogin('방 만들기'),
        });
        if (modes.mp.rankMatch) {
          const rankLabel = !loggedIn
            ? { ko: '랭크 매칭 🔒', en: 'Ranked Match 🔒' }
            : defaultEntryFee > 0
            ? { ko: '랭크 매칭 · ' + defaultEntryFee + ' coin', en: 'Ranked Match · ' + defaultEntryFee + ' coin' }
            : { ko: '랭크 매칭', en: 'Ranked Match' };
          buttons.push({
            id: 'rank',
            label: rankLabel,
            onClick: () => loggedIn ? handleRankMatch() : requireLogin('랭크 매칭'),
          });
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
      if (defaultEntryFee > 0 && _coinBalance != null && _coinBalance < defaultEntryFee) {
        showInsufficientCoinsModal(defaultEntryFee, _coinBalance);
        return;
      }
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
      if (!getKeenpleUserId()) { requireLogin('랭크 매칭'); return; }
      if (defaultEntryFee > 0 && _coinBalance != null && _coinBalance < defaultEntryFee) {
        showInsufficientCoinsModal(defaultEntryFee, _coinBalance);
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
    let _coinBalance = null;  // null = 아직 모름 (낙관적 허용)
    let _keenBalance = null;
    function getNickname() { return _nickname; }
    function getKeenpleUserId() { return _userId; }
    function getBalance(currency) {
      return currency === 'keen' ? _keenBalance : _coinBalance;
    }
    function setBalanceLocal(currency, newVal) {
      if (currency === 'keen') _keenBalance = newVal;
      else _coinBalance = newVal;
    }

    async function refreshCoinBalance() {
      if (!_userId) { _coinBalance = null; _keenBalance = null; return; }
      try {
        if (Keenple.Wallet && Keenple.Wallet.get) {
          const w = await Keenple.Wallet.get();
          _coinBalance = (w && (w.coin != null ? w.coin : w.coinBalance)) || 0;
          _keenBalance = (w && (w.keen != null ? w.keen : w.keenBalance)) || 0;
          return;
        }
        const res = await fetch('/api/wallet', { credentials: 'include' });
        if (!res.ok) return;
        const w = await res.json();
        _coinBalance = (w.coin != null ? w.coin : w.coinBalance) || 0;
        _keenBalance = (w.keen != null ? w.keen : w.keenBalance) || 0;
      } catch (e) {}
    }

    // 코인 충분한 경우에만 onOk 실행. 부족하면 안내 모달.
    function ensureEnoughCoin(required, onOk) {
      if (!required || required <= 0) { onOk(); return; }
      if (_coinBalance == null) { onOk(); return; }  // 잔액 미확인 → 낙관적 허용 (서버가 최종 방어)
      if (_coinBalance >= required) { onOk(); return; }
      showInsufficientCoinsModal(required, _coinBalance);
    }

    function showInsufficientCoinsModal(required, current) {
      showInsufficientModal(required, current, 'coin');
    }
    function showInsufficientModal(required, current, currency) {
      currency = currency || 'coin';
      var title = currency === 'keen' ? t('Keen 부족', 'Not Enough Keen') : t('코인 부족', 'Not Enough Coins');
      var overlay = document.createElement('div');
      overlay.className = 'keenple-fee-confirm-overlay keenple-fee-insufficient';
      overlay.innerHTML =
        '<div class="keenple-fee-confirm-card">' +
          '<div class="keenple-fee-confirm-icon">🪙</div>' +
          '<div class="keenple-fee-confirm-title">' + title + '</div>' +
          '<div class="keenple-fee-confirm-msg">' +
            '<b>' + required + ' ' + currency + '</b>' + t('이 필요합니다.', ' required.') + '<br>' +
            t('현재 보유', 'You have') + ': <b>' + current + ' ' + currency + '</b>' +
          '</div>' +
          '<div class="keenple-fee-confirm-buttons">' +
            '<button class="keenple-fee-confirm-cancel">' + t('확인', 'OK') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var close = function () { overlay.classList.add('keenple-fee-confirm-out'); setTimeout(function () { overlay.remove(); }, 200); };
      overlay.querySelector('.keenple-fee-confirm-cancel').onclick = close;
      overlay.onclick = function (e) { if (e.target === overlay) close(); };
      requestAnimationFrame(function () { overlay.classList.add('keenple-fee-confirm-in'); });
    }

    // ── 부트스트랩 ────────────────────────────
    async function bootstrap() {
      try {
        if (typeof Keenple === 'undefined') throw new Error('Keenple SDK 미로드');
        if (!Keenple.UI || !Keenple.UI.Lobby) throw new Error('Keenple.UI.Lobby 없음');
        if (typeof GameClient === 'undefined') console.warn('[shell] GameClient 미정의 — MP 비활성');
        const user = await Keenple.getUser();
        if (user) { _nickname = user.nickname; _userId = user.id; }
      } catch (e) { showShellError('bootstrap-prechecks', e); }

      // 코인 잔액 초기 조회
      if (defaultEntryFee > 0) refreshCoinBalance();
      // wallet-changed 구독 — 사운드 재생 + (입장료 있는 게임은) 잔액 갱신.
      // 사운드는 모든 게임에 적용 (defaultEntryFee와 무관 — item_purchase는 입장료 없는 게임에서도 발생).
      addShellListener(window, 'keenple:wallet-changed', (e) => {
        const detail = (e && e.detail) || {};
        if (detail.mock) return;
        // shared 소유 wallet 사운드 (v2.16.0+)
        try {
          if (detail.reason === 'entry_fee') _audio.playEntryFee();
          else if (detail.reason === 'refund') _audio.playRefund();
          else if (detail.reason === 'item_purchase') {
            const variant = detail.sound || (config.audio && config.audio.purchaseSound) || 'coin';
            _audio.playItemPurchase(variant);
          }
        } catch (err) { console.warn('[KeenpleShell] wallet sound 재생 실패', err); }
        if (defaultEntryFee > 0) refreshCoinBalance();
      });

      try {
      lobbyApi = Keenple.UI.Lobby({
        mount: '#lobby-mount',
        title: GAME_NAME,
        buttons: buildLobbyButtons(),
        joinInput: (modes.mp && modes.mp.enabled !== false)
          ? { enabled: true, onJoin: (code) => _userId ? joinRoomWithConfirm(code, defaultEntryFee) : requireLogin('방 참가') }
          : undefined,
        roomList: (modes.mp && modes.mp.enabled !== false)
          ? {
              enabled: true,
              fetchRooms: () => fetch('api/rooms').then(r => r.json()).catch(() => []),
              pollInterval: 10000,
              onRoomClick: (r) => _userId
                ? joinRoomWithConfirm(r.code, r.entryFee != null ? r.entryFee : defaultEntryFee)
                : requireLogin('방 참가'),
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

    addShellListener(window, 'keenple:langchange', () => {
      try {
        if (state && config.board.render) config.board.render(state, api);
        refreshCustomActions();
      }
      catch (e) { showShellError('langchange-render', e); }
    });

    // ── 탭 닫기·새로고침·뒤로가기 시 자동 항복 (MP만) ──
    function tryAutoSurrender() {
      if (mode !== 'mp' || gameOver || !mp || !mp.surrender) return;
      try { mp.surrender(); } catch (e) {}
    }
    addShellListener(window, 'beforeunload', tryAutoSurrender);
    addShellListener(window, 'pagehide', tryAutoSurrender);  // 모바일 safari 등

    bootstrap().catch(e => showShellError('bootstrap', e));

    // destroy(opts?)
    //   opts.removeDom === true → shell이 mount한 body-level DOM 전체 철거
    //   (pre-lobby 메뉴로 복귀하는 경로에서 사용. v2.17.0+)
    function destroy(opts) {
      opts = opts || {};
      try { backToLobby(); } catch (e) {}
      removeShellListeners();
      if (opts.removeDom) {
        const ids = [
          'keenple-game-area',
          'keenple-ai-picker',
          'keenple-room-options',
          'keenple-disconnect-overlay',
          'keenple-spectator-banner',
          'keenple-back-to-menu-btn',
          'keenple-shell-error',
        ];
        for (const id of ids) {
          const node = document.getElementById(id);
          if (node && node.parentNode) node.parentNode.removeChild(node);
        }
        if (lobbyApi && typeof lobbyApi.destroy === 'function') {
          try { lobbyApi.destroy(); } catch (e) {}
        }
      }
    }

    return {
      getState: () => state,
      getMode: () => mode,
      backToLobby,
      destroy,
      _api: api,
    };
  }

  // ============================================
  //  Game Menu — 모드 선택 카드 UI (v2.14.0)
  // ============================================
  // 여러 변형/모드를 가진 게임의 루트 페이지용.
  // 각 카드 클릭 → href로 이동 (MPA) 또는 onClick 콜백 (SPA).
  // 모드별 페이지에서 createTurnBased를 각각 호출하는 구조.
  function createGameMenu(config) {
    if (!config || !config.title) throw new Error('[KeenpleShell] createGameMenu: config.title 필수');
    if (!Array.isArray(config.modes) || config.modes.length === 0) {
      throw new Error('[KeenpleShell] createGameMenu: config.modes (배열, 1개 이상) 필수');
    }

    var mount = config.mount
      ? (typeof config.mount === 'string' ? document.querySelector(config.mount) : config.mount)
      : document.body;

    // SDK TopBar 자동 구성
    if (typeof Keenple !== 'undefined' && Keenple.UI) {
      if (Keenple.UI.setTheme && config.theme) Keenple.UI.setTheme(config.theme);
      if (Keenple.UI.TopBar) Keenple.UI.TopBar({ gameName: config.title });
    }

    // 타이틀
    document.title = t(config.title.ko, config.title.en);

    var container = el('div', { class: 'keenple-game-menu' }, [
      el('h1', {
        class: 'keenple-game-menu-title',
        dataKo: config.title.ko,
        dataEn: config.title.en,
      }, config.title.ko),
      buildCards(config.modes),
    ]);

    mount.appendChild(container);

    function buildCards(modes) {
      var grid = el('div', { class: 'keenple-game-menu-cards' });
      modes.forEach(function (m) {
        if (!m.title) return;
        var titleEl = el('h2', {
          dataKo: m.title.ko, dataEn: m.title.en,
        }, m.title.ko);
        var descEl = m.description
          ? el('p', { dataKo: m.description.ko, dataEn: m.description.en }, m.description.ko)
          : null;
        var badgeEl = m.badge
          ? el('span', { class: 'keenple-game-menu-badge', dataKo: m.badge.ko, dataEn: m.badge.en }, m.badge.ko)
          : null;

        var tag = m.href ? 'a' : 'div';
        var attrs = { class: 'keenple-game-menu-card' };
        if (m.href) attrs.href = m.href;
        if (m.disabled) attrs.class += ' keenple-game-menu-card-disabled';

        var card = el(tag, attrs, [badgeEl, titleEl, descEl].filter(Boolean));

        if (!m.href && typeof m.onClick === 'function') {
          card.style.cursor = 'pointer';
          card.addEventListener('click', function () { if (!m.disabled) m.onClick(m); });
        }
        if (m.disabled) card.style.pointerEvents = 'none';

        grid.appendChild(card);
      });
      return grid;
    }

    // 한/영 전환 대응
    function onLangChange() {
      document.title = t(config.title.ko, config.title.en);
    }
    window.addEventListener('keenple:langchange', onLangChange);

    return {
      destroy: function () {
        window.removeEventListener('keenple:langchange', onLangChange);
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  const KeenpleShell = { createTurnBased, createGameMenu };
  if (typeof module === 'object' && module.exports) module.exports = KeenpleShell;
  else root.KeenpleShell = KeenpleShell;

})(typeof self !== 'undefined' ? self : this);
