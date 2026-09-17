/*
 * extractors.js — 파일 → "페이지/행/셀" 격자 구조로 변환
 * PDF와 Excel을 같은 중간 구조로 바꿔, 급여 파서(salaryParser)는 형식을 몰라도 되게 한다.
 *
 * 중간 구조:
 *   Page  = { rows: Row[] }
 *   Row   = { top, cells: Cell[] }            (위→아래)
 *   Cell  = { x0, x1, text, raw }             (왼→오른쪽, 빈 셀도 포함)
 *   PDF 좌표 단위: pt / Excel 좌표 단위: 열 번호
 */
(function (root) {
  const PS = (root.PS = root.PS || {});

  /* ---------- 공통 유틸 ---------- */
  const U = (PS.util = PS.util || {});
  U.norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  U.clean = (s) => String(s == null ? '' : s).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  /** 금액 문자열 → 정수. 해석 불가면 null (절대 0으로 대체하지 않음) */
  U.parseAmount = (v) => {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    const s = String(v == null ? '' : v).replace(/\s/g, '').replace(/원$/, '');
    if (!/^-?[\d,]+$/.test(s) || !/\d/.test(s)) return null;
    const n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  };
  U.fmt = (n) => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ko-KR'));
  U.ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

  class ExtractError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  PS.ExtractError = ExtractError;

  /* ---------- 파일 형식 판별 ---------- */
  PS.detectFileType = function (name, bytes) {
    const b = new Uint8Array(bytes.slice(0, 8));
    const lower = String(name || '').toLowerCase();
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
    if (b[0] === 0x50 && b[1] === 0x4b) return 'excel';                              // xlsx(zip)
    if (b[0] === 0xd0 && b[1] === 0xcf) return 'excel';                              // xls(OLE)
    if (/\.pdf$/.test(lower)) return 'pdf';
    if (/\.(xlsx|xls)$/.test(lower)) return 'excel';
    return null;
  };

  /* ---------- Excel 추출 ---------- */
  PS.extractExcel = function (XLSX, bytes) {
    let wb;
    try { wb = XLSX.read(bytes, { type: 'array', cellText: true, cellDates: false }); }
    catch (e) { throw new ExtractError('EXCEL_READ', 'Excel 파일을 열 수 없습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다.'); }
    const pages = [];
    wb.SheetNames.forEach((sn) => {
      const ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) return;
      const range = XLSX.utils.decode_range(ws['!ref']);
      const merges = ws['!merges'] || [];
      const covered = new Map(); // "r,c" -> merge
      merges.forEach((m) => {
        for (let r = m.s.r; r <= m.e.r; r++)
          for (let c = m.s.c; c <= m.e.c; c++) covered.set(r + ',' + c, m);
      });
      const rows = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cells = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const m = covered.get(r + ',' + c);
          if (m && (m.s.r !== r || m.s.c !== c)) continue; // 병합 셀의 비앵커는 건너뜀
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          let raw = cell ? cell.v : null;
          let text = '';
          if (cell) text = cell.t === 'n' ? String(cell.v) : String(cell.w != null ? cell.w : cell.v);
          cells.push({ x0: c, x1: m ? m.e.c + 1 : c + 1, text: U.clean(text), raw });
        }
        rows.push({ top: r, cells });
      }
      // 인쇄용 페이지 구분: '급여명세서' 제목 행에서 나눈다
      let cur = { rows: [] };
      rows.forEach((row) => {
        const isTitle = row.cells.some((c) => U.norm(c.text) === '급여명세서');
        if (isTitle && cur.rows.some((r) => r.cells.some((c) => U.norm(c.text) === '급여명세서'))) {
          pages.push(cur); cur = { rows: [] };
        }
        cur.rows.push(row);
      });
      if (cur.rows.length) pages.push(cur);
    });
    if (!pages.length) throw new ExtractError('EXCEL_EMPTY', 'Excel 파일에 읽을 수 있는 시트가 없습니다.');
    return { pages, unit: 'col', tol: 0.01 };
  };

  /* ---------- PDF 추출 ---------- */
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ARGC = { 13: 2, 14: 2, 15: 6, 16: 4, 17: 4, 18: 0, 19: 4 }; // moveTo,lineTo,curveTo,curveTo2,curveTo3,closePath,rectangle

  /** 연산자 목록에서 '채워진 사각형'(표의 셀 배경)을 모은다 */
  function collectFilledRects(opList, OPS) {
    const rects = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let pending = [];
    const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
      OPS.closeFillStroke, OPS.closeEOFillStroke]);
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.constructPath) {
        const ops = args[0], a = args[1];
        let k = 0;
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = a.slice(k, k + 4);
            const p1 = apply(ctm, x, y), p2 = apply(ctm, x + w, y + h);
            pending.push({ x0: Math.min(p1[0], p2[0]), x1: Math.max(p1[0], p2[0]),
              y0: Math.min(p1[1], p2[1]), y1: Math.max(p1[1], p2[1]) });
          }
          k += ARGC[op] != null ? ARGC[op] : 0;
        }
      } else if (FILL.has(fn)) { rects.push(...pending); pending = []; }
      else if (fn === OPS.endPath || fn === OPS.stroke || fn === OPS.closeStroke) pending = [];
    }
    // 너무 얇은 것(선)과 너무 큰 것은 셀이 아님
    return rects.filter((r) => r.x1 - r.x0 > 3 && r.y1 - r.y0 > 3);
  }

  /** 같은 줄의 텍스트 조각들을 하나로 합침 */
  function joinLines(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    sorted.forEach((it) => {
      const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(1.5, it.h * 0.4));
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    });
    return lines
      .sort((a, b) => b.y - a.y)
      .map((l) => {
        const its = l.items.sort((a, b) => a.x - b.x);
        let s = '';
        its.forEach((it, i) => {
          if (i > 0) {
            const prev = its[i - 1];
            const gap = it.x - (prev.x + prev.w);
            if (gap > it.h * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
          }
          s += it.str;
        });
        return { y: l.y, text: s.replace(/[ \t]+/g, ' ').trim() };
      })
      .filter((l) => l.text);
  }

  /** 연산자 목록에서 글자 출력(showText) 단위로 텍스트 조각을 만든다.
   *  getTextContent는 같은 줄의 인접 조각을 합쳐 버려 셀 경계를 넘는 경우가 있어 직접 계산한다. */
  function collectTextRuns(opList, OPS) {
    const runs = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm.slice();
    let size = 10, leading = 0, cs = 0, ws = 0, hs = 1;
    const show = (glyphs) => {
      let x = 0, str = '';
      glyphs.forEach((g) => {
        if (typeof g === 'number') { x -= (g / 1000) * size * hs; return; }
        if (!g) return;
        const u = g.unicode || '';
        x += ((g.width || 0) / 1000) * size * hs + cs * hs + (u === ' ' ? ws * hs : 0);
        str += u;
      });
      const m = mul(ctm, tm);
      const scale = Math.hypot(m[2], m[3]) || 1;
      if (str.trim()) runs.push({ str, x: m[4], y: m[5], w: x * Math.hypot(m[0], m[1]), h: size * scale });
      tm = mul(tm, [1, 0, 0, 1, x, 0]);
    };
    const moveLine = (tx, ty) => { tlm = mul(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm.slice(); };
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], a = opList.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push(ctm); break;
        case OPS.restore: ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case OPS.setTextMatrix: tm = a.slice(0, 6); tlm = tm.slice(); break;
        case OPS.moveText: moveLine(a[0], a[1]); break;
        case OPS.setLeadingMoveText: leading = -a[1]; moveLine(a[0], a[1]); break;
        case OPS.setLeading: leading = a[0]; break;
        case OPS.nextLine: moveLine(0, -leading); break;
        case OPS.setFont: size = a[1]; break;
        case OPS.setCharSpacing: cs = a[0]; break;
        case OPS.setWordSpacing: ws = a[0]; break;
        case OPS.setHScale: hs = a[0] / 100; break;
        case OPS.showText: case OPS.showSpacedText: show(a[0]); break;
        case OPS.nextLineShowText: moveLine(0, -leading); show(a[0]); break;
        case OPS.nextLineSetSpacingShowText: ws = a[0]; cs = a[1]; moveLine(0, -leading); show(a[2]); break;
        default: break;
      }
    }
    return runs;
  }

  PS.extractPdf = async function (pdfjsLib, bytes) {
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') throw new ExtractError('PDF_PASSWORD', '암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제한 뒤 다시 올려 주세요.');
      throw new ExtractError('PDF_READ', 'PDF 파일을 열 수 없습니다. 파일이 손상되었을 수 있습니다.');
    }
    const OPS = pdfjsLib.OPS;
    const pages = [];
    let textCount = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const ol = await page.getOperatorList();
      const rects = collectFilledRects(ol, OPS);
      let items = collectTextRuns(ol, OPS);
      if (!items.length) {
        // 예비 경로: 글자 정보가 연산자에서 나오지 않는 PDF
        const tc = await page.getTextContent();
        items = tc.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => {
          const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 8;
          return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h };
        });
      }
      textCount += items.length;
      // 각 텍스트 조각을 그 중심점을 품는 '가장 작은' 셀에 배정
      const cellItems = rects.map(() => []);
      const free = [];
      items.forEach((it) => {
        const cx = it.x + Math.min(it.w, 4) / 2 + 0.5, cy = it.y + it.h * 0.3;
        let best = -1, bestArea = Infinity;
        rects.forEach((r, i) => {
          if (cx >= r.x0 - 0.5 && cx <= r.x1 + 0.5 && cy >= r.y0 - 0.5 && cy <= r.y1 + 0.5) {
            const area = (r.x1 - r.x0) * (r.y1 - r.y0);
            if (area < bestArea) { bestArea = area; best = i; }
          }
        });
        if (best >= 0) cellItems[best].push(it); else free.push(it);
      });
      // 다른 셀을 완전히 포함하는 큰 사각형(배경)은 셀 목록에서 제외
      const isContainer = rects.map((r, i) => rects.some((q, j) => j !== i &&
        q.x0 >= r.x0 - 0.5 && q.x1 <= r.x1 + 0.5 && q.y0 >= r.y0 - 0.5 && q.y1 <= r.y1 + 0.5 &&
        (q.x1 - q.x0) * (q.y1 - q.y0) < (r.x1 - r.x0) * (r.y1 - r.y0) - 1));
      const cells = [];
      rects.forEach((r, i) => {
        if (isContainer[i] && !cellItems[i].length) return;
        const text = joinLines(cellItems[i]).map((l) => l.text).join('\n');
        cells.push({ x0: r.x0, x1: r.x1, top: r.y1, text, raw: text });
      });
      // 셀 밖 텍스트는 줄 단위로 가짜 셀을 만든다
      joinLines(free).forEach((l) => {
        const its = free.filter((it) => Math.abs(it.y - l.y) < Math.max(1.5, it.h * 0.4));
        const x0 = Math.min(...its.map((i) => i.x));
        const x1 = Math.max(...its.map((i) => i.x + i.w));
        cells.push({ x0, x1, top: l.y + 8, text: l.text, raw: l.text, free: true });
      });
      // 행 묶기: 위쪽 경계가 같은 셀끼리
      cells.sort((a, b) => b.top - a.top || a.x0 - b.x0);
      const rows = [];
      cells.forEach((c) => {
        const row = rows.find((r) => Math.abs(r.top - c.top) < 1.5);
        if (row) row.cells.push(c); else rows.push({ top: c.top, cells: [c] });
      });
      rows.forEach((r) => r.cells.sort((a, b) => a.x0 - b.x0));
      pages.push({ rows });
    }
    if (!textCount) {
      throw new ExtractError('PDF_NO_TEXT',
        'PDF에서 글자를 찾을 수 없습니다. 스캔(이미지) PDF로 보입니다. 나이스에서 내려받은 원본 PDF 또는 Excel 파일을 올려 주세요.');
    }
    return { pages, unit: 'pt', tol: 1.5 };
  };
})(typeof window !== 'undefined' ? window : globalThis);
