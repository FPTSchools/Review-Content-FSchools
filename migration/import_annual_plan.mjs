// Nhập sheet "Kế hoạch năm" (file Kế hoạch truyền thông THPT FPT Hà Nội) vào bảng annual_plan_lines.
// Sheet dạng ma trận: mỗi hàng là 1 tuyến (tổ/phòng, series, chiến dịch, kênh báo chí...), mỗi tháng
// có các cột Highlight nội dung / Số lượng content / Ngân sách / (Định dạng). Hàng "MỤC TIÊU/THÔNG ĐIỆP"
// gộp ô theo giai đoạn nhiều tháng.
//
// Chạy:  node migration/import_annual_plan.mjs "<file .xlsx>" <campus> <năm học> [--apply]
//   vd:  node migration/import_annual_plan.mjs "D:/Dowloads/Kế hoạch truyền thông ....xlsx" hoa_lac 2025-2026 --apply
// Không có --apply thì chỉ in kết quả đọc. Tự dừng nếu năm học/cơ sở đó đã có kế hoạch.
import xlsx from 'xlsx';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const [FILE, CAMPUS, SCHOOL_YEAR] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const SHEET = 'Kế hoạch năm';
if (!FILE || !CAMPUS || !/^\d{4}-\d{4}$/.test(SCHOOL_YEAR || '')) {
  console.error('Dùng: node migration/import_annual_plan.mjs "<file .xlsx>" <hoa_lac|tay_hn> <yyyy-yyyy> [--apply]');
  process.exit(1);
}

const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[SHEET];
if (!ws) { console.error('Không thấy sheet', SHEET); process.exit(1); }
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: false });
const clean = v => String(v == null ? '' : v).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();

// Hàng 1: nhãn tháng "10/2025" ở cột bắt đầu mỗi nhóm; hàng 2: tên trường của từng cột.
const monthStarts = [];
rows[1].forEach((c, j) => { const m = clean(c).match(/^(\d{1,2})\/(\d{4})$/); if (m && j >= 3) monthStarts.push([j, `${m[2]}-${m[1].padStart(2, '0')}`]); });
const colInfo = {};
monthStarts.forEach(([start, key], i) => {
  const end = i + 1 < monthStarts.length ? monthStarts[i + 1][0] - 1 : rows[1].length + 5;
  for (let j = start; j <= end; j++) {
    const h = clean(rows[2][j]).toLowerCase();
    const field = h.startsWith('highlight') ? 'highlight' : h.startsWith('số lượng') ? 'target' : h.startsWith('ngân sách') ? 'budget' : h.startsWith('định dạng') ? 'format' : null;
    if (field) colInfo[j] = { month: key, field };
  }
});
const monthOfCol = j => { let k = null; for (const [s, key] of monthStarts) if (j >= s) k = key; return k; };

function sectionOf(label) {
  const u = label.toUpperCase();
  if (u.startsWith('TỔNG') || u.startsWith('NGÂN SÁCH NĂM') || u.startsWith('SỐ LƯỢNG CONTENT NĂM')) return 'stop';
  if (u.includes('MỤC TIÊU')) return 'muc_tieu';
  if (u.includes('HOẠT ĐỘNG/SỰ KIỆN') || u.includes('HOẠT ĐỘNG / SỰ KIỆN')) return 'su_kien';
  if (u.includes('LỚP HỌC')) return 'lop_hoc';
  if (u.includes('CHỦ ĐỀ NĂM HỌC')) return 'chu_de';
  if (u.includes('CAMPAIGN TUYỂN SINH')) return 'tuyen_sinh';
  if (u.startsWith('CAMPAIGN')) return 'campaign';
  if (/^(KOC|KOL|BÁO CHÍ|TRUYỀN HÌNH|HOTPAGE)/.test(u)) return 'kenh_ngoai';
  return null;
}
// "CAMPAIGN FSCHOOL VIBES" → "Campaign FSchool vibes"; tên ngắn toàn chữ hoa (KOC/KOL) giữ nguyên.
const titleCase = s => s === s.toUpperCase() && /[A-ZĐ]/.test(s) && s.length > 10
  ? s.charAt(0) + s.slice(1).toLowerCase().replace(/\bfschool\b/g, 'FSchool') : s;

const lines = [];
let section = null, current = null, groupName = '', groupNote = '';
function newLine(name, note) {
  current = { section, name: name.slice(0, 300), note: note || null, months: {} };
  lines.push(current);
  return current;
}
function addCells(line, r) {
  for (const [j, info] of Object.entries(colInfo)) {
    const v = clean(r[j]);
    if (!v) continue;
    const cell = line.months[info.month] || (line.months[info.month] = {});
    if (info.field === 'target' || info.field === 'budget') {
      const n = Number(v.replace(/[^\d.]/g, ''));
      if (isFinite(n) && v.replace(/[^\d]/g, '')) cell[info.field] = (cell[info.field] || 0) + n;
    } else {
      cell[info.field] = cell[info.field] ? `${cell[info.field]}\n${v}` : v;
    }
  }
}

