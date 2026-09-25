// ============================================================
// PHÂN QUYỀN Ở ROUTER — mỗi action cho phép những vai trò nào. Action KHÔNG có trong bảng
// này bị từ chối (mặc định cấm), nên thêm action mới vào functions/api/index.js thì phải khai
// báo quyền ở đây.
//
// Danh tính (ai đang gọi) LUÔN lấy từ phiên đăng nhập, không tin user_id/role/tên do trình
// duyệt gửi — xem bindIdentity(). Các handler bên trong vẫn kiểm tra thêm nghiệp vụ (đúng người
// duyệt, đúng chủ bài...) dựa trên danh tính đã được ép này.
// ============================================================

const ALL = ['ctv', 'leader_content', 'leader', 'manager', 'admin'];
const REVIEWERS = ['leader_content', 'leader', 'manager', 'admin'];
const BOSS = ['leader', 'manager', 'admin'];
const ADMIN_MANAGER = ['manager', 'admin'];
const ADMIN = ['admin'];

export const ACTION_ROLES = {
  // Nhân sự
  get_users: ALL,
  add_user: ADMIN,
  update_user: ADMIN,
  delete_user: ADMIN,

  // Cài đặt AI / thương hiệu
  get_rules: ALL,
  save_rules: ADMIN,
  get_personas: ADMIN,
  save_persona: ADMIN,
  delete_persona: ADMIN,
  get_brand_guides: ALL,
  save_brand_guide_text: ADMIN,
  save_brand_guide_image: ADMIN,
  delete_brand_guide: ADMIN,

  // Kho tài liệu (handler tự kiểm tra thêm quyền theo danh mục)
  get_document_categories: ALL,
  add_document_category: ALL,
  update_document_category: ALL,
  delete_document_category: ALL,
  get_document_links: ALL,
  add_document_link: ALL,
  update_document_link: ALL,
  delete_document_link: ALL,

  // Bài viết
  submit: ALL,
  resubmit: ALL,
  update_submission: ALL,
  cancel_submission: ALL,
  approve: REVIEWERS,
  reject: REVIEWERS,
  request_revision: REVIEWERS,
  forward_to_next: REVIEWERS,
  change_reviewer: REVIEWERS,
  save_inline_comments: REVIEWERS,
  get_submissions: ALL,
  get_report: REVIEWERS,
  get_ai_accuracy_report: BOSS,
  check_submit_result: ALL,
  get_submission_versions: ALL,

  // Bản nháp (mỗi người chỉ thấy bản nháp của mình — user_id bị ép theo phiên)
  save_draft: ALL,
  get_drafts: ALL,
  delete_draft: ALL,

  // Quy trình duyệt
  get_workflows: ALL,
  get_workflow_templates: ADMIN_MANAGER,
  save_workflow_template: ADMIN_MANAGER,
  delete_workflow_template: ADMIN_MANAGER,
  validate_workflow_template: ADMIN_MANAGER,

  // AI
  ai_check_content: ALL,
  ai_check_brand_image: ALL,
  ai_suggest_review: REVIEWERS,
  ai_chat: ALL,

  // Kế hoạch & lịch (handler tự tra lại vai trò/cơ sở)
  get_content_pillars: ALL,
  save_content_pillar: ALL,
  get_school_events: ALL,
  save_school_event: ALL,
  get_plan_items: ALL,
  save_plan_item: ALL,
  delete_plan_item: ALL
};

export function isActionAllowed(action, role) {
  const roles = ACTION_ROLES[action];
  return !!roles && roles.includes(role);
}

// Ghi đè mọi trường "ai đang thao tác" bằng danh tính thật từ phiên đăng nhập.
// Trả về object tham số mới (không sửa đối tượng gốc).
export function bindIdentity(p, me) {
  const out = { ...p };
  out.user_id = me.id;
  out.user_name = me.name;
  out.role = me.role;

  // Hành động của người duyệt: người thao tác chính là người đang đăng nhập.
  out.reviewer_id = me.id;
  out.reviewer_name = me.name;
  if (out.forwarder_name !== undefined) out.forwarder_name = me.name;
  if (out.changed_by_name !== undefined) out.changed_by_name = me.name;

  // Payload dạng { data: {...} } (gửi bài, gửi lại, sửa, huỷ, tạo bản nháp).
  if (out.data && typeof out.data === 'object') {
    out.data = { ...out.data, user_id: me.id, user_name: me.name, user_email: me.email };
  }

  // "Bài của tôi" (ctv.html) gọi get_submissions với role 'ctv' để chỉ xem bài của chính mình,
  // kể cả khi tài khoản là leader_content — cho phép HẠ xuống 'ctv', không bao giờ cho nâng quyền.
  if (p.action === 'get_submissions') {
    out.role = p.role === 'ctv' ? 'ctv' : me.role;
    out.campus = me.campus;
  }
  return out;
}
