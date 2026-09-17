/* app.js — 화면 전환(해시 라우터)과 PWA 등록 */
(function (root) {
  const PS = root.PS;
  const UI = PS.ui;
  const routes = { home: 'home', upload: 'upload', month: 'month', year: 'year', compare: 'compare', data: 'data' };

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
    const titles = { home: '홈', upload: '명세서 올리기', month: '월별 조회', year: '연도별 분석', compare: '연도 비교', data: '데이터 관리' };
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
    if (e.target.closest('#lock-btn')) { PS.lock.lock(); UI.toast('잠갔습니다'); render(); }
  });
  window.addEventListener('DOMContentLoaded', render);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('오프라인 기능 등록 실패', e));
    });
  }
})(window);
