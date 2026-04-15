// ============================================
//  공통 "로비로 돌아가기" 헬퍼
//
//  AI 대전 / 로컬 2인 / 멀티플레이어 게임 화면에서
//  내부 로비(Keenple.UI.Lobby 또는 모드 선택 화면)로 복귀할 때 사용.
//
//  사용 예:
//    BackToLobby.attach(document.getElementById('back-btn'), {
//      isInProgress: () => !gameEndState && moveHistory.length > 0,
//      onReset: () => { resetGameState(); lobbyApi.show(); modePicker.hide(); },
//    });
//
//    // 또는 버튼 DOM까지 자동 생성:
//    const btn = BackToLobby.createButton({
//      isInProgress: () => running,
//      onReset: () => { ... },
//    });
//    container.appendChild(btn);
// ============================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BackToLobby = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function t(ko, en) {
    return (typeof Keenple !== 'undefined' && Keenple.t) ? Keenple.t(ko, en) : ko;
  }

  function confirmLeave() {
    return window.confirm(t(
      '진행 중인 게임이 종료됩니다. 로비로 돌아가시겠습니까?',
      'This will end the current game. Return to lobby?'
    ));
  }

  // 공통 실행 로직
  function go(opts) {
    const inProgress = typeof opts.isInProgress === 'function' ? opts.isInProgress() : false;
    const skipConfirm = opts.confirm === false;
    if (inProgress && !skipConfirm && !confirmLeave()) return false;
    if (typeof opts.onReset === 'function') opts.onReset();
    return true;
  }

  // 기존 DOM 요소에 핸들러만 붙이기
  function attach(el, opts) {
    if (!el) return;
    el.addEventListener('click', function (e) {
      e.preventDefault();
      go(opts);
    });
    // i18n 기본값 (data-ko/en 없으면 자동 주입)
    if (!el.hasAttribute('data-ko')) el.setAttribute('data-ko', '← 로비');
    if (!el.hasAttribute('data-en')) el.setAttribute('data-en', '← Lobby');
    if (!el.textContent.trim()) el.textContent = t('← 로비', '← Lobby');
  }

  // 버튼 DOM까지 생성
  function createButton(opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keenple-back-to-lobby' + (opts.className ? ' ' + opts.className : '');
    attach(btn, opts);
    return btn;
  }

  return { go: go, attach: attach, createButton: createButton };
});
