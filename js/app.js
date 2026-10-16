/* app.js — 화면 전환(해시 라우터)과 PWA 등록 */
(function (root) {
  const PS = root.PS;
  PS.APP_VERSION = '1.4.2';
  const UI = PS.ui;
  const routes = { home: 'home', upload: 'upload', month: 'month', year: 'year', compare: 'compare', search: 'search', data: 'data' };

  async function render() {
    const main = document.getElementById('main');
    let state;
    try { state = await PS.lock.state(); }
    catch (e) { state = 'error'; }
    const locked = state !== 'unlocked';
    document.body.classList.toggle('locked', locked);
    if (locked) {
      UI.destroyCharts();
      document.title = '잠김 · 급여명세 장부';
      if (state === 'error') {
        main.innerHTML = `<section class="block"><h1>저장소를 열 수 없습니다</h1><p style="margin-top:8px">사생활 보호(시크릿) 모드이거나 브라우저 저장공간이 막혀 있으면 이 앱을 쓸 수 없습니다.</p></section>`;
      } else await PS.views.lockScreen(state);
      render.prev = 'lock';
      return;
    }
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    const name = routes[parts[0]] || 'home';
    UI.destroyCharts();
    UI.$$('.nav a').forEach((a) => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const titles = { home: '홈', upload: '명세서 올리기', month: '월별 조회', year: '연도별 분석', compare: '연도 비교', search: '검색', data: '데이터 관리' };
    document.title = `${titles[name]} · 급여명세 장부`;
    try {
      await PS.views[name](parts.slice(1));
    } catch (e) {
      if (e && e.code === 'LOCKED') { render(); return; }
      console.error(e);
      document.getElementById('main').innerHTML = `<section class="block"><h1>화면을 표시하지 못했습니다</h1>
        <p style="margin-top:8px">${UI.esc(e && e.message ? e.message : String(e))}</p>
        <p class="small muted" style="margin-top:8px">사생활 보호(시크릿) 모드이거나 브라우저 저장공간이 막혀 있으면 이 앱을 쓸 수 없습니다.</p></section>`;
    }
    if (render.prev !== name) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    render.prev = name;
  }
  PS.app = { render };
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    if (e.target.closest('#search-btn')) { location.hash = '#/search'; }
    if (e.target.closest('#lock-btn')) { PS.lock.lock(); UI.toast('잠갔습니다'); render(); }
  });
  window.addEventListener('DOMContentLoaded', render);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => { PS.swReg = reg; reg.update().catch(() => {}); })
        .catch((e) => console.warn('오프라인 기능 등록 실패', e));
    });
    // 화면을 다시 불러오는 것은 '업데이트 확인' 버튼을 눌렀을 때만 한다.
    // (처음 방문하거나 새 버전이 뒤에서 설치될 때 저절로 새로고침하면 PIN 입력·수정 중인 내용이 끊긴다)
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateRequested || reloaded) return;
      reloaded = true; location.reload();
    });
  }
  let updateRequested = false;

  /** 서버에 새 버전이 있는지 확인하고, 있으면 적용한 뒤 화면을 다시 불러온다 */
  PS.checkUpdate = async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = PS.swReg || await navigator.serviceWorker.getRegistration();
    if (!reg) return 'none';
    updateRequested = true;
    try { await reg.update(); } catch (e) { updateRequested = false; throw e; }
    const nw = reg.installing || reg.waiting;
    if (!nw) { updateRequested = false; return 'latest'; }
    const activate = () => nw.postMessage('SKIP_WAITING');
    if (nw.state === 'installed') activate();
    else nw.addEventListener('statechange', () => { if (nw.state === 'installed') activate(); });
    setTimeout(() => { updateRequested = false; }, 20000);
    return 'updating';
  };
})(window);
