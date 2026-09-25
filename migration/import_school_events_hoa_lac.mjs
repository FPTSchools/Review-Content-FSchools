// Nhập sheet "Hoạt động sự kiện của trường" (file Kế hoạch truyền thông THPT FPT Hà Nội — cơ sở
// Hòa Lạc) vào bảng school_events cho năm học 2026-2027, trạng thái "chờ xác nhận".
// Ngày trong file là của năm học trước — chỉ dùng làm NGÀY GỢI Ý (đổi sang năm học mới theo
// ngày/tháng), Leader Content xác nhận lại từng sự kiện trên trang Kế hoạch & Lịch.
//
// Chạy:  node migration/import_school_events_hoa_lac.mjs "<đường dẫn file .xlsx>" [--apply]
// Không có --apply thì chỉ in kết quả đọc, không ghi gì. Chạy lại lần 2 sẽ tự dừng nếu đã nhập.
import xlsx from 'xlsx';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const CAMPUS = 'hoa_lac';
const SCHOOL_YEAR = '2026-2027';
const SHEET = 'Hoạt động sự kiện của trường';

if (!FILE) { console.error('Thiếu đường dẫn file .xlsx'); process.exit(1); }

function yearForMonth(m) { return m >= 8 ? 2026 : 2027; }

function toIso(day, month) {
  const y = yearForMonth(month);
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

// Đọc ngày gợi ý từ chữ tự do: "23-24/10", "10,11/01", "19&26/12", "9/12 - 23/12", "Tối 26/3",
// "15/01 (7:50 - 8:30)", "22/02/2025 - 23/2"...
function parseDates(text) {
  const s = String(text || '');
  // "23-24/10": số đầu không được đứng sau chữ số hoặc "/" — tránh bắt nhầm "9/12 - 23/12" thành
  // "12 - 23/12", hay "2025 - 23/2" thành "25 - 23/2".
  const range = s.match(/(?<![\d\/])(\d{1,2})\s*[-,&]\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (range) {
    const m = Number(range[3]);
    const start = toIso(Number(range[1]), m), end = toIso(Number(range[2]), m);
    return { start, end: end && start && end > start ? end : null };
  }
  const all = [...s.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*\d{2,4})?/g)]
    .map(x => toIso(Number(x[1]), Number(x[2]))).filter(Boolean);
  if (!all.length) return { start: null, end: null };
  return { start: all[0], end: all.length > 1 && all[1] > all[0] ? all[1] : null };
}

const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[SHEET];
if (!ws) { console.error('Không thấy sheet', SHEET); process.exit(1); }
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false });

const events = [];
let month = null, department = null;
for (const r of rows.slice(1)) {
  const [, monthCell, timeCell, deptCell, titleCell] = r.map(c => String(c || '').replace(/\s+/g, ' ').trim());
  const mm = monthCell.match(/Tháng\s*0?(\d{1,2})/i);
  if (mm) { month = Number(mm[1]); department = null; }
  if (deptCell) department = deptCell;
  if (!titleCell || !month) continue;

  // Một số tên sự kiện bị tách làm 2 dòng trong file (dấu ngoặc kép mở ở dòng trên, đóng ở dòng dưới).
  const prev = events[events.length - 1];
  if (prev && prev.title.includes('“') && !prev.title.includes('”') && titleCell.includes('”')) {
    prev.title = prev.title + ' ' + titleCell;
    continue;
  }

  let { start, end } = parseDates(timeCell);
  // Ngày lễ cố định ghi thẳng trong tên ("20/10: Pink Day", "Sự kiện 20/10") khi cột thời gian trống.
  const titleDate = !timeCell && titleCell.match(/^(?:Sự kiện\s+)?(\d{1,2})\/(\d{1,2})(?:\s*:|$)/);
  if (titleDate) start = toIso(Number(titleDate[1]), Number(titleDate[2]));
  const notes = [];
  if (timeCell) notes.push('Năm trước: ' + timeCell);
  if (/20(1\d|2[0-5])/.test(titleCell)) notes.push('Tên sự kiện còn ghi năm cũ — cần sửa');
  events.push({
    campus: CAMPUS, school_year: SCHOOL_YEAR, month, title: titleCell,
    department: department || null, start_date: start, end_date: end,
    time_note: notes.join(' · ') || null
  });
}

console.log(`Đọc được ${events.length} sự kiện:`);
events.forEach((e, i) => console.log(
  String(i + 1).padStart(3), `T${String(e.month).padStart(2)}`, (e.start_date || '    —     '), (e.end_date ? '→ ' + e.end_date : '             '),
  '|', (e.department || '').slice(0, 18).padEnd(18), '|', e.title.slice(0, 70), e.time_note ? '  [' + e.time_note.slice(0, 50) + ']' : ''
));

if (!APPLY) { console.log('\n(Chạy thử — chưa ghi gì. Thêm --apply để nhập thật.)'); process.exit(0); }

const dev = fs.readFileSync('.dev.vars', 'utf8');
const env = {};
dev.split('\n').forEach(line => { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; });
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { count } = await supabase.from('school_events').select('id', { count: 'exact', head: true })
  .eq('campus', CAMPUS).eq('school_year', SCHOOL_YEAR).eq('source', 'import');
if (count) { console.log(`\nĐã có ${count} sự kiện nhập từ file cho ${CAMPUS} ${SCHOOL_YEAR} — dừng, không nhập trùng.`); process.exit(0); }

const stamp = Date.now();
const payload = events.map((e, i) => ({
  id: `EVT_${stamp}_${String(i).padStart(3, '0')}`, ...e,
  status: 'cho_xac_nhan', lead_days: 14, source: 'import'
}));
const { error } = await supabase.from('school_events').insert(payload);
if (error) { console.error('Lỗi nhập:', error.message); process.exit(1); }
console.log(`\nĐã nhập ${payload.length} sự kiện (trạng thái chờ xác nhận).`);
