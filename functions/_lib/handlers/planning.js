import { newId } from '../ids.js';

// ============================================================
// KẾ HOẠCH & LỊCH — trụ content, lịch sự kiện năm học, đầu việc kế hoạch content tháng.
// Xem migration 20260925041244_planning_calendar.sql.
//
// Phân quyền: vai trò của người thao tác luôn tra lại từ bảng users theo user_id — KHÔNG tin
// trường "role" do trình duyệt gửi lên (các handler cũ khác vẫn tin, chưa sửa ở đây).
// ============================================================

const PLAN_EDITOR_ROLES = ['leader_content', 'leader', 'manager', 'admin'];
const PILLAR_ADMIN_ROLES = ['manager', 'admin'];
const CAMPUSES = ['hoa_lac', 'tay_hn', 'chung'];
const CHANNELS = ['facebook', 'tiktok', 'youtube', 'web', 'email', 'sms', 'zalo', 'instagram'];

async function getActor(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('id, name, role, campus, active').eq('id', userId).maybeSingle();
  return data && data.active !== false ? data : null;
}

// Người có campus 'chung' hoặc manager/admin được làm với mọi cơ sở; còn lại chỉ cơ sở của mình.
function canTouchCampus(actor, campus) {
  if (!actor) return false;
  if (['manager', 'admin'].includes(actor.role) || actor.campus === 'chung') return true;
  return campus === actor.campus || campus === 'chung';
}

function visibleCampuses(actor) {
  if (['manager', 'admin', 'leader'].includes(actor.role) || actor.campus === 'chung') return CAMPUSES;
  return [actor.campus, 'chung'];
}

