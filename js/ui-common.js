/* ui-common.js — 화면 공통 도구 */
(function (root) {
  const PS = root.PS;
  const UI = (PS.ui = {});
  const U = PS.util;

  UI.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  UI.won = (n) => (n == null ? '<span class="muted">확인 필요</span>' : `${U.fmt(n)}`);
  UI.$ = (sel, el) => (el || document).querySelector(sel);
  UI.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  UI.ymLabel = (y, m) => `${y}년 ${m}월`;

  /* 토스트 */
  let tt;
  UI.toast = (msg) => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => el.classList.remove('show'), 2600);
  };

  /* 모달: buttons = [{label, value, cls}] → Promise<value> */
  UI.modal = ({ title, body, buttons, onMount }) => new Promise((resolve) => {
    const rootEl = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
      <h2 id="mt">${UI.esc(title)}</h2><div class="modal-body"></div>
      <div class="actions">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${UI.esc(b.label)}</button>`).join('')}</div></div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    back.addEventListener('click', (e) => {
      if (e.target === back) close(undefined);
      const b = e.target.closest('button[data-i]');
      if (b) {
        const spec = buttons[Number(b.dataset.i)];
        if (spec.handler) { spec.handler(bodyEl, close); return; }
        close(spec.value);
      }
    });
    document.addEventListener('keydown', onKey);
    rootEl.appendChild(back);
    if (onMount) onMount(bodyEl, close);
    const f = back.querySelector('button'); if (f) f.focus();
  });
  UI.confirm = (title, body, okLabel, danger) => UI.modal({
    title, body: `<p>${body}</p>`,
    buttons: [{ label: okLabel || '확인', value: true, cls: danger ? 'danger' : 'primary' }, { label: '취소', value: false }],
  });

  /* 라이브러리 지연 로딩 (모두 앱 폴더 안의 파일) */
  const loaded = {};
  UI.loadScript = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error(`${src} 파일을 불러오지 못했습니다.`)); };
    document.head.appendChild(s);
  }));
  UI.parserLibs = async () => {
    await Promise.all([UI.loadScript('lib/pdf.min.js'), UI.loadScript('lib/xlsx.full.min.js')]);
    const pdfjs = root.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    return { pdfjs, XLSX: root.XLSX };
  };
  UI.chartLib = async () => { await UI.loadScript('lib/chart.umd.min.js'); return root.Chart; };

  /* 차트 */
  const charts = new Map();
  UI.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  UI.destroyCharts = () => { charts.forEach((c) => c.destroy()); charts.clear(); };
  UI.chart = async (canvas, config) => {
    const Chart = await UI.chartLib();
    if (!canvas.isConnected) return null;
    const id = canvas.id;
    if (charts.has(id)) charts.get(id).destroy();
    const ink = UI.css('--ink-2'), line = UI.css('--line');
    Chart.defaults.font.family = UI.css('--font');
    Chart.defaults.color = ink;
    const base = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              const unit = (config.unit != null ? config.unit : '원');
              return `${ctx.dataset.label}: ${v == null ? '자료 없음' : U.fmt(v) + unit}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: line },
          ticks: {
            callback: (v) => (config.unit != null && config.unit !== '원') ? v
              : (Math.abs(v) >= 10000 ? `${U.fmt(v / 10000)}만` : U.fmt(v)),
          },
        },
      },
    };
    const merged = Object.assign({}, config);
    merged.options = deepMerge(base, config.options || {});
    delete merged.unit;
    const c = new Chart(canvas.getContext('2d'), merged);
    charts.set(id, c);
    return c;
  };
  function deepMerge(a, b) {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b).forEach((k) => {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') out[k] = deepMerge(a[k], b[k]);
      else out[k] = b[k];
    });
    return out;
  }

  /** 지표 선택 목록(저장된 데이터에서 동적으로) */
  UI.metricOptions = (records, selected, opts) => {
    const cat = PS.analysis.catalog(records);
    const A = PS.analysis;
    let html = '<optgroup label="합계">' + A.TOTALS.map((t) =>
      `<option value="${t.key}" ${t.key === selected ? 'selected' : ''}>${t.label}</option>`).join('') + '</optgroup>';
    if (opts && opts.info) {
      html += `<optgroup label="기본정보"><option value="info:payGrade" ${selected === 'info:payGrade' ? 'selected' : ''}>호봉</option>
        <option value="info:careerYears" ${selected === 'info:careerYears' ? 'selected' : ''}>근무년수</option></optgroup>`;
    }
    Object.keys(cat).forEach((g) => {
      if (!cat[g].length) return;
      html += `<optgroup label="${A.GROUP_LABEL[g]}">` + cat[g].map((n) => {
        const key = `${g}:${n}`;
        return `<option value="${UI.esc(key)}" ${key === selected ? 'selected' : ''}>${UI.esc(n)}</option>`;
      }).join('') + '</optgroup>';
    });
    return html;
  };
  UI.metricColor = (key) => {
    if (key === 'total:netPay') return UI.css('--net');
    if (key === 'total:paymentTotal' || key.startsWith('payments:')) return UI.css('--pay');
    if (key === 'total:taxTotal' || key.startsWith('taxes:')) return UI.css('--tax');
    if (key === 'total:deductionTotal' || key.startsWith('deductions:')) return UI.css('--ded');
    return UI.css('--brand');
  };

  UI.download = (filename, text) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  UI.today = () => {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  /* PIN 입력 패드 (숫자 4자리) */
  UI.pinPad = (container, opts) => {
    let val = '';
    let disabled = false;
    let timer = null;
    container.innerHTML = `
      <div class="pin">
        <p class="pin-label" id="pin-label">${UI.esc(opts.label || 'PIN')}</p>
        <div class="pin-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <p class="pin-msg" role="status" aria-live="polite"></p>
        <input class="sr" type="password" inputmode="numeric" autocomplete="off" aria-labelledby="pin-label" maxlength="4">
        <div class="pin-keys">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="pin-key" data-k="${n}">${n}</button>`).join('')}
          <span></span><button type="button" class="pin-key" data-k="0">0</button>
          <button type="button" class="pin-key del" data-k="del" aria-label="한 자리 지우기">⌫</button>
        </div>
      </div>`;
    const dots = UI.$$('.pin-dots span', container);
    const msg = UI.$('.pin-msg', container);
    const label = UI.$('.pin-label', container);
    const keys = UI.$$('.pin-key', container);
    const hidden = UI.$('input', container);
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < val.length));
    const setDisabled = (v) => { disabled = v; keys.forEach((k) => { k.disabled = v; }); };
    const press = (k) => {
      if (disabled) return;
      if (k === 'del') val = val.slice(0, -1);
      else if (val.length < 4) val += k;
      msg.classList.remove('err');
      paint();
      if (val.length === 4) { const pin = val; setTimeout(() => opts.onComplete(pin, api), 60); }
    };
    const api = {
      reset(text) { clearInterval(timer); val = ''; paint(); setDisabled(false); msg.textContent = ''; if (text) label.textContent = text; },
      busy(text) { setDisabled(true); msg.classList.remove('err'); msg.textContent = text || ''; },
      error(text, nextLabel, waitSec) {
        clearInterval(timer);
        val = ''; paint();
        if (nextLabel) label.textContent = nextLabel;
        msg.classList.add('err');
        container.querySelector('.pin-dots').classList.remove('shake');
        void container.offsetWidth;
        container.querySelector('.pin-dots').classList.add('shake');
        if (waitSec > 0) {
          let left = waitSec;
          setDisabled(true);
          const tick = () => {
            if (!container.isConnected) { clearInterval(timer); return; }
            if (left <= 0) { clearInterval(timer); setDisabled(false); msg.classList.remove('err'); msg.textContent = '다시 입력할 수 있습니다.'; return; }
            msg.textContent = `${text.replace(/\d+초 뒤에 다시 시도하세요\.?/, '').trim()} ${left}초 뒤에 다시 입력할 수 있습니다.`;
            left -= 1;
          };
          tick(); timer = setInterval(tick, 1000);
        } else { setDisabled(false); msg.textContent = text; }
      },
    };
    keys.forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
    const onKey = (e) => {
      if (!container.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.target && e.target.closest && e.target.closest('.modal') && !container.closest('.modal')) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
    };
    document.addEventListener('keydown', onKey);
    hidden.addEventListener('input', () => { hidden.value = ''; });
    return api;
  };

  /** 모달에서 PIN을 받아 check(pin)을 실행. 성공하면 그 결과를 반환, 취소하면 undefined */
  UI.pinPrompt = ({ title, message, check }) => UI.modal({
    title,
    body: `<p>${UI.esc(message)}</p><div class="pp" style="margin-top:12px"></div>`,
    buttons: [{ label: '취소', value: undefined }],
    onMount: (body, close) => {
      UI.pinPad(body.querySelector('.pp'), {
        label: 'PIN',
        onComplete: async (pin, pad) => {
          pad.busy('확인 중…');
          try { close(await check(pin)); }
          catch (e) { pad.error(e.message); }
        },
      });
    },
  });

  /** PIN 변경: 현재 PIN → 새 PIN → 확인 */
  UI.pinChange = () => UI.modal({
    title: 'PIN 변경',
    body: `<p>현재 PIN을 확인한 뒤 새 PIN으로 모든 기록을 다시 암호화합니다.</p>
      <p class="small muted" style="margin-top:4px">이전에 받은 백업 파일은 그 당시의 PIN으로 열어야 합니다.</p><div class="pp" style="margin-top:12px"></div>`,
    buttons: [{ label: '취소', value: undefined }],
    onMount: (body, close) => {
      let oldPin = null, newPin = null;
      UI.pinPad(body.querySelector('.pp'), {
        label: '현재 PIN',
        onComplete: async (pin, pad) => {
          if (oldPin == null) {
            pad.busy('확인 중…');
            const m = await PS.lock.meta();
            try { await PS.crypto.decrypt(await PS.crypto.deriveKey(pin, m.salt, m.iter), m.check); }
            catch (e) { pad.error('현재 PIN이 맞지 않습니다.'); return; }
            oldPin = pin; pad.reset('새 PIN 4자리'); return;
          }
          if (newPin == null) {
            if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '4321') { pad.error('너무 쉬운 PIN입니다. 다른 숫자를 골라 주세요.'); return; }
            if (pin === oldPin) { pad.error('현재 PIN과 같습니다. 다른 숫자를 골라 주세요.'); return; }
            newPin = pin; pad.reset('새 PIN 한 번 더'); return;
          }
          if (pin !== newPin) { newPin = null; pad.error('두 번 입력한 PIN이 다릅니다.', '새 PIN 4자리'); return; }
          pad.busy('다시 암호화하는 중…');
          try { await PS.lock.change(oldPin, newPin); close(true); UI.toast('PIN을 변경했습니다'); }
          catch (e) { oldPin = null; newPin = null; pad.error(e.message, '현재 PIN'); }
        },
      });
    },
  });

  UI.issueBox = (issues, title) => {
    const list = issues.filter((i) => i.level !== 'info');
    const info = issues.filter((i) => i.level === 'info');
    let html = '';
    if (list.length) {
      const err = list.some((i) => i.level === 'error');
      html += `<div class="notice ${err ? 'err' : 'warn'}" role="alert"><strong>⚠ ${UI.esc(title || '확인 필요')}</strong><ul>${list.map((i) => `<li>${UI.esc(i.message)}</li>`).join('')}</ul></div>`;
    }
    if (info.length) html += `<div class="notice info small"><ul>${info.map((i) => `<li>${UI.esc(i.message)}</li>`).join('')}</ul></div>`;
    return html;
  };
})(window);
