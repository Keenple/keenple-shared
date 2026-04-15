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
  } = options;

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

  function startGame(room) {
    if (room._idleTimer) { clearTimeout(room._idleTimer); room._idleTimer = null; }
    room.gameStarted = true;
    room.gameOver = false;

    const startData = {
      players: room.players.map(p => ({ role: p.role, nickname: p.nickname })),
      gameState: room.gameState,
      options: room.options,
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
    scheduleRoomCleanup(room.code);
    console.log(`[MP] Game over: ${room.code}`);
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

      const response = {
        roomCode: room.code,
        playerId,
        role,
        minPlayers,
        maxPlayers,
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

        const reconnectResponse = {
          playerId,
          role: existingPlayer.role,
          roomCode,
          reconnected: true,
          gameStarted: room.gameStarted,
          gameOver: room.gameOver,
          gameState: room.gameState,
          options: room.options,
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

        const joinResponse = {
          playerId,
          role,
          roomCode,
          reconnected: false,
          options: room.options,
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
          players: room.players.map(p => ({ role: p.role, nickname: p.nickname, connected: p.connected })),
        };

        socket.emit('roomJoined', specResponse);
        socket.emit('spectatorJoined');
        if (typeof callback === 'function') callback(specResponse);

        console.log(`[MP] Spectator: ${playerId} in ${roomCode}`);
      }
    });

    // 게임 시작 요청 (방장 전용)
    socket.on('mp:startGame', (data = {}) => {
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

      startGame(room);
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
    config: { minPlayers, maxPlayers, playerRoles, reconnectTimeout, roomExpiry },
  };
}

module.exports = { createMultiplayerServer };