function cleanDate(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cleanText(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

// ---------------- Trụ content ----------------

export async function handleGetContentPillars(supabase, p) {
  let q = supabase.from('content_pillars').select('id, name, sort_order, active').order('sort_order');
  if (!p.include_inactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, pillars: data || [] };
}

export async function handleSaveContentPillar(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !PILLAR_ADMIN_ROLES.includes(actor.role)) return { ok: false, error: 'Chỉ admin/manager được sửa trụ content' };
  const name = cleanText(p.name);
  if (!name) return { ok: false, error: 'Thiếu tên trụ content' };

  if (p.id) {
    const patch = { name };
    if (p.sort_order !== undefined) patch.sort_order = Number(p.sort_order) || 0;
    if (p.active !== undefined) patch.active = !!p.active;
    const { data, error } = await supabase.from('content_pillars').update(patch).eq('id', p.id).select('id');
    if (error) return { ok: false, error: error.message };
    if (!data || !data.length) return { ok: false, error: 'Không tìm thấy trụ content' };
    return { ok: true, id: p.id };
  }

  const { data: last } = await supabase.from('content_pillars').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  const id = newId('PIL');
  const { error } = await supabase.from('content_pillars').insert({
    id, name, sort_order: ((last && last[0] && Number(last[0].sort_order)) || 0) + 1, active: true
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// ---------------- Lịch sự kiện ----------------

export async function handleGetSchoolEvents(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const allowed = visibleCampuses(actor);
  const campuses = p.campus && allowed.includes(p.campus) ? [p.campus, 'chung'] : allowed;

  let q = supabase.from('school_events')
    .select('id, campus, school_year, month, title, department, start_date, end_date, time_note, status, lead_days, source, confirmed_by, confirmed_at')
    .in('campus', campuses)
    .order('start_date', { ascending: true, nullsFirst: false });
  if (p.school_year) q = q.eq('school_year', p.school_year);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, events: data || [] };
}

export async function handleSaveSchoolEvent(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !PLAN_EDITOR_ROLES.includes(actor.role)) return { ok: false, error: 'Bạn không có quyền sửa lịch sự kiện' };
  const e = p.event || {};
  const title = cleanText(e.title);
  const month = Number(e.month);
  const schoolYear = cleanText(e.school_year);
  if (!title || !schoolYear || !(month >= 1 && month <= 12)) return { ok: false, error: 'Thiếu tên sự kiện, năm học hoặc tháng' };
  if (!CAMPUSES.includes(e.campus) || !canTouchCampus(actor, e.campus)) return { ok: false, error: 'Không được sửa lịch của cơ sở này' };

  const row = {
    campus: e.campus, school_year: schoolYear, month, title,
    department: cleanText(e.department),
    start_date: cleanDate(e.start_date), end_date: cleanDate(e.end_date),
    time_note: cleanText(e.time_note),
    lead_days: Math.max(0, Math.min(90, Number(e.lead_days) || 14)),
    updated_at: new Date().toISOString()
  };
  if (['cho_xac_nhan', 'da_xac_nhan', 'huy'].includes(e.status)) row.status = e.status;

  if (e.id) {
    const { data: old } = await supabase.from('school_events').select('campus').eq('id', e.id).maybeSingle();
    if (!old) return { ok: false, error: 'Không tìm thấy sự kiện' };
    if (!canTouchCampus(actor, old.campus)) return { ok: false, error: 'Không được sửa lịch của cơ sở này' };
    // Đổi ngày của 1 sự kiện đã xác nhận thì coi như vừa xác nhận lại bởi người sửa.
    if (row.status === 'da_xac_nhan') { row.confirmed_by = actor.id; row.confirmed_at = row.updated_at; }
    const { error } = await supabase.from('school_events').update(row).eq('id', e.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: e.id };
  }

  const id = newId('EVT');
  if (!row.status) row.status = row.start_date ? 'da_xac_nhan' : 'cho_xac_nhan';
  if (row.status === 'da_xac_nhan') { row.confirmed_by = actor.id; row.confirmed_at = row.updated_at; }
  const { error } = await supabase.from('school_events').insert({ id, ...row, source: 'manual', created_by: actor.id });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// ---------------- Kế hoạch content tháng ----------------

// Trạng thái đầu việc suy ra từ bài gửi duyệt đã nối (không lưu riêng, tránh lệch với luồng duyệt).
function derivePlanStatus(item, sub) {
  if (item.post_link) return 'da_dang';
  if (!sub) return 'chua_lam';
  if (sub.status === 'approved') return 'da_duyet';
  if (sub.status === 'revision') return 'can_sua';
  if (sub.status === 'rejected') return 'tu_choi';
  if (sub.status === 'cancelled') return 'chua_lam';
  return 'dang_duyet';
}

async function enrichPlanItems(supabase, items) {
  const subIds = [...new Set(items.map(i => i.submission_id).filter(Boolean))];
  let subs = {};
  if (subIds.length) {
    const { data } = await supabase.from('submissions').select('id, status, title, send_count').in('id', subIds);
    (data || []).forEach(s => { subs[s.id] = s; });
  }
  return items.map(i => {
    const sub = i.submission_id ? subs[i.submission_id] || null : null;
    return { ...i, submission: sub, plan_status: derivePlanStatus(i, sub) };
  });
}

export async function handleGetPlanItems(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const allowed = visibleCampuses(actor);
  const campuses = p.campus && allowed.includes(p.campus) ? [p.campus, 'chung'] : allowed;

  let q = supabase.from('plan_items').select('*').in('campus', campuses).order('deadline', { ascending: true, nullsFirst: false });
  if (p.id) q = q.eq('id', p.id);
  else if (/^\d{4}-\d{2}$/.test(String(p.month || ''))) q = q.eq('plan_month', `${p.month}-01`);
  if (p.assignee_id) q = q.eq('assignee_id', p.assignee_id);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, items: await enrichPlanItems(supabase, data || []) };
}

export async function handleSavePlanItem(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !PLAN_EDITOR_ROLES.includes(actor.role)) return { ok: false, error: 'Bạn không có quyền sửa kế hoạch' };
  const it = p.item || {};
  const title = cleanText(it.title);
  if (!title) return { ok: false, error: 'Thiếu tiêu đề đầu việc' };
  if (!/^\d{4}-\d{2}$/.test(String(it.month || ''))) return { ok: false, error: 'Thiếu tháng kế hoạch' };
  if (!CAMPUSES.includes(it.campus) || !canTouchCampus(actor, it.campus)) return { ok: false, error: 'Không được sửa kế hoạch của cơ sở này' };

  const row = {
    campus: it.campus, plan_month: `${it.month}-01`, title,
    pillar_id: cleanText(it.pillar_id), event_id: cleanText(it.event_id),
    highlight: cleanText(it.highlight), reference: cleanText(it.reference),
    channels: Array.isArray(it.channels) ? it.channels.filter(c => CHANNELS.includes(c)) : [],
    format: cleanText(it.format), assignee_id: cleanText(it.assignee_id),
    deadline: cleanDate(it.deadline), publish_date: cleanDate(it.publish_date),
    post_link: cleanText(it.post_link),
    updated_at: new Date().toISOString()
  };

  if (it.id) {
    const { data: old } = await supabase.from('plan_items').select('campus').eq('id', it.id).maybeSingle();
    if (!old) return { ok: false, error: 'Không tìm thấy đầu việc' };
    if (!canTouchCampus(actor, old.campus)) return { ok: false, error: 'Không được sửa kế hoạch của cơ sở này' };
    const { error } = await supabase.from('plan_items').update(row).eq('id', it.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: it.id };
  }

  const id = newId('PLN') + '_' + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from('plan_items').insert({ id, ...row, created_by: actor.id });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

export async function handleDeletePlanItem(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !PLAN_EDITOR_ROLES.includes(actor.role)) return { ok: false, error: 'Bạn không có quyền xoá đầu việc' };
  const { data: old } = await supabase.from('plan_items').select('campus, submission_id').eq('id', p.id).maybeSingle();
  if (!old) return { ok: false, error: 'Không tìm thấy đầu việc' };
  if (!canTouchCampus(actor, old.campus)) return { ok: false, error: 'Không được xoá kế hoạch của cơ sở này' };
  if (old.submission_id) return { ok: false, error: 'Đầu việc đã có bài gửi duyệt — không xoá được' };
  const { error } = await supabase.from('plan_items').delete().eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Cho báo cáo cuối kỳ: đầu việc kế hoạch của các tháng nằm trong kỳ [from, to], kèm trạng thái
// suy ra (chưa làm / đang duyệt / đã duyệt / đã đăng...) — để đối chiếu "được giao" với "đã làm".
export async function getPlanItemsForReport(supabase, from, to) {
  let q = supabase.from('plan_items').select('id, campus, plan_month, title, pillar_id, channels, assignee_id, submission_id, post_link');
  if (from) q = q.gte('plan_month', String(from).slice(0, 7) + '-01');
  if (to) q = q.lte('plan_month', String(to).slice(0, 7) + '-01');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (await enrichPlanItems(supabase, data || [])).map(i => ({
    id: i.id, campus: i.campus, plan_month: i.plan_month, pillar_id: i.pillar_id, channels: i.channels || [],
    assignee_id: i.assignee_id, submission_id: i.submission_id, plan_status: i.plan_status
  }));
}

// Gọi từ handleSubmit: nối bài vừa gửi duyệt vào đầu việc (chỉ khi đầu việc chưa nối bài nào).
export async function linkPlanItemToSubmission(supabase, planItemId, submissionId) {
  if (!planItemId || !submissionId) return;
  await supabase.from('plan_items')
    .update({ submission_id: submissionId, updated_at: new Date().toISOString() })
    .eq('id', planItemId)
    .is('submission_id', null);
}
