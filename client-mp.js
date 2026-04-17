/**
 * Keenple Multiplayer Client
 *
 * 브라우저에서 Socket.io를 통해 멀티플레이어 서버에 연결하는 헬퍼 클래스.
 * 방 생성/입장, 재연결 자동 처리, 연결 상태 콜백 제공.
 *
 * 사용법:
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/multiplayer/client-mp.js"></script>
 *   <script>
 *     const mp = new GameClient();
 *     mp.connect();
 *     mp.createRoom({ maxPlayers: 4 });
 *     mp.on('gameStart', (data) => { ... });
 *     mp.send('move', { x: 1, y: 2 });
 *   </script>
 */

class GameClient {
  constructor(options = {}) {
    this.socket = null;
    this.playerId = null;
    this.roomCode = null;
    this.role = null;
    this.connected = false;
    this.reconnecting = false;

    this._listeners = {};  // event -> [callback]
    this._options = options;

    // sessionStorage 키 접두사 (여러 게임이 같은 도메인에서 동작할 때 충돌 방지)
    this._storagePrefix = options.storagePrefix || 'mp_';
  }

  // ─── 연결 ──────────────────────────────────────────────────

  /**
   * 서버에 소켓 연결
   * @param {object} socketOptions - Socket.io 연결 옵션 (선택)
   */
  connect(socketOptions = {}) {
    if (this.socket && this.socket.connected) return;

    // Socket.io 경로 자동 감지
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const gamePath = this._options.gamePath || '';
    const defaultSioPath = isLocal ? '/socket.io' : (gamePath ? `/${gamePath}/socket.io` : '/socket.io');

    const sioOptions = {
      path: socketOptions.path || defaultSioPath,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      ...socketOptions,
    };

    try {
      this.socket = io(sioOptions);
    } catch (e) {
      this._emit('error', { message: 'Failed to connect to server', error: e });
      return;
    }

    this._setupSocketListeners();
  }

  /**
   * 연결 해제
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.playerId = null;
    this.roomCode = null;
    this.role = null;
    this._clearSession();
  }

  // ─── 방 관리 ───────────────────────────────────────────────

  /**
   * 새 방 생성
   * @param {object} options - 방 옵션 (게임별 커스텀 설정)
   * @param {string} nickname - 플레이어 닉네임
   */
  createRoom(options = {}, nickname = null, keenpleUserId = null) {
    if (!this.socket || !this.socket.connected) {
      this._emit('error', { message: '서버에 연결되지 않았습니다' });
      return;
    }
    this.socket.emit('mp:createRoom', {
      playerId: this._loadPlayerId(),
      nickname,
      keenpleUserId,
      options,
    });
  }

  /**
   * 기존 방 입장
   * @param {string} roomCode - 6자리 방 코드
   * @param {string} nickname - 플레이어 닉네임
   * @param {number} keenpleUserId - Keenple 유저 ID (ELO 보고용, 선택)
   */
  joinRoom(roomCode, nickname = null, keenpleUserId = null) {
    if (!this.socket || !this.socket.connected) {
      this._emit('error', { message: '서버에 연결되지 않았습니다' });
      return;
    }
    this.socket.emit('mp:joinRoom', {
      roomCode: roomCode.toUpperCase(),
      playerId: this._loadPlayerId(),
      nickname,
      keenpleUserId,
    });
  }

  /**
   * 게임 시작 요청 (방장 전용)
   * @param {object} data - 시작 시 추가 데이터
   */
  startGame(data = {}) {
    if (!this.socket) return;
    this.socket.emit('mp:startGame', data);
  }

