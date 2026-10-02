// Nhập file "KẾ HOẠCH SỰ KIỆN - NĂM HỌC 2026-2027 FS Tây Hà Nội" vào:
//   1) school_events      — lịch sự kiện (hiện ở Lịch + "sự kiện trong tháng chưa có bài")
//   2) annual_plan_lines  — Kế hoạch năm, nhóm "Theo sự kiện", mỗi bộ phận phụ trách 1 tuyến
// File có 2 sheet: "KH năm học 26-27" (đủ bộ phận/loại/địa điểm/ghi chú, có cả mục "Cắt giảm") và
// "Sheet11" (danh sách chốt, có ngày cụ thể). Lấy Sheet11 làm chuẩn; bộ phận lấy từ sheet đầu.
// Ngày trong file là ngày CỦA NĂM HỌC MỚI nên sự kiện có ngày được ghi luôn là "đã xác nhận";
// sự kiện chỉ có tháng thì để "chờ xác nhận" (không có ngày).
//
// Chạy:  node migration/import_school_events_tay_hn.mjs "<file .xlsx>" [--apply]
// Không có --apply thì chỉ in kết quả đọc. Chạy lại lần 2 sẽ tự dừng nếu đã nhập.
import xlsx from 'xlsx';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const CAMPUS = 'tay_hn';
const SCHOOL_YEAR = '2026-2027';
if (!FILE) { console.error('Thiếu đường dẫn file .xlsx'); process.exit(1); }

const clean = v => String(v == null ? '' : v).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
const wb = xlsx.readFile(FILE);
const read = name => xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false });
const detail = read(wb.SheetNames[0]);   // Thời gian | Bộ phận | Tên | Đối tượng | Loại | Đối tượng TG | Địa điểm | ... | Ghi chú
const final = read(wb.SheetNames[1]);    // Thời gian | Tên | Đối tượng

const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
// "17/08/2026" · "27/08 - 28/08/2026" · "21/10 - 30/10/26" · "01/04 - 30/04/2027" → {start,end}; "10/2026" → {month}
function parseTime(text) {
  const s = clean(text);
  const mo = s.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (mo) return { month: Number(mo[1]), year: Number(mo[2]), start: null, end: null };
  const toks = [...s.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/g)];
  if (!toks.length) return null;
  let year = null;
  for (const t of toks) if (t[3]) year = Number(t[3]) < 100 ? 2000 + Number(t[3]) : Number(t[3]);
  if (!year) return null;
  const dates = toks.map(t => iso(year, Number(t[2]), Number(t[1]))).filter(Boolean);
  if (!dates.length) return null;
  return { start: dates[0], end: dates.length > 1 && dates[1] > dates[0] ? dates[1] : null, month: Number(dates[0].slice(5, 7)), year };
}

const norm = s => clean(s).toLowerCase().replace(/fpt\s*school/g, 'fschool').replace(/[“”"'«»]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const detailRows = detail.slice(1).map(r => ({
  time: clean(r[0]), dept: clean(r[1]), title: clean(r[2]), place: clean(r[6]), note: clean(r[9]),
  cut: /cắt giảm/i.test(clean(r[9])), key: norm(r[2])
})).filter(r => r.title);
const deptOf = title => {
  const k = norm(title);
  if (/phòng ngừa tâm lý/.test(k)) return 'CTHS';
  if (/^kiểm tra /.test(k)) return 'Đào tạo';
  if (/^showcase các dự án/.test(k)) return 'PDP';
  const hit = detailRows.find(d => d.key === k) || detailRows.find(d => d.key.length > 12 && (d.key.startsWith(k.slice(0, 25)) || k.startsWith(d.key.slice(0, 25))))
    || detailRows.find(d => d.key.length >= 6 && k.includes(d.key));
  return hit ? hit.dept : '';
};

const events = [];
const seen = new Set();
for (const r of final.slice(1)) {
  const time = clean(r[0]), title = clean(r[1]), audience = clean(r[2]);
  if (!title) continue;
  const t = parseTime(time);
  if (!t) { console.warn('Không đọc được thời gian:', JSON.stringify(time), title); continue; }
  const dupKey = norm(title) + '|' + (t.start || t.month);
  if (seen.has(dupKey)) { console.warn('Bỏ dòng trùng:', title, time); continue; }
  seen.add(dupKey);
  const place = (detailRows.find(d => d.key === norm(title)) || {}).place || '';
  const notes = [];
  if (audience) notes.push('Đối tượng: ' + audience);
  if (place) notes.push(place);
  if (!t.start) notes.push('Mới có tháng — chờ chốt ngày');
  if (/năm học 20(1\d|2[0-5])/i.test(title)) notes.push('Tên sự kiện còn ghi năm cũ — cần sửa');
  events.push({
    month: t.month, title, department: deptOf(title) || null, start_date: t.start, end_date: t.end,
    time_note: notes.join(' · ') || null, status: t.start ? 'da_xac_nhan' : 'cho_xac_nhan'
  });
}
// Mục chỉ có ở sheet chi tiết (không bị "Cắt giảm", không có ở danh sách chốt) → vẫn nhập, ghi rõ để người dùng quyết.
for (const d of detailRows) {
  if (d.cut || /^chi phí|^tổng/i.test(d.title)) continue;
  const first3 = k => k.split(' ').slice(0, 3).join(' ');
  const dm = (parseTime(d.time) || {}).month;
  if (events.some(e => { const n = norm(e.title); return n.includes(d.key) || d.key.includes(n) || (d.key.length > 12 && n.startsWith(d.key.slice(0, 25))) || (e.month === dm && first3(n) === first3(d.key)); })) continue;
  const t = parseTime(d.time) || parseTime(d.time.replace(/^(\d{1,2}\/\d{2})$/, '$1/2026'));
  const m = t && t.month ? t : (/(\d{1,2})\/(\d{4})/.test(d.time) ? parseTime(d.time) : null);
  const month = (t && t.month) || 8;   // dòng không ghi tháng: tuần cuối tháng 8 (cạnh các mục "Khảo sát" đầu năm)
  events.push({
    month, title: d.title, department: d.dept || null, start_date: t ? t.start : null, end_date: t ? t.end : null,
    time_note: 'Chỉ có trong bảng chi tiết, không có trong danh sách chốt — kiểm tra lại' + (d.time ? ' · Thời gian: ' + d.time : ''),
    status: 'cho_xac_nhan'
  });
}
events.sort((a, b) => (a.start_date || `${a.month >= 8 ? 2026 : 2027}-${String(a.month).padStart(2, '0')}-99`).localeCompare(b.start_date || `${b.month >= 8 ? 2026 : 2027}-${String(b.month).padStart(2, '0')}-99`));

