import { newId } from '../ids.js';
import { enqueueEmail, emailHtml, openButtonHtml } from '../email.js';

// ============================================================
// LỊCH ĐĂNG — bước "Duyệt → Lịch đăng → Đăng" của luồng kế hoạch. Mỗi bài ĐÃ DUYỆT × mỗi kênh đăng = 1 suất đăng
// (bảng publish_slots, xem migration 20261009010000_publish_slots.sql). Suất đăng chỉ có dòng trong DB khi có người
// đặt lịch hoặc bấm "Đã đăng"; bài đã duyệt chưa có dòng nào vẫn hiện trong hàng chờ (suy ra từ submissions.platform),
// nên không phải đồng bộ lúc duyệt bài. Ngày đăng của đầu việc kế hoạch (plan_items.publish_date) được dùng làm ngày gợi ý.
//
// Quyền: người viết bài (chủ bài) và người lập kế hoạch (leader_content/leader/manager/admin, đúng cơ sở) được đặt lịch /
// đánh dấu đã đăng. Vai trò luôn tra lại từ bảng users theo user_id (không tin trường role của trình duyệt).
// ============================================================

const PLAN_EDITOR_ROLES = ['leader_content', 'leader', 'manager', 'admin'];
const CAMPUSES = ['hoa_lac', 'tay_hn', 'chung'];
const CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'web', 'email', 'zalo', 'sms'];
// Bài duyệt TRƯỚC ngày này không đưa vào hàng chờ đăng (đã đăng từ lâu, chưa từng dùng Lịch đăng) — tránh hàng chục việc "trễ" giả.
// Bài cũ vẫn tự vào danh sách nếu từng được đặt lịch/đánh dấu.
const PUBLISH_START = '2026-10-08';
const DONE_KEEP_DAYS = 21;
const CHANNEL_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'Youtube', web: 'Website', email: 'Email', zalo: 'Zalo', sms: 'SMS' };

const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const vnDateOf = ts => (ts ? new Date(Date.parse(ts) + 7 * 3600 * 1000).toISOString().slice(0, 10) : '');

async function getActor(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('id, name, role, campus, active').eq('id', userId).maybeSingle();
  return data && data.active !== false ? data : null;
}
function visibleCampuses(actor) {
  if (['manager', 'admin', 'leader'].includes(actor.role) || actor.campus === 'chung') return CAMPUSES;
  return [actor.campus, 'chung'];
}
function canTouchCampus(actor, campus) {
  if (['manager', 'admin'].includes(actor.role) || actor.campus === 'chung') return true;
  return campus === actor.campus || campus === 'chung';
}
// Chủ bài luôn được; người lập kế hoạch được với bài thuộc cơ sở mình phụ trách.
function canManageSub(actor, sub) {
  if (String(sub.user_id) === String(actor.id)) return true;
  return PLAN_EDITOR_ROLES.includes(actor.role) && canTouchCampus(actor, sub.campus || 'chung');
}
const cleanDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
const cleanTime = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim()) ? String(v).trim() : null);
const cleanLink = v => { const s = String(v || '').trim(); return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 500) : ''; };
const channelsOf = sub => [...new Set((sub.platform || []).filter(c => CHANNELS.includes(c)))];

