import { newId } from '../ids.js';

// ============================================================
// KHO THÔNG TIN CHUẨN — xem migration 20260927020000_knowledge_facts.sql.
// Ai cũng đề xuất được (→ chờ xác minh); Admin / Trưởng ban (manager) / Trưởng phòng (leader) xác minh
// hoặc từ chối, và thông tin họ tự thêm được xác minh luôn. "Hết hạn" suy ra từ valid_until.
// AI (viết bài, kiểm tra bài) chỉ dùng thông tin ĐÃ XÁC MINH và CÒN HẠN — getVerifiedFacts().
//
// Vai trò/cơ sở luôn tra lại từ bảng users theo user_id do router ép theo phiên đăng nhập.
// ============================================================

export const KB_CATEGORIES = [
  ['tuyen_sinh', 'Tuyển sinh & hồ sơ'],
  ['hoc_phi', 'Học phí & chính sách'],
  ['hoc_bong', 'Học bổng'],
  ['chuong_trinh', 'Chương trình đào tạo'],
  ['co_so', 'Cơ sở vật chất & nội trú'],
  ['doi_ngu', 'Đội ngũ giáo viên'],
  ['thanh_tich', 'Thành tích & giải thưởng'],
  ['gia_tri', 'Giá trị cốt lõi & thông điệp'],
  ['lien_he', 'Địa chỉ & liên hệ'],
  ['khac', 'Khác']
];
const CATEGORY_IDS = KB_CATEGORIES.map(c => c[0]);
const VERIFIER_ROLES = ['admin', 'manager', 'leader'];
const CAMPUSES = ['hoa_lac', 'tay_hn', 'chung'];

