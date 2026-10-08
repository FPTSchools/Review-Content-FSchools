import { newId } from '../ids.js';

// ============================================================
// ĐỊNH MỨC BÀI THEO KÊNH (bảng channel_quotas) + tiến độ so với định mức.
// Tiến độ = số bài ĐÃ DUYỆT cho kênh trong kỳ (tuần: Thứ Hai→Chủ nhật; tháng: dương lịch), tính theo giờ Việt Nam; bài chung 2 cơ sở
// (campus 'chung') được tính cho cả 2 cơ sở. Kèm số bài đã đăng thật (publish_slots) để tham khảo. Xem: mọi người; sửa: người lập kế hoạch
// (Leader Content/Trưởng phòng/Trưởng ban/Admin) đúng cơ sở, tra lại vai trò từ bảng users.
// ============================================================

const PLAN_EDITOR_ROLES = ['leader_content', 'leader', 'manager', 'admin'];
const QUOTA_CAMPUSES = ['hoa_lac', 'tay_hn'];
const CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'web', 'email', 'zalo', 'sms'];

const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const vnDateOf = ts => (ts ? new Date(Date.parse(ts) + 7 * 3600 * 1000).toISOString().slice(0, 10) : '');
const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function weekRange(day) {
  const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;   // Thứ Hai = 0
  const from = addDaysIso(day, -dow);
  return { from, to: addDaysIso(from, 6) };
}
export function monthRange(day) {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  return { from: `${day.slice(0, 7)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

async function getActor(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('id, name, role, campus, active').eq('id', userId).maybeSingle();
  return data && data.active !== false ? data : null;
}
function visibleQuotaCampuses(actor) {
  if (['manager', 'admin', 'leader'].includes(actor.role) || actor.campus === 'chung') return QUOTA_CAMPUSES;
  return QUOTA_CAMPUSES.filter(c => c === actor.campus);
}
function canEditCampus(actor, campus) {
  if (!PLAN_EDITOR_ROLES.includes(actor.role)) return false;
  if (['manager', 'admin'].includes(actor.role) || actor.campus === 'chung') return true;
  return campus === actor.campus;
}

// Trạng thái so với tiến độ kỳ: đạt / đúng tiến độ / chậm / thiếu nhiều. Đầu kỳ (chưa qua 30%) chưa đánh giá để khỏi báo đỏ oan.
export function quotaStatus(done, target, frac) {
  if (done >= target) return 'dat';
  if (frac < 0.3) return 'dung';
  const expected = target * frac;
  if (done >= expected) return 'dung';
  return done >= 0.6 * expected ? 'cham' : 'thieu';
}

// Tính tiến độ mọi định mức của các cơ sở, tại ngày asOf (mặc định hôm nay).
export async function computeQuotaProgress(supabase, campuses, asOf) {
  const today = asOf || vnToday();
  const week = weekRange(today), month = monthRange(today);
  const { data: quotas, error } = await supabase.from('channel_quotas').select('*').in('campus', campuses);
  if (error) throw new Error(error.message);
  if (!(quotas || []).length) return { today, week, month, rows: [] };

  const from = week.from < month.from ? week.from : month.from;
  const [subRes, slotRes] = await Promise.all([
    supabase.from('submissions').select('id, campus, platform, reviewed_at, submitted_at').eq('status', 'approved')
      .gte('reviewed_at', from + 'T00:00:00+07:00').lte('reviewed_at', addDaysIso(month.to, 1) + 'T00:00:00+07:00').limit(2000),
    supabase.from('publish_slots').select('submission_id, channel, campus, posted_at').eq('status', 'da_dang')
      .gte('posted_at', from + 'T00:00:00+07:00').lte('posted_at', addDaysIso(month.to, 1) + 'T00:00:00+07:00').limit(2000)
  ]);
  if (subRes.error) throw new Error(subRes.error.message);
  const subs = subRes.data || [], slots = slotRes.data || [];
  const inCampus = (rowCampus, c) => rowCampus === c || rowCampus === 'chung';

  const rows = quotas.map(q => {
    const r = q.period === 'week' ? week : month;
    const within = d => d >= r.from && d <= r.to && d <= today;
    const done = subs.filter(s => inCampus(s.campus, q.campus) && (s.platform || []).includes(q.channel) && within(vnDateOf(s.reviewed_at))).length;
    const posted = slots.filter(s => inCampus(s.campus, q.campus) && s.channel === q.channel && within(vnDateOf(s.posted_at))).length;
    const total = diffDays(r.from, r.to) + 1, elapsed = diffDays(r.from, today < r.to ? today : r.to) + 1;
    const frac = Math.max(0, Math.min(1, elapsed / total));
    return {
      campus: q.campus, channel: q.channel, period: q.period, target: q.target, done, posted,
      expected: Math.round(q.target * frac * 10) / 10, status: quotaStatus(done, q.target, frac)
    };
  });
  return { today, week, month, rows };
}

export async function handleGetQuotas(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const campuses = visibleQuotaCampuses(actor);
  try {
    const prog = await computeQuotaProgress(supabase, campuses);
    return { ok: true, ...prog, campuses, editable: campuses.filter(c => canEditCampus(actor, c)) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function handleSaveQuota(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !PLAN_EDITOR_ROLES.includes(actor.role)) return { ok: false, error: 'Bạn không có quyền sửa định mức' };
  if (!QUOTA_CAMPUSES.includes(p.campus) || !canEditCampus(actor, p.campus)) return { ok: false, error: 'Không được sửa định mức của cơ sở này' };
  if (!CHANNELS.includes(p.channel)) return { ok: false, error: 'Kênh không hợp lệ' };
  if (!['week', 'month'].includes(p.period)) return { ok: false, error: 'Kỳ không hợp lệ' };
  const target = Math.floor(Number(p.target));
  if (!Number.isFinite(target) || target < 0 || target > 999) return { ok: false, error: 'Định mức phải là số từ 0 đến 999 (0 = bỏ định mức)' };
  if (target === 0) {
    const { error } = await supabase.from('channel_quotas').delete().eq('campus', p.campus).eq('channel', p.channel).eq('period', p.period);
    return error ? { ok: false, error: error.message } : { ok: true, removed: true };
  }
  const { error } = await supabase.from('channel_quotas').upsert({
    id: newId('QUO') + '_' + Math.random().toString(36).slice(2, 6), campus: p.campus, channel: p.channel, period: p.period,
    target, updated_by: actor.id, updated_at: new Date().toISOString()
  }, { onConflict: 'campus,channel,period', ignoreDuplicates: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Cho trang "Việc cần làm": các định mức đang chậm / thiếu nhiều (kỳ đang chạy) của các cơ sở người này xem được.
export async function getQuotaTodo(supabase, actor, today) {
  const prog = await computeQuotaProgress(supabase, visibleQuotaCampuses(actor), today);
  return { behind: prog.rows.filter(r => r.status === 'cham' || r.status === 'thieu'), total: prog.rows.length, week: prog.week, month: prog.month };
}
