import { handleGetReport } from './submissions.js';
import { computeQuotaProgress, monthRange } from './quotas.js';
import { enqueueEmail, emailHtml, openButtonHtml } from '../email.js';

// ============================================================
// BÁO CÁO THÁNG TỰ GỬI — ngày 1–3 hằng tháng (8h–17h giờ VN), gửi email tổng hợp THÁNG TRƯỚC cho Trưởng phòng, Trưởng ban, Admin:
// mỗi cơ sở: số bài gửi/đã duyệt/cần sửa/từ chối, tỷ lệ duyệt, tiến độ định mức theo kênh, top 3 xếp hạng (cùng công thức trang Báo cáo).
// Chạy kèm tiến trình gửi email (Worker lập lịch gọi process_email_queue mỗi 2 phút). Khoá chống trùng `monthly_report:<user>:<yyyy-mm>`
// → mỗi người đúng 1 email/tháng; nếu mọi người đã có email của tháng đó thì thoát ngay, không tính lại báo cáo mỗi 2 phút.
// ============================================================

const RECIPIENT_ROLES = ['leader', 'manager', 'admin'];
const CAMPUS_NAME = { hoa_lac: 'Hòa Lạc', tay_hn: 'Tây Hà Nội' };
const CH_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'Youtube', web: 'Website', email: 'Email', zalo: 'Zalo', sms: 'SMS' };
const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// Báo cáo 1 cơ sở trong 1 tháng (dùng đúng hàm của trang Báo cáo, quyền 'admin' = thấy đủ điểm).
async function campusReport(supabase, campus, range) {
  const rep = await handleGetReport(supabase, { from: range.from, to: range.to, campus, role: 'admin', user_id: 'system' });
  if (!rep.ok) throw new Error(rep.error);
  const prog = await computeQuotaProgress(supabase, [campus], range.to);
  const o = rep.overview;
  return {
    campus, overview: o, rate: o.total ? Math.round(o.approved / o.total * 100) : 0,
    quotas: prog.rows.filter(r => r.period === 'month').sort((a, b) => a.channel.localeCompare(b.channel)),
    top: rep.ctv_list.filter(c => c.finalScore !== undefined).slice(0, 3)
  };
}

function sectionText(c) {
  const o = c.overview;
  const lines = [`== CƠ SỞ ${CAMPUS_NAME[c.campus].toUpperCase()} ==`];
  if (!o.total) { lines.push('Không có bài nào gửi trong tháng.'); return lines.join('\n'); }
  lines.push(`Bài gửi: ${o.total} · Đã duyệt: ${o.approved} (${c.rate}%) · Cần sửa: ${o.revision} · Từ chối: ${o.rejected} · Đang chờ: ${o.pending}`);
  if (c.quotas.length) {
    lines.push('Định mức tháng theo kênh:');
    c.quotas.forEach(q => lines.push(`  - ${CH_LABEL[q.channel] || q.channel}: ${q.done}/${q.target}${q.done >= q.target ? ' (đạt)' : ` (thiếu ${q.target - q.done})`}`));
  }
  if (c.top.length) {
    lines.push('Top xếp hạng:');
    c.top.forEach((t, i) => lines.push(`  ${i + 1}. ${t.name} — ${t.total} bài, duyệt ${t.approved}, điểm tổng hợp ${t.finalScore}`));
  }
  return lines.join('\n');
}

