/* views.js — 각 화면 */
(function (root) {
  const PS = root.PS;
  const UI = PS.ui, U = PS.util, A = PS.analysis, S = PS.storage;
  const esc = UI.esc;
  const V = (PS.views = {});
  const main = () => document.getElementById('main');
  const go = (hash) => { location.hash = hash; };
  const GROUPS = [
    { key: 'payments', label: '급여내역', cls: 'pay', total: 'paymentTotal', totalLabel: '급여총액' },
    { key: 'taxes', label: '세금내역', cls: 'tax', total: 'taxTotal', totalLabel: '세금총액' },
    { key: 'deductions', label: '공제내역', cls: 'ded', total: 'deductionTotal', totalLabel: '공제총액' },
  ];
  const b = (rec, k) => (rec.basicInfo || {})[k];
  const showVal = (v, missingText) => (v == null || v === '' ? `<span class="v missing">${missingText || '확인 필요'}</span>` : `<span class="v">${esc(v)}</span>`);

  /* ---------- 공통 조각 ---------- */
  function splitHero(rec, opts) {
    const p = rec.paymentTotal, t = rec.taxTotal, d = rec.deductionTotal, n = rec.netPay;
    const canBar = p && t != null && d != null && n != null && p > 0 && t >= 0 && d >= 0 && n >= 0;
    const pct = (v) => `${Math.max(0, (v / p) * 100).toFixed(2)}%`;
    return `
      <section class="block payslip-hero" aria-label="${UI.ymLabel(rec.year, rec.month)} 요약">
        <div class="hero-top">
          <span class="hero-month">${opts && opts.link ? `<a href="#/month/${rec.year}/${rec.month}">${UI.ymLabel(rec.year, rec.month)} 급여</a>` : `${UI.ymLabel(rec.year, rec.month)} 급여`}</span>
          ${rec.userEdited ? '<span class="tag edit">직접 수정함</span>' : ''}
        </div>
        <div class="net-figure"><span class="label">실수령액</span>
          <span class="value">${n == null ? '확인 필요' : `${U.fmt(n)}<small>원</small>`}</span></div>
        <div class="split">
          ${canBar ? `<div class="split-bar" role="img" aria-label="급여총액 중 실수령액 ${pct(n)}, 세금 ${pct(t)}, 공제 ${pct(d)}">
            <span class="s-net" style="width:${pct(n)}"></span><span class="s-tax" style="width:${pct(t)}"></span><span class="s-ded" style="width:${pct(d)}"></span></div>` : ''}
          <div class="split-legend">
            <div class="leg pay"><span class="k">급여총액</span><span class="v">${UI.won(p)}</span></div>
            <div class="leg tax"><span class="k">세금총액</span><span class="v">${UI.won(t)}</span></div>
            <div class="leg ded"><span class="k">공제총액</span><span class="v">${UI.won(d)}</span></div>
            <div class="leg net"><span class="k">실수령 비율</span><span class="v">${canBar ? `${((n / p) * 100).toFixed(1)}%` : '—'}</span></div>
          </div>
        </div>
      </section>`;
  }
  function factsBlock(rec, withMore) {
    const moreKeys = PS.BASIC_LABELS.filter((k) => k !== '보직구분' && k !== '담당과목');
    return `
      <section class="block">
        <div class="facts">
          <div class="fact"><span class="k">보직</span>${showVal(b(rec, '보직구분'), ('보직구분' in (rec.basicInfo || {})) ? '없음' : '확인 필요')}</div>
          <div class="fact"><span class="k">담당과목</span>${showVal(b(rec, '담당과목'), ('담당과목' in (rec.basicInfo || {})) ? '없음' : '확인 필요')}</div>
          <div class="fact"><span class="k">호봉</span>${showVal(rec.payGrade == null ? null : `${rec.payGrade}호봉`)}</div>
          <div class="fact"><span class="k">근무년수</span>${showVal(rec.careerYears == null ? null : `${rec.careerYears}년`)}</div>
        </div>
        ${withMore ? `<details class="more-toggle"><summary>상세정보 더보기</summary>
          <div class="facts more">
            ${moreKeys.map((k) => `<div class="fact"><span class="k">${k}</span>${showVal(b(rec, k), k in (rec.basicInfo || {}) ? '(빈칸)' : '확인 필요')}</div>`).join('')}
            <div class="fact"><span class="k">재직상태</span>${showVal(rec.employmentStatus)}</div>
          </div>
          <p class="small muted" style="margin-top:12px">
            ${rec.summaryLine ? `명세서 요약줄 ${esc(rec.summaryLine)}<br>` : ''}
            원본 ${rec.sourceFileType === 'pdf' ? 'PDF' : rec.sourceFileType === 'excel' ? 'Excel' : '직접 입력'}${rec.sourceFileName ? ` · ${esc(rec.sourceFileName)}` : ''}${rec.printedDate ? ` · 명세서 출력일 ${esc(rec.printedDate)}` : ''}<br>
            저장 ${esc((rec.updatedAt || '').slice(0, 16).replace('T', ' '))}
          </p>
        </details>` : ''}
      </section>`;
  }
  function calcHtml(calc) {
    if (!calc || !calc.raw) return '';
    const rows = (calc.parsed || []).map((kv) => `<dt>${esc(kv.basis ? `${kv.key}` : kv.key)}</dt><dd>${esc(kv.value)}</dd>`).join('');
    return `<div class="calc">
      ${calc.tags && calc.tags.length ? `<div class="tags">${calc.tags.map((t) => `[${esc(t)}]`).join('')}</div>` : ''}
      ${rows ? `<dl>${rows}</dl>` : ''}
      <pre>${esc(calc.raw)}</pre>
      ${calc.status === 'partial' || calc.status === 'failed' ? '<p class="small muted" style="margin-top:6px">위 원문 중 일부는 항목별로 나누지 않고 원문 그대로 보관했습니다.</p>' : ''}</div>`;
  }
  function ledgerBlock(rec, g) {
    const items = rec[g.key] || [];
    const orig = rec.original;
    const changed = (it) => {
      if (!orig) return false;
      const o = (orig[g.key] || []).filter((x) => x.name === it.name);
      return !o.length || o.reduce((s, x) => s + (x.amount || 0), 0) !== it.amount;
    };
    const sum = items.reduce((s, i) => s + (i.amount || 0), 0);
    const mismatch = rec[g.total] != null && sum !== rec[g.total];
    return `
      <section class="block ledger ${g.cls}">
        <div class="block-head"><h3>${g.label}</h3><span class="small muted">${items.length}개 항목</span></div>
        ${items.length ? `<ul class="lines">${items.map((it) => {
          const name = `<span class="line-name">${esc(it.name || '(이름 없음)')}${changed(it) ? '<span class="tag edit">수정</span>' : ''}</span>`;
          const amt = `<span class="line-amt">${it.amount == null ? '<span class="tag warn">확인 필요</span>' : U.fmt(it.amount)}</span>`;
          return `<li class="line">${it.calc && it.calc.raw
            ? `<details><summary class="line-main">${name}${amt}</summary>${calcHtml(it.calc)}</details>`
            : `<div class="line-main">${name}${amt}</div>`}</li>`;
        }).join('')}</ul>` : '<p class="muted">이 달에는 항목이 없습니다.</p>'}
        <div class="line-total"><span>${g.totalLabel}</span><span class="amount">${UI.won(rec[g.total])}</span></div>
        ${mismatch ? `<p class="small" style="color:var(--warn)">⚠ 세부항목 합계 ${U.fmt(sum)}원과 다릅니다.</p>` : ''}
      </section>`;
  }

  /* ---------- 잠금 화면 ---------- */
  V.lockScreen = async (state) => {
    const m = main();
    if (!PS.crypto.available()) {
      m.innerHTML = `<section class="block"><h1>잠금 기능을 쓸 수 없는 환경입니다</h1>
        <p style="margin-top:8px">암호화 기능은 https 주소(또는 localhost)에서만 동작합니다. 앱 주소가 https로 시작하는지 확인해 주세요.</p></section>`;
      return;
    }
    if (state === 'setup') {
      m.innerHTML = `<section class="block lock-box">
        <h1>PIN 설정</h1>
        <p>이 앱에 저장되는 급여 기록을 보호할 숫자 4자리를 정해 주세요. 앱을 새로 열 때마다 입력합니다.</p>
        <div class="notice warn" style="margin:12px 0"><strong>PIN을 잊으면 기록을 되살릴 수 없습니다.</strong>
          제작자도 복구할 수 없습니다. 기억하기 쉬우면서 남이 짐작하기 어려운 숫자를 고르세요(생일·1234·0000 피하기).</div>
        <div id="pin-pad"></div></section>`;
      let first = null;
      UI.pinPad(document.getElementById('pin-pad'), {
        label: '새 PIN 4자리',
        onComplete: async (pin, pad) => {
          if (first == null) {
            if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '4321') { pad.error('너무 쉬운 PIN입니다. 다른 숫자를 골라 주세요.'); return; }
            first = pin; pad.reset('확인을 위해 한 번 더 입력하세요'); return;
          }
          if (pin !== first) { first = null; pad.error('두 번 입력한 PIN이 다릅니다. 처음부터 다시 입력하세요.', '새 PIN 4자리'); return; }
          pad.busy('암호화하는 중…');
          try {
            const moved = await PS.lock.setup(pin);
            UI.toast(moved ? `PIN을 설정하고 기존 기록 ${moved}건을 암호화했습니다` : 'PIN을 설정했습니다');
            PS.app.render();
          } catch (e) { first = null; pad.error(e.message, '새 PIN 4자리'); }
        },
      });
      return;
    }
    m.innerHTML = `<section class="block lock-box">
      <h1>잠겨 있습니다</h1>
      <p>PIN 4자리를 입력하세요.</p>
      <div id="pin-pad" style="margin-top:12px"></div>
      <details class="more-toggle"><summary>PIN을 잊었어요</summary>
        <p style="margin-top:8px">PIN 없이는 저장된 기록을 열 수 없습니다. 앱을 초기화하면 <strong>모든 기록이 삭제</strong>되고 새 PIN을 정할 수 있습니다.
        백업 파일이 있다면, 초기화 후 <strong>그 백업을 만들 때의 PIN</strong>으로 복원할 수 있습니다.</p>
        <button type="button" class="btn danger" id="reset-all" style="margin-top:10px">앱 초기화</button>
      </details></section>`;
    const pad = UI.pinPad(document.getElementById('pin-pad'), {
      label: 'PIN',
      onComplete: async (pin, p) => {
        p.busy('확인 중…');
        const r = await PS.lock.unlock(pin);
        if (r.ok) { PS.app.render(); return; }
        p.error(r.wait ? `PIN이 맞지 않습니다. ${r.wait}초 뒤에 다시 시도하세요.` : `PIN이 맞지 않습니다 (${r.fails}회 실패).`, 'PIN', r.wait);
      },
    });
    const a = await PS.lock.attempts();
    if (a.until > Date.now()) pad.error(`여러 번 틀려 잠시 입력이 막혔습니다.`, 'PIN', Math.ceil((a.until - Date.now()) / 1000));
    document.getElementById('reset-all').onclick = async () => {
      const ok = await UI.modal({
        title: '앱을 초기화할까요?',
        body: `<p>저장된 모든 급여 기록과 PIN 설정이 삭제되며 되돌릴 수 없습니다. 계속하려면 아래 칸에 <strong>초기화</strong>라고 입력하세요.</p><input class="input" id="reset-confirm" style="margin-top:10px" autocomplete="off">`,
        buttons: [
          { label: '모두 삭제하고 초기화', cls: 'danger', handler: (body, close) => { if (body.querySelector('#reset-confirm').value.trim() === '초기화') close(true); else body.querySelector('#reset-confirm').classList.add('bad'); } },
          { label: '취소', value: false },
        ],
      });
      if (!ok) return;
      await PS.lock.resetAll();
      UI.toast('초기화했습니다. 새 PIN을 정해 주세요');
      PS.app.render();
    };
  };

  /* ---------- 홈 ---------- */
  V.home = async () => {
    const recs = await S.all();
    if (!recs.length) {
      main().innerHTML = `
        <section class="block empty-state">
          <h1>첫 급여명세서를 올려 주세요</h1>
          <p>나이스에서 내려받은 급여명세서(PDF 또는 Excel)를 올리면 달마다 기록이 쌓입니다. 파일은 이 기기 안에서만 읽고, 외부로 보내지 않습니다.</p>
          <a class="btn primary" href="#/upload">명세서 올리기</a>
        </section>`;
      return;
    }
    const last = recs[recs.length - 1];
    const ys = A.yearSummary(recs, last.year);
    const issues = PS.validate(last).filter((i) => i.level !== 'info');
    main().innerHTML = `
      <div class="page-head"><div><h1>최근 급여</h1><p>저장된 명세서 ${recs.length}건 중 가장 최근 달입니다.</p></div>
        <a class="btn" href="#/upload">명세서 올리기</a></div>
      <div class="stack">
        ${splitHero(last, { link: true })}
        ${factsBlock(last, false)}
        ${issues.length ? `<div class="notice warn">⚠ 이 달 기록에 확인이 필요한 부분이 ${issues.length}건 있습니다. <a href="#/month/${last.year}/${last.month}">자세히 보기</a></div>` : ''}
        <section class="block">
          <div class="block-head"><h2>${last.year}년 누적</h2><span class="small muted">${ys.months}개월 기록</span></div>
          <div class="split-legend">
            <div class="leg pay"><span class="k">급여총액</span><span class="v">${UI.won(ys.paymentTotal)}</span></div>
            <div class="leg tax"><span class="k">세금총액</span><span class="v">${UI.won(ys.taxTotal)}</span></div>
            <div class="leg ded"><span class="k">공제총액</span><span class="v">${UI.won(ys.deductionTotal)}</span></div>
            <div class="leg net"><span class="k">실수령액</span><span class="v">${UI.won(ys.netPay)}</span></div>
          </div>
          ${ys.incomplete ? '<p class="small muted" style="margin-top:10px">합계가 비어 있는 달은 누적에서 빠졌습니다.</p>' : ''}
          <div class="row" style="margin-top:14px"><a class="btn small" href="#/year/${last.year}">${last.year}년 분석 보기</a><a class="btn small" href="#/month/${last.year}/${last.month}">이 달 명세 보기</a></div>
        </section>
      </div>`;
  };

  /* ---------- 업로드 ---------- */
  const upState = { queue: [], current: null, editor: null };
  V.upload = async () => {
    main().innerHTML = `
      <div class="page-head"><div><h1>명세서 올리기</h1><p>나이스 급여명세서 PDF·Excel을 여러 개 한꺼번에 올릴 수 있습니다.</p></div></div>
      <div class="stack">
        <label class="drop" id="drop" tabindex="0">
          <strong>파일 선택</strong>
          <span class="muted">또는 이곳에 끌어다 놓기 · PDF, XLSX</span>
          <input type="file" id="file" accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" multiple class="sr">
        </label>
        <p class="small muted">파일은 이 기기의 브라우저 안에서만 읽습니다. 원본 파일은 저장하지 않고, 확인을 마친 급여 숫자만 저장합니다. 성명은 읽거나 저장하지 않습니다.</p>
        <div id="queue-box"></div>
        <div id="review"></div>
      </div>`;
    const input = document.getElementById('file');
    const drop = document.getElementById('drop');
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    renderQueue();
    if (upState.current) showReview();
  };

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    files.forEach((f) => upState.queue.push({ file: f, name: f.name, status: 'wait', msg: '읽는 중' }));
    renderQueue();
    let libs;
    try { libs = await UI.parserLibs(); }
    catch (e) {
      upState.queue.forEach((q) => { if (q.status === 'wait') { q.status = 'err'; q.msg = '분석 도구를 불러오지 못했습니다'; } });
      renderQueue();
      return;
    }
    for (const q of upState.queue.filter((x) => x.status === 'wait' && !x.rec)) {
      try {
        const rec = await PS.processFile(q.file, libs);
        rec.extractedAt = new Date().toISOString();
        q.rec = rec;
        q.status = 'ready';
        q.msg = rec.year ? `${UI.ymLabel(rec.year, rec.month)} · 확인 대기` : '확인 대기 (연월 미확인)';
      } catch (e) {
        q.status = 'err';
        q.msg = e && e.code ? e.message : `읽는 중 오류가 발생했습니다: ${e && e.message ? e.message : e}`;
        console.error(e);
      }
      q.file = null;
      renderQueue();
    }
    if (!upState.current) nextReview();
  }
  function renderQueue() {
    const box = document.getElementById('queue-box');
    if (!box) return;
    if (!upState.queue.length) { box.innerHTML = ''; return; }
    const cls = { wait: 'wait', ready: 'wait', review: 'wait', saved: 'ok', skipped: 'wait', err: 'err' };
    box.innerHTML = `<section class="block"><div class="block-head"><h2>올린 파일</h2>
      ${upState.queue.every((q) => ['saved', 'skipped', 'err'].includes(q.status)) ? '<button class="btn small" id="qclear" type="button">목록 비우기</button>' : ''}</div>
      <ul class="queue">${upState.queue.map((q) => `<li><span>${esc(q.name)}</span><span class="st ${cls[q.status]}">${esc(q.msg)}</span></li>`).join('')}</ul></section>`;
    const c = document.getElementById('qclear');
    if (c) c.onclick = () => { upState.queue = []; renderQueue(); };
  }
  function nextReview() {
    const q = upState.queue.find((x) => x.status === 'ready');
    upState.current = q || null;
    if (q) { q.status = 'review'; q.msg = '확인 중'; renderQueue(); }
    showReview();
  }
  function showReview() {
    const box = document.getElementById('review');
    if (!box) return;
    const q = upState.current;
    if (!q) { box.innerHTML = ''; return; }
    const rec = q.rec;
    const typeLabel = rec.meta.sourceFileType === 'pdf' ? 'PDF' : 'Excel';
    box.innerHTML = `
      <div class="page-head" style="margin-top:8px"><div>
        <h2>추출 결과 확인${rec.year ? ` · ${UI.ymLabel(rec.year, rec.month)}` : ''}</h2>
        <p>원본 명세서와 비교해 보고, 다른 곳이 있으면 고친 뒤 저장해 주세요. 아직 저장되지 않았습니다.</p></div></div>
      ${UI.issueBox(rec.issues || [], '파일을 읽는 중 확인이 필요한 부분')}
      <div id="ed"></div>
      <div class="editor-actions">
        <button type="button" class="btn" id="rv-skip">이 파일 건너뛰기</button>
        <button type="button" class="btn primary" id="rv-save">확인하고 저장</button>
      </div>`;
    const ed = PS.createEditor(rec, { fileLabel: `${typeLabel} · ${q.name}` });
    upState.editor = ed;
    box.querySelector('#ed').appendChild(ed.el);
    box.querySelector('#rv-skip').onclick = () => { q.status = 'skipped'; q.msg = '건너뜀'; renderQueue(); nextReview(); };
    box.querySelector('#rv-save').onclick = () => saveReview(q, ed);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function saveReview(q, ed) {
    const { draft, errors } = ed.read();
    const issues = PS.validate(draft);
    const hard = issues.filter((i) => i.level === 'error');
    if (errors.length || hard.length) {
      await UI.modal({ title: '저장할 수 없습니다', body: `<ul>${errors.concat(hard.map((h) => h.message)).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`, buttons: [{ label: '돌아가서 고치기', value: 1, cls: 'primary' }] });
      return;
    }
    const warns = issues.filter((i) => i.level === 'warn');
    if (warns.length) {
      const ok = await UI.modal({
        title: '확인이 필요한 부분이 남아 있습니다',
        body: `<ul>${warns.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul><p style="margin-top:8px">원본 명세서도 이렇게 되어 있다면 그대로 저장해도 됩니다.</p>`,
        buttons: [{ label: '이대로 저장', value: true, cls: 'primary' }, { label: '돌아가서 고치기', value: false }],
      });
      if (!ok) return;
    }
    const record = PS.buildRecord(Object.assign({}, draft, { meta: q.rec.meta, extractedAt: q.rec.extractedAt, printedDate: q.rec.printedDate }), q.rec);
    const existing = await S.get(record.id);
    if (existing) {
      const choice = await duplicateDialog(existing, record);
      if (choice === 'cancel' || choice === undefined) return;
      if (choice === 'keep') { q.status = 'skipped'; q.msg = `${UI.ymLabel(record.year, record.month)} · 기존 데이터 유지`; renderQueue(); nextReview(); return; }
    }
    try { await S.put(record); }
    catch (e) { UI.modal({ title: '저장하지 못했습니다', body: `<p>${esc(e.message)}</p>`, buttons: [{ label: '닫기', value: 1 }] }); return; }
    q.status = 'saved';
    q.msg = `${UI.ymLabel(record.year, record.month)} · 저장됨`;
    UI.toast(`${UI.ymLabel(record.year, record.month)} 명세서를 저장했습니다`);
    renderQueue();
    const more = upState.queue.some((x) => x.status === 'ready');
    if (more) nextReview();
    else {
      upState.current = null;
      const box = document.getElementById('review');
      box.innerHTML = `<div class="notice ok"><strong>저장을 마쳤습니다.</strong>
        <div class="row" style="margin-top:8px"><a class="btn small primary" href="#/month/${record.year}/${record.month}">${UI.ymLabel(record.year, record.month)} 명세 보기</a>
        <button class="btn small" type="button" id="up-more">다른 파일 올리기</button></div></div>`;
      box.querySelector('#up-more').onclick = () => document.getElementById('file').click();
    }
  }
  async function duplicateDialog(existing, incoming) {
    const label = UI.ymLabel(incoming.year, incoming.month);
    for (;;) {
      const c = await UI.modal({
        title: `${label} 데이터가 이미 있습니다`,
        body: `<p>저장된 기록: ${existing.sourceFileType === 'pdf' ? 'PDF' : existing.sourceFileType === 'excel' ? 'Excel' : '직접 입력'}, ${esc((existing.updatedAt || '').slice(0, 10))} 저장${existing.userEdited ? ', 직접 수정함' : ''}</p>`,
        buttons: [
          { label: '기존 데이터 유지', value: 'keep' },
          { label: '새 데이터로 교체', value: 'replace', cls: 'primary' },
          { label: '두 데이터 비교', value: 'compare' },
          { label: '취소', value: 'cancel' },
        ],
      });
      if (c !== 'compare') return c;
      const rows = A.diff(existing, incoming);
      const gl = { payments: '급여', taxes: '세금', deductions: '공제', total: '합계', info: '기본' };
      const cell = (v) => (v === undefined ? '<span class="muted">없음</span>' : typeof v === 'number' ? U.fmt(v) : esc(v == null ? '—' : v));
      await UI.modal({
        title: `${label} 비교`,
        body: rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>항목</th><th class="num">기존</th><th class="num">새 파일</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${gl[r.group]}</td><td>${esc(r.name)}</td><td class="num">${cell(r.a)}</td><td class="num">${cell(r.b)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p>두 데이터의 항목과 금액이 모두 같습니다.</p>',
        buttons: [{ label: '선택으로 돌아가기', value: 1, cls: 'primary' }],
      });
    }
  }

  /* ---------- 월별 조회 ---------- */
  const monthState = { metric: 'total:netPay' };
  V.month = async (params) => {
    const recs = await S.all();
    let y = Number(params[0]), m = Number(params[1]);
    if (!y) {
      const last = recs[recs.length - 1];
      const now = new Date();
      y = last ? last.year : now.getFullYear();
      m = last ? last.month : now.getMonth() + 1;
      history.replaceState(null, '', `#/month/${y}/${m}`);
    }
    if (!m) {
      const inYear = recs.filter((r) => r.year === y);
      m = inYear.length ? inYear[inYear.length - 1].month : 1;
    }
    const edit = params[2] === 'edit';
    const rec = recs.find((r) => r.year === y && r.month === m) || null;
    const years = [...new Set([...A.years(recs), y, new Date().getFullYear()])].sort((a, b) => a - b);
    const prev = A.shift(y, m, -1), next = A.shift(y, m, 1);
    const has = new Set(recs.filter((r) => r.year === y).map((r) => r.month));

    main().innerHTML = `
      <div class="page-head"><div><h1>월별 조회</h1><p>연도와 월을 고르면 그 달의 명세를 볼 수 있습니다.</p></div></div>
      <div class="stack">
        <section class="block">
          <div class="year-pick" role="group" aria-label="연도 선택">
            <button class="chip" type="button" data-yy="${y - 1}" aria-label="이전 연도">‹</button>
            ${years.map((yy) => `<button class="chip" type="button" data-yy="${yy}" aria-pressed="${yy === y}">${yy}</button>`).join('')}
            <button class="chip" type="button" data-yy="${y + 1}" aria-label="다음 연도">›</button>
          </div>
          <div class="month-grid" role="group" aria-label="${y}년 월 선택">
            ${Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => `
              <button type="button" class="mcell ${has.has(mm) ? 'has' : ''}" data-mm="${mm}" ${mm === m ? 'aria-current="date"' : ''}
                aria-label="${y}년 ${mm}월 ${has.has(mm) ? '데이터 있음' : '데이터 없음'}">
                <span>${mm}월</span><span class="dot" aria-hidden="true">${has.has(mm) ? '●' : '○'}</span></button>`).join('')}
          </div>
          <p class="month-legend">● 데이터 있음 &nbsp; ○ 데이터 없음</p>
        </section>
        <nav class="pager" aria-label="달 이동">
          <a class="btn" href="#/month/${prev.year}/${prev.month}">← ${prev.year !== y ? `${prev.year}년 ` : ''}${prev.month}월</a>
          <div class="title"><h2>${UI.ymLabel(y, m)} 급여명세</h2></div>
          <a class="btn" href="#/month/${next.year}/${next.month}">${next.year !== y ? `${next.year}년 ` : ''}${next.month}월 →</a>
        </nav>
        <div id="detail"></div>
      </div>`;
    UI.$$('[data-yy]').forEach((btn) => btn.onclick = () => {
      const yy = Number(btn.dataset.yy);
      const list = recs.filter((r) => r.year === yy);
      go(`#/month/${yy}/${list.length ? list[list.length - 1].month : m}`);
    });
    UI.$$('[data-mm]').forEach((btn) => btn.onclick = () => go(`#/month/${y}/${btn.dataset.mm}`));

    const box = document.getElementById('detail');
    if (!rec) {
      box.innerHTML = `<section class="block empty-state"><h2>${UI.ymLabel(y, m)}의 급여명세서 데이터가 없습니다.</h2>
        <p>이 달의 명세서를 올리면 여기에 표시됩니다.</p><a class="btn primary" href="#/upload">명세서 올리기</a></section>`;
      if (recs.length) box.insertAdjacentHTML('beforeend', trendBlock());
      if (recs.length) drawTrend(recs, y, m);
      return;
    }
    if (edit) return renderMonthEdit(box, rec);

    const issues = PS.validate(rec);
    box.innerHTML = `<div class="stack">
      ${splitHero(rec)}
      ${factsBlock(rec, true)}
      ${UI.issueBox(issues, '확인 필요')}
      <div class="ledgers">${GROUPS.map((g) => ledgerBlock(rec, g)).join('')}</div>
      <p class="small muted">항목 이름 옆 ⌄ 표시를 누르면 명세서의 계산근거를 볼 수 있습니다.</p>
      <div class="row">
        <a class="btn primary" href="#/month/${y}/${m}/edit">수정</a>
        ${rec.userEdited && rec.original ? '<button type="button" class="btn" id="show-orig">자동 추출값과 비교</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn danger" id="del-rec">이 달 기록 삭제</button>
      </div>
      ${trendBlock()}
    </div>`;
    box.querySelector('#del-rec').onclick = async () => {
      if (!(await UI.confirm(`${UI.ymLabel(y, m)} 기록을 삭제할까요?`, '삭제하면 되돌릴 수 없습니다. 필요하면 먼저 데이터 관리에서 백업해 두세요.', '삭제', true))) return;
      await S.remove(rec.id);
      UI.toast(`${UI.ymLabel(y, m)} 기록을 삭제했습니다`);
      V.month([y, m]);
    };
    const so = box.querySelector('#show-orig');
    if (so) so.onclick = () => {
      const rows = A.diff(Object.assign({ basicInfo: {} }, rec.original), rec);
      const gl = { payments: '급여', taxes: '세금', deductions: '공제', total: '합계', info: '기본' };
      const cell = (v) => (v === undefined ? '<span class="muted">없음</span>' : typeof v === 'number' ? U.fmt(v) : esc(v == null ? '—' : v));
      UI.modal({
        title: '자동 추출값과 현재 값',
        body: rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>항목</th><th class="num">자동 추출</th><th class="num">현재</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${gl[r.group]}</td><td>${esc(r.name)}</td><td class="num">${cell(r.a)}</td><td class="num">${cell(r.b)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p>차이가 없습니다.</p>',
        buttons: [{ label: '닫기', value: 1 }],
      });
    };
    drawTrend(recs, y, m);
  };

  function trendBlock() {
    return `<section class="block">
      <div class="block-head"><h2>최근 12개월 추세</h2></div>
      <label class="f"><span>볼 항목</span><select class="input" id="trend-metric"></select></label>
      <div class="chart-box" style="margin-top:12px"><canvas id="trend-chart" aria-label="최근 12개월 추세 그래프" role="img"></canvas></div>
      <p class="chart-note">막대가 없는 달은 명세서가 없거나, 그 달에 해당 항목이 없는 경우입니다(0원과 구분).</p>
    </section>`;
  }
  function drawTrend(recs, y, m) {
    const sel = document.getElementById('trend-metric');
    if (!sel) return;
    const keys = new Set(A.TOTALS.map((t) => t.key));
    const cat = A.catalog(recs);
    Object.keys(cat).forEach((g) => cat[g].forEach((n) => keys.add(`${g}:${n}`)));
    if (!keys.has(monthState.metric)) monthState.metric = 'total:netPay';
    sel.innerHTML = UI.metricOptions(recs, monthState.metric);
    const draw = () => {
      const key = sel.value;
      monthState.metric = key;
      const series = A.lastN(recs, y, m, 12);
      UI.chart(document.getElementById('trend-chart'), {
        type: 'bar',
        data: {
          labels: series.map((s) => (s.month === 1 || s === series[0] ? `${String(s.year).slice(2)}.${s.month}월` : `${s.month}월`)),
          datasets: [{
            label: A.metricLabel(key),
            data: series.map((s) => A.value(s.rec, key)),
            backgroundColor: series.map((s) => (s.year === y && s.month === m ? UI.metricColor(key) : UI.metricColor(key) + '88')),
            borderRadius: 3,
          }],
        },
        options: { plugins: { legend: { display: false } } },
      });
    };
    sel.onchange = draw;
    draw();
  }

  function renderMonthEdit(box, rec) {
    box.innerHTML = `<div class="notice info">수정한 값은 ${UI.ymLabel(rec.year, rec.month)} 기록에만 반영됩니다. 다른 달은 바뀌지 않습니다. 자동 추출값은 따로 보관됩니다.</div><div id="ed" style="margin-top:16px"></div>
      <div class="editor-actions">
        <a class="btn" href="#/month/${rec.year}/${rec.month}">취소</a>
        <button type="button" class="btn primary" id="ed-save">저장</button>
      </div>`;
    const ed = PS.createEditor(rec, { fileLabel: rec.userEdited ? '직접 수정한 기록' : null });
    box.querySelector('#ed').appendChild(ed.el);
    box.querySelector('#ed-save').onclick = async () => {
      const { draft, errors } = ed.read();
      const hard = PS.validate(draft).filter((i) => i.level === 'error');
      if (errors.length || hard.length) {
        await UI.modal({ title: '저장할 수 없습니다', body: `<ul>${errors.concat(hard.map((h) => h.message)).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`, buttons: [{ label: '돌아가서 고치기', value: 1, cls: 'primary' }] });
        return;
      }
      const updated = PS.applyEdit(rec, draft);
      if (updated.id !== rec.id) {
        const clash = await S.get(updated.id);
        if (clash) {
          await UI.modal({ title: '연·월을 바꿀 수 없습니다', body: `<p>${UI.ymLabel(updated.year, updated.month)} 기록이 이미 있습니다. 그 달 기록을 먼저 정리한 뒤 다시 시도해 주세요.</p>`, buttons: [{ label: '확인', value: 1 }] });
          return;
        }
        if (!(await UI.confirm('연·월을 옮길까요?', `이 기록을 ${UI.ymLabel(rec.year, rec.month)}에서 ${UI.ymLabel(updated.year, updated.month)}(으)로 옮깁니다.`, '옮기기'))) return;
      }
      try {
        await S.put(updated);
        if (updated.id !== rec.id) await S.remove(rec.id);
      } catch (e) { UI.modal({ title: '저장하지 못했습니다', body: `<p>${esc(e.message)}</p>`, buttons: [{ label: '닫기', value: 1 }] }); return; }
      UI.toast('수정 내용을 저장했습니다');
      go(`#/month/${updated.year}/${updated.month}`);
    };
  }

  /* ---------- 연도별 분석 ---------- */
  const yearState = { metric: 'total:netPay' };
  V.year = async (params) => {
    const recs = await S.all();
    if (!recs.length) {
      main().innerHTML = `<section class="block empty-state"><h1>분석할 기록이 아직 없습니다</h1><p>명세서를 올리면 연도별 합계와 월별 변화를 볼 수 있습니다.</p><a class="btn primary" href="#/upload">명세서 올리기</a></section>`;
      return;
    }
    const years = A.years(recs);
    let y = Number(params[0]) || years[years.length - 1];
    if (!years.includes(y)) y = years[years.length - 1];
    const sums = years.map((yy) => A.yearSummary(recs, yy));
    const s = sums.find((x) => x.year === y);
    const list = recs.filter((r) => r.year === y);
    const byM = new Map(list.map((r) => [r.month, r]));
    const changes = A.changes(recs, y);

    main().innerHTML = `
      <div class="page-head"><div><h1>연도별 분석</h1><p>저장된 ${years.length}개 연도, ${recs.length}개월의 기록입니다.</p></div></div>
      <div class="stack">
        <section class="block">
          <div class="year-pick" role="group" aria-label="연도 선택">
            ${years.map((yy) => `<button class="chip" type="button" data-yy="${yy}" aria-pressed="${yy === y}">${yy}</button>`).join('')}
          </div>
        </section>
        <section class="block">
          <div class="block-head"><h2>${y}년 합계</h2><span class="small muted">${s.months}개월 기록</span></div>
          <div class="split-legend">
            <div class="leg pay"><span class="k">총 급여액</span><span class="v">${UI.won(s.paymentTotal)}</span></div>
            <div class="leg tax"><span class="k">총 세금</span><span class="v">${UI.won(s.taxTotal)}</span></div>
            <div class="leg ded"><span class="k">총 공제액</span><span class="v">${UI.won(s.deductionTotal)}</span></div>
            <div class="leg net"><span class="k">총 실수령액</span><span class="v">${UI.won(s.netPay)}</span></div>
          </div>
          <hr class="rule">
          <div class="split-legend">
            <div class="leg pay"><span class="k">월평균 급여</span><span class="v">${UI.won(s.avgPayment)}</span></div>
            <div class="leg tax"><span class="k">월평균 세금</span><span class="v">${UI.won(s.avgTax)}</span></div>
            <div class="leg ded"><span class="k">월평균 공제</span><span class="v">${UI.won(s.avgDeduction)}</span></div>
            <div class="leg net"><span class="k">월평균 실수령액</span><span class="v">${UI.won(s.avgNet)}</span></div>
          </div>
          <p class="small muted" style="margin-top:10px">월평균은 명세서가 저장된 달만으로 계산합니다.${s.incomplete ? ' 합계가 비어 있는 달은 계산에서 빠졌습니다.' : ''}</p>
        </section>

        <section class="block">
          <div class="block-head"><h2>${y}년 월별 표</h2><span class="small muted">행을 누르면 그 달 명세로 이동</span></div>
          <div class="table-wrap"><table class="grid cards">
            <thead><tr><th>월</th><th>보직</th><th class="num">호봉</th><th class="num">근무년수</th><th class="num">급여총액</th><th class="num">세금총액</th><th class="num">공제총액</th><th class="num">실수령액</th></tr></thead>
            <tbody>${Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => {
              const r = byM.get(mm);
              if (!r) return `<tr class="empty clickable" data-go="#/month/${y}/${mm}"><td class="head-cell">${mm}월</td><td data-l="보직">-</td><td class="num" data-l="호봉">-</td><td class="num" data-l="근무년수">-</td><td class="num" data-l="급여총액">-</td><td class="num" data-l="세금총액">-</td><td class="num" data-l="공제총액">-</td><td class="num" data-l="실수령액">-</td></tr>`;
              return `<tr class="clickable" data-go="#/month/${y}/${mm}" tabindex="0">
                <td class="head-cell">${mm}월${r.userEdited ? ' <span class="tag edit">수정</span>' : ''}</td>
                <td data-l="보직">${esc(b(r, '보직구분') || '-')}</td>
                <td class="num" data-l="호봉">${r.payGrade == null ? '-' : r.payGrade}</td>
                <td class="num" data-l="근무년수">${r.careerYears == null ? '-' : r.careerYears}</td>
                <td class="num c-pay" data-l="급여총액">${r.paymentTotal == null ? '-' : U.fmt(r.paymentTotal)}</td>
                <td class="num c-tax" data-l="세금총액">${r.taxTotal == null ? '-' : U.fmt(r.taxTotal)}</td>
                <td class="num c-ded" data-l="공제총액">${r.deductionTotal == null ? '-' : U.fmt(r.deductionTotal)}</td>
                <td class="num c-net" data-l="실수령액">${r.netPay == null ? '-' : U.fmt(r.netPay)}</td></tr>`;
            }).join('')}</tbody>
          </table></div>
        </section>

        <section class="block">
          <div class="block-head"><h2>${y}년 변동 사항</h2></div>
          ${changes.length ? `<ul class="lines">${changes.map((c) => `<li class="line"><div class="line-main"><span class="line-name">${c.month}월 · ${esc(c.label)}</span><span class="line-amt">${esc(c.from)} → ${esc(c.to)}</span></div></li>`).join('')}</ul>`
            : '<p class="muted">저장된 기록 기준으로 호봉·근무년수·보직·담당과목의 변동이 없습니다.</p>'}
        </section>

        <section class="block">
          <div class="block-head"><h2>${y}년 월별 실수령액</h2></div>
          <div class="chart-box"><canvas id="c-net" role="img" aria-label="${y}년 월별 실수령액 그래프"></canvas></div>
        </section>

        <section class="block">
          <div class="block-head"><h2>항목별 월 변화</h2></div>
          <label class="f"><span>볼 항목 (저장된 기록에 있는 항목만 표시)</span><select class="input" id="y-metric"></select></label>
          <div class="chart-box" style="margin-top:12px"><canvas id="c-item" role="img" aria-label="선택한 항목의 월별 변화 그래프"></canvas></div>
          <p class="chart-note">점이 끊긴 달은 명세서가 없거나 그 달에 해당 항목이 없는 경우입니다.</p>
        </section>

        <section class="block">
          <div class="block-head"><h2>연도별 합계 비교</h2></div>
          <div class="chart-box"><canvas id="c-years" role="img" aria-label="연도별 급여총액, 세금총액, 공제총액, 실수령액 그래프"></canvas></div>
          <div class="table-wrap" style="margin-top:14px"><table class="grid cards">
            <thead><tr><th>연도</th><th class="num">기록</th><th class="num">총 급여액</th><th class="num">총 세금</th><th class="num">총 공제액</th><th class="num">총 실수령액</th><th class="num">월평균 실수령액</th></tr></thead>
            <tbody>${sums.map((x) => `<tr class="clickable" data-go="#/year/${x.year}" tabindex="0"><td class="head-cell">${x.year}년</td>
              <td class="num" data-l="기록">${x.months}개월</td>
              <td class="num c-pay" data-l="총 급여액">${U.fmt(x.paymentTotal)}</td>
              <td class="num c-tax" data-l="총 세금">${U.fmt(x.taxTotal)}</td>
              <td class="num c-ded" data-l="총 공제액">${U.fmt(x.deductionTotal)}</td>
              <td class="num c-net" data-l="총 실수령액">${U.fmt(x.netPay)}</td>
              <td class="num" data-l="월평균 실수령액">${U.fmt(x.avgNet)}</td></tr>`).join('')}</tbody>
          </table></div>
          <p class="chart-note">연도마다 저장된 개월 수가 다르면 합계를 그대로 비교하기 어렵습니다. 월평균도 함께 보세요.</p>
        </section>
      </div>`;

    UI.$$('[data-yy]').forEach((btn) => btn.onclick = () => go(`#/year/${btn.dataset.yy}`));
    UI.$$('tr[data-go]').forEach((tr) => {
      tr.onclick = () => go(tr.dataset.go);
      tr.onkeydown = (e) => { if (e.key === 'Enter') go(tr.dataset.go); };
    });

    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    UI.chart(document.getElementById('c-net'), {
      type: 'bar',
      data: { labels: monthLabels, datasets: [{ label: '실수령액', data: monthLabels.map((_, i) => (byM.get(i + 1) || {}).netPay ?? null), backgroundColor: UI.css('--net'), borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } } },
    });

    const sel = document.getElementById('y-metric');
    sel.innerHTML = UI.metricOptions(recs, yearState.metric);
    if (sel.value !== yearState.metric) yearState.metric = sel.value;
    const drawItem = () => {
      yearState.metric = sel.value;
      const key = sel.value;
      UI.chart(document.getElementById('c-item'), {
        type: 'line',
        data: { labels: monthLabels, datasets: [{ label: A.metricLabel(key), data: monthLabels.map((_, i) => A.value(byM.get(i + 1), key)), borderColor: UI.metricColor(key), backgroundColor: UI.metricColor(key), spanGaps: false, tension: 0, pointRadius: 4 }] },
        options: { plugins: { legend: { display: false } } },
      });
    };
    sel.onchange = drawItem;
    drawItem();

    UI.chart(document.getElementById('c-years'), {
      type: 'bar',
      data: {
        labels: sums.map((x) => `${x.year}년`),
        datasets: [
          { label: '급여총액', data: sums.map((x) => x.paymentTotal), backgroundColor: UI.css('--pay'), borderRadius: 3 },
          { label: '세금총액', data: sums.map((x) => x.taxTotal), backgroundColor: UI.css('--tax'), borderRadius: 3 },
          { label: '공제총액', data: sums.map((x) => x.deductionTotal), backgroundColor: UI.css('--ded'), borderRadius: 3 },
          { label: '실수령액', data: sums.map((x) => x.netPay), backgroundColor: UI.css('--net'), borderRadius: 3 },
        ],
      },
    });
  };

  /* ---------- 연도 비교 ---------- */
  const cmpState = { basis: 'same', base: null, target: null, monthKey: 'total:netPay', cumField: 'netPay', upto: null };
  const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  const signed = (v) => (v == null ? '—' : `${v > 0 ? '▲ ' : v < 0 ? '▼ ' : ''}${U.fmt(Math.abs(v))}`);
  const dcls = (v) => (v == null || v === 0 ? 'd-zero' : v > 0 ? 'd-up' : 'd-down');
  const monthList = (ms) => (ms && ms.length ? ms.map((m) => `${m}월`).join(', ') : '없음');

  V.compare = async (params) => {
    const recs = await S.all();
    const years = A.years(recs);
    if (years.length < 2) {
      main().innerHTML = `<div class="page-head"><div><h1>연도 비교</h1></div></div>
        <section class="block empty-state"><h2>비교하려면 두 해 이상의 기록이 필요합니다</h2>
        <p>지금은 ${years.length ? `${years[0]}년 기록만 있습니다` : '저장된 기록이 없습니다'}. 나이스에서 지난해 급여명세서를 내려받아 올리면 연도끼리 비교할 수 있습니다.</p>
        <a class="btn primary" href="#/upload">명세서 올리기</a></section>`;
      return;
    }
    if (params[0] === 'same' || params[0] === 'annual') cmpState.basis = params[0];
    if (!years.includes(cmpState.target)) cmpState.target = years[years.length - 1];
    if (!years.includes(cmpState.base) || cmpState.base === cmpState.target) {
      const earlier = years.filter((y) => y < cmpState.target);
      cmpState.base = earlier.length ? earlier[earlier.length - 1] : years.find((y) => y !== cmpState.target);
    }
    const { basis, base, target } = cmpState;
    const c = A.comparePair(recs, base, target, basis);
    const ov = A.yearOverview(recs, basis);
    const bur = A.burden(recs, years, basis);
    const tMonths = A.monthsOf(recs, target);
    if (!cmpState.upto || cmpState.upto > 12) cmpState.upto = tMonths[tMonths.length - 1] || 12;
    const cum = A.cumulative(recs, base, target, cmpState.upto, cmpState.cumField);
    const basisNote = basis === 'same'
      ? `두 해 모두 기록이 있는 달만 비교합니다. 비교한 달: <strong>${monthList(c.common)}</strong>`
      : `각 해에 저장된 모든 달을 합산합니다. ${base}년 ${c.monthsBase.length}개월 · ${target}년 ${c.monthsTarget.length}개월`;
    const yOpt = (sel, except) => years.filter((y) => y !== except).map((y) => `<option value="${y}" ${y === sel ? 'selected' : ''}>${y}년</option>`).join('');

    main().innerHTML = `
      <div class="page-head"><div><h1>연도 비교</h1><p>두 해의 급여를 나란히 놓고 달라진 점을 봅니다.</p></div></div>
      <div class="stack">
        <section class="block cmp-controls">
          <div class="seg" role="group" aria-label="비교 기준">
            <button type="button" class="seg-btn" data-basis="same" aria-pressed="${basis === 'same'}">같은 달끼리</button>
            <button type="button" class="seg-btn" data-basis="annual" aria-pressed="${basis === 'annual'}">연간 합계</button>
          </div>
          <div class="form-grid cmp-years">
            <label class="f"><span>기준 연도</span><select class="input" id="cmp-target">${yOpt(target)}</select></label>
            <label class="f"><span>비교 연도</span><select class="input" id="cmp-base">${yOpt(base, target)}</select></label>
          </div>
          <p class="small" style="margin-top:10px">${basisNote}</p>
          ${c.mismatch ? `<div class="notice warn" style="margin-top:10px">⚠ 두 해의 기록 개월 수(또는 달)가 달라 연간 합계를 그대로 비교하기 어렵습니다. 공정한 비교는 <strong>같은 달끼리</strong> 기준을 보세요.</div>` : ''}
          ${c.empty ? `<div class="notice warn" style="margin-top:10px">⚠ ${basis === 'same' ? `${base}년과 ${target}년에 함께 기록된 달이 없어 비교할 수 없습니다.` : '비교할 기록이 없습니다.'}</div>` : ''}
        </section>

        <section class="block">
          <div class="block-head"><h2>연도 간 증감</h2><span class="small muted">${base}년 → ${target}년</span></div>
          <div class="table-wrap"><table class="grid cards">
            <thead><tr><th>구분</th><th class="num">${base}년</th><th class="num">${target}년</th><th class="num">증감액</th><th class="num">증감률</th></tr></thead>
            <tbody>${c.rows.map((r) => `<tr><td class="head-cell">${r.label}</td>
              <td class="num" data-l="${base}년">${r.a == null ? '—' : U.fmt(r.a)}</td>
              <td class="num" data-l="${target}년">${r.b == null ? '—' : U.fmt(r.b)}</td>
              <td class="num ${dcls(r.diff)}" data-l="증감액">${signed(r.diff)}</td>
              <td class="num ${dcls(r.diff)}" data-l="증감률">${pct(r.pct)}</td></tr>`).join('')}
              <tr><td class="head-cell">월평균 실수령액</td>
              <td class="num" data-l="${base}년">${c.avgNet.a == null ? '—' : U.fmt(c.avgNet.a)}</td>
              <td class="num" data-l="${target}년">${c.avgNet.b == null ? '—' : U.fmt(c.avgNet.b)}</td>
              <td class="num ${dcls(c.avgNet.diff)}" data-l="증감액">${signed(c.avgNet.diff)}</td>
              <td class="num ${dcls(c.avgNet.diff)}" data-l="증감률">${pct(c.avgNet.pct)}</td></tr>
            </tbody></table></div>
          <p class="chart-note">▲는 늘어남, ▼는 줄어듦입니다. 세금·공제가 늘어난 것은 실수령에 불리한 변화입니다. 합계가 비어 있는 달이 섞이면 '—'로 표시합니다.</p>
          <h3 style="margin:18px 0 6px">전체 연도 실수령액 추이</h3>
          <div class="table-wrap"><table class="grid cards">
            <thead><tr><th>연도</th><th class="num">기록</th><th class="num">${basis === 'same' ? '비교한 달' : '실수령액 합계'}</th><th class="num">직전 연도 대비</th><th class="num">증감률</th></tr></thead>
            <tbody>${ov.map((o) => `<tr><td class="head-cell">${o.year}년</td>
              <td class="num" data-l="기록">${o.months}개월</td>
              <td class="num" data-l="${basis === 'same' ? '비교한 달' : '실수령액 합계'}">${basis === 'same' ? (o.prev ? `${o.cmpMonths}개월 (${o.prev}년과)` : '—') : U.fmt(o.net)}</td>
              <td class="num ${o.prev ? dcls(o.netDelta.diff) : ''}" data-l="직전 연도 대비">${o.prev ? `${signed(o.netDelta.diff)}${o.mismatch ? ' ⚠' : ''}` : '—'}</td>
              <td class="num ${o.prev ? dcls(o.netDelta.diff) : ''}" data-l="증감률">${o.prev ? pct(o.netDelta.pct) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
          ${basis === 'annual' && ov.some((o) => o.mismatch) ? '<p class="chart-note">⚠ 표시는 두 해의 기록 개월 수가 달라 단순 비교가 어려운 경우입니다.</p>' : ''}
        </section>

        <section class="block">
          <div class="block-head"><h2>같은 달 연도 비교</h2></div>
          <label class="f"><span>볼 항목</span><select class="input" id="cmp-month-metric"></select></label>
          <div class="chart-box" style="margin-top:12px"><canvas id="c-samemonth" role="img" aria-label="월별로 연도를 겹쳐 비교한 그래프"></canvas></div>
          <p class="chart-note">연도마다 선 하나입니다. 끊긴 곳은 명세서가 없거나 그 달에 해당 항목이 없는 달입니다. 최근 5개 연도까지 표시합니다.</p>
        </section>

        <section class="block">
          <div class="block-head"><h2>항목별 연간 비교</h2><span class="small muted">${base}년 → ${target}년</span></div>
          ${c.empty ? '<p class="muted">비교할 기록이 없습니다.</p>' : ['payments', 'taxes', 'deductions'].map((g) => {
            const list = c.items[g];
            if (!list.length) return '';
            const cls = { payments: 'pay', taxes: 'tax', deductions: 'ded' }[g];
            const val = (inX, v, mX, mAll) => (inX ? `${U.fmt(v)}${mX !== mAll ? `<small>(${mX}개월)</small>` : ''}` : '<span class="muted">없음</span>');
            return `<h3 class="grp-${cls}" style="margin:14px 0 2px">${A.GROUP_LABEL[g]}</h3>
              <ul class="lines cmp-lines">${list.map((it) => `<li class="line"><div class="line-main">
                <span class="line-name">${esc(it.name)}${!it.inA ? '<span class="tag file">신규</span>' : ''}${!it.inB ? '<span class="tag file">없어짐</span>' : ''}
                  <span class="cmp-vals">${base} ${val(it.inA, it.a, it.monthsA, c.monthsBase.length)} → ${target} ${val(it.inB, it.b, it.monthsB, c.monthsTarget.length)}</span></span>
                <span class="line-amt cmp-d ${dcls(it.diff)}">${signed(it.diff)}${it.diff == null ? "" : `<small>${pct(it.pct)}</small>`}</span>
              </div></li>`).join('')}</ul>`;
          }).join('')}
          <p class="chart-note">괄호 안 개월 수는 그 항목이 실제로 있었던 달의 수입니다(명절휴가비처럼 특정 달에만 나오는 항목).</p>
        </section>

        <section class="block">
          <div class="block-head"><h2>세금·공제 부담률 추이</h2><span class="small muted">급여총액 대비</span></div>
          ${basis === 'same' ? `<p class="small">모든 연도에 공통으로 기록된 달만 사용: <strong>${monthList(bur.months)}</strong></p>` : '<p class="small">각 해에 저장된 모든 달을 사용합니다. 비율이라 개월 수 차이의 영향은 작지만, 명절휴가비가 있는 달이 빠진 해는 비율이 달라질 수 있습니다.</p>'}
          ${basis === 'same' && !bur.months.length ? '<div class="notice warn" style="margin-top:10px">⚠ 모든 연도에 공통으로 기록된 달이 없어 이 기준으로는 계산할 수 없습니다. 연간 합계 기준을 이용하세요.</div>' : `
          <div class="chart-box" style="margin-top:12px"><canvas id="c-burden" role="img" aria-label="연도별 세금과 공제 부담률 그래프"></canvas></div>
          <div class="table-wrap" style="margin-top:12px"><table class="grid cards">
            <thead><tr><th>연도</th><th class="num">개월</th><th class="num">세금 비율</th><th class="num">공제 비율</th><th class="num">세금+공제</th></tr></thead>
            <tbody>${bur.rows.map((r) => `<tr><td class="head-cell">${r.year}년</td><td class="num" data-l="개월">${r.months}</td>
              <td class="num c-tax" data-l="세금 비율">${r.taxRate == null ? '—' : r.taxRate.toFixed(1) + '%'}</td>
              <td class="num c-ded" data-l="공제 비율">${r.dedRate == null ? '—' : r.dedRate.toFixed(1) + '%'}</td>
              <td class="num" data-l="세금+공제"><strong>${r.totalRate == null ? '—' : r.totalRate.toFixed(1) + '%'}</strong></td></tr>`).join('')}</tbody>
          </table></div>`}
        </section>

        <section class="block">
          <div class="block-head"><h2>같은 기간 누적 비교</h2><span class="small muted">${base}년 vs ${target}년</span></div>
          <div class="form-grid">
            <label class="f"><span>항목</span><select class="input" id="cum-field">
              ${['netPay', 'paymentTotal', 'taxTotal', 'deductionTotal'].map((f) => `<option value="${f}" ${f === cmpState.cumField ? 'selected' : ''}>${A.FIELD_LABEL[f]}</option>`).join('')}</select></label>
            <label class="f"><span>기간</span><select class="input" id="cum-upto">
              ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}" ${m === cmpState.upto ? 'selected' : ''}>1월~${m}월</option>`).join('')}</select></label>
          </div>
          <div class="split-legend" style="margin-top:14px">
            <div class="leg" style="--c:var(--line-strong)"><span class="k">${base}년 누적</span><span class="v">${UI.won(cum.total.a)}</span></div>
            <div class="leg net"><span class="k">${target}년 누적</span><span class="v">${UI.won(cum.total.b)}</span></div>
            <div class="leg" style="--c:var(--ink-2)"><span class="k">차이</span><span class="v ${dcls(cum.total.diff)}">${signed(cum.total.diff)}</span></div>
            <div class="leg" style="--c:var(--ink-2)"><span class="k">증감률</span><span class="v ${dcls(cum.total.diff)}">${pct(cum.total.pct)}</span></div>
          </div>
          <p class="small" style="margin-top:10px">누적에 넣은 달: <strong>${monthList(cum.months)}</strong>${cum.missing.length ? ` · 한쪽이라도 기록이 없어 뺀 달: ${monthList(cum.missing)}` : ''}</p>
          ${cum.broken ? '<p class="small" style="color:var(--warn)">⚠ 합계가 비어 있는 달이 있어 그 달은 0으로 더했습니다. 해당 달 기록을 확인해 주세요.</p>' : ''}
          ${cum.months.length ? '<div class="chart-box" style="margin-top:12px"><canvas id="c-cum" role="img" aria-label="같은 기간 누적 비교 그래프"></canvas></div>' : '<div class="notice warn" style="margin-top:10px">⚠ 이 기간에 두 해 모두 기록된 달이 없습니다.</div>'}
        </section>
      </div>`;

    UI.$$('[data-basis]').forEach((b2) => b2.onclick = () => { cmpState.basis = b2.dataset.basis; V.compare([]); });
    document.getElementById('cmp-target').onchange = (e) => { cmpState.target = Number(e.target.value); cmpState.base = null; cmpState.upto = null; V.compare([]); };
    document.getElementById('cmp-base').onchange = (e) => { cmpState.base = Number(e.target.value); V.compare([]); };
    document.getElementById('cum-field').onchange = (e) => { cmpState.cumField = e.target.value; V.compare([]); };
    document.getElementById('cum-upto').onchange = (e) => { cmpState.upto = Number(e.target.value); V.compare([]); };

    const palette = [UI.css('--net'), UI.css('--pay'), UI.css('--tax'), UI.css('--ded'), UI.css('--muted')];
    const recentYears = years.slice(-5).reverse();
    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    const sel = document.getElementById('cmp-month-metric');
    const keys = new Set(A.TOTALS.map((t) => t.key));
    const cat = A.catalog(recs);
    Object.keys(cat).forEach((g) => cat[g].forEach((n) => keys.add(`${g}:${n}`)));
    if (!keys.has(cmpState.monthKey)) cmpState.monthKey = 'total:netPay';
    sel.innerHTML = UI.metricOptions(recs, cmpState.monthKey);
    const drawSame = () => {
      cmpState.monthKey = sel.value;
      const byId = new Map(recs.map((r) => [r.id, r]));
      UI.chart(document.getElementById('c-samemonth'), {
        type: 'line',
        data: {
          labels: monthLabels,
          datasets: recentYears.map((y, i) => ({
            label: `${y}년`,
            data: monthLabels.map((_, m) => A.value(byId.get(U.ym(y, m + 1)), sel.value)),
            borderColor: palette[i], backgroundColor: palette[i],
            borderWidth: i === 0 ? 3 : 2, borderDash: i === 0 ? [] : [5, 4], pointRadius: 4, spanGaps: false, tension: 0,
          })),
        },
      });
    };
    sel.onchange = drawSame;
    drawSame();

    const cb = document.getElementById('c-burden');
    if (cb) {
      UI.chart(cb, {
        type: 'line', unit: '%',
        data: {
          labels: bur.rows.map((r) => `${r.year}년`),
          datasets: [
            { label: '세금+공제', data: bur.rows.map((r) => r.totalRate), borderColor: UI.css('--ink-2'), backgroundColor: UI.css('--ink-2'), borderWidth: 3, pointRadius: 4 },
            { label: '공제', data: bur.rows.map((r) => r.dedRate), borderColor: UI.css('--ded'), backgroundColor: UI.css('--ded'), pointRadius: 4 },
            { label: '세금', data: bur.rows.map((r) => r.taxRate), borderColor: UI.css('--tax'), backgroundColor: UI.css('--tax'), pointRadius: 4 },
          ],
        },
        options: {
          plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? '자료 없음' : ctx.parsed.y.toFixed(1) + '%'}` } } },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` } } },
        },
      });
    }
    const cc = document.getElementById('c-cum');
    if (cc) {
      UI.chart(cc, {
        type: 'line',
        data: {
          labels: cum.series.map((p2) => `${p2.month}월`),
          datasets: [
            { label: `${base}년`, data: cum.series.map((p2) => p2.a), borderColor: UI.css('--muted'), backgroundColor: UI.css('--muted'), borderDash: [5, 4], pointRadius: 3, spanGaps: true },
            { label: `${target}년`, data: cum.series.map((p2) => p2.b), borderColor: UI.css('--net'), backgroundColor: UI.css('--net'), borderWidth: 3, pointRadius: 3, spanGaps: true },
          ],
        },
      });
    }
  };

  /* ---------- 데이터 관리 ---------- */
  V.data = async () => {
    const recs = await S.all();
    let est = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        est = `이 앱이 쓰는 저장공간 약 ${Math.max(1, Math.round((e.usage || 0) / 1024)).toLocaleString('ko-KR')}KB`;
      }
    } catch (e) { /* 무시 */ }
    let persisted = null;
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { /* 무시 */ }
    const years = A.years(recs);
    main().innerHTML = `
      <div class="page-head"><div><h1>데이터 관리</h1><p>기록 ${recs.length}건 · 이 브라우저 안에만 저장되어 있습니다.</p></div></div>
      <div class="stack">
        <section class="block">
          <div class="block-head"><h2>백업</h2></div>
          <p>모든 기록을 암호화된 파일 하나로 내려받습니다. 다른 기기나 브라우저로 옮길 때, 브라우저 데이터를 지우기 전에 사용하세요.</p>
          <div class="notice warn" style="margin-top:10px"><strong>⚠ 이 백업 파일은 앱 PIN(숫자 4자리)으로만 보호됩니다.</strong>
            파일이 다른 사람 손에 들어가면 PIN을 짧은 시간에 알아낼 수 있습니다. 메신저·메일로 보내지 말고, 본인만 쓰는 PC나 비공개 저장공간에만 보관하세요.
            복원할 때는 <strong>백업을 만든 시점의 PIN</strong>이 필요합니다.</div>
          <div class="row" style="margin-top:12px"><button type="button" class="btn primary" id="bk" ${recs.length ? '' : 'disabled'}>백업 파일 내려받기</button></div>
        </section>
        <section class="block">
          <div class="block-head"><h2>복원</h2></div>
          <p>이 앱에서 만든 백업 파일을 불러옵니다. 백업을 만든 시점의 PIN을 입력한 뒤, 방식을 고르고 결과를 미리 확인합니다.</p>
          <div class="row" style="margin-top:12px"><label class="btn"><input type="file" id="rs" accept=".json,application/json" class="sr">백업 파일 선택</label></div>
          <div id="rs-plan"></div>
        </section>
        <section class="block">
          <div class="block-head"><h2>저장된 기록</h2></div>
          ${recs.length ? years.map((yy) => `<h3 style="margin:10px 0 4px">${yy}년</h3><ul class="lines">${recs.filter((r) => r.year === yy).map((r) => `
            <li class="line"><div class="line-main"><a class="line-name" href="#/month/${r.year}/${r.month}">${r.month}월${r.userEdited ? '<span class="tag edit">수정</span>' : ''}</a>
            <span class="row"><span class="line-amt small muted">${r.sourceFileType === 'pdf' ? 'PDF' : r.sourceFileType === 'excel' ? 'Excel' : '직접'}</span>
            <button type="button" class="btn small danger" data-del="${esc(r.id)}" aria-label="${r.year}년 ${r.month}월 기록 삭제">삭제</button></span></div></li>`).join('')}</ul>`).join('') : '<p class="muted">저장된 기록이 없습니다.</p>'}
          ${recs.length ? '<div class="row" style="margin-top:14px"><button type="button" class="btn danger" id="del-all">모든 기록 삭제</button></div>' : ''}
        </section>
        <section class="block">
          <div class="block-head"><h2>앱 잠금</h2></div>
          <p>앱을 완전히 종료했다가 다시 열면 PIN을 묻습니다. 저장된 기록은 PIN으로 암호화되어 있습니다.</p>
          <p class="small muted" style="margin-top:6px">홈 화면으로 나가기만 하면 앱이 잠기지 않습니다. 휴대폰을 잠시 맡길 때는 <strong>지금 잠그기</strong>를 누르세요.</p>
          <div class="row" style="margin-top:12px">
            <button type="button" class="btn" id="lock-now">지금 잠그기</button>
            <button type="button" class="btn" id="pin-change">PIN 변경</button>
          </div>
        </section>
        <section class="block">
          <div class="block-head"><h2>저장 방식과 개인정보</h2></div>
          <ul style="margin:0;padding-left:18px">
            <li>명세서 파일은 이 기기의 브라우저 안에서만 읽고, 어떤 서버로도 보내지 않습니다.</li>
            <li>저장된 기록은 PIN에서 만든 키로 암호화(AES-256)되며, PIN 자체는 어디에도 저장하지 않습니다.</li>
            <li>PIN을 잊으면 기록을 되살릴 방법이 없습니다. 초기화한 뒤 백업으로 복원해야 합니다.</li>
            <li>원본 파일은 저장하지 않고, 확인을 마친 급여 숫자와 기본정보만 저장합니다.</li>
            <li>성명과 PDF 하단의 접속 정보(IP·출력 시각)는 읽거나 저장하지 않습니다.</li>
            <li>브라우저의 사이트 데이터를 지우면 기록도 지워집니다. 백업을 정기적으로 받아 두세요.</li>
          </ul>
          <p class="small muted" style="margin-top:10px">${esc(est)}${persisted === true ? ' · 자동 삭제 방지 켜짐' : ''}</p>
          ${persisted === false ? '<div class="row" style="margin-top:10px"><button type="button" class="btn small" id="persist">브라우저 자동 삭제 방지 요청</button></div>' : ''}
          <p class="small muted" style="margin-top:10px">파서 버전 ${esc(PS.PARSER_VERSION)}</p>
        </section>
      </div>`;

    const bk = document.getElementById('bk');
    if (bk) bk.onclick = async () => {
      bk.disabled = true;
      let data;
      try { data = await PS.backup.make(); } finally { bk.disabled = false; }
      const d = new Date();
      const stamp = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      UI.download(`급여명세장부_백업_${stamp}.json`, JSON.stringify(data));
      UI.toast(`백업 파일을 만들었습니다 (${data.count}건)`);
    };
    document.getElementById('lock-now').onclick = () => { PS.lock.lock(); location.hash = '#/home'; PS.app.render(); };
    document.getElementById('pin-change').onclick = () => UI.pinChange();
    const ps = document.getElementById('persist');
    if (ps) ps.onclick = async () => {
      const ok = await navigator.storage.persist();
      UI.toast(ok ? '자동 삭제 방지를 켰습니다' : '브라우저가 요청을 받아들이지 않았습니다. 홈 화면에 앱을 추가하면 허용되는 경우가 많습니다.');
      V.data();
    };
    UI.$$('[data-del]').forEach((btn) => btn.onclick = async () => {
      const id = btn.dataset.del;
      const [yy, mm] = id.split('-').map(Number);
      if (!(await UI.confirm(`${UI.ymLabel(yy, mm)} 기록을 삭제할까요?`, '삭제하면 되돌릴 수 없습니다.', '삭제', true))) return;
      await S.remove(id); UI.toast('삭제했습니다'); V.data();
    });
    const da = document.getElementById('del-all');
    if (da) da.onclick = async () => {
      const ok = await UI.modal({
        title: '모든 기록을 삭제할까요?',
        body: `<p>기록 ${recs.length}건이 모두 지워지며 되돌릴 수 없습니다. 계속하려면 아래 칸에 <strong>삭제</strong>라고 입력하세요.</p><input class="input" id="del-confirm" style="margin-top:10px" autocomplete="off">`,
        buttons: [
          { label: '모두 삭제', cls: 'danger', handler: (body, close) => { if (body.querySelector('#del-confirm').value.trim() === '삭제') close(true); else body.querySelector('#del-confirm').classList.add('bad'); } },
          { label: '취소', value: false },
        ],
      });
      if (!ok) return;
      await S.clear(); UI.toast('모든 기록을 삭제했습니다'); V.data();
    };
    document.getElementById('rs').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const planBox = document.getElementById('rs-plan');
      let obj, info, incoming;
      try { obj = JSON.parse(await f.text()); info = PS.backup.inspect(obj); }
      catch (err) { planBox.innerHTML = `<div class="notice err" style="margin-top:12px">${esc(err instanceof SyntaxError ? 'JSON 파일 형식이 올바르지 않습니다.' : err.message)}</div>`; return; }
      if (info.encrypted) {
        incoming = await UI.pinPrompt({
          title: '백업 파일 PIN 입력',
          message: `이 백업(기록 ${info.count}건)을 만든 시점의 PIN 4자리를 입력하세요.`,
          check: (pin) => PS.backup.open(obj, pin),
        });
        if (!incoming) return;
      } else {
        try { incoming = PS.backup.validateRecords(obj.records); }
        catch (err) { planBox.innerHTML = `<div class="notice err" style="margin-top:12px">${esc(err.message)}</div>`; return; }
      }
      const renderPlan = async (mode) => {
        const plan = await PS.backup.plan(incoming, mode);
        planBox.querySelector('#plan-sum').innerHTML = mode === 'overwrite'
          ? `현재 기록 ${recs.length}건을 모두 지우고 백업의 ${plan.add.length}건으로 바꿉니다.`
          : `새로 추가 ${plan.add.length}건 · 교체 ${plan.replace.length}건 · 그대로 둠 ${plan.skip.length}건`;
        planBox._plan = plan;
      };
      planBox.innerHTML = `<div class="stack" style="margin-top:14px">
        <div class="notice info">백업 파일: ${esc(f.name)} · 기록 ${incoming.length}건</div>
        ${info.encrypted ? '' : '<div class="notice warn">암호화되지 않은 이전 형식의 백업입니다. 복원한 뒤에는 이 파일을 삭제하고 새 백업(암호화)을 받아 두세요.</div>'}
        <div class="radio-list" role="radiogroup" aria-label="복원 방식">
          <label><input type="radio" name="rmode" value="keep" checked><span><strong>기존 데이터 유지</strong><br><span class="small muted">겹치는 달은 지금 기록을 그대로 두고, 없는 달만 추가합니다.</span></span></label>
          <label><input type="radio" name="rmode" value="merge"><span><strong>데이터 병합</strong><br><span class="small muted">겹치는 달은 더 최근에 저장·수정된 쪽을 남깁니다.</span></span></label>
          <label><input type="radio" name="rmode" value="overwrite"><span><strong>기존 데이터 덮어쓰기</strong><br><span class="small muted">지금 기록을 모두 지우고 백업 내용으로 바꿉니다.</span></span></label>
        </div>
        <p id="plan-sum" style="font-weight:600"></p>
        <div class="row"><button type="button" class="btn primary" id="rs-go">복원하기</button><button type="button" class="btn" id="rs-cancel">취소</button></div></div>`;
      UI.$$('input[name="rmode"]', planBox).forEach((r) => r.onchange = () => renderPlan(r.value));
      await renderPlan('keep');
      planBox.querySelector('#rs-cancel').onclick = () => { planBox.innerHTML = ''; };
      planBox.querySelector('#rs-go').onclick = async () => {
        const mode = planBox.querySelector('input[name="rmode"]:checked').value;
        if (mode === 'overwrite' && !(await UI.confirm('기존 기록을 모두 덮어쓸까요?', `현재 기록 ${recs.length}건이 지워집니다.`, '덮어쓰기', true))) return;
        try { await PS.backup.apply(planBox._plan); }
        catch (err) { planBox.insertAdjacentHTML('beforeend', `<div class="notice err">${esc(err.message)}</div>`); return; }
        UI.toast('복원을 마쳤습니다');
        V.data();
      };
    };
  };
})(window);
