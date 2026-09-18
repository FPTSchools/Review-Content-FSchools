// ============================================================
// Di chuyển dữ liệu 1 lần từ file Google Sheets xuất ra (.xlsx) sang Supabase.
// Đã chạy thành công ngày 2026-09-18 (xem PROGRESS.md) — giữ lại file này làm hồ sơ tham khảo,
// KHÔNG chạy lại trên dữ liệu đã có (sẽ tạo trùng id / lỗi khoá chính).
//
// Cách chạy: đặt biến môi trường SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, sửa đường dẫn file
// export ở XLSX_PATH bên dưới, rồi:
//   node migration/migrate_from_sheets_export.mjs --dry-run   (chỉ xem số liệu, không ghi)
//   node migration/migrate_from_sheets_export.mjs             (ghi thật vào Supabase)
//
// 2 quyết định thủ công đã áp dụng khi chạy lần đầu (xem PROGRESS.md để biết lý do):
//   1. Tài khoản đã bị xoá nhưng còn bài viết gắn vào (USR_1781238666751 "Hưng Đỗ") được tạo
//      lại thành user placeholder (active=false, không đăng nhập được) để giữ lại tên + bài viết.
//   2. 19 dòng lịch sử (SubmissionVersions/SubmissionSteps) gắn với 5 submission đã bị xoá khỏi
//      Sheets từ trước — bị bỏ qua, không di chuyển (không có bài gốc để gắn vào).
// ============================================================
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const XLSX_PATH = 'D:\\Dowloads\\FSchools Content Review.xlsx';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const wb = xlsx.readFile(XLSX_PATH);
function sheetRows(name) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const headers = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
function j(val, fallback) {
  if (val === '' || val === undefined || val === null) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (e) { return fallback; }
}
function s(val) { return val === '' || val === undefined ? null : val; }
function n(val, fallback) { const x = Number(val); return isNaN(x) ? fallback : x; }

const rawUsers = sheetRows('Users');
const rawSubs = sheetRows('Submissions');
const rawVersions = sheetRows('SubmissionVersions');
const rawSteps = sheetRows('SubmissionSteps');
const rawWft = sheetRows('WorkflowTemplates');
const rawWfs = sheetRows('WorkflowSteps');
const rawDrafts = sheetRows('Drafts');
const rawCats = sheetRows('DocumentCategories');
const rawLinks = sheetRows('DocumentLinks');
const rawRules = sheetRows('Rules');
const rawBg = sheetRows('BrandGuides');
const rawEq = sheetRows('EmailQueue');

const userIds = new Set(rawUsers.map(u => u.id));
const subIds = new Set(rawSubs.map(sub => String(sub.id).trim()));

// --- USERS (+ placeholder cho tài khoản đã bị xoá nhưng còn bài viết gắn vào) ---
// Tự phát hiện từ dữ liệu (KHÔNG hardcode tên/email cá nhân vào code) — bất kỳ user_id nào
// submission tham chiếu tới nhưng không còn trong sheet Users sẽ được tái tạo lại thành 1 user
// placeholder (active:false, không đăng nhập được) dựa trên user_name/user_email mà chính
// submission đó đã lưu, để giữ được tên hiển thị + không mất bài viết.
const users = rawUsers.map(u => ({
  id: u.id, email: u.email, password: u.password, name: u.name, role: u.role,
  campus: s(u.campus), active: !!u.active, created_at: u.created_at, last_login: s(u.last_login)
}));
const orphanUserIds = [...new Set(rawSubs.map(sub => sub.user_id))].filter(id => id && !userIds.has(id));
orphanUserIds.forEach(id => {
  const sample = rawSubs.find(sub => sub.user_id === id);
  users.push({
    id, email: sample.user_email || `${id}@migrated.invalid`, password: '(tài khoản đã xoá — không thể đăng nhập)',
    name: sample.user_name || id, role: 'ctv', campus: null, active: false,
    created_at: sample.submitted_at || new Date().toISOString(), last_login: null
  });
  userIds.add(id);
});

// --- WORKFLOW TEMPLATES / STEPS ---
const workflowTemplates = rawWft.map(w => ({
  workflow_id: w.workflow_id, version: n(w.version, 1), name: w.name,
  match_rule: j(w.match_rule_json, {}), active: !!w.active, created_by: s(w.created_by), created_at: w.created_at
}));
const workflowSteps = rawWfs.map(w => ({
  workflow_id: w.workflow_id, workflow_version: n(w.workflow_version, 1), step_id: w.step_id,
  step_order: n(w.step_order, 1), label: w.label, mode: w.mode || 'sequential',
  min_approvals: n(w.min_approvals, 1), assignment_rule: j(w.assignment_rule_json, {}),
  sla_hours: n(w.sla_hours, 0), on_approve: w.on_approve || 'next_step',
  on_revision: w.on_revision || 'revision', on_reject: w.on_reject || 'rejected'
}));

