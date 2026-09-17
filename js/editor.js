/* editor.js — 추출 결과 확인·수정 화면(업로드 검토와 월별 수정에서 함께 사용) */
(function (root) {
  const PS = root.PS;
  const UI = PS.ui;
  const U = PS.util;
  const esc = UI.esc;
  const GROUPS = [
    { key: 'payments', label: '급여내역', cls: 'pay', total: 'paymentTotal', totalLabel: '급여총액' },
    { key: 'taxes', label: '세금내역', cls: 'tax', total: 'taxTotal', totalLabel: '세금총액' },
    { key: 'deductions', label: '공제내역', cls: 'ded', total: 'deductionTotal', totalLabel: '공제총액' },
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const amtText = (n) => (n == null ? '' : U.fmt(n));

  PS.createEditor = function (draft0, opts) {
    const draft = clone(draft0);
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'stack editor';

    const itemRow = (g, it, idx) => `
      <div class="item-row" data-g="${g}" data-idx="${idx}">
        <input class="input iname ${it.name ? '' : 'flag'}" value="${esc(it.name)}" aria-label="항목명" placeholder="항목명">
        <input class="input amt iamt ${it.amount == null ? 'flag' : ''}" value="${esc(amtText(it.amount))}" inputmode="numeric" aria-label="${esc(it.name || '항목')} 금액" placeholder="확인 필요">
        <button type="button" class="btn ghost icon-btn idel" aria-label="${esc(it.name || '항목')} 삭제" title="항목 삭제">✕</button>
      </div>`;

    const basicKeys = PS.BASIC_LABELS;
    el.innerHTML = `
      <section class="block">
        <div class="block-head"><h2>기본정보</h2>
          ${opts.fileLabel ? `<span class="tag file">${esc(opts.fileLabel)}</span>` : ''}</div>
        <div class="form-grid">
          <label class="f"><span>연도</span><input class="input" data-f="year" inputmode="numeric" value="${esc(draft.year == null ? '' : draft.year)}"></label>
          <label class="f"><span>월</span><select class="input" data-f="month">
            <option value="">선택</option>
            ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${draft.month === i + 1 ? 'selected' : ''}>${i + 1}월</option>`).join('')}
          </select></label>
          <label class="f"><span>호봉</span><input class="input ${draft.payGrade == null ? 'flag' : ''}" data-f="payGrade" inputmode="numeric" value="${esc(draft.payGrade == null ? '' : draft.payGrade)}" placeholder="확인 필요"></label>
          <label class="f"><span>근무년수</span><input class="input ${draft.careerYears == null ? 'flag' : ''}" data-f="careerYears" inputmode="numeric" value="${esc(draft.careerYears == null ? '' : draft.careerYears)}" placeholder="확인 필요"></label>
          ${['보직구분', '담당과목'].map((k) => `<label class="f"><span>${k}</span><input class="input ${k in draft.basicInfo ? '' : 'flag'}" data-b="${k}" value="${esc(draft.basicInfo[k] || '')}" placeholder="${k in draft.basicInfo ? '(빈칸)' : '확인 필요'}"></label>`).join('')}
          <label class="f"><span>재직상태</span><input class="input" data-f="employmentStatus" value="${esc(draft.employmentStatus || '')}"></label>
        </div>
        <details class="more-toggle"><summary>나머지 기본정보</summary>
          <div class="form-grid" style="margin-top:10px">
            ${basicKeys.filter((k) => k !== '보직구분' && k !== '담당과목').map((k) => `<label class="f"><span>${k}</span><input class="input ${k in draft.basicInfo ? '' : 'flag'}" data-b="${k}" value="${esc(draft.basicInfo[k] || '')}" placeholder="${k in draft.basicInfo ? '(빈칸)' : '확인 필요'}"></label>`).join('')}
          </div>
          ${draft.summaryLine ? `<p class="small muted" style="margin-top:10px">명세서 요약줄: ${esc(draft.summaryLine)}</p>` : ''}
        </details>
      </section>
      ${GROUPS.map((g) => `
      <section class="block ledger ${g.cls}" data-group="${g.key}">
        <div class="block-head"><h3>${g.label}</h3>
          <button type="button" class="btn small iadd" data-g="${g.key}">+ 항목 추가</button></div>
        <div class="items">${draft[g.key].map((it, i) => itemRow(g.key, it, i)).join('') || '<p class="muted small none">항목 없음</p>'}</div>
        <div class="total-row">
          <span>${g.totalLabel}</span>
          <input class="input amt ttl ${draft[g.total] == null ? 'flag' : ''}" data-t="${g.total}" value="${esc(amtText(draft[g.total]))}" inputmode="numeric" aria-label="${g.totalLabel}" placeholder="확인 필요">
          <span></span>
          <span class="sumhint" data-hint="${g.key}"></span>
        </div>
      </section>`).join('')}
      <section class="block">
        <div class="total-row" style="padding-top:0">
          <span style="color:var(--net)">실수령액</span>
          <input class="input amt ttl ${draft.netPay == null ? 'flag' : ''}" data-t="netPay" value="${esc(amtText(draft.netPay))}" inputmode="numeric" aria-label="실수령액" placeholder="확인 필요">
          <span></span>
          <span class="sumhint" data-hint="net"></span>
        </div>
      </section>
      <div class="live-issues"></div>`;

    // 항목 추가/삭제
    el.addEventListener('click', (e) => {
      const add = e.target.closest('.iadd');
      if (add) {
        const g = add.dataset.g;
        const box = el.querySelector(`[data-group="${g}"] .items`);
        const none = box.querySelector('.none'); if (none) none.remove();
        const idx = 'n' + Date.now();
        box.insertAdjacentHTML('beforeend', itemRow(g, { name: '', amount: null }, idx));
        box.lastElementChild.querySelector('.iname').focus();
        refresh();
      }
      const del = e.target.closest('.idel');
      if (del) { del.closest('.item-row').remove(); refresh(); }
    });
    el.addEventListener('input', () => refresh());
    el.addEventListener('focusout', (e) => {
      const t = e.target;
      if (t.classList && t.classList.contains('amt')) {
        const v = U.parseAmount(t.value);
        if (v != null) t.value = U.fmt(v);
      }
    });

    function readAmount(input, errors, label) {
      const s = input.value.trim();
      if (s === '') { input.classList.remove('bad'); input.classList.add('flag'); return null; }
      const v = U.parseAmount(s);
      input.classList.toggle('bad', v == null);
      input.classList.remove('flag');
      if (v == null) errors.push(`${label}: "${s}"은(는) 금액으로 읽을 수 없습니다.`);
      return v;
    }
    function readInt(input, errors, label) {
      const s = input.value.trim();
      if (s === '') { input.classList.add('flag'); input.classList.remove('bad'); return null; }
      const ok = /^\d+$/.test(s);
      input.classList.toggle('bad', !ok);
      input.classList.remove('flag');
      if (!ok) errors.push(`${label}: 숫자만 입력해 주세요.`);
      return ok ? Number(s) : null;
    }

    function read() {
      const errors = [];
      const out = clone(draft);
      out.year = readInt(el.querySelector('[data-f="year"]'), errors, '연도');
      const mv = el.querySelector('[data-f="month"]').value;
      out.month = mv ? Number(mv) : null;
      out.payGrade = readInt(el.querySelector('[data-f="payGrade"]'), errors, '호봉');
      out.careerYears = readInt(el.querySelector('[data-f="careerYears"]'), errors, '근무년수');
      out.employmentStatus = el.querySelector('[data-f="employmentStatus"]').value.trim() || null;
      const bi = {};
      UI.$$('[data-b]', el).forEach((inp) => {
        const k = inp.dataset.b;
        const v = inp.value.trim();
        // 원래 없던 칸을 비워 두면 '없음'을 유지(빈 문자열로 만들지 않음)
        if (k in draft.basicInfo || v !== '') bi[k] = v;
        inp.classList.toggle('flag', !(k in bi));
      });
      out.basicInfo = bi;
      GROUPS.forEach((g) => {
        const items = [];
        UI.$$(`[data-group="${g.key}"] .item-row`, el).forEach((row) => {
          const idx = row.dataset.idx;
          const prev = /^\d+$/.test(idx) ? draft[g.key][Number(idx)] : null;
          const nameInp = row.querySelector('.iname');
          const name = nameInp.value.trim();
          nameInp.classList.toggle('flag', !name);
          const amount = readAmount(row.querySelector('.iamt'), errors, `${g.label} "${name || '이름 없음'}"`);
          items.push({ name, amount, calc: prev ? prev.calc || null : null });
        });
        out[g.key] = items;
        out[g.total] = readAmount(el.querySelector(`[data-t="${g.total}"]`), errors, g.totalLabel);
      });
      out.netPay = readAmount(el.querySelector('[data-t="netPay"]'), errors, '실수령액');
      return { draft: out, errors };
    }

    function refresh() {
      const { draft: d, errors } = read();
      GROUPS.forEach((g) => {
        const hint = el.querySelector(`[data-hint="${g.key}"]`);
        const s = d[g.key].reduce((a, i) => a + (i.amount || 0), 0);
        if (d[g.total] == null) { hint.className = 'sumhint'; hint.textContent = `세부항목 합계 ${U.fmt(s)}원`; }
        else if (s === d[g.total]) { hint.className = 'sumhint good'; hint.textContent = `세부항목 합계와 일치 (${U.fmt(s)}원)`; }
        else { hint.className = 'sumhint bad'; hint.textContent = `⚠ 세부항목 합계 ${U.fmt(s)}원 · 차이 ${U.fmt(d[g.total] - s)}원`; }
      });
      const nh = el.querySelector('[data-hint="net"]');
      if (d.paymentTotal != null && d.taxTotal != null && d.deductionTotal != null) {
        const c = d.paymentTotal - d.taxTotal - d.deductionTotal;
        if (d.netPay === c) { nh.className = 'sumhint good'; nh.textContent = `급여총액 − 세금총액 − 공제총액과 일치`; }
        else { nh.className = 'sumhint bad'; nh.textContent = `⚠ 급여총액 − 세금총액 − 공제총액 = ${U.fmt(c)}원`; }
      } else { nh.textContent = ''; }
      const issues = PS.validate(Object.assign({}, d, { year: d.year, month: d.month }));
      const all = errors.map((m) => ({ level: 'error', message: m })).concat(issues);
      el.querySelector('.live-issues').innerHTML = UI.issueBox(all, '저장 전에 확인해 주세요') ||
        '<div class="notice ok">모든 합계가 원본 명세서와 일치합니다.</div>';
    }
    refresh();
    return { el, read, refresh };
  };
})(window);
