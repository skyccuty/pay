/*
 * data.js — IndexedDB 저장(storage), 분석(analysis), 백업/복원(backup)
 * 각 SalaryRecord는 연-월(id: "2026-09") 단위의 독립 기록이다. 한 달을 고쳐도 다른 달은 바뀌지 않는다.
 */
(function (root) {
  const PS = (root.PS = root.PS || {});
  const U = PS.util;
  const DB_NAME = 'payslip-ledger';
  const STORE = 'records';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  /** 키 순서와 무관한 비교용 문자열 */
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  };
  PS.sameCore = (a, b) => stable(PS.coreOf(a)) === stable(PS.coreOf(b));

  /* ================= storage ================= */
  const META = 'meta';
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('이 브라우저는 IndexedDB를 지원하지 않아 데이터를 저장할 수 없습니다.')); return; }
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('저장소를 열 수 없습니다. 사생활 보호(시크릿) 모드에서는 저장이 제한될 수 있습니다.'));
    });
    return dbp;
  }
  /** fn은 동기적으로 요청만 넣는다(트랜잭션 안에서 암호화 같은 비동기 작업 금지) */
  const tx = async (stores, mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const out = {};
      fn((name) => t.objectStore(name), out);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error || new Error('저장 중 오류가 발생했습니다.'));
      t.onabort = () => reject(t.error || new Error('저장이 취소되었습니다. 저장 공간이 부족할 수 있습니다.'));
    });
  };
  const getAll = (store) => tx([store], 'readonly', (st, out) => {
    const r = st(store).getAll(); r.onsuccess = () => { out.v = r.result; };
  }).then((o) => o.v || []);
  const getOne = (store, id) => tx([store], 'readonly', (st, out) => {
    const r = st(store).get(id); r.onsuccess = () => { out.v = r.result; };
  }).then((o) => o.v || null);

  /* ================= 암호화 (Web Crypto) ================= */
  const C = (PS.crypto = {});
  const te = new TextEncoder(), td = new TextDecoder();
  C.ITER = 600000;
  C.b64 = (buf) => {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  C.unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));
  C.available = () => !!(root.crypto && root.crypto.subtle);
  C.deriveKey = async (pin, saltB64, iter) => {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: C.unb64(saltB64), iterations: iter || C.ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  };
  C.encrypt = async (key, obj) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
    return { iv: C.b64(iv), ct: C.b64(ct) };
  };
  C.decrypt = async (key, box) => {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.unb64(box.iv) }, key, C.unb64(box.ct));
    return JSON.parse(td.decode(pt));
  };
  C.newSalt = () => C.b64(crypto.getRandomValues(new Uint8Array(16)));
  const CHECK = { app: 'payslip-ledger', v: 1 };

  /* ================= 앱 잠금 ================= */
  const L = (PS.lock = {});
  let KEY = null;          // 메모리에만 존재. 새로고침·앱 종료 시 사라짐
  let lockMeta = null;
  L.PIN_RE = /^\d{4}$/;
  L.isUnlocked = () => !!KEY;
  L.meta = async () => (lockMeta = lockMeta || await getOne(META, 'lock'));
  /** 'setup'(PIN 미설정) | 'locked' | 'unlocked' */
  L.state = async () => {
    if (KEY) return 'unlocked';
    return (await L.meta()) ? 'locked' : 'setup';
  };
  const DELAYS = [0, 0, 0, 0, 30, 60, 120, 300, 600, 900]; // 실패 횟수별 대기(초)
  L.attempts = async () => (await getOne(META, 'attempts')) || { id: 'attempts', fails: 0, until: 0 };
  L.unlock = async (pin) => {
    const a = await L.attempts();
    if (a.until > Date.now()) return { ok: false, wait: Math.ceil((a.until - Date.now()) / 1000), fails: a.fails };
    const m = await L.meta();
    const key = await C.deriveKey(pin, m.salt, m.iter);
    try {
      const chk = await C.decrypt(key, m.check);
      if (chk.app !== CHECK.app) throw new Error('bad');
    } catch (e) {
      const fails = a.fails + 1;
      const wait = DELAYS[Math.min(fails, DELAYS.length - 1)];
      await tx([META], 'readwrite', (st) => { st(META).put({ id: 'attempts', fails, until: Date.now() + wait * 1000 }); });
      return { ok: false, fails, wait };
    }
    KEY = key;
    await tx([META], 'readwrite', (st) => { st(META).put({ id: 'attempts', fails: 0, until: 0 }); });
    return { ok: true };
  };
  L.lock = () => { KEY = null; cache = null; };
  /** 최초 설정: 기존 평문 기록(v1.0)이 있으면 암호화해서 옮긴다 */
  L.setup = async (pin) => {
    if (!L.PIN_RE.test(pin)) throw new Error('PIN은 숫자 4자리여야 합니다.');
    if (await getOne(META, 'lock')) throw new Error('이미 PIN이 설정되어 있습니다.');
    const salt = C.newSalt();
    const key = await C.deriveKey(pin, salt, C.ITER);
    const check = await C.encrypt(key, CHECK);
    const rows = await getAll(STORE);
    const boxes = await Promise.all(rows.map(async (r) => (r.ct ? r : Object.assign({ id: r.id }, await C.encrypt(key, r)))));
    await tx([STORE, META], 'readwrite', (st) => {
      boxes.forEach((b) => st(STORE).put(b));
      st(META).put({ id: 'lock', v: 1, salt, iter: C.ITER, check, createdAt: new Date().toISOString() });
      st(META).put({ id: 'attempts', fails: 0, until: 0 });
    });
    lockMeta = null; KEY = key; cache = null;
    return rows.filter((r) => !r.ct).length;
  };
  L.change = async (oldPin, newPin) => {
    if (!L.PIN_RE.test(newPin)) throw new Error('새 PIN은 숫자 4자리여야 합니다.');
    const m = await L.meta();
    const oldKey = await C.deriveKey(oldPin, m.salt, m.iter);
    try { await C.decrypt(oldKey, m.check); } catch (e) { throw new Error('현재 PIN이 맞지 않습니다.'); }
    const records = await Promise.all((await getAll(STORE)).map((b) => C.decrypt(oldKey, b)));
    const salt = C.newSalt();
    const key = await C.deriveKey(newPin, salt, C.ITER);
    const check = await C.encrypt(key, CHECK);
    const boxes = await Promise.all(records.map(async (r) => Object.assign({ id: r.id }, await C.encrypt(key, r))));
    await tx([STORE, META], 'readwrite', (st) => {
      st(STORE).clear();
      boxes.forEach((b) => st(STORE).put(b));
      st(META).put(Object.assign({}, m, { salt, iter: C.ITER, check, changedAt: new Date().toISOString() }));
    });
    lockMeta = null; KEY = key; cache = null;
  };
  /** PIN 분실 시: 모든 기록과 PIN 설정 삭제 */
  L.resetAll = async () => {
    await tx([STORE, META], 'readwrite', (st) => { st(STORE).clear(); st(META).clear(); });
    lockMeta = null; KEY = null; cache = null;
  };
  L.exportKeyInfo = async () => { const m = await L.meta(); return { salt: m.salt, iter: m.iter }; };
  const needKey = () => { if (!KEY) { const e = new Error('앱이 잠겨 있습니다.'); e.code = 'LOCKED'; throw e; } return KEY; };

  const S = (PS.storage = {});
  let cache = null;
  S.all = async () => {
    const key = needKey();
    if (cache) return cache;
    const rows = await getAll(STORE);
    const list = await Promise.all(rows.map(async (b) => {
      try { return await C.decrypt(key, b); } catch (e) { return null; }
    }));
    const bad = list.filter((x) => !x).length;
    cache = list.filter(Boolean).sort((a, b) => a.year - b.year || a.month - b.month);
    cache.unreadable = bad;
    return cache;
  };
  S.get = async (id) => (await S.all()).find((r) => r.id === id) || null;
  const boxOf = async (rec) => Object.assign({ id: rec.id }, await C.encrypt(needKey(), clone(rec)));
  S.put = async (rec) => {
    const b = await boxOf(rec);
    await tx([STORE], 'readwrite', (st) => { st(STORE).put(b); });
    cache = null;
  };
  S.putMany = async (recs) => {
    const bs = await Promise.all(recs.map(boxOf));
    await tx([STORE], 'readwrite', (st) => { bs.forEach((b) => st(STORE).put(b)); });
    cache = null;
  };
  S.remove = async (id) => { needKey(); await tx([STORE], 'readwrite', (st) => { st(STORE).delete(id); }); cache = null; };
  S.clear = async () => { needKey(); await tx([STORE], 'readwrite', (st) => { st(STORE).clear(); }); cache = null; };

  /** 추출 초안 → 저장용 기록. original에 자동 추출값을 따로 보관한다. */
  const CORE = ['year', 'month', 'paymentYearMonth', 'basicInfo', 'summaryLine', 'payGrade', 'careerYears',
    'employmentStatus', 'payments', 'taxes', 'deductions', 'paymentTotal', 'taxTotal', 'deductionTotal', 'netPay'];
  PS.coreOf = (r) => { const o = {}; CORE.forEach((k) => { o[k] = clone(r[k] === undefined ? null : r[k]); }); return o; };
  PS.buildRecord = function (draft, extracted, now) {
    const t = now || new Date().toISOString();
    const core = PS.coreOf(draft);
    core.paymentYearMonth = U.ym(core.year, core.month);
    const orig = extracted ? PS.coreOf(extracted) : null;
    const edited = orig ? !PS.sameCore(orig, core) : true;
    return Object.assign({ id: core.paymentYearMonth }, core, {
      printedDate: draft.printedDate || null,
      sourceFileType: (draft.meta && draft.meta.sourceFileType) || draft.sourceFileType || 'manual',
      sourceFileName: (draft.meta && draft.meta.sourceFileName) || draft.sourceFileName || null,
      parserVersion: (draft.meta && draft.meta.parserVersion) || draft.parserVersion || null,
      extractedAt: draft.extractedAt || t,
      updatedAt: t,
      original: orig,
      userEdited: edited,
    });
  };
  /** 기존 기록 수정 저장: original은 유지 */
  PS.applyEdit = function (rec, draft) {
    const core = PS.coreOf(draft);
    core.paymentYearMonth = U.ym(core.year, core.month);
    const out = Object.assign({}, clone(rec), core, { id: core.paymentYearMonth, updatedAt: new Date().toISOString() });
    out.userEdited = out.original ? !PS.sameCore(out.original, core) : true;
    return out;
  };

  /* ================= analysis ================= */
  const A = (PS.analysis = {});
  A.GROUP_LABEL = { payments: '급여', taxes: '세금', deductions: '공제' };
  A.TOTALS = [
    { key: 'total:netPay', label: '실수령액', field: 'netPay' },
    { key: 'total:paymentTotal', label: '급여총액', field: 'paymentTotal' },
    { key: 'total:taxTotal', label: '세금총액', field: 'taxTotal' },
    { key: 'total:deductionTotal', label: '공제총액', field: 'deductionTotal' },
  ];
  /** 저장된 기록에 실제로 등장한 항목 목록(코드에 고정하지 않음) */
  A.catalog = (records) => {
    const out = { payments: [], taxes: [], deductions: [] };
    Object.keys(out).forEach((g) => {
      const seen = new Map();
      records.forEach((r) => (r[g] || []).forEach((it) => {
        if (it.name && !seen.has(it.name)) seen.set(it.name, seen.size);
      }));
      out[g] = [...seen.keys()];
    });
    return out;
  };
  A.metricLabel = (key) => {
    const t = A.TOTALS.find((x) => x.key === key);
    if (t) return t.label;
    const [g, ...rest] = key.split(':');
    return `${rest.join(':')} (${A.GROUP_LABEL[g] || g})`;
  };
  /** 한 달의 지표 값. 항목이 없는 달은 null(0이 아님). 같은 이름이 여러 번이면 합산 */
  A.value = (rec, key) => {
    if (!rec) return null;
    const t = A.TOTALS.find((x) => x.key === key);
    if (t) return rec[t.field] == null ? null : rec[t.field];
    if (key === 'info:payGrade') return rec.payGrade;
    if (key === 'info:careerYears') return rec.careerYears;
    const i = key.indexOf(':');
    const g = key.slice(0, i), name = key.slice(i + 1);
    const hits = (rec[g] || []).filter((it) => it.name === name);
    if (!hits.length) return null;
    if (hits.some((h) => h.amount == null)) return null;
    return hits.reduce((s, h) => s + h.amount, 0);
  };
  A.shift = (y, m, d) => { const t = y * 12 + (m - 1) + d; return { year: Math.floor(t / 12), month: (t % 12) + 1 }; };
  A.lastN = (records, y, m, n) => {
    const byId = new Map(records.map((r) => [r.id, r]));
    const out = [];
    for (let k = n - 1; k >= 0; k--) {
      const p = A.shift(y, m, -k);
      out.push({ year: p.year, month: p.month, rec: byId.get(U.ym(p.year, p.month)) || null });
    }
    return out;
  };
  A.years = (records) => [...new Set(records.map((r) => r.year))].sort((a, b) => a - b);
  const sumOf = (list, f) => {
    const vals = list.map((r) => r[f]).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  A.yearSummary = (records, year) => {
    const list = records.filter((r) => r.year === year);
    const n = list.length;
    const s = {
      year, months: n,
      paymentTotal: sumOf(list, 'paymentTotal'), taxTotal: sumOf(list, 'taxTotal'),
      deductionTotal: sumOf(list, 'deductionTotal'), netPay: sumOf(list, 'netPay'),
    };
    const avg = (f) => {
      const vals = list.map((r) => r[f]).filter((v) => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    s.avgPayment = avg('paymentTotal');
    s.avgTax = avg('taxTotal');
    s.avgDeduction = avg('deductionTotal');
    s.avgNet = avg('netPay');
    s.incomplete = list.some((r) => ['paymentTotal', 'taxTotal', 'deductionTotal', 'netPay'].some((f) => r[f] == null));
    return s;
  };
  /** 연중 호봉·근무년수·보직 변화 */
  A.changes = (records, year) => {
    const list = records.filter((r) => r.year === year);
    const prevAll = records.filter((r) => r.year < year);
    let prev = prevAll[prevAll.length - 1] || null;
    const out = [];
    list.forEach((r) => {
      if (prev) {
        const diff = (label, a, b) => { if (a !== b && a != null && b != null) out.push({ month: r.month, label, from: a, to: b }); };
        diff('호봉', prev.payGrade, r.payGrade);
        diff('근무년수', prev.careerYears, r.careerYears);
        diff('보직구분', (prev.basicInfo || {})['보직구분'], (r.basicInfo || {})['보직구분']);
        diff('담당과목', (prev.basicInfo || {})['담당과목'], (r.basicInfo || {})['담당과목']);
      }
      prev = r;
    });
    return out;
  };
  /** 두 기록의 항목 비교 */
  A.diff = (a, b) => {
    const rows = [];
    ['payments', 'taxes', 'deductions'].forEach((g) => {
      const names = [...new Set([...(a[g] || []), ...(b[g] || [])].map((i) => i.name))];
      names.forEach((n) => {
        const va = A.value(a, g + ':' + n), vb = A.value(b, g + ':' + n);
        const ea = (a[g] || []).some((i) => i.name === n), eb = (b[g] || []).some((i) => i.name === n);
        if (ea !== eb || va !== vb) rows.push({ group: g, name: n, a: ea ? va : undefined, b: eb ? vb : undefined });
      });
    });
    A.TOTALS.forEach((t) => { if (a[t.field] !== b[t.field]) rows.push({ group: 'total', name: t.label, a: a[t.field], b: b[t.field] }); });
    [['호봉', 'payGrade'], ['근무년수', 'careerYears']].forEach(([l, f]) => {
      if (a[f] !== b[f]) rows.push({ group: 'info', name: l, a: a[f], b: b[f] });
    });
    const ks = new Set([...Object.keys(a.basicInfo || {}), ...Object.keys(b.basicInfo || {})]);
    ks.forEach((k) => { if ((a.basicInfo || {})[k] !== (b.basicInfo || {})[k]) rows.push({ group: 'info', name: k, a: (a.basicInfo || {})[k], b: (b.basicInfo || {})[k] }); });
    return rows;
  };

  /* ---------- 연도 간 비교 ---------- */
  const FIELDS = ['paymentTotal', 'taxTotal', 'deductionTotal', 'netPay'];
  A.FIELD_LABEL = { paymentTotal: '급여총액', taxTotal: '세금총액', deductionTotal: '공제총액', netPay: '실수령액' };
  A.monthsOf = (records, year) => records.filter((r) => r.year === year).map((r) => r.month).sort((a, b) => a - b);
  const pick = (records, year, months) => records.filter((r) => r.year === year && (!months || months.includes(r.month)));
  const sumField = (list, f) => {
    if (!list.length) return null;
    if (list.some((r) => r[f] == null)) return null; // 비어 있는 달이 섞이면 합계를 만들지 않음
    return list.reduce((s, r) => s + r[f], 0);
  };
  const sumKey = (list, key) => {
    const vals = list.map((r) => A.value(r, key)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  A.delta = (a, b) => {
    if (a == null || b == null) return { diff: null, pct: null };
    return { diff: b - a, pct: a === 0 ? null : ((b - a) / Math.abs(a)) * 100 };
  };
  /**
   * 두 연도 비교. basis: 'same'(두 해 모두 기록이 있는 달만) | 'annual'(저장된 달 전부)
   * base = 비교 대상(이전), target = 기준 연도
   */
  A.comparePair = (records, base, target, basis) => {
    const mBase = A.monthsOf(records, base), mTarget = A.monthsOf(records, target);
    const common = mBase.filter((m) => mTarget.includes(m));
    const use = basis === 'same' ? common : null;
    const la = pick(records, base, use), lb = pick(records, target, use);
    const out = {
      base, target, basis, common,
      monthsBase: use ? common : mBase, monthsTarget: use ? common : mTarget,
      mismatch: basis === 'annual' && (mBase.length !== mTarget.length || mBase.some((m, i) => m !== mTarget[i])),
      empty: basis === 'same' ? !common.length : !(la.length && lb.length),
      rows: [],
    };
    FIELDS.forEach((f) => {
      const a = sumField(la, f), b = sumField(lb, f);
      out.rows.push(Object.assign({ key: f, label: A.FIELD_LABEL[f], a, b }, A.delta(a, b)));
    });
    const avg = (list, f) => { const v = sumField(list, f); return v == null ? null : Math.round(v / list.length); };
    out.avgNet = Object.assign({ a: avg(la, 'netPay'), b: avg(lb, 'netPay') }, A.delta(avg(la, 'netPay'), avg(lb, 'netPay')));
    // 항목별
    const cat = A.catalog(la.concat(lb));
    out.items = {};
    Object.keys(cat).forEach((g) => {
      out.items[g] = cat[g].map((name) => {
        const key = `${g}:${name}`;
        const a = sumKey(la, key), b = sumKey(lb, key);
        const inA = la.some((r) => (r[g] || []).some((i) => i.name === name));
        const inB = lb.some((r) => (r[g] || []).some((i) => i.name === name));
        return Object.assign({ name, a, b, inA, inB, monthsA: la.filter((r) => A.value(r, key) != null).length, monthsB: lb.filter((r) => A.value(r, key) != null).length }, A.delta(inA ? a : null, inB ? b : null));
      });
    });
    return out;
  };
  /** 연속 연도(직전 기록 연도) 대비 개요 */
  A.yearOverview = (records, basis) => {
    const ys = A.years(records);
    return ys.map((y, i) => {
      const s = A.yearSummary(records, y);
      const row = { year: y, months: s.months, net: s.netPay, pay: s.paymentTotal, prev: i ? ys[i - 1] : null };
      if (i) {
        const c = A.comparePair(records, ys[i - 1], y, basis);
        const n = c.rows.find((r) => r.key === 'netPay');
        const p = c.rows.find((r) => r.key === 'paymentTotal');
        Object.assign(row, { cmpMonths: c.basis === 'same' ? c.common.length : null, empty: c.empty, mismatch: c.mismatch, netDelta: n, payDelta: p, netA: n.a, netB: n.b });
      }
      return row;
    });
  };
  /** 부담률: (세금+공제)/급여총액. basis 'same'이면 모든 대상 연도에 공통으로 있는 달만 */
  A.burden = (records, years, basis) => {
    let months = null;
    if (basis === 'same') {
      months = [...Array(12)].map((_, i) => i + 1).filter((m) => years.every((y) => records.some((r) => r.year === y && r.month === m)));
    }
    const rows = years.map((y) => {
      const list = pick(records, y, months);
      const p = sumField(list, 'paymentTotal'), t = sumField(list, 'taxTotal'), d = sumField(list, 'deductionTotal');
      const r = (v) => (p && v != null ? (v / p) * 100 : null);
      return { year: y, months: list.length, pay: p, tax: t, ded: d, taxRate: r(t), dedRate: r(d), totalRate: t != null && d != null ? r(t + d) : null };
    });
    return { months, rows };
  };
  /** 같은 기간 누적: 1월~upto월, 두 해 모두 기록이 있는 달만 누적 */
  A.cumulative = (records, base, target, upto, field) => {
    const mBase = A.monthsOf(records, base), mTarget = A.monthsOf(records, target);
    const months = [];
    for (let m = 1; m <= upto; m++) if (mBase.includes(m) && mTarget.includes(m)) months.push(m);
    const missing = [];
    for (let m = 1; m <= upto; m++) if (!months.includes(m)) missing.push(m);
    const byId = new Map(records.map((r) => [r.id, r]));
    let ca = 0, cb = 0, broken = false;
    const series = [];
    for (let m = 1; m <= upto; m++) {
      if (months.includes(m)) {
        const ra = byId.get(U.ym(base, m)), rb = byId.get(U.ym(target, m));
        if (ra[field] == null || rb[field] == null) broken = true;
        ca += ra[field] || 0; cb += rb[field] || 0;
        series.push({ month: m, a: ca, b: cb });
      } else series.push({ month: m, a: null, b: null });
    }
    return { months, missing, broken, series, total: Object.assign({ a: months.length ? ca : null, b: months.length ? cb : null }, A.delta(months.length ? ca : null, months.length ? cb : null)) };
  };

  /* ---------- 검색 ---------- */
  const nrm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
  const hitAll = (text, terms) => { const t = nrm(text); return terms.every((q) => t.includes(q)); };
  A.searchTerms = (query) => String(query || '').trim().split(/\s+/).map(nrm).filter(Boolean);
  /**
   * 저장된 모든 기록에서 검색.
   * 1) 급여·세금·공제 항목명  2) 기본정보(라벨·값)  3) 계산근거 원문(일치한 줄)
   */
  A.search = (records, query) => {
    const terms = A.searchTerms(query);
    const out = { terms, items: { payments: [], taxes: [], deductions: [] }, basics: [], calcs: [], count: 0, monthCount: 0 };
    if (!terms.length) return out;
    const touched = new Set();
    ['payments', 'taxes', 'deductions'].forEach((g) => {
      const names = [];
      records.forEach((r) => (r[g] || []).forEach((it) => {
        if (it.name && hitAll(it.name, terms) && !names.includes(it.name)) names.push(it.name);
      }));
      names.sort((a, b) => a.localeCompare(b, 'ko'));
      out.items[g] = names.map((name) => {
        const key = `${g}:${name}`;
        const months = [];
        records.forEach((r) => {
          if (!(r[g] || []).some((i) => i.name === name)) return;
          months.push({ year: r.year, month: r.month, amount: A.value(r, key) });
          touched.add(r.id);
        });
        const years = [];
        months.forEach((m) => {
          let y = years.find((x) => x.year === m.year);
          if (!y) { y = { year: m.year, months: [], sum: 0, missing: 0 }; years.push(y); }
          y.months.push(m);
          if (m.amount == null) y.missing += 1; else y.sum += m.amount;
        });
        const total = months.reduce((s, m) => s + (m.amount || 0), 0);
        return { group: g, name, years, count: months.length, total, missing: months.filter((m) => m.amount == null).length };
      });
      out.count += out.items[g].length;
    });
    // 기본정보
    const map = new Map();
    records.forEach((r) => {
      const pairs = Object.entries(r.basicInfo || {});
      if (r.payGrade != null) pairs.push(['호봉', `${r.payGrade}호봉`]);
      if (r.careerYears != null) pairs.push(['근무년수', `${r.careerYears}년`]);
      if (r.employmentStatus) pairs.push(['재직상태', r.employmentStatus]);
      pairs.forEach(([label, value]) => {
        if (!value || !(hitAll(label + value, terms) || hitAll(value, terms) || hitAll(label, terms))) return;
        const k = label + '\u0000' + value;
        if (!map.has(k)) map.set(k, { label, value, months: [] });
        map.get(k).months.push({ year: r.year, month: r.month });
        touched.add(r.id);
      });
    });
    out.basics = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    out.count += out.basics.length;
    // 계산근거 원문
    records.forEach((r) => {
      ['payments', 'taxes', 'deductions'].forEach((g) => (r[g] || []).forEach((it) => {
        if (!it.calc || !it.calc.raw) return;
        const lines = it.calc.raw.split('\n').filter((ln) => ln.trim() && hitAll(ln, terms));
        if (!lines.length) return;
        out.calcs.push({ year: r.year, month: r.month, name: it.name, lines });
        touched.add(r.id);
      }));
    });
    out.calcs.sort((a, b) => a.year - b.year || a.month - b.month);
    out.count += out.calcs.length;
    out.monthCount = touched.size;
    return out;
  };

  /* ================= backup / restore ================= */
  const B = (PS.backup = {});
  B.FORMAT = 'payslip-ledger-backup';
  /** 백업 파일: 앱 PIN으로 만든 키로 암호화(v2). 복원 시 그 백업을 만들 때의 PIN이 필요 */
  B.make = async () => {
    const records = await S.all();
    const info = await L.exportKeyInfo();
    const box = await C.encrypt(needKey(), { records });
    return {
      format: B.FORMAT, version: 2, encrypted: true,
      exportedAt: new Date().toISOString(), count: records.length,
      kdf: { name: 'PBKDF2-SHA256', salt: info.salt, iterations: info.iter }, cipher: 'AES-256-GCM',
      iv: box.iv, ct: box.ct,
    };
  };
  B.inspect = (obj) => {
    if (!obj || obj.format !== B.FORMAT) throw new Error('이 앱에서 만든 백업 파일이 아닙니다.');
    if (obj.encrypted) {
      if (!obj.kdf || !obj.kdf.salt || !obj.iv || !obj.ct) throw new Error('백업 파일이 손상되었습니다.');
      return { encrypted: true, count: obj.count };
    }
    if (!Array.isArray(obj.records)) throw new Error('백업 파일이 손상되었습니다.');
    return { encrypted: false, count: obj.records.length };
  };
  B.open = async (obj, pin) => {
    if (!obj.encrypted) return B.validateRecords(obj.records);
    const key = await C.deriveKey(pin, obj.kdf.salt, obj.kdf.iterations);
    let data;
    try { data = await C.decrypt(key, { iv: obj.iv, ct: obj.ct }); }
    catch (e) { const err = new Error('PIN이 맞지 않거나 백업 파일이 손상되었습니다.'); err.code = 'BAD_PIN'; throw err; }
    return B.validateRecords(data.records);
  };
  B.validateRecords = (records) => {
    if (!Array.isArray(records)) throw new Error('백업 파일이 손상되었습니다.');
    const bad = records.filter((r) => !r || !r.id || !(r.month >= 1 && r.month <= 12) || !r.year ||
      !Array.isArray(r.payments) || !Array.isArray(r.taxes) || !Array.isArray(r.deductions) || r.id !== U.ym(r.year, r.month));
    if (bad.length) throw new Error(`백업 파일에 형식이 맞지 않는 기록이 ${bad.length}건 있습니다.`);
    return records;
  };
  /**
   * mode: 'keep'  — 기존 데이터 유지, 없는 달만 추가
   *       'overwrite' — 기존 데이터 모두 지우고 백업으로 교체
   *       'merge' — 같은 달이 겹치면 수정 시각(updatedAt)이 더 최근인 쪽 사용
   */
  B.plan = async (incoming, mode) => {
    const current = await S.all();
    const byId = new Map(current.map((r) => [r.id, r]));
    const plan = { add: [], replace: [], skip: [], removeAll: mode === 'overwrite' };
    incoming.forEach((r) => {
      const ex = byId.get(r.id);
      if (mode === 'overwrite' || !ex) plan.add.push(r);
      else if (mode === 'keep') plan.skip.push(r);
      else if ((r.updatedAt || '') > (ex.updatedAt || '')) plan.replace.push(r);
      else plan.skip.push(r);
    });
    return plan;
  };
  B.apply = async (plan) => {
    const bs = await Promise.all([...plan.add, ...plan.replace].map(boxOf));
    await tx([STORE], 'readwrite', (st) => {
      if (plan.removeAll) st(STORE).clear();
      bs.forEach((b) => st(STORE).put(b));
    });
    cache = null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