function sectionHtml(c) {
  const o = c.overview, th = 'style="text-align:left;padding:4px 10px;background:#f3f4f6"', td = 'style="padding:4px 10px;border-bottom:1px solid #eee"';
  let h = `<h3 style="margin:18px 0 6px;color:#003DA5">Cơ sở ${emailHtml(CAMPUS_NAME[c.campus])}</h3>`;
  if (!o.total) return h + '<p>Không có bài nào gửi trong tháng.</p>';
  h += `<p style="margin:4px 0">Bài gửi: <b>${o.total}</b> · Đã duyệt: <b>${o.approved}</b> (${c.rate}%) · Cần sửa: <b>${o.revision}</b> · Từ chối: <b>${o.rejected}</b> · Đang chờ: <b>${o.pending}</b></p>`;
  if (c.quotas.length) {
    h += `<p style="margin:10px 0 4px"><b>Định mức tháng theo kênh</b></p><table style="border-collapse:collapse;font-size:14px"><tr><th ${th}>Kênh</th><th ${th}>Đã duyệt / Định mức</th><th ${th}>Kết quả</th></tr>` +
      c.quotas.map(q => `<tr><td ${td}>${emailHtml(CH_LABEL[q.channel] || q.channel)}</td><td ${td}>${q.done} / ${q.target}</td><td ${td}>${q.done >= q.target ? '<span style="color:#00843D"><b>Đạt</b></span>' : `<span style="color:#C0392B">Thiếu ${q.target - q.done}</span>`}</td></tr>`).join('') + '</table>';
  }
  if (c.top.length) {
    h += `<p style="margin:10px 0 4px"><b>Top xếp hạng</b></p><table style="border-collapse:collapse;font-size:14px"><tr><th ${th}>#</th><th ${th}>Người viết</th><th ${th}>Bài gửi</th><th ${th}>Đã duyệt</th><th ${th}>Điểm tổng hợp</th></tr>` +
      c.top.map((t, i) => `<tr><td ${td}>${i + 1}</td><td ${td}>${emailHtml(t.name)}</td><td ${td}>${t.total}</td><td ${td}>${t.approved}</td><td ${td}>${t.finalScore}</td></tr>`).join('') + '</table>';
  }
  return h;
}

export async function enqueueMonthlyReports(supabase, env, opts = {}) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  if (!opts.force && (vn.getUTCDate() > 3 || vn.getUTCHours() < 8 || vn.getUTCHours() > 17 || vn.getUTCMinutes() >= 4)) return { skipped: true };
  const today = vnToday();
  const last = addDaysIso(today.slice(0, 8) + '01', -1);          // ngày cuối tháng trước
  const range = monthRange(last), monthKey = last.slice(0, 7);

  let { data: users } = await supabase.from('users').select('id, name, email, role, active').in('role', RECIPIENT_ROLES);
  users = (users || []).filter(u => u.active !== false && u.email && (!opts.onlyUsers || opts.onlyUsers.includes(u.id)));
  if (!users.length) return { queued: 0 };
  // Mọi người đã có email tháng này → thoát ngay (cron chạy mỗi 2 phút, không tính lại báo cáo).
  const keys = users.map(u => `monthly_report:${u.id}:${monthKey}`);
  const { data: have } = await supabase.from('email_queue').select('event_key').in('event_key', keys).neq('status', 'failed');
  const haveSet = new Set((have || []).map(r => r.event_key));
  const todo = users.filter(u => !haveSet.has(`monthly_report:${u.id}:${monthKey}`));
  if (!todo.length) return { queued: 0 };

  const reports = {};
  for (const c of ['hoa_lac', 'tay_hn']) reports[c] = await campusReport(supabase, c, range);
  const label = `${monthKey.slice(5)}/${monthKey.slice(0, 4)}`;
  const link = String(env.APP_URL || '').replace(/\/$/, '') + '/boss.html';
  let queued = 0;
  for (const u of todo) {
    const subject = `[Báo cáo tháng ${label}] FPT Schools Content`;
    const text = `Chào ${u.name},\n\nBáo cáo content tháng ${label}:\n\n${['hoa_lac', 'tay_hn'].map(c => sectionText(reports[c])).join('\n\n')}\n\nXem chi tiết ở trang Báo cáo: ${link}\n\nFSchools Content Review`;
    const html = `<p>Chào ${emailHtml(u.name)},</p><p>Báo cáo content <b>tháng ${label}</b>:</p>${['hoa_lac', 'tay_hn'].map(c => sectionHtml(reports[c])).join('')}` +
      `<p style="margin-top:16px">Xem chi tiết (lọc theo kỳ, kênh, từng người) ở trang <b>Báo cáo</b>.</p>${openButtonHtml(link, 'Mở trang Báo cáo')}<p>FSchools Content Review</p>`;
    const r = await enqueueEmail(supabase, u.email, u.name, subject, text, html, `monthly_report:${u.id}:${monthKey}`);
    if (r && r.queued) queued++;
  }
  return { queued, month: monthKey };
}
