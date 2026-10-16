/*
 * parser.js — 격자 구조 → SalaryRecord 초안
 * 원칙: 좌표를 고정하지 않고 라벨(급여내역·급여총액·계산근거 …)로 위치를 찾는다.
 *       읽지 못한 값은 null로 두고 issues에 남긴다. 추측해서 채우지 않는다.
 */
(function (root) {
  const PS = (root.PS = root.PS || {});
  const U = PS.util;

  PS.PARSER_VERSION = '1.0.0';

  /** 나이스 명세서에서 확인된 기본정보 라벨(공백 제거 기준) → 저장 키(원본 명칭) */
  PS.BASIC_LABELS = [
    '공무원구분', '급여관리구분', '급여직종', '최초임용일',
    '기관명', '급여관리기관', '직위', '현직급임용일',
    '보직구분', '담당과목', '교원구분', '현직위임용일',
  ];
  const GROUPS = [
    { key: 'payments', header: '급여내역', total: '급여총액', totalKey: 'paymentTotal' },
    { key: 'taxes', header: '세금내역', total: '세금총액', totalKey: 'taxTotal' },
    { key: 'deductions', header: '공제내역', total: '공제총액', totalKey: 'deductionTotal' },
  ];

  const rowText = (row) => row.cells.map((c) => c.text).join(' ');
  const findCell = (row, label) => row.cells.find((c) => U.norm(c.text) === label);
  const nextCell = (row, cell, tol) => row.cells.find((c) => Math.abs(c.x0 - cell.x1) <= tol);
  const nonEmpty = (cells) => cells.filter((c) => c.text !== '');
  const inRange = (cell, h) => {
    const mid = (cell.x0 + cell.x1) / 2;
    return mid >= h.x0 && mid <= h.x1;
  };

  /* ---------- 계산근거 분해 ---------- */
  PS.parseCalc = function (raw) {
    const text = U.clean(raw);
    const out = { raw: text, tags: [], parsed: [], unparsed: [], status: 'ok' };
    if (!text) { out.status = 'empty'; return out; }
    text.split('\n').forEach((line0) => {
      let line = line0.trim();
      // 줄 앞의 [당월][분류-항목] 태그
      let m;
      while ((m = line.match(/^\[([^\]]*)\]/))) { out.tags.push(m[1]); line = line.slice(m[0].length).trim(); }
      if (!line) return;
      // 콜론 쌍: "회계기간구분: 당년1월~12월 기준연도: 2026 교원봉급표적용"
      if (/^[^\s:()]+:\s/.test(line)) {
        const re = /([^\s:()]+):\s*([^\s:]+)/g;
        let rest = line, mm;
        while ((mm = re.exec(line))) { out.parsed.push({ key: mm[1], value: mm[2] }); rest = rest.replace(mm[0], ''); }
        rest = rest.trim();
        if (rest) out.unparsed.push(rest);
        return;
      }
      // "(기준1-근무년수) 13"
      if ((m = line.match(/^\((기준\d+)-([^)]+)\)\s*(.*)$/))) {
        out.parsed.push({ key: m[2], value: m[3], basis: m[1] });
        return;
      }
      // "금액(40000) * 배우자수(1)" 같은 곱셈식
      const parts = line.split(/\s*\*\s*/);
      const one = (seg) => {
        let k;
        if ((k = seg.match(/^(.+?)\[([^\]]*)\]$/))) return { key: k[1].trim(), value: k[2] };
        const i = seg.indexOf('(');
        if (i > 0 && seg.endsWith(')')) return { key: seg.slice(0, i).trim(), value: seg.slice(i + 1, -1) };
        return null;
      };
      const got = parts.map(one);
      if (got.every(Boolean)) {
        got.forEach((g) => out.parsed.push(parts.length > 1 ? Object.assign(g, { formula: line }) : g));
      } else {
        out.unparsed.push(line);
      }
    });
    if (out.unparsed.length) out.status = out.parsed.length ? 'partial' : 'failed';
    return out;
  };

  /* ---------- 본 파서 ---------- */
  PS.parseSalary = function (grid, meta) {
    const tol = grid.tol;
    const issues = [];
    const warn = (field, message) => issues.push({ level: 'warn', field, message });
    const rec = {
      year: null, month: null, paymentYearMonth: null,
      basicInfo: {}, summaryLine: null, payGrade: null, careerYears: null, employmentStatus: null,
      payments: [], taxes: [], deductions: [],
      paymentTotal: null, taxTotal: null, deductionTotal: null, netPay: null,
      printedDate: null,
    };
    const pages = grid.pages;
    const perPageHeader = [];

    pages.forEach((page, pi) => {
      const hdr = { basic: {} };
      let detailHeader = null, calcHeader = null, detailDone = false;
      page.rows.forEach((row) => {
        const txt = rowText(row);
        const ntxt = U.norm(txt);
        let m;
        // 출력일(1페이지 상단 날짜 단독 셀)
        if (pi === 0 && !rec.printedDate && row.cells.filter((c) => c.text).length === 1 &&
            /^\d{4}\.\d{2}\.\d{2}$/.test(txt.trim())) rec.printedDate = txt.trim();
        // 급여지급년월 (성명은 읽지 않음)
        if ((m = txt.match(/급여지급년월\s*(\d{4})\s*년\s*(\d{1,2})\s*월/))) {
          hdr.year = Number(m[1]); hdr.month = Number(m[2]);
          return;
        }
        // 요약줄 [기관] [급여직종/ /계급/NN호봉/NN년]  + 재직상태
        if ((m = txt.match(/\[([^\]]*)\]\s*\[([^\]]*\/[^\]]*)\]/))) {
          hdr.summaryLine = `[${m[1].trim()}] [${m[2].trim()}]`;
          const parts = m[2].split('/').map((s) => s.trim());
          const g = parts.find((s) => /^\d+\s*호봉$/.test(s));
          const y = parts.find((s) => /^\d+\s*년$/.test(s));
          hdr.payGrade = g ? Number(g.replace(/\D/g, '')) : null;
          hdr.careerYears = y ? Number(y.replace(/\D/g, '')) : null;
          const statusCell = row.cells.filter((c) => c.text && !c.text.includes('[')).pop();
          hdr.employmentStatus = statusCell ? statusCell.text : null;
          return;
        }
        // 기본정보 라벨-값
        row.cells.forEach((c) => {
          const lab = U.norm(c.text);
          if (PS.BASIC_LABELS.includes(lab)) {
            const v = nextCell(row, c, tol);
            hdr.basic[lab] = v ? U.clean(v.text) : '';
          }
        });
        // 세부내역 머리글
        const gh = GROUPS.map((g) => findCell(row, g.header));
        if (gh[0] && gh[1] && gh[2]) {
          detailHeader = GROUPS.map((g, i) => ({ ...g, x0: gh[i].x0, x1: gh[i].x1 }));
          return;
        }
        // 계산근거 머리글
        const ch = findCell(row, '계산근거');
        if (ch && findCell(row, '급여내역')) {
          calcHeader = { item: findCell(row, '급여내역'), calc: ch };
          detailHeader = null;
          return;
        }
        if (detailHeader && !detailDone) {
          if (ntxt.includes('실수령액')) {
            const lab = row.cells.find((c) => U.norm(c.text) === '실수령액');
            const val = nonEmpty(row.cells).find((c) => c !== lab);
            rec.netPay = val ? U.parseAmount(val.raw != null ? val.raw : val.text) : null;
            if (val && rec.netPay == null) warn('netPay', `실수령액 금액을 숫자로 읽지 못했습니다: "${val.text}"`);
            detailDone = true;
            return;
          }
          detailHeader.forEach((g) => {
            const cells = nonEmpty(row.cells.filter((c) => inRange(c, g)));
            if (!cells.length) return;
            const [nameC, amtC, ...extra] = cells;
            const name = U.clean(nameC.text);
            if (U.norm(name) === g.total) {
              rec[g.totalKey] = amtC ? U.parseAmount(amtC.raw != null ? amtC.raw : amtC.text) : null;
              if (rec[g.totalKey] == null) warn(g.totalKey, `${g.total}을(를) 읽지 못했습니다.`);
              return;
            }
            const nameIsNumber = U.parseAmount(name) != null;
            const item = { name: nameIsNumber ? '' : name, amount: null, calc: null };
            const src = nameIsNumber ? nameC : amtC;
            if (src) item.amount = U.parseAmount(src.raw != null ? src.raw : src.text);
            if (nameIsNumber) warn(g.key, `${g.header}에 항목명이 없는 금액(${nameC.text})이 있습니다.`);
            if (item.amount == null) warn(g.key, `"${name}"의 금액을 읽지 못했습니다${src ? `: "${src.text}"` : ''}.`);
            if (extra.length) warn(g.key, `"${name}" 행에서 해석하지 못한 값이 있습니다: ${extra.map((e) => e.text).join(', ')}`);
            rec[g.key].push(item);
          });
          return;
        }
        if (calcHeader) {
          const itemCells = nonEmpty(row.cells.filter((c) => inRange(c, calcHeader.item)));
          const calcCells = nonEmpty(row.cells.filter((c) => inRange(c, calcHeader.calc)));
          if (!itemCells.length) return;
          const name = U.clean(itemCells[0].text);
          const amount = itemCells[1] ? U.parseAmount(itemCells[1].raw != null ? itemCells[1].raw : itemCells[1].text) : null;
          (hdr.calcRows = hdr.calcRows || []).push({ name, amount, raw: calcCells.map((c) => c.text).join('\n') });
        }
      });
      perPageHeader.push(hdr);
    });

    /* 기본정보: 1페이지 기준, 다른 페이지와 비교 */
    const first = perPageHeader[0] || { basic: {} };
    rec.year = first.year != null ? first.year : null;
    rec.month = first.month != null ? first.month : null;
    rec.summaryLine = first.summaryLine || null;
    rec.payGrade = first.payGrade != null ? first.payGrade : null;
    rec.careerYears = first.careerYears != null ? first.careerYears : null;
    rec.employmentStatus = first.employmentStatus || null;
    PS.BASIC_LABELS.forEach((k) => { if (k in first.basic) rec.basicInfo[k] = first.basic[k]; });
    perPageHeader.slice(1).forEach((h, i) => {
      if (h.year != null && (h.year !== rec.year || h.month !== rec.month))
        warn('paymentYearMonth', `${i + 2}페이지의 급여지급년월이 1페이지와 다릅니다.`);
      if (h.payGrade != null && h.payGrade !== rec.payGrade) warn('payGrade', `${i + 2}페이지의 호봉이 1페이지와 다릅니다.`);
      Object.keys(h.basic).forEach((k) => {
        if (k in rec.basicInfo && h.basic[k] !== rec.basicInfo[k]) warn('basicInfo', `${i + 2}페이지의 ${k} 값이 1페이지와 다릅니다.`);
      });
    });
    if (rec.year && rec.month >= 1 && rec.month <= 12) rec.paymentYearMonth = U.ym(rec.year, rec.month);

    /* 계산근거를 급여항목에 이름(+금액) 기준으로 연결 */
    const calcRows = perPageHeader.flatMap((h) => h.calcRows || []);
    const used = new Set();
    calcRows.forEach((cr) => {
      const target = rec.payments.find((p, i) => !used.has(i) && p.name === cr.name && (cr.amount == null || p.amount == null || p.amount === cr.amount));
      if (!target) {
        warn('calc', `계산근거의 "${cr.name}" 항목을 급여내역에서 찾지 못했습니다.`);
        return;
      }
      used.add(rec.payments.indexOf(target));
      if (cr.amount != null && target.amount != null && cr.amount !== target.amount)
        warn('calc', `"${cr.name}"의 금액이 급여내역과 계산근거에서 다릅니다.`);
      target.calc = PS.parseCalc(cr.raw);
    });

    rec.meta = Object.assign({ parserVersion: PS.PARSER_VERSION }, meta || {});
    rec.issues = issues;
    return rec;
  };

  /* ---------- 검증 (저장 전/조회 시 공통) ---------- */
  PS.validate = function (rec) {
    const out = [];
    const add = (level, field, message) => out.push({ level, field, message });
    if (!rec.year || rec.year < 1990 || rec.year > 2100) add('error', 'year', '연도를 확인해 주세요.');
    if (!(rec.month >= 1 && rec.month <= 12)) add('error', 'month', '월을 확인해 주세요.');
    if (rec.payGrade == null) add('warn', 'payGrade', '호봉을 읽지 못했습니다. 직접 확인해 주세요.');
    if (rec.careerYears == null) add('warn', 'careerYears', '근무년수를 읽지 못했습니다. 직접 확인해 주세요.');
    PS.BASIC_LABELS.forEach((k) => {
      if (!(k in (rec.basicInfo || {}))) add('warn', 'basicInfo', `기본정보 "${k}" 칸을 찾지 못했습니다.`);
    });
    if (!rec.payments.length) add('warn', 'payments', '급여항목이 하나도 없습니다.');
    const sum = (arr) => arr.reduce((s, i) => s + (i.amount || 0), 0);
    const pairs = [
      ['payments', 'paymentTotal', '급여'], ['taxes', 'taxTotal', '세금'], ['deductions', 'deductionTotal', '공제'],
    ];
    pairs.forEach(([k, t, label]) => {
      rec[k].forEach((it) => {
        if (!it.name) add('warn', k, `${label}항목 중 이름이 비어 있는 항목이 있습니다.`);
        if (it.amount == null) add('warn', k, `${label}항목 "${it.name || '(이름 없음)'}"의 금액이 비어 있습니다.`);
      });
      if (rec[t] == null) add('warn', t, `${label}총액이 비어 있습니다.`);
      else if (sum(rec[k]) !== rec[t])
        add('warn', t, `원본 명세서의 ${label}총액(${U.fmt(rec[t])})과 추출된 세부항목의 합계(${U.fmt(sum(rec[k]))})가 일치하지 않습니다. 원본을 확인해 주세요.`);
    });
    if (rec.netPay == null) add('warn', 'netPay', '실수령액이 비어 있습니다.');
    else if (rec.paymentTotal != null && rec.taxTotal != null && rec.deductionTotal != null) {
      const calc = rec.paymentTotal - rec.taxTotal - rec.deductionTotal;
      if (calc !== rec.netPay)
        add('warn', 'netPay', `급여총액 − 세금총액 − 공제총액(${U.fmt(calc)})이 실수령액(${U.fmt(rec.netPay)})과 다릅니다. 원본을 확인해 주세요.`);
    }
    // 호봉·근무년수 교차검증(당월 계산근거 기준, '전월' 값은 제외)
    rec.payments.forEach((p) => {
      if (!p.calc || !p.calc.parsed) return;
      p.calc.parsed.forEach((kv) => {
        const key = U.norm(kv.key);
        if ((key === '호봉' || key === '현재호봉') && rec.payGrade != null) {
          const n = Number(String(kv.value).replace(/\D/g, ''));
          if (n && n !== rec.payGrade) add('warn', 'payGrade', `"${p.name}" 계산근거의 호봉(${n})이 요약줄 호봉(${rec.payGrade})과 다릅니다.`);
        }
        if (key === '근무년수' && rec.careerYears != null) {
          const n = Number(String(kv.value).replace(/\D/g, ''));
          if (n && n !== rec.careerYears) add('warn', 'careerYears', `"${p.name}" 계산근거의 근무년수(${n})가 요약줄 근무년수(${rec.careerYears})와 다릅니다.`);
        }
      });
    });
    return out;
  };

  /** 파일 1개 처리: 형식 판별 → 추출 → 파싱 → 검증 */
  PS.processFile = async function (file, libs) {
    const bytes = await file.arrayBuffer();
    const type = PS.detectFileType(file.name, bytes);
    if (!type) throw new PS.ExtractError('TYPE', `"${file.name}"은(는) 지원하지 않는 형식입니다. PDF 또는 Excel(.xlsx) 파일을 올려 주세요.`);
    const grid = type === 'pdf' ? await PS.extractPdf(libs.pdfjs, bytes) : PS.extractExcel(libs.XLSX, bytes);
    const rec = PS.parseSalary(grid, { sourceFileType: type, sourceFileName: file.name });
    if (rec.year == null && !rec.payments.length)
      throw new PS.ExtractError('NOT_PAYSLIP', `"${file.name}"에서 나이스 급여명세서 구조를 찾지 못했습니다.`);
    return rec;
  };
})(typeof window !== 'undefined' ? window : globalThis);