// Kế hoạch năm: 1 tuyến / bộ phận, mỗi tháng liệt kê các sự kiện.
// Gom theo bộ phận CHÍNH (đứng đầu, vd "PDP + GVCN" → PDP); bộ phận phối hợp ghi cuối dòng.
const primaryDept = d => (d ? d.split(/\s*(?:\+|\bx\b)\s*/)[0].trim() : '') || 'Chưa rõ bộ phận';
const byDept = new Map();
for (const e of events) {
  const dept = primaryDept(e.department);
  if (!byDept.has(dept)) byDept.set(dept, {});
  const key = `${e.month >= 8 ? 2026 : 2027}-${String(e.month).padStart(2, '0')}`;
  const months = byDept.get(dept);
  const when = e.start_date ? e.start_date.slice(8, 10) + '/' + e.start_date.slice(5, 7) + (e.end_date ? '–' + e.end_date.slice(8, 10) + '/' + e.end_date.slice(5, 7) : '') : '';
  const line = '- ' + e.title + (when ? ' (' + when + ')' : '') + (e.department && e.department !== dept ? ' — ' + e.department : '');
  months[key] = { highlight: months[key] ? months[key].highlight + '\n' + line : line };
}
const planLines = [...byDept.entries()].map(([name, months], i) => ({ section: 'su_kien', name, months, sort_order: i + 1 }));

console.log(`Đọc được ${events.length} sự kiện (${events.filter(e => e.status === 'da_xac_nhan').length} có ngày, ${events.filter(e => e.status !== 'da_xac_nhan').length} chờ xác nhận):`);
events.forEach((e, i) => console.log(
  String(i + 1).padStart(3), `T${String(e.month).padStart(2)}`, (e.start_date || '    —     '), (e.end_date ? '→ ' + e.end_date.slice(5) : '       '),
  '|', (e.department || '').slice(0, 20).padEnd(20), '|', e.title.slice(0, 60), e.time_note ? ' [' + e.time_note.slice(0, 60) + ']' : ''
));
console.log(`\nKế hoạch năm: ${planLines.length} tuyến theo bộ phận:`);
planLines.forEach(l => console.log('  -', l.name, `(${Object.keys(l.months).length} tháng)`));

if (!APPLY) { console.log('\n(Chạy thử — chưa ghi gì. Thêm --apply để nhập thật.)'); process.exit(0); }

const env = Object.fromEntries(fs.readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const c1 = await supabase.from('school_events').select('id', { count: 'exact', head: true }).eq('campus', CAMPUS).eq('school_year', SCHOOL_YEAR);
const c2 = await supabase.from('annual_plan_lines').select('id', { count: 'exact', head: true }).eq('campus', CAMPUS).eq('school_year', SCHOOL_YEAR);
if (c1.count || c2.count) { console.log(`\nĐã có dữ liệu ${CAMPUS} ${SCHOOL_YEAR} (sự kiện: ${c1.count}, kế hoạch năm: ${c2.count}) — dừng, không nhập trùng.`); process.exit(0); }

const now = new Date().toISOString();
const stamp = Date.now();
const evRows = events.map((e, i) => ({
  id: `EVT_${stamp}_${String(i).padStart(3, '0')}`, campus: CAMPUS, school_year: SCHOOL_YEAR, ...e,
  lead_days: 14, source: 'import', confirmed_at: e.status === 'da_xac_nhan' ? now : null
}));
const r1 = await supabase.from('school_events').insert(evRows);
if (r1.error) { console.error('Lỗi nhập sự kiện:', r1.error.message); process.exit(1); }
const lineRows = planLines.map((l, i) => ({ id: `APL_${stamp}_${String(i).padStart(3, '0')}`, campus: CAMPUS, school_year: SCHOOL_YEAR, ...l, source: 'import' }));
const r2 = await supabase.from('annual_plan_lines').insert(lineRows);
if (r2.error) { console.error('Lỗi nhập kế hoạch năm:', r2.error.message); process.exit(1); }
console.log(`\nĐã nhập ${evRows.length} sự kiện và ${lineRows.length} tuyến kế hoạch năm cho ${CAMPUS} ${SCHOOL_YEAR}.`);
