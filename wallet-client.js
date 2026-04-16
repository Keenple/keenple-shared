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

function postJson(path, body, idempotencyKey) {
  if (!INTERNAL_SECRET) {
    return Promise.reject(new Error('GAME_SERVER_SECRET 환경변수가 필요합니다'));
  }
  var headers = {
    'Content-Type': 'application/json',
    'x-internal-secret': INTERNAL_SECRET,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  return fetch(KEENPLE_MAIN_URL + path, {
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
  if (!INTERNAL_SECRET) {
    return Promise.reject(new Error('GAME_SERVER_SECRET 환경변수가 필요합니다'));
  }
  return fetch(KEENPLE_MAIN_URL + path, {
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

// 충전/지급 (관리자·테스트용).
function grant(opts) {
  return postJson('/api/internal/wallet/grant', {
    userId: opts.userId,
    currency: opts.currency,
    amount: opts.amount,
    type: opts.type || 'admin_grant',
    adminUserId: opts.adminUserId,
    reason: opts.reason,
    meta: opts.meta,
  }, opts.idempotencyKey);
}

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
  grant: grant,
  getInventory: getInventory,
  addInventory: addInventory,
  consumeInventory: consumeInventory,
  syncCatalog: syncCatalog,
};
