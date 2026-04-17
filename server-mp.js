/**
 * Keenple Multiplayer Server Module
 *
 * 범용 멀티플레이어 서버. 방 생성/입장/퇴장, 재연결, 관전자, 게임 상태 관리 제공.
 * 게임 규칙에 종속되지 않으며, 턴제/실시간/다인원 모두 지원.
 *
 * 사용법:
 *   const { createMultiplayerServer } = require('./multiplayer/server-mp');
 *   const mp = createMultiplayerServer(io, { minPlayers: 2, maxPlayers: 4 });
 *   mp.onGameEvent('move', (room, player, data) => { ... });
 */

function createMultiplayerServer(io, options = {}) {
  const {
    minPlayers = 2,
    maxPlayers = 2,
    roles = null,               // 예: ['red','blue','green','yellow'], null이면 자동 생성
    reconnectTimeout = 30000,   // 재연결 대기 (ms)
    roomExpiry = 600000,        // 방 만료 (ms, 기본 10분)
    roomCodeLength = 6,
    entryFee = 0,               // 기본 입장료 (coin). 0이면 무료. 방 옵션으로 덮어쓰기 가능.
    gameId = null,              // wallet spend에 사용할 게임 식별자
    // 랭크 매칭 자동 리포트.
    //   enabled: true로 켜면 room.matched 방이 끝날 때 자동으로 main에 결과 전송
    //   buildReport(room, endData) → main에 보낼 payload (게임별 포맷)
    //   dispatchUpdate(room, response) → main 응답을 플레이어별 eloUpdate 이벤트로 매핑
    //   endpoint → main 측 경로 (기본 '/api/match/result')
    rankMatch = null,
    // 입장료 종료 시 정산 정책.
    //   'sink' — 환불 없음 (입장료는 플랫폼 귀속)
    //   'refund-on-abort' — 기본. endData.aborted === true 일 때만 양쪽 환불
    //                       (서버/네트워크 오류 등으로 게임이 제대로 진행 못한 경우)
    //   'refund-all' — 항상 양쪽 환불 (예: 테스트·친선전)
    //   function(room, endData) → [{role, amount, reason}] — 커스텀
    payoutPolicy = 'refund-on-abort',
  } = options;

  // 입장료 기능 시 wallet-client 지연 로드
  let wallet = null;
  function getWallet() {
    if (!wallet) {
      try { wallet = require('./wallet-client'); }
      catch (e) { console.error('[MP] wallet-client 로드 실패:', e.message); }
    }
    return wallet;
  }

  // 랭크 매치 결과 보고 (room.matched 방이 끝날 때 자동, 또는 mp.reportMatch 수동)
  async function reportMatch(room, endData) {
    if (!rankMatch || !rankMatch.enabled) return null;
    if (typeof rankMatch.buildReport !== 'function') {
      console.warn('[MP] rankMatch.buildReport 미정의 — skip');
      return null;
    }
    const payload = rankMatch.buildReport(room, endData || {});
    if (!payload) return null;
    const endpoint = rankMatch.endpoint || '/api/match/result';
    // /api/* → /api/v1/* 자동 라우팅 (이미 /api/v로 시작하면 그대로). main이 /api/* alias 유지 중이라 fail-safe.
    const routedEndpoint = (endpoint.indexOf('/api/') === 0 && endpoint.indexOf('/api/v') !== 0)
      ? '/api/v1' + endpoint.substring(4)
      : endpoint;
    const baseUrl = process.env.KEENPLE_MAIN_URL || 'http://localhost:3100';
    const secret = process.env.GAME_SERVER_SECRET;
    if (!secret) {
      console.warn('[MP] GAME_SERVER_SECRET 미설정 — rankMatch 보고 skip');
      return null;
    }
    try {
      const res = await fetch(baseUrl + routedEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[MP] rankMatch 보고 실패:', res.status, data);
        return null;
      }
      if (typeof rankMatch.dispatchUpdate === 'function') {
        const updates = rankMatch.dispatchUpdate(room, data) || [];
        for (const u of updates) {
          const p = room.players.find(pp => pp.role === u.role);
          if (p && p.connected) io.to(p.socketId).emit('eloUpdate', u.payload);
        }
      }
      return data;
    } catch (e) {
      console.error('[MP] rankMatch 보고 에러:', e.message);
      return null;
    }
  }

  // 역할 자동 생성
  const playerRoles = roles || Array.from({ length: maxPlayers }, (_, i) => `player${i + 1}`);

  const rooms = new Map();
  const gameEventHandlers = new Map();  // eventName -> handler(room, player, data)
  const lifecycleHandlers = {};         // onPlayerJoin, onPlayerLeave, onRoomCreated, etc.

  function callLifecycle(name, ...args) {
    const handlers = lifecycleHandlers[name];
    if (!handlers) return;
    let result;
    for (const handler of handlers) {
      try { result = handler(...args); }
      catch (err) { console.error(`[MP] lifecycle "${name}" error:`, err.message); }
    }
    return result;
  }

  // ─── 유틸리티 ───────────────────────────────────────────────

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < roomCodeLength; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms.has(code) ? generateRoomCode() : code;
  }

  function generatePlayerId() {
    return 'p_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  function getRoom(code) {
    return rooms.get(code) || null;
  }

  function getRoomByPlayerId(pid) {
    for (const room of rooms.values()) {
      if (room.players.some(p => p.id === pid)) return room;
    }
    return null;
  }

  // ─── 방 관리 ───────────────────────────────────────────────

  function createRoom(options = {}) {
    // 매칭 시스템에서 preferredCode를 지정하면 그 코드를 사용 (이미 존재하면 대신 신규 생성)
    let code = options.preferredCode && !rooms.has(options.preferredCode)
      ? options.preferredCode
      : generateRoomCode();
    const room = {
      code,
      players: [],          // [{id, socketId, role, connected, nickname, data}]
      spectators: [],       // [{id, socketId, nickname}]
      gameState: {},        // 개발자가 자유롭게 사용하는 게임 상태 객체
      gameStarted: false,
      gameOver: false,
      options: options,     // 방 생성 시 전달한 커스텀 옵션
      createdAt: Date.now(),
      disconnectTimers: new Map(),
      _cleanupTimer: null,
      _idleTimer: null,
    };

    rooms.set(code, room);

    // 방 만료 타이머 (게임 시작 전)
    room._idleTimer = setTimeout(() => {
      if (!room.gameStarted) {
        destroyRoom(code, 'idle');
      }
    }, roomExpiry);

    return room;
  }

  function destroyRoom(code, reason = 'cleanup') {
    const room = rooms.get(code);
    if (!room) return;

    if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
    if (room._idleTimer) clearTimeout(room._idleTimer);
    room.disconnectTimers.forEach(t => clearTimeout(t));

    rooms.delete(code);
    console.log(`[MP] Room destroyed: ${code} (${reason})`);
  }

  function scheduleRoomCleanup(code, delayMs = 300000) {
    const room = rooms.get(code);
    if (!room || room._cleanupTimer) return;
    room._cleanupTimer = setTimeout(() => {
      destroyRoom(code, 'timeout');
    }, delayMs);
  }

  // ─── 브로드캐스트 ──────────────────────────────────────────

  function broadcastToRoom(room, event, data, excludeSocketId = null) {
    room.players.forEach(p => {
      if (p.connected && p.socketId !== excludeSocketId) {
        io.to(p.socketId).emit(event, data);
      }
    });
  }

  function broadcastToAll(room, event, data) {
    room.players.forEach(p => {
      if (p.connected) io.to(p.socketId).emit(event, data);
    });
    room.spectators.forEach(s => {
      io.to(s.socketId).emit(event, data);
    });
  }

  function broadcastToSpectators(room, event, data) {
    room.spectators.forEach(s => {
      io.to(s.socketId).emit(event, data);
    });
  }

  function sendToPlayer(room, role, event, data) {
    const player = room.players.find(p => p.role === role);
    if (player && player.connected) {
      io.to(player.socketId).emit(event, data);
    }
  }

  function sendToSocket(socketId, event, data) {
    io.to(socketId).emit(event, data);
  }

  // ─── 게임 흐름 ─────────────────────────────────────────────

  // 입장료 차감 (양쪽 플레이어 coin). 성공 시 true.
  // rematch 등 재시작 상황에서도 재차감되도록 매 시작마다 호출.
  async function tryDeductEntryFees(room) {
    const fee = (room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
    if (fee <= 0) return true;
    const w = getWallet();
    if (!w) {
      room.players.forEach(p => { if (p.connected) io.to(p.socketId).emit('entryFeeError', { error: 'wallet_unavailable' }); });
      return false;
    }
    // 매 게임 시작마다 고유 키 (rematch도 새 차감이 되어야 함)
    const startSeq = (room._startSeq = (room._startSeq || 0) + 1);
    for (const p of room.players) {
      if (!p.keenpleUserId) {
        if (p.connected) io.to(p.socketId).emit('entryFeeError', { error: 'login_required' });
        return false;
      }
      const result = await w.spend({
        userId: p.keenpleUserId,
        currency: 'coin',
        amount: fee,
        type: 'entry_fee',
        gameId: gameId || 'unknown',
        refType: 'room',
        refId: room.code,
        idempotencyKey: 'entry-' + room.code + '-' + startSeq + '-' + p.keenpleUserId,
      });
      if (!result.ok) {
        if (p.connected) io.to(p.socketId).emit('entryFeeError', { error: 'insufficient_funds', required: fee });
        return false;
      }
    }
    room._hasUnsettledFees = true;
    room._lastChargedFee = fee;
    return true;
  }

  // 입장료 정산 (환불/지급) — payoutPolicy에 따라
  async function processPayout(room, endData) {
    if (!room._hasUnsettledFees) return;
    room._hasUnsettledFees = false;   // 중복 실행 방지
    const feeCharged = room._lastChargedFee || 0;
    if (feeCharged <= 0) return;

    let payouts = [];
    if (payoutPolicy === 'sink') {
      payouts = [];
    } else if (payoutPolicy === 'refund-on-abort') {
      if (endData && endData.aborted === true) {
        payouts = room.players.map(p => ({ role: p.role, amount: feeCharged, reason: 'abort_refund' }));
      }
    } else if (payoutPolicy === 'refund-all') {
      payouts = room.players.map(p => ({ role: p.role, amount: feeCharged, reason: 'refund' }));
    } else if (typeof payoutPolicy === 'function') {
      try { payouts = payoutPolicy(room, endData || {}) || []; }
      catch (e) { console.error('[MP] payoutPolicy 함수 에러:', e.message); payouts = []; }
    }
    if (!payouts.length) return;

    const w = getWallet();
    if (!w) return;

    const seq = room._startSeq || 1;
    for (const po of payouts) {
      const p = room.players.find(pp => pp.role === po.role);
      if (!p || !p.keenpleUserId) continue;
      const amount = po.amount;
      if (!amount || amount <= 0) continue;
      const key = 'payout-' + room.code + '-' + seq + '-' + p.keenpleUserId;
      try {
        const result = await w.refund({
          userId: p.keenpleUserId,
          currency: 'coin',
          amount,
          refType: 'room',
          refId: room.code,
          gameId: gameId || 'unknown',
          reason: po.reason || 'payout',
          idempotencyKey: key,
        });
        if (result && result.ok && p.connected) {
          io.to(p.socketId).emit('payoutResult', { amount, reason: po.reason, balanceAfter: result.balanceAfter });
        }
      } catch (e) {
        console.error('[MP] payout 에러:', e.message);
      }
    }
  }

  function buildServerConfig(room) {
    const fee = (room && room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
    return {
      entryFee: fee,
      rankMatch: !!(rankMatch && rankMatch.enabled),
      payoutPolicy: typeof payoutPolicy === 'function' ? 'custom' : payoutPolicy,
      minPlayers,
      maxPlayers,
    };
  }

  async function startGame(room) {
    if (room._idleTimer) { clearTimeout(room._idleTimer); room._idleTimer = null; }

    // 입장료 차감 (rematch 포함 — 매번 재차감)
    const feesOk = await tryDeductEntryFees(room);
    if (!feesOk) return false;

    room.gameStarted = true;
    room.gameOver = false;

    const startFee = (room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
    const startData = {
      players: room.players.map(p => ({ role: p.role, nickname: p.nickname })),
      gameState: room.gameState,
      options: room.options,
      entryFee: startFee,
      serverConfig: buildServerConfig(room),
    };

    room.players.forEach(p => {
      if (p.connected) {
        io.to(p.socketId).emit('gameStart', {
          ...startData,
          yourRole: p.role,
        });
      }
    });

    room.spectators.forEach(s => {
      io.to(s.socketId).emit('gameStart', {
        ...startData,
        yourRole: 'spectator',
      });
    });

    console.log(`[MP] Game started: ${room.code}`);
    callLifecycle('onAfterGameStart', room);
  }

  function endGame(room, data = {}) {
    room.gameOver = true;
    broadcastToAll(room, 'gameOver', data);
    callLifecycle('onAfterEndGame', room, data);
    // 랭크 매치 자동 보고 (room.matched 방만)
    if (room.matched && rankMatch && rankMatch.enabled) {
      reportMatch(room, data).catch(err => console.error('[MP] reportMatch:', err.message));
    }
    // 입장료 정산 (policy에 따라 환불·지급·sink)
    if (room._hasUnsettledFees) {
      processPayout(room, data).catch(err => console.error('[MP] processPayout:', err.message));
    }
    scheduleRoomCleanup(room.code);
    console.log(`[MP] Game over: ${room.code}`);
  }

  // 편의 메서드: 서버 오류·강제 중단 시 환불과 함께 종료
  function abortGame(room, reasonOrData) {
    const data = typeof reasonOrData === 'string'
      ? { aborted: true, reason: reasonOrData }
      : Object.assign({ aborted: true }, reasonOrData || {});
    endGame(room, data);
  }

  // ─── 이벤트 등록 ───────────────────────────────────────────

  function onGameEvent(eventName, handler) {
    gameEventHandlers.set(eventName, handler);
  }

  function onLifecycle(eventName, handler) {
    if (!lifecycleHandlers[eventName]) lifecycleHandlers[eventName] = [];
    lifecycleHandlers[eventName].push(handler);
  }

  // ─── Socket.io 연결 처리 ───────────────────────────────────

  io.on('connection', (socket) => {
    let playerId = null;
    let currentRoomCode = null;

    // 기존 방에서 나가기 (방 생성/입장 전 호출)
    function leaveCurrentRoom() {
      if (!currentRoomCode) return;
      const oldRoom = getRoom(currentRoomCode);
      if (!oldRoom) { currentRoomCode = null; return; }

      socket.leave(currentRoomCode);

      // 플레이어인지 관전자인지 확인
      const playerIdx = oldRoom.players.findIndex(p => p.id === playerId);
      if (playerIdx !== -1) {
        oldRoom.players.splice(playerIdx, 1);

        // 게임 시작 전이고 플레이어가 없으면 방 삭제
        if (oldRoom.players.length === 0) {
          destroyRoom(currentRoomCode, 'empty');
        } else if (!oldRoom.gameStarted) {
          // 대기 중인 방에서 나감을 알림
          broadcastToRoom(oldRoom, 'playerLeft', {
            playerCount: oldRoom.players.length,
          });
        }
      } else {
        oldRoom.spectators = oldRoom.spectators.filter(s => s.id !== playerId);
      }

      currentRoomCode = null;
    }

    // 방 생성
    socket.on('mp:createRoom', (data = {}, callback) => {
      leaveCurrentRoom();
      const room = createRoom(data.options || {});
      playerId = data.playerId || generatePlayerId();
      currentRoomCode = room.code;

      const role = playerRoles[0];
      room.players.push({
        id: playerId,
        socketId: socket.id,
        role,
        connected: true,
        nickname: data.nickname || null,
        keenpleUserId: data.keenpleUserId || null,
        data: {},  // 플레이어별 커스텀 데이터
      });

      // 매칭 시스템 표시 (ELO 보고 대상 판단용)
      if (data.options && data.options.matched) {
        room.matched = true;
      }

      socket.join(room.code);

      const roomFee = (room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
      const response = {
        roomCode: room.code,
        playerId,
        role,
        minPlayers,
        maxPlayers,
        entryFee: roomFee,
        serverConfig: buildServerConfig(room),
      };

      socket.emit('roomCreated', response);
      if (typeof callback === 'function') callback(response);

      callLifecycle('onRoomCreated', room, room.players[0]);

      console.log(`[MP] Room created: ${room.code} by ${playerId} (${role})${room.matched ? ' [MATCHED]' : ''}`);
    });

    // 방 입장
    socket.on('mp:joinRoom', (data = {}, callback) => {
      const { roomCode } = data;
      const room = getRoom(roomCode);

      if (!room) {
        const err = { message: '방을 찾을 수 없습니다' };
        socket.emit('error', err);
        if (typeof callback === 'function') callback({ error: err.message });
        return;
      }

      if (room.gameOver) {
        const err = { message: '이미 종료된 게임입니다' };
        socket.emit('error', err);
        if (typeof callback === 'function') callback({ error: err.message });
        return;
      }

      playerId = data.playerId || generatePlayerId();

      // 다른 방에 있었으면 나가기 (같은 방 재연결은 제외)
      if (currentRoomCode && currentRoomCode !== roomCode) {
        leaveCurrentRoom();
      }

      currentRoomCode = roomCode;
      socket.join(roomCode);

      // 재연결 확인
      const existingPlayer = room.players.find(p => p.id === playerId);
      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        if (data.nickname) existingPlayer.nickname = data.nickname;

        if (room._cleanupTimer) { clearTimeout(room._cleanupTimer); room._cleanupTimer = null; }
        if (room.disconnectTimers.has(playerId)) {
          clearTimeout(room.disconnectTimers.get(playerId));
          room.disconnectTimers.delete(playerId);
        }

        broadcastToRoom(room, 'playerReconnected', {
          role: existingPlayer.role,
          nickname: existingPlayer.nickname,
        }, socket.id);

        const rcFee = (room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
        const reconnectResponse = {
          playerId,
          role: existingPlayer.role,
          roomCode,
          reconnected: true,
          gameStarted: room.gameStarted,
          gameOver: room.gameOver,
          gameState: room.gameState,
          options: room.options,
          entryFee: rcFee,
          serverConfig: buildServerConfig(room),
          players: room.players.map(p => ({ role: p.role, nickname: p.nickname, connected: p.connected })),
        };

        socket.emit('roomJoined', reconnectResponse);
        if (typeof callback === 'function') callback(reconnectResponse);

        callLifecycle('onPlayerReconnect', room, existingPlayer);

        console.log(`[MP] Reconnected: ${playerId} as ${existingPlayer.role} in ${roomCode}`);
        return;
      }

      // 새 입장 - 플레이어 or 관전자
      if (room.players.length < maxPlayers) {
        const role = playerRoles[room.players.length];
        const player = {
          id: playerId,
          socketId: socket.id,
          role,
          connected: true,
          nickname: data.nickname || null,
          keenpleUserId: data.keenpleUserId || null,
          data: {},
        };
        room.players.push(player);

        const jFee = (room.options && room.options.entryFee != null) ? room.options.entryFee : entryFee;
        const joinResponse = {
          playerId,
          role,
          roomCode,
          reconnected: false,
          options: room.options,
          entryFee: jFee,
          serverConfig: buildServerConfig(room),
          players: room.players.map(p => ({ role: p.role, nickname: p.nickname, connected: p.connected })),
        };

        socket.emit('roomJoined', joinResponse);
        if (typeof callback === 'function') callback(joinResponse);

        // 다른 플레이어들에게 알림
        broadcastToRoom(room, 'playerJoined', {
          role,
          nickname: player.nickname,
          playerCount: room.players.length,
          minPlayers,
          maxPlayers,
        }, socket.id);

        callLifecycle('onPlayerJoin', room, player);

        // minPlayers 충족 시 자동 알림 (게임 시작은 개발자가 직접 호출)
        if (room.players.length >= minPlayers && !room.gameStarted) {
          broadcastToAll(room, 'readyToStart', {
            playerCount: room.players.length,
            minPlayers,
            maxPlayers,
          });
        }

        console.log(`[MP] Joined: ${playerId} as ${role} in ${roomCode} (${room.players.length}/${maxPlayers})`);
      } else {
        // 관전자
        room.spectators.push({ id: playerId, socketId: socket.id, nickname: data.nickname || null });

        const specResponse = {
          playerId,
          role: 'spectator',
          roomCode,
          gameStarted: room.gameStarted,
          gameOver: room.gameOver,
          gameState: room.gameState,
          options: room.options,
          serverConfig: buildServerConfig(room),
          players: room.players.map(p => ({ role: p.role, nickname: p.nickname, connected: p.connected })),
        };

        socket.emit('roomJoined', specResponse);
        socket.emit('spectatorJoined');
        if (typeof callback === 'function') callback(specResponse);

        console.log(`[MP] Spectator: ${playerId} in ${roomCode}`);
      }
    });

    // 게임 시작 요청 (방장 전용)
    socket.on('mp:startGame', async (data = {}) => {
      const room = getRoom(currentRoomCode);
      if (!room || room.gameStarted) return;

      const player = room.players.find(p => p.id === playerId);
      if (!player || player.role !== playerRoles[0]) return; // 방장만

      if (room.players.length < minPlayers) {
        socket.emit('error', { message: `최소 ${minPlayers}명이 필요합니다` });
        return;
      }

      const startResult = callLifecycle('onBeforeGameStart', room, data);
      if (startResult === false) return; // 시작 거부

      // 입장료 차감은 startGame 내부에서 처리됨 (rematch 등 다른 진입점도 동일)
      await startGame(room);
    });

    // 커스텀 게임 이벤트 (mp:game:이벤트명)
    socket.on('mp:game', (data = {}) => {
      const room = getRoom(currentRoomCode);
      if (!room) return;

      const player = room.players.find(p => p.id === playerId);
      if (!player) return;

      const { event, payload } = data;
      if (!event) return;

      const handler = gameEventHandlers.get(event);
      if (handler) {
        try { handler(room, player, payload || {}); }
        catch (err) { console.error(`[MP] gameEvent "${event}" error:`, err.message); }
      }
    });

    // 항복
    socket.on('mp:surrender', () => {
      const room = getRoom(currentRoomCode);
      if (!room || !room.gameStarted || room.gameOver) return;

      const player = room.players.find(p => p.id === playerId);
      if (!player) return;

      const surrenderHandled = callLifecycle('onSurrender', room, player);
      if (!lifecycleHandlers.onSurrender || lifecycleHandlers.onSurrender.length === 0) {
        endGame(room, { winner: null, reason: 'surrender', surrenderedBy: player.role });
      }
    });

    // 연결 끊김
    socket.on('disconnect', () => {
      if (!currentRoomCode || !playerId) return;
      const room = getRoom(currentRoomCode);
      if (!room) return;

      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.connected = false;

        const anyConnected = room.players.some(p => p.connected);
        if (!anyConnected) {
          if (!room.gameStarted) {
            destroyRoom(currentRoomCode, 'empty');
          } else {
            scheduleRoomCleanup(currentRoomCode);
          }
          return;
        }

        if (!room.gameOver) {
          broadcastToRoom(room, 'playerDisconnected', {
            role: player.role,
            nickname: player.nickname,
          });

          const timer = setTimeout(() => {
            room.disconnectTimers.delete(playerId);
            if (!player.connected && !room.gameOver) {
              callLifecycle('onDisconnectTimeout', room, player);
              if (!lifecycleHandlers.onDisconnectTimeout || lifecycleHandlers.onDisconnectTimeout.length === 0) {
                // 기본: 연결 끊긴 플레이어 패배
                endGame(room, {
                  winner: null,
                  reason: 'disconnect',
                  disconnectedRole: player.role,
                });
              }
            }
          }, reconnectTimeout);

          room.disconnectTimers.set(playerId, timer);
        }

        callLifecycle('onPlayerDisconnect', room, player);
      } else {
        room.spectators = room.spectators.filter(s => s.id !== playerId);
      }
    });
  });

  // ─── API 엔드포인트 (선택적) ──────────────────────────────

  function getStatusData() {
    let activeRooms = 0;
    let playersInGame = 0;
    for (const room of rooms.values()) {
      if (room.gameStarted && !room.gameOver) {
        activeRooms++;
        playersInGame += room.players.filter(p => p.connected).length;
      }
    }
    return {
      online: io.engine.clientsCount || 0,
      activeRooms,
      playersInGame,
      totalRooms: rooms.size,
    };
  }

  // ─── 공개 API ──────────────────────────────────────────────

  return {
    // 방 관리
    getRoom,
    getRoomByPlayerId,
    destroyRoom,
    rooms,

    // 게임 흐름
    startGame,
    endGame,
    abortGame,
    reportMatch,

    // 이벤트
    onGameEvent,
    onLifecycle,

    // 브로드캐스트
    broadcastToRoom,
    broadcastToAll,
    broadcastToSpectators,
    sendToPlayer,
    sendToSocket,

    // 상태 조회
    getStatusData,

    // 설정
    config: { minPlayers, maxPlayers, playerRoles, reconnectTimeout, roomExpiry, entryFee, gameId },
  };
}

module.exports = { createMultiplayerServer };