  /**
   * 커스텀 게임 이벤트 전송
   * @param {string} event - 이벤트 이름
   * @param {object} payload - 이벤트 데이터
   */
  send(event, payload = {}) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('mp:game', { event, payload });
  }

  /**
   * 항복
   */
  surrender() {
    if (!this.socket) return;
    this.socket.emit('mp:surrender');
  }

  // ─── 이벤트 리스너 ────────────────────────────────────────

  /**
   * 이벤트 리스너 등록
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 콜백 함수
   */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  }

  /**
   * 이벤트 리스너 제거
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 제거할 콜백 (생략 시 해당 이벤트 전체 제거)
   */
  off(event, callback) {
    if (!callback) {
      delete this._listeners[event];
    } else if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
    return this;
  }

  // ─── 내부 메서드 ──────────────────────────────────────────

  _emit(event, data) {
    const handlers = this._listeners[event];
    if (handlers) {
      handlers.forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[GameClient] Error in ${event} handler:`, e); }
      });
    }
  }

  _setupSocketListeners() {
    const s = this.socket;

    s.on('connect', () => {
      this.connected = true;
      this._emit('connected');

      // 재연결 시도
      const savedPid = this._loadPlayerId();
      const savedRoom = this._loadRoomCode();
      if (savedPid && savedRoom) {
        this.reconnecting = true;
        this._emit('reconnecting', { roomCode: savedRoom });
        s.emit('mp:joinRoom', {
          roomCode: savedRoom,
          playerId: savedPid,
          nickname: this._options.nickname || null,
        });
      }

      // URL room 파라미터 자동 입장
      if (!savedRoom) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam && roomParam.length === 6) {
          this.joinRoom(roomParam, this._options.nickname);
          const url = new URL(window.location);
          url.searchParams.delete('room');
          window.history.replaceState({}, '', url);
        }
      }
    });

    s.on('connect_error', (err) => {
      this._emit('connectionError', { message: err.message, error: err });
    });

    s.io.on('reconnect_failed', () => {
      this._emit('reconnectFailed', { message: '서버 재연결에 실패했습니다' });
    });

    s.on('disconnect', (reason) => {
      this.connected = false;
      this._emit('disconnected', { reason });
    });

    // 방 생성 완료
    s.on('roomCreated', (data) => {
      this.playerId = data.playerId;
      this.roomCode = data.roomCode;
      this.role = data.role;
      this._saveSession(data.playerId, data.roomCode);
      this.reconnecting = false;
      this._emit('roomCreated', data);
    });

    // 방 입장 완료 (새 입장 + 재연결)
    s.on('roomJoined', (data) => {
      this.playerId = data.playerId;
      this.roomCode = data.roomCode;
      this.role = data.role;
      this._saveSession(data.playerId, data.roomCode);

      if (data.reconnected) {
        this.reconnecting = false;
        this._emit('reconnected', data);
      }
      this._emit('roomJoined', data);
    });

    // 서버에서 오는 이벤트들 (직접 전달)
    const passthroughEvents = [
      'playerJoined',
      'playerDisconnected',
      'playerReconnected',
      'readyToStart',
      'gameStart',
      'gameOver',
      'spectatorJoined',
      'error',
    ];

    passthroughEvents.forEach(event => {
      s.on(event, (data) => this._emit(event, data));
    });

    // entryFeeError: 서버가 입장료 차감 실패 시 emit (wallet_unavailable/login_required/insufficient_funds).
    // 저수준 client-mp 직접 사용 시 리스너를 안 달면 게임 시작이 조용히 막혀 사용자에게 "멈춘 것처럼" 보임.
    // 고수준 shell(turn-based.js)은 이미 핸들러를 붙이지만, 저수준 사용자를 위해 안전장치 1회 경고.
    s.on('entryFeeError', (data) => {
      this._emit('entryFeeError', data);
      const passthroughCount = (this._listeners['entryFeeError'] || []).length;
      const socketCount = (s.listeners('entryFeeError') || []).length - 1;  // 본 핸들러 제외
      if (passthroughCount + socketCount === 0) {
        const reason = (data && data.error) || 'unknown';
        console.warn(
          '[GameClient] entryFeeError(' + reason + ') 수신했지만 리스너 없음. ' +
          'mp.on("entryFeeError", handler) 또는 mp.onServer("entryFeeError", ...)로 등록해 토스트/모달 안내를 띄우세요. ' +
          '미등록 시 서버가 게임 시작을 막아도 사용자에게 피드백이 없어 "멈춘 것처럼" 보입니다. ' +
          '서버 emit 분기: wallet_unavailable | login_required | insufficient_funds(required=숫자).'
        );
      }
    });
  }

  // ─── 세션 저장/복원 ───────────────────────────────────────

  _getTabId() {
    try {
      let tabId = sessionStorage.getItem(this._storagePrefix + 'tabId');
      if (!tabId) {
        tabId = 'tab_' + Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem(this._storagePrefix + 'tabId', tabId);
      }
      return tabId;
    } catch (e) { return 'default'; }
  }

  _saveSession(pid, roomCode) {
    try {
      localStorage.setItem(this._storagePrefix + 'playerId', pid);
      localStorage.setItem(this._storagePrefix + 'roomCode', roomCode);
      localStorage.setItem(this._storagePrefix + 'tabId', this._getTabId());
    } catch (e) { /* 불가 환경 무시 */ }
  }

  _loadPlayerId() {
    try {
      // 다른 탭이 세션을 가져갔으면 무시
      const savedTab = localStorage.getItem(this._storagePrefix + 'tabId');
      if (savedTab && savedTab !== this._getTabId()) return this.playerId;
      return localStorage.getItem(this._storagePrefix + 'playerId') || this.playerId;
    } catch (e) { return this.playerId; }
  }

  _loadRoomCode() {
    try {
      const savedTab = localStorage.getItem(this._storagePrefix + 'tabId');
      if (savedTab && savedTab !== this._getTabId()) return null;
      return localStorage.getItem(this._storagePrefix + 'roomCode') || null;
    } catch (e) { return null; }
  }

  _clearSession() {
    try {
      localStorage.removeItem(this._storagePrefix + 'playerId');
      localStorage.removeItem(this._storagePrefix + 'roomCode');
    } catch (e) { /* 무시 */ }
  }

  /**
   * 세션 초기화 (새 게임 시작 시 호출)
   */
  clearSession() {
    this._clearSession();
    this.roomCode = null;
    this.role = null;
  }

  // ─── 커스텀 서버 이벤트 수신 등록 ─────────────────────────

  /**
   * 서버에서 보내는 커스텀 이벤트 직접 수신
   * (서버에서 broadcastToRoom/broadcastToAll로 보낸 이벤트)
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 콜백 함수
   */
  onServer(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
    return this;
  }

  /**
   * 서버 커스텀 이벤트 수신 해제
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 콜백 함수
   */
  offServer(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
    return this;
  }
}

// UMD export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameClient };
} else if (typeof window !== 'undefined') {
  window.GameClient = GameClient;
}
