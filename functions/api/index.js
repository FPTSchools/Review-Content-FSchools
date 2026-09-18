import { getServiceClient } from '../_lib/supabase.js';
import * as users from '../_lib/handlers/users.js';
import * as rules from '../_lib/handlers/rules.js';
import * as personas from '../_lib/handlers/personas.js';
import * as brandGuides from '../_lib/handlers/brandGuides.js';
import * as documents from '../_lib/handlers/documents.js';
import * as submissions from '../_lib/handlers/submissions.js';
import * as drafts from '../_lib/handlers/drafts.js';
import * as workflowTemplates from '../_lib/handlers/workflowTemplates.js';
import { handleGetSubmissionVersions } from '../_lib/submissionVersions.js';
import * as ai from '../_lib/handlers/ai.js';
import { handleProcessEmailQueue } from '../_lib/handlers/emailQueue.js';

// ============================================================
// Router chính — thay cho doPost/doGet trong backend_apps_script.js.
// Giữ nguyên "giao thức" cũ: POST 1 endpoint duy nhất, body JSON { action, ...params },
// trả về JSON { ok, ... } — để KHÔNG phải sửa index.html/boss.html/ctv.html khi chuyển sang
// backend này, chỉ cần đổi hằng số URL API ở frontend khi đã sẵn sàng cắt sang (xem PROGRESS.md,
// CHƯA đổi vì backend này còn thiếu nhiều action so với bản Apps Script gốc).
// ============================================================

const APP_NAME = 'FSchools Content Review';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestGet() {
  return json({ ok: true, message: `${APP_NAME} API (Cloudflare Pages Functions) running` });
}

// Các action ghi email vào hàng đợi (submit/duyệt/chuyển tiếp/đổi người duyệt) — sau khi xử lý
// xong, xử lý hàng đợi NGAY trong nền (waitUntil, không làm chậm phản hồi cho người dùng) thay
// vì chờ tới lượt Cron 2 phút/lần tiếp theo. Cron vẫn giữ lại làm lưới an toàn (thử lại email
// gửi lỗi, hoặc trường hợp hiếm khi waitUntil bị dừng giữa chừng).
const EMAIL_TRIGGER_ACTIONS = new Set([
  'submit', 'resubmit', 'approve', 'reject', 'request_revision', 'forward_to_next', 'change_reviewer'
]);

async function routeAction(p, supabase, env) {
  switch (p.action) {
    case 'login': return users.handleLogin(supabase, p);
    case 'get_users': return users.handleGetUsers(supabase);
    case 'add_user': return users.handleAddUser(supabase, p);
    case 'update_user': return users.handleUpdateUser(supabase, p);
    case 'delete_user': return users.handleDeleteUser(supabase, p);

    case 'get_rules': return rules.handleGetRules(supabase);
    case 'save_rules': return rules.handleSaveRules(supabase, p);

    case 'get_personas': return personas.handleGetPersonas(supabase);
    case 'save_persona': return personas.handleSavePersona(supabase, p);
    case 'delete_persona': return personas.handleDeletePersona(supabase, p);

    case 'get_brand_guides': return brandGuides.handleGetBrandGuides(supabase);
    case 'save_brand_guide_text': return brandGuides.handleSaveBrandGuideText(supabase, p);
    case 'save_brand_guide_image': return brandGuides.handleSaveBrandGuideImage();
    case 'delete_brand_guide': return brandGuides.handleDeleteBrandGuide(supabase, p);

    case 'get_document_categories': return documents.handleGetDocumentCategories(supabase, p);
    case 'add_document_category': return documents.handleAddDocumentCategory(supabase, p);
    case 'update_document_category': return documents.handleUpdateDocumentCategory(supabase, p);
    case 'delete_document_category': return documents.handleDeleteDocumentCategory(supabase, p);
    case 'get_document_links': return documents.handleGetDocumentLinks(supabase, p);
    case 'add_document_link': return documents.handleAddDocumentLink(supabase, p);
    case 'update_document_link': return documents.handleUpdateDocumentLink(supabase, p);
    case 'delete_document_link': return documents.handleDeleteDocumentLink(supabase, p);

    case 'submit': return submissions.handleSubmit(supabase, env, p);
    case 'resubmit': return submissions.handleResubmit(supabase, env, p);
    case 'update_submission': return submissions.handleUpdateSubmission(supabase, p);
    case 'cancel_submission': return submissions.handleCancelSubmission(supabase, p);
    case 'approve': return submissions.handleApprove(supabase, env, p);
    case 'reject': return submissions.handleReject(supabase, env, p);
    case 'request_revision': return submissions.handleRevision(supabase, env, p);
    case 'forward_to_next': return submissions.handleForwardToNext(supabase, env, p);
    case 'change_reviewer': return submissions.handleChangeReviewer(supabase, env, p);
    case 'save_inline_comments': return submissions.handleSaveInlineComments(supabase, p);
    case 'get_submissions': return submissions.handleGetSubmissions(supabase, p);
    case 'get_report': return submissions.handleGetReport(supabase, p);
    case 'check_submit_result': return submissions.handleCheckSubmitResult(supabase, p);
    case 'get_submission_versions': return handleGetSubmissionVersions(supabase, p);

    case 'save_draft': return drafts.handleSaveDraft(supabase, p);
    case 'get_drafts': return drafts.handleGetDrafts(supabase, p);
    case 'delete_draft': return drafts.handleDeleteDraft(supabase, p);

    case 'get_workflows': return workflowTemplates.handleGetWorkflows(supabase, p);
    case 'get_workflow_templates': return workflowTemplates.handleGetWorkflowTemplates(supabase, p);
    case 'save_workflow_template': return workflowTemplates.handleSaveWorkflowTemplate(supabase, p);
    case 'delete_workflow_template': return workflowTemplates.handleDeleteWorkflowTemplate(supabase, p);
    case 'validate_workflow_template': return workflowTemplates.handleValidateWorkflowTemplate(p);

    case 'ai_check_content': return ai.handleAiCheckContent(supabase, env, p);
    case 'ai_check_brand_image': return ai.handleAiCheckBrandImage(supabase, env, p);
    case 'ai_suggest_review': return ai.handleAiSuggestReview(supabase, env, p);
    case 'ai_chat': return ai.handleAiChat(supabase, env, p);

    case 'process_email_queue': return handleProcessEmailQueue(supabase, env);

    default:
      return {
        ok: false,
        error: `Hành động "${p.action}" chưa được hỗ trợ ở backend mới (đang di chuyển dần từ Google Apps Script — xem PROGRESS.md mục "Cần làm tiếp")`
      };
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  let p;
  try {
    const text = await request.text();
    p = JSON.parse(text || '{}');
  } catch (e) {
    return json({ ok: false, error: 'Body không phải JSON hợp lệ' });
  }

  let supabase;
  try {
    supabase = getServiceClient(env);
  } catch (e) {
    return json({ ok: false, error: e.message });
  }

  try {
    const result = await routeAction(p, supabase, env);
    // Xử lý hàng đợi email NGAY sau khi hành động chính đã ghi xong (email vừa được thêm vào
    // hàng đợi bên trong routeAction ở trên) — chạy nền qua waitUntil, không làm chậm phản hồi,
    // nhưng bắt đầu ngay thay vì đợi Cron 2 phút/lần. Cron vẫn giữ lại làm lưới an toàn.
    if (EMAIL_TRIGGER_ACTIONS.has(p.action) && typeof waitUntil === 'function') {
      waitUntil(handleProcessEmailQueue(supabase, env).catch(() => {}));
    }
    return json(result);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}
