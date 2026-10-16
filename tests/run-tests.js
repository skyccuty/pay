/*
 * 파서 회귀 테스트 (Node.js 18 이상)
 * 사용법:  cd tests && npm install pdfjs-dist@3.11.174 xlsx@0.18.5
 *          node run-tests.js <명세서 파일이 있는 폴더>
 * expected/ 안의 기준 결과(연-월.json)와 새 파서 결과를 비교합니다.
 * 파서를 고친 뒤 기존 명세서의 결과가 달라지지 않았는지 확인하는 용도입니다.
 */
const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const XLSX = require('xlsx');
require('../js/extractors.js');
require('../js/parser.js');
const PS = globalThis.PS;

const dir = process.argv[2];
const update = process.argv.includes('--update');
if (!dir) { console.log('사용법: node run-tests.js <명세서 폴더> [--update]'); process.exit(1); }
const core = (r) => {
  const o = JSON.parse(JSON.stringify(r));
  delete o.meta; delete o.printedDate;
  return o;
};
(async () => {
  let fail = 0, n = 0;
  const byMonth = {};
  for (const f of fs.readdirSync(dir).filter((x) => /\.(pdf|xlsx)$/i.test(x)).sort()) {
    const buf = fs.readFileSync(path.join(dir, f));
    const file = { name: f, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    let rec;
    try { rec = await PS.processFile(file, { pdfjs, XLSX }); }
    catch (e) { console.log(`✗ ${f}: ${e.message}`); fail++; continue; }
    n++;
    const issues = [...rec.issues, ...PS.validate(rec)];
    const exp = path.join(__dirname, 'expected', `${rec.paymentYearMonth}.json`);
    const got = JSON.stringify(core(rec), null, 2);
    (byMonth[rec.paymentYearMonth] = byMonth[rec.paymentYearMonth] || []).push(got);
    if (update || !fs.existsSync(exp)) { fs.writeFileSync(exp, got); console.log(`• ${f} → 기준 결과 저장 (${rec.paymentYearMonth})`); continue; }
    const same = fs.readFileSync(exp, 'utf8') === got;
    if (!same) fail++;
    console.log(`${same ? '✓' : '✗'} ${f} (${rec.paymentYearMonth}) ${same ? '기준과 일치' : '기준과 다름'}${issues.length ? ` · 확인 필요 ${issues.length}건` : ''}`);
    issues.forEach((i) => console.log(`    - ${i.message}`));
  }
  Object.entries(byMonth).forEach(([ym, list]) => {
    if (list.length > 1 && new Set(list).size > 1) { fail++; console.log(`✗ ${ym}: 같은 달의 PDF와 Excel 결과가 다릅니다`); }
    else if (list.length > 1) console.log(`✓ ${ym}: PDF와 Excel 결과 일치`);
  });
  console.log(`\n${n}개 파일, 실패 ${fail}건`);
  process.exit(fail ? 1 : 0);
})();