// Mục tiêu/thông điệp: ô gộp nhiều tháng → áp cùng thông điệp cho mọi tháng trong vùng gộp.
const merges = ws['!merges'] || [];
for (let i = 3; i < rows.length; i++) {
  const r = rows[i];
  const c0 = clean(r[0]), c1 = clean(r[1]), c2 = clean(r[2]);
  const sec = c0 ? sectionOf(c0) : null;
  if (sec === 'stop') break;

  if (sec === 'muc_tieu') {
    section = 'muc_tieu';
    const line = newLine('Mục tiêu / Thông điệp');
    for (let j = 3; j < r.length; j++) {
      const v = clean(r[j]);
      if (!v) continue;
      const m = merges.find(g => g.s.r === i && g.s.c === j);
      const last = m ? m.e.c : j;
      const keys = new Set();
      for (let c = j; c <= last; c++) { const k = monthOfCol(c); if (k) keys.add(k); }
      keys.forEach(k => { line.months[k] = { highlight: v }; });
    }
    continue;
  }

  if (sec) {
    section = sec;
    groupName = titleCase(c0);
    groupNote = [c1, c2].filter(Boolean).join('\n');
    if (sec === 'su_kien' || sec === 'lop_hoc') {
      // Hàng tiêu đề nhóm — tuyến con là từng tổ/phòng ở cột B.
      current = null;
      if (c1 && c1.length <= 40) { newLine(c1, null); addCells(current, r); }
      continue;
    }
    newLine(groupName, groupNote || null);
    addCells(current, r);
    continue;
  }

  if (!section) continue;
  if (section === 'su_kien' || section === 'lop_hoc') {
    // Hàng có tên series ở cột A (vd "Series FSchool in Class") → ghi chú cho các tổ bên dưới.
    if (c0) groupNote = c0;
    if (c1 && c1.length <= 40) newLine(c1, section === 'lop_hoc' ? groupNote || null : null);
    if (current) addCells(current, r);
    continue;
  }
  if (c0) {
    // Hàng con của 1 chiến dịch/nhóm (vd "Slogan: ...", "Sự kiện/Hội thảo").
    const name = ['campaign'].includes(section) && groupName ? `${groupName} · ${c0}` : c0;
    newLine(name, [c1, c2].filter(Boolean).join('\n') || null);
    addCells(current, r);
    continue;
  }
  if (current) {
    if (c1) current.note = current.note ? `${current.note}\n${c1}` : c1;
    addCells(current, r);
  }
}

const kept = lines.filter(l => Object.keys(l.months).length || l.note);
const LABEL = { muc_tieu: 'Mục tiêu', su_kien: 'Theo sự kiện', lop_hoc: 'Lớp học', chu_de: 'Chủ đề năm', campaign: 'Campaign', tuyen_sinh: 'Tuyển sinh', kenh_ngoai: 'Kênh ngoài' };
for (const l of kept) {
  const months = Object.keys(l.months).sort();
  const target = months.reduce((s, k) => s + (l.months[k].target || 0), 0);
  console.log(`[${LABEL[l.section]}] ${l.name.slice(0, 60)} — ${months.length} tháng (${months[0] || '-'} → ${months[months.length - 1] || '-'}), ${target} bài${l.note ? ' · có ghi chú' : ''}`);
}
console.log(`\nTổng: ${kept.length} tuyến`);
// Đối chiếu với hàng "TỔNG" của sheet.
const byMonth = {};
kept.forEach(l => Object.entries(l.months).forEach(([k, c]) => { byMonth[k] = (byMonth[k] || 0) + (c.target || 0); }));
console.log('Số bài theo tháng:', Object.keys(byMonth).sort().map(k => `${k.slice(5)}/${k.slice(0, 4)}: ${byMonth[k]}`).join(', '));

if (!APPLY) { console.log('(chạy thử — thêm --apply để ghi vào Supabase)'); process.exit(0); }

const env = Object.fromEntries(fs.readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { count } = await supabase.from('annual_plan_lines').select('id', { count: 'exact', head: true }).eq('campus', CAMPUS).eq('school_year', SCHOOL_YEAR);
if (count) { console.log(`Đã có ${count} tuyến cho ${CAMPUS} ${SCHOOL_YEAR} — dừng, không nhập đè.`); process.exit(0); }
const now = new Date().toISOString();
const payload = kept.map((l, i) => ({
  id: `APL_IMP_${CAMPUS}_${SCHOOL_YEAR}_${String(i + 1).padStart(2, '0')}`, campus: CAMPUS, school_year: SCHOOL_YEAR,
  section: l.section, name: l.name, note: l.note, months: l.months, sort_order: i + 1, source: 'import', created_at: now, updated_at: now
}));
const { error } = await supabase.from('annual_plan_lines').insert(payload);
if (error) { console.error('Lỗi ghi:', error.message); process.exit(1); }
console.log(`Đã nhập ${payload.length} tuyến cho ${CAMPUS} năm học ${SCHOOL_YEAR}.`);
