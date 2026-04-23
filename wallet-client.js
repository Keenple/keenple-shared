// wallet-client.js
// 게임 서버 → Keenple 메인 서버 결제·재화 API 클라이언트.
// 의존성: 없음 (Node 18+ 내장 fetch만 사용).
//
// Usage:
//   const wallet = require('@keenple/shared/wallet-client');
//   const result = await wallet.spend({ userId, currency: 'coin', amount: 5, type: 'entry_fee', gameId: 'chess', refType: 'room', refId: roomCode });
//   if (!result.ok) { /* insufficient_funds 등 */ }

'use strict';

var KEENPLE_MAIN_URL = process.env.KEENPLE_MAIN_URL || 'http://localhost:3100';
var INTERNAL_SECRET = process.env.GAME_SERVER_SECRET;
var API_PREFIX = '/api/v1';
var _envWarned = false;
function warnMissingEnvOnce() {
  if (_envWarned) return;
  _envWarned = true;
  if (!process.env.KEENPLE_MAIN_URL) {
    console.warn('[wallet-client] KEENPLE_MAIN_URL 환경변수 미설정 — localhost:3100 기본값 사용. production에서는 반드시 설정 필요.');
  }
}

// /api/* → /api/v1/* 자동 라우팅. 이미 /api/v로 시작하면 그대로 (미래 v2 호환).
// main이 /api/* alias 유지 중이라 fail-safe (치환 실패해도 깨지지 않음).
function withApiPrefix(path) {
  if (typeof path !== 'string') return path;
  if (path.indexOf('/api/') !== 0) return path;
  if (path.indexOf('/api/v') === 0) return path;
  return API_PREFIX + path.substring(4);
}

function postJson(path, body, idempotencyKey) {
  warnMissingEnvOnce();
  if (!INTERNAL_SECRET) {
    return Promise.reject(new Error('GAME_SERVER_SECRET 환경변수가 필요합니다'));
  }
  var headers = {
    'Content-Type': 'application/json',
    'x-internal-secret': INTERNAL_SECRET,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  return fetch(KEENPLE_MAIN_URL + withApiPrefix(path), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  }).then(function (res) {
    return res.json().then(function (data) {
      data._status = res.status;
      return data;
    });
  });
}

function getJson(path) {
  warnMissingEnvOnce();
  if (!INTERNAL_SECRET) {
    return Promise.reject(new Error('GAME_SERVER_SECRET 환경변수가 필요합니다'));
  }
  return fetch(KEENPLE_MAIN_URL + withApiPrefix(path), {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  }).then(function (res) {
    return res.json();
  });
}

// ── 지갑 ───────────────────────────────────

// 차감 (입장료, 아이템 구매 등).
// opts: { userId, currency, amount, type, refType?, refId?, gameId?, meta?, idempotencyKey? }
// 반환: { ok, txId, balanceAfter } 또는 { ok:false, error:'insufficient_funds', ... }
function spend(opts) {
  return postJson('/api/internal/wallet/spend', {
    userId: opts.userId,
    currency: opts.currency,
    amount: opts.amount,
    type: opts.type,
    refType: opts.refType,
    refId: opts.refId,
    gameId: opts.gameId,
    meta: opts.meta,
  }, opts.idempotencyKey);
}

// 환원 (매치 무효 등).
function refund(opts) {
  return postJson('/api/internal/wallet/refund', {
    userId: opts.userId,
    currency: opts.currency,
    amount: opts.amount,
    refType: opts.refType,
    refId: opts.refId,
    gameId: opts.gameId,
    originalTxId: opts.originalTxId,
    reason: opts.reason,
    meta: opts.meta,
  }, opts.idempotencyKey);
}

// 매치 정산 마커 (amount=0 거래). 환불·지급이 일어나지 않는 policy(sink 등)에서도
// "이 매치는 정상 종료됨" 을 main 에 기록 → crash-refund cron 이 entry_fee 를
// 환불 대상으로 오판하지 않도록 막는 용도. idempotent (같은 key 재호출 무시).
// opts: { userIds:number[], gameId, refType, refId, reason?, idempotencyKey }
function settle(opts) {
  return postJson('/api/internal/match/settle', {
    userIds: opts.userIds,
    gameId: opts.gameId,
    refType: opts.refType,
    refId: opts.refId,
    reason: opts.reason || 'game_finished',
    idempotencyKey: opts.idempotencyKey,
  }, opts.idempotencyKey);
}

// grant는 관리자 전용 (/api/admin/wallet/adjust). 게임 서버에서 충전 불가 (보안).
// 테스트 시에는 관리자 계정으로 admin 페이지(https://keenple.com/admin/wallet.html)에서 수동 충전.

// ── 인벤토리 ────────────────────────────────

// 유저 보유 아이템 조회.
function getInventory(userId, gameId) {
  var q = gameId ? '?gameId=' + encodeURIComponent(gameId) : '';
  return getJson('/api/internal/inventory/' + userId + q);
}

// 인벤토리 추가 (구매/보상 후).
function addInventory(opts) {
  return postJson('/api/internal/inventory/add', {
    userId: opts.userId,
    gameId: opts.gameId,
    itemId: opts.itemId,
    quantity: opts.quantity,
    txId: opts.txId,
    itemSnapshot: opts.itemSnapshot,
  });
}

// 소비형 아이템 사용.
function consumeInventory(opts) {
  return postJson('/api/internal/inventory/consume', {
    userId: opts.userId,
    itemId: opts.itemId,
    quantity: opts.quantity,
  });
}

// ── 카탈로그 ────────────────────────────────

// 게임 items.json sync.
function syncCatalog(gameId, items) {
  return postJson('/api/internal/catalog/sync', { gameId: gameId, items: items });
}

module.exports = {
  spend: spend,
  refund: refund,
  settle: settle,
  getInventory: getInventory,
  addInventory: addInventory,
  consumeInventory: consumeInventory,
  syncCatalog: syncCatalog,
};