function todayVN() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function cleanText(v, max) {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max || 4000) : null;
}
function cleanDate(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
async function getActor(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('id, name, role, campus, active').eq('id', userId).maybeSingle();
  return data && data.active !== false ? data : null;
}
const isVerifier = a => !!a && VERIFIER_ROLES.includes(a.role);
// Admin/manager hoặc người thuộc campus 'chung' làm được với mọi cơ sở; còn lại chỉ cơ sở mình + 'chung'.
function canTouchCampus(actor, campus) {
  if (['manager', 'admin'].includes(actor.role) || actor.campus === 'chung') return true;
  return campus === actor.campus || campus === 'chung';
}
function visibleCampuses(actor) {
  if (['manager', 'admin', 'leader'].includes(actor.role) || actor.campus === 'chung') return CAMPUSES;
  return [actor.campus, 'chung'];
}
// Trạng thái hiển thị: thêm 'het_han' cho thông tin đã xác minh nhưng quá hạn.
function effectiveStatus(f, today) {
  if (f.status === 'da_xac_minh' && f.valid_until && f.valid_until < today) return 'het_han';
  return f.status;
}

export async function handleGetKnowledgeFacts(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const allowed = visibleCampuses(actor);
  const campuses = p.campus && allowed.includes(p.campus) ? [p.campus, 'chung'] : allowed;
  const { data, error } = await supabase.from('knowledge_facts').select('*').in('campus', campuses)
    .order('category').order('updated_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  const today = todayVN();
  return {
    ok: true,
    facts: (data || []).map(f => ({ ...f, effective_status: effectiveStatus(f, today) })),
    categories: KB_CATEGORIES,
    can_verify: isVerifier(actor)
  };
}

export async function handleSaveKnowledgeFact(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const f = p.fact || {};
  const title = cleanText(f.title, 300), content = cleanText(f.content, 4000);
  if (!title || !content) return { ok: false, error: 'Thiếu tiêu đề hoặc nội dung thông tin' };
  if (!CATEGORY_IDS.includes(f.category)) return { ok: false, error: 'Nhóm thông tin không hợp lệ' };
  if (!CAMPUSES.includes(f.campus) || !canTouchCampus(actor, f.campus)) return { ok: false, error: 'Không được sửa thông tin của cơ sở này' };

  const now = new Date().toISOString();
  const verifier = isVerifier(actor);
  const row = {
    campus: f.campus, category: f.category, title, content,
    source: cleanText(f.source, 1000), valid_until: cleanDate(f.valid_until), updated_at: now
  };
  // Người xác minh thêm/sửa → coi như xác minh luôn. Người khác thêm/sửa → quay về chờ xác minh.
  Object.assign(row, verifier
    ? { status: 'da_xac_minh', verified_by: actor.id, verified_by_name: actor.name, verified_at: now, review_note: null }
    : { status: 'cho_xac_minh', verified_by: null, verified_by_name: null, verified_at: null, review_note: null });

  if (f.id) {
    const { data: old } = await supabase.from('knowledge_facts').select('campus, submitted_by, status').eq('id', f.id).maybeSingle();
    if (!old) return { ok: false, error: 'Không tìm thấy thông tin' };
    if (!canTouchCampus(actor, old.campus)) return { ok: false, error: 'Không được sửa thông tin của cơ sở này' };
    // Người không có quyền xác minh chỉ sửa được đề xuất của chính mình khi chưa được xác minh.
    if (!verifier && (old.submitted_by !== actor.id || old.status === 'da_xac_minh')) {
      return { ok: false, error: 'Bạn chỉ sửa được đề xuất của mình khi chưa được xác minh' };
    }
    const { error } = await supabase.from('knowledge_facts').update(row).eq('id', f.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: f.id, status: row.status };
  }
  const id = newId('KB') + '_' + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from('knowledge_facts').insert({
    id, ...row, submitted_by: actor.id, submitted_by_name: actor.name, created_at: now
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id, status: row.status };
}

export async function handleReviewKnowledgeFact(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!isVerifier(actor)) return { ok: false, error: 'Chỉ Admin, Trưởng ban, Trưởng phòng được xác minh thông tin' };
  if (!['verify', 'reject'].includes(p.decision)) return { ok: false, error: 'Quyết định không hợp lệ' };
  const { data: old } = await supabase.from('knowledge_facts').select('campus').eq('id', p.id).maybeSingle();
  if (!old) return { ok: false, error: 'Không tìm thấy thông tin' };
  if (!canTouchCampus(actor, old.campus)) return { ok: false, error: 'Không được xác minh thông tin của cơ sở này' };
  const note = cleanText(p.note, 1000);
  if (p.decision === 'reject' && !note) return { ok: false, error: 'Ghi lý do từ chối để người đề xuất biết cần sửa gì' };
  const now = new Date().toISOString();
  const patch = p.decision === 'verify'
    ? { status: 'da_xac_minh', verified_by: actor.id, verified_by_name: actor.name, verified_at: now, review_note: note, updated_at: now }
    : { status: 'tu_choi', verified_by: actor.id, verified_by_name: actor.name, verified_at: now, review_note: note, updated_at: now };
  if (p.decision === 'verify' && p.valid_until !== undefined) patch.valid_until = cleanDate(p.valid_until);
  const { error } = await supabase.from('knowledge_facts').update(patch).eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Xác minh nhanh nhiều mục một lúc (chỉ "xác minh" — từ chối vẫn làm từng mục vì phải ghi lý do riêng).
// Bỏ qua (không báo lỗi cả lô) những mục không còn ở trạng thái chờ hoặc thuộc cơ sở người này không được đụng.
export async function handleVerifyKnowledgeFacts(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!isVerifier(actor)) return { ok: false, error: 'Chỉ Admin, Trưởng ban, Trưởng phòng được xác minh thông tin' };
  const ids = [...new Set((Array.isArray(p.ids) ? p.ids : []).map(String).filter(Boolean))].slice(0, 200);
  if (!ids.length) return { ok: false, error: 'Chưa chọn thông tin nào' };
  const { data: rows, error } = await supabase.from('knowledge_facts').select('id, campus, status').in('id', ids);
  if (error) return { ok: false, error: error.message };
  const allowed = (rows || []).filter(r => r.status === 'cho_xac_minh' && canTouchCampus(actor, r.campus)).map(r => r.id);
  if (!allowed.length) return { ok: true, verified: 0, skipped: ids.length };
  const now = new Date().toISOString();
  const { error: upErr } = await supabase.from('knowledge_facts')
    .update({ status: 'da_xac_minh', verified_by: actor.id, verified_by_name: actor.name, verified_at: now, review_note: null, updated_at: now })
    .in('id', allowed).eq('status', 'cho_xac_minh');
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, verified: allowed.length, skipped: ids.length - allowed.length };
}

export async function handleDeleteKnowledgeFact(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  const { data: old } = await supabase.from('knowledge_facts').select('campus, submitted_by, status').eq('id', p.id).maybeSingle();
  if (!old) return { ok: false, error: 'Không tìm thấy thông tin' };
  const own = old.submitted_by === actor.id && old.status !== 'da_xac_minh';
  if (!(isVerifier(actor) && canTouchCampus(actor, old.campus)) && !own) return { ok: false, error: 'Bạn không có quyền xoá thông tin này' };
  const { error } = await supabase.from('knowledge_facts').delete().eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Dùng cho AI: thông tin đã xác minh, còn hạn, của cơ sở bài viết + thông tin chung 2 cơ sở.
// Bài chung 2 cơ sở (campus 'chung' hoặc không rõ) → lấy của cả 2 cơ sở, ghi rõ cơ sở ở từng dòng.
export async function getVerifiedFacts(supabase, campus) {
  const campuses = campus && campus !== 'chung' && CAMPUSES.includes(campus) ? [campus, 'chung'] : CAMPUSES;
  const { data } = await supabase.from('knowledge_facts')
    .select('id, campus, category, title, content, valid_until')
    .eq('status', 'da_xac_minh').in('campus', campuses).order('category');
  const today = todayVN();
  return (data || []).filter(f => !f.valid_until || f.valid_until >= today);
}

const CAMPUS_LABEL = { hoa_lac: 'Hòa Lạc', tay_hn: 'Tây Hà Nội', chung: 'chung 2 cơ sở' };
const categoryLabel = id => (KB_CATEGORIES.find(c => c[0] === id) || [id, id])[1];

// Chuỗi đưa vào prompt: mỗi thông tin 1 mã [F1], [F2]... để AI trích lại được. Giới hạn độ dài để
// prompt không phình quá (thông tin cơ sở của bài được xếp trước thông tin chung).
export function factsPromptText(facts, maxChars = 9000) {
  const lines = [];
  let used = 0;
  const kept = [];
  for (const f of facts) {
    // Mỗi thông tin tối đa 800 ký tự (thông tin thương hiệu như 5 giá trị, ý nghĩa Kiến Sáng dài hơn số liệu).
    const line = `[F${kept.length + 1}] (${categoryLabel(f.category)} · ${CAMPUS_LABEL[f.campus] || f.campus}) ${f.title}: ${String(f.content).replace(/\s+/g, ' ').slice(0, 800)}`;
    if (used + line.length > maxChars) break;
    lines.push(line); kept.push(f); used += line.length;
  }
  return { text: lines.join('\n'), kept };
}