// Gộp bài đã duyệt + suất đăng thật + ngày đăng của đầu việc kế hoạch thành danh sách suất đăng (kể cả suất "ảo" chưa có dòng DB).
// canEdit(sub) quyết định cờ can_edit của từng dòng.
async function buildPublishRows(supabase, list, canEdit, doneDays) {
  if (!list.length) return [];
  const ids = list.map(s => s.id);
  const [slotRes, planRes] = await Promise.all([
    supabase.from('publish_slots').select('*').in('submission_id', ids),
    supabase.from('plan_items').select('id, submission_id, publish_date, post_link').in('submission_id', ids)
  ]);
  if (slotRes.error) throw new Error(slotRes.error.message);
  const slotOf = {};
  (slotRes.data || []).forEach(s => { slotOf[s.submission_id + ':' + s.channel] = s; });
  const planOf = {};
  (planRes.data || []).forEach(p => { planOf[p.submission_id] = p; });

  const keepDoneFrom = addDaysIso(vnToday(), -doneDays);
  const rows = [];
  for (const s of list) {
    const approvedOn = vnDateOf(s.reviewed_at || s.submitted_at);
    const plan = planOf[s.id] || null;
    for (const ch of channelsOf(s)) {
      const slot = slotOf[s.id + ':' + ch] || null;
      if (!slot && approvedOn < PUBLISH_START) continue;
      const done = !!slot && slot.status === 'da_dang';
      if (done && vnDateOf(slot.posted_at) < keepDoneFrom) continue;
      rows.push({
        submission_id: s.id, channel: ch, title: s.title, user_id: s.user_id, user_name: s.user_name,
        campus: s.campus || 'chung', pillar_id: s.pillar_id || '', approved_on: approvedOn,
        plan_item_id: plan ? plan.id : '',
        status: done ? 'da_dang' : 'cho_dang',
        scheduled_date: slot ? (slot.scheduled_date || null) : (plan && plan.publish_date) || null,
        scheduled_time: slot ? slot.scheduled_time || '' : '',
        from_plan: !slot && !!(plan && plan.publish_date),
        note: slot ? slot.note || '' : '',
        post_link: slot ? slot.post_link || '' : '',
        posted_at: slot ? slot.posted_at : null, posted_by_name: slot ? slot.posted_by_name || '' : '',
        can_edit: canEdit(s)
      });
    }
  }
  return rows;
}

const SUB_COLS = 'id, user_id, user_name, campus, title, platform, pillar_id, submitted_at, reviewed_at';

// Danh sách suất đăng mà người này được thấy.
export async function loadPublishRows(supabase, actor, opts = {}) {
  const today = vnToday();
  const writerOnly = actor.role === 'ctv';
  let q = supabase.from('submissions').select(SUB_COLS)
    .eq('status', 'approved')
    .gte('submitted_at', addDaysIso(today, -150) + 'T00:00:00+07:00')
    .order('reviewed_at', { ascending: false, nullsFirst: false }).limit(400);
  q = writerOnly ? q.eq('user_id', actor.id) : q.in('campus', visibleCampuses(actor));
  const { data: subs, error } = await q;
  if (error) throw new Error(error.message);
  return buildPublishRows(supabase, subs || [], s => canManageSub(actor, s), opts.doneDays || DONE_KEEP_DAYS);
}

// Phần "Bài cần đăng" của trang Việc cần làm: đến hạn trong 2 ngày tới (kể cả đã trễ) + bài đã duyệt chưa có ngày đăng.
export async function getPublishTodo(supabase, actor, today) {
  const rows = (await loadPublishRows(supabase, actor)).filter(r => r.status === 'cho_dang' && r.can_edit);
  const due = rows.filter(r => r.scheduled_date && r.scheduled_date <= addDaysIso(today, 2))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .map(r => ({ ...r, days_late: Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(r.scheduled_date + 'T00:00:00Z')) / 86400000) }));
  const unscheduled = rows.filter(r => !r.scheduled_date);
  return { due, unscheduled };
}