// --- SUBMISSIONS ---
const submissions = rawSubs.map(sub => ({
  id: sub.id, user_id: sub.user_id, user_name: sub.user_name, user_email: sub.user_email,
  campus: s(sub.campus), content_type: s(sub.content_type), audience: s(sub.audience),
  title: sub.title, content: s(sub.content), note: s(sub.note),
  drive_links: s(sub.drive_links), ai_verdict: s(sub.ai_verdict), ai_scores: j(sub.ai_scores, null),
  submitted_at: sub.submitted_at, status: sub.status,
  comment: s(sub.comment), score: sub.score === '' ? null : n(sub.score, null),
  reviewer_name: s(sub.reviewer_name), reviewed_at: s(sub.reviewed_at),
  send_count: n(sub.send_count, 1), original_id: s(sub.original_id),
  reviewers: j(sub.reviewers, []), current_reviewer_id: s(sub.current_reviewer_id),
  current_reviewer_name: s(sub.current_reviewer_name), is_shared: !!sub.is_shared,
  current_reviewer_index: n(sub.current_reviewer_index, 0),
  inline_comments: j(sub.inline_comments, []), review_history: j(sub.review_history, []),
  brand_check_result: j(sub.brand_check_result, null), evidence_links: s(sub.evidence_links),
  workflow_id: sub.workflow_id || 'manual_chain', workflow_version: n(sub.workflow_version, 1),
  workflow_steps: j(sub.workflow_steps, null), current_step_id: s(sub.current_step_id),
  lock_version: n(sub.lock_version, 1), idempotency_key: s(sub.idempotency_key),
  platform: j(sub.platform, [])
}));

// --- SUBMISSION VERSIONS / STEPS (bỏ 19 dòng mồ côi — submission gốc đã bị xoá) ---
const submissionVersions = rawVersions.filter(v => subIds.has(String(v.submission_id).trim())).map(v => ({
  id: v.id, submission_id: v.submission_id, revision_no: n(v.revision_no, 1),
  user_id: s(v.user_id), user_name: s(v.user_name), title: s(v.title), content: s(v.content), note: s(v.note),
  drive_links: s(v.drive_links), evidence_links: s(v.evidence_links), reviewers: j(v.reviewers, []),
  inline_comments: j(v.inline_comments, []), review_history: j(v.review_history, []),
  submitted_at: s(v.submitted_at), status: s(v.status), updated_at: v.updated_at || v.submitted_at || new Date().toISOString(),
  platform: j(v.platform, [])
}));
const submissionSteps = rawSteps.filter(st => subIds.has(String(st.submission_id).trim())).map(st => ({
  id: st.id, submission_id: st.submission_id, revision_no: n(st.revision_no, 1), step_id: st.step_id,
  step_order: n(st.step_order, 0), label: s(st.label), mode: st.mode || 'sequential', state: st.state || 'pending',
  reviewer_ids: j(st.reviewer_ids_json, []), decisions: j(st.decisions_json, []),
  started_at: s(st.started_at), completed_at: s(st.completed_at)
}));

// --- DRAFTS ---
const drafts = rawDrafts.map(d => ({
  id: d.id, user_id: d.user_id, user_name: s(d.user_name), payload: j(d.payload_json, {}),
  created_at: d.created_at, updated_at: d.updated_at
}));

// --- DOCUMENT CATEGORIES / LINKS ---
const documentCategories = rawCats.map(c => ({
  id: c.id, name: c.name, sort_order: n(c.sort_order, 0), created_by: s(c.created_by),
  created_at: c.created_at, color: c.color || '#E9E9E9', allowed_roles: j(c.allowed_roles, [])
}));
const documentLinks = rawLinks.map(l => ({
  id: l.id, category_id: l.category_id, title: l.title, url: l.url, note: s(l.note),
  added_by_id: s(l.added_by_id), added_by_name: s(l.added_by_name), created_at: l.created_at, updated_at: l.updated_at
}));

// --- RULES ---
const rules = rawRules.map(r => ({ type: r.type, value: s(r.value), category: s(r.category), date: s(r.date) }));

// --- BRAND GUIDES ---
const brandGuides = rawBg.map(b => ({
  id: b.id, name: b.name, type: b.type, content: s(b.content), mime_type: s(b.mime_type), updated_at: b.updated_at
}));

// --- EMAIL QUEUE (toàn bộ đã 'sent', an toàn để giữ lại làm lịch sử) ---
const emailQueue = rawEq.map(e => ({
  id: e.id, event_key: e.event_key, to_email: e.to_email, to_name: s(e.to_name),
  subject: s(e.subject), body: s(e.body), html_body: s(e.html_body), status: e.status,
  attempts: n(e.attempts, 0), last_error: s(e.last_error), created_at: e.created_at, sent_at: s(e.sent_at)
}));

const plan = [
  ['users', users], ['workflow_templates', workflowTemplates], ['workflow_steps', workflowSteps],
  ['submissions', submissions], ['submission_versions', submissionVersions], ['submission_steps', submissionSteps],
  ['drafts', drafts], ['document_categories', documentCategories], ['document_links', documentLinks],
  ['rules', rules], ['brand_guides', brandGuides], ['email_queue', emailQueue]
];

console.log(DRY_RUN ? '=== DRY RUN (không ghi vào Supabase) ===' : '=== GHI THẬT VÀO SUPABASE ===');
for (const [table, rows] of plan) {
  console.log(`${table}: ${rows.length} dòng`);
}

if (DRY_RUN) {
  console.log('\nSample submissions[0]:', JSON.stringify(submissions[0], null, 2).slice(0, 800));
  process.exit(0);
}

for (const [table, rows] of plan) {
  if (!rows.length) continue;
  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`LỖI khi insert vào ${table}:`, error.message);
    process.exit(1);
  }
  console.log(`✓ Đã ghi ${rows.length} dòng vào ${table}`);
}
console.log('\n=== HOÀN TẤT ===');