export async function handleGetPublishQueue(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  try {
    return { ok: true, today: vnToday(), slots: await loadPublishRows(supabase, actor) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Lấy bài + kiểm tra quyền + kênh hợp lệ (dùng cho 3 action ghi).
async function loadTarget(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { error: 'Chưa đăng nhập' };
  const channel = String(p.channel || '');
  if (!CHANNELS.includes(channel)) return { error: 'Kênh đăng không hợp lệ' };
  const { data: sub } = await supabase.from('submissions').select('id, user_id, campus, status, platform, title').eq('id', p.submission_id).maybeSingle();
  if (!sub) return { error: 'Không tìm thấy bài viết' };
  if (sub.status !== 'approved') return { error: 'Chỉ bài đã duyệt mới lên lịch đăng được' };
  if (!canManageSub(actor, sub)) return { error: 'Bạn không có quyền với bài này' };
  if (!channelsOf(sub).includes(channel)) return { error: 'Bài này không đăng ở kênh đó' };
  const { data: slot } = await supabase.from('publish_slots').select('*').eq('submission_id', sub.id).eq('channel', channel).maybeSingle();
  return { actor, sub, channel, slot: slot || null };
}

export async function handleSavePublishSlot(supabase, p) {
  const t = await loadTarget(supabase, p);
  if (t.error) return { ok: false, error: t.error };
  if (t.slot && t.slot.status === 'da_dang') return { ok: false, error: 'Kênh này đã đánh dấu đã đăng — hoàn tác trước nếu muốn đổi lịch' };
  const date = String(p.scheduled_date || '').trim() ? cleanDate(p.scheduled_date) : null;
  if (String(p.scheduled_date || '').trim() && !date) return { ok: false, error: 'Ngày đăng không hợp lệ' };
  const row = {
    scheduled_date: date, scheduled_time: date ? cleanTime(p.scheduled_time) : null,
    note: String(p.note || '').trim().slice(0, 200) || null, updated_at: new Date().toISOString()
  };
  if (t.slot) {
    const { error } = await supabase.from('publish_slots').update(row).eq('id', t.slot.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: t.slot.id };
  }
  const id = newId('PUB') + '_' + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from('publish_slots').insert({
    id, submission_id: t.sub.id, channel: t.channel, campus: t.sub.campus || 'chung', ...row, created_by: t.actor.id
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

export async function handleMarkPublished(supabase, p) {
  const t = await loadTarget(supabase, p);
  if (t.error) return { ok: false, error: t.error };
  const link = cleanLink(p.post_link);
  if (String(p.post_link || '').trim() && !link) return { ok: false, error: 'Link bài đăng phải bắt đầu bằng http:// hoặc https://' };
  const now = new Date().toISOString();
  const patch = { status: 'da_dang', post_link: link || null, posted_at: now, posted_by: t.actor.id, posted_by_name: t.actor.name, updated_at: now };
  if (t.slot) {
    const { error } = await supabase.from('publish_slots').update(patch).eq('id', t.slot.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const id = newId('PUB') + '_' + Math.random().toString(36).slice(2, 6);
    // Giữ ngày gợi ý của kế hoạch tháng làm ngày đăng dự kiến để hoàn tác sau này không mất lịch.
    const { data: planRow } = await supabase.from('plan_items').select('publish_date').eq('submission_id', t.sub.id).maybeSingle();
    const { error } = await supabase.from('publish_slots').insert({
      id, submission_id: t.sub.id, channel: t.channel, campus: t.sub.campus || 'chung', created_by: t.actor.id,
      scheduled_date: (planRow && planRow.publish_date) || null, ...patch
    });
    if (error) return { ok: false, error: error.message };
  }

  // Đầu việc kế hoạch nối với bài: khi MỌI kênh đã đăng thì ghi link (đầu tiên) vào đầu việc → trạng thái "Đã đăng" ở trang Kế hoạch.
  let planUpdated = false;
  try {
    const { data: plan } = await supabase.from('plan_items').select('id, post_link').eq('submission_id', t.sub.id).maybeSingle();
    if (plan && !plan.post_link) {
      const { data: slots } = await supabase.from('publish_slots').select('channel, status, post_link').eq('submission_id', t.sub.id);
      const doneCh = new Set((slots || []).filter(s => s.status === 'da_dang').map(s => s.channel));
      const links = (slots || []).filter(s => s.status === 'da_dang' && s.post_link).map(s => s.post_link);
      if (channelsOf(t.sub).every(c => doneCh.has(c)) && links.length) {
        const { error } = await supabase.from('plan_items').update({ post_link: links[0], updated_at: now }).eq('id', plan.id);
        planUpdated = !error;
      }
    }
  } catch (e) { /* không chặn việc đánh dấu đã đăng */ }
  return { ok: true, plan_updated: planUpdated };
}

export async function handleUnmarkPublished(supabase, p) {
  const t = await loadTarget(supabase, p);
  if (t.error) return { ok: false, error: t.error };
  if (!t.slot || t.slot.status !== 'da_dang') return { ok: false, error: 'Kênh này chưa được đánh dấu đã đăng' };
  const now = new Date().toISOString();
  const { error } = await supabase.from('publish_slots').update({
    status: 'cho_dang', post_link: null, posted_at: null, posted_by: null, posted_by_name: null, updated_at: now
  }).eq('id', t.slot.id);
  if (error) return { ok: false, error: error.message };
  // Link của đầu việc kế hoạch do chính kênh này ghi thì gỡ đi (khớp đúng link mới gỡ, không đụng link nhập tay khác).
  try {
    if (t.slot.post_link) {
      await supabase.from('plan_items').update({ post_link: null, updated_at: now })
        .eq('submission_id', t.sub.id).eq('post_link', t.slot.post_link);
    }
  } catch (e) {}
  return { ok: true };
}

// ------------------------------------------------------------
// EMAIL NHẮC ĐẾN HẠN ĐĂNG — mỗi ngày 1 email cho từng chủ bài có bài đã duyệt đến hạn đăng hôm nay hoặc đã trễ.
// Chạy kèm tiến trình gửi email (Worker lập lịch gọi process_email_queue mỗi 2 phút): chỉ thử trong khung 8h–17h giờ VN,
// mỗi giờ 1 lần; khoá chống trùng `publish_due:<user>:<ngày>` của enqueueEmail đảm bảo mỗi người tối đa 1 email/ngày.
// ------------------------------------------------------------
export async function enqueuePublishReminders(supabase, env, opts = {}) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  if (!opts.force && (vn.getUTCHours() < 8 || vn.getUTCHours() > 17 || vn.getUTCMinutes() >= 4)) return { skipped: true };
  const today = vnToday();
  const { data: subs, error } = await supabase.from('submissions').select(SUB_COLS)
    .eq('status', 'approved').gte('submitted_at', addDaysIso(today, -150) + 'T00:00:00+07:00').limit(600);
  if (error) throw new Error(error.message);
  const rows = (await buildPublishRows(supabase, (subs || []).filter(x => !opts.onlyUsers || opts.onlyUsers.includes(x.user_id)), () => true, 0))
    .filter(r => r.status === 'cho_dang' && r.scheduled_date && r.scheduled_date <= today);
  if (!rows.length) return { queued: 0 };

  const byUser = {};
  rows.forEach(r => { (byUser[r.user_id] = byUser[r.user_id] || []).push(r); });
  const { data: users } = await supabase.from('users').select('id, name, email, active').in('id', Object.keys(byUser));
  const link = String(env.APP_URL || '').replace(/\/$/, '') + '/plan.html?tab=publish';
  const dmy = iso => iso.split('-').reverse().join('/');
  let queued = 0;
  for (const u of users || []) {
    if (u.active === false || !u.email) continue;
    const list = byUser[u.id].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const late = list.filter(r => r.scheduled_date < today).length;
    const line = r => `- ${r.scheduled_date === today ? 'Hôm nay' : 'Trễ từ ' + dmy(r.scheduled_date)}: [${CHANNEL_LABEL[r.channel] || r.channel}] ${r.title}`;
    const subject = `[Lịch đăng] ${list.length} bài cần đăng${late ? ` (${late} bài đã trễ)` : ' hôm nay'}`;
    const text = `Chào ${u.name},\n\nBạn có ${list.length} bài đã duyệt đến hạn đăng:\n\n${list.map(line).join('\n')}\n\n` +
      `Đăng xong, nhớ bấm "Đã đăng" và dán link bài: ${link}\n\nFSchools Content Review`;
    const html = `<p>Chào ${emailHtml(u.name)},</p><p>Bạn có <b>${list.length}</b> bài đã duyệt đến hạn đăng:</p><ul>` +
      list.map(r => `<li>${r.scheduled_date === today ? '<b>Hôm nay</b>' : '<span style="color:#C0392B"><b>Trễ từ ' + dmy(r.scheduled_date) + '</b></span>'}: [${emailHtml(CHANNEL_LABEL[r.channel] || r.channel)}] ${emailHtml(r.title)}</li>`).join('') +
      `</ul><p>Đăng xong, nhớ bấm <b>Đã đăng</b> và dán link bài.</p>${openButtonHtml(link, 'Mở Lịch đăng')}<p>FSchools Content Review</p>`;
    const r = await enqueueEmail(supabase, u.email, u.name, subject, text, html, `publish_due:${u.id}:${today}`);
    if (r && r.queued) queued++;
  }
  return { queued };
}
