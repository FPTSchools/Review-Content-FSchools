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

export async function onRequestPost({ request, env }) {
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
    switch (p.action) {
      case 'login': return json(await users.handleLogin(supabase, p));
      case 'get_users': return json(await users.handleGetUsers(supabase));
      case 'add_user': return json(await users.handleAddUser(supabase, p));
      case 'update_user': return json(await users.handleUpdateUser(supabase, p));
      case 'delete_user': return json(await users.handleDeleteUser(supabase, p));

      case 'get_rules': return json(await rules.handleGetRules(supabase));
      case 'save_rules': return json(await rules.handleSaveRules(supabase, p));

      case 'get_personas': return json(await personas.handleGetPersonas(supabase));
      case 'save_persona': return json(await personas.handleSavePersona(supabase, p));
      case 'delete_persona': return json(await personas.handleDeletePersona(supabase, p));

      case 'get_brand_guides': return json(await brandGuides.handleGetBrandGuides(supabase));
      case 'save_brand_guide_text': return json(await brandGuides.handleSaveBrandGuideText(supabase, p));
      case 'save_brand_guide_image': return json(await brandGuides.handleSaveBrandGuideImage());
      case 'delete_brand_guide': return json(await brandGuides.handleDeleteBrandGuide(supabase, p));

      case 'get_document_categories': return json(await documents.handleGetDocumentCategories(supabase, p));
      case 'add_document_category': return json(await documents.handleAddDocumentCategory(supabase, p));
      case 'update_document_category': return json(await documents.handleUpdateDocumentCategory(supabase, p));
      case 'delete_document_category': return json(await documents.handleDeleteDocumentCategory(supabase, p));
      case 'get_document_links': return json(await documents.handleGetDocumentLinks(supabase, p));
      case 'add_document_link': return json(await documents.handleAddDocumentLink(supabase, p));
      case 'update_document_link': return json(await documents.handleUpdateDocumentLink(supabase, p));
      case 'delete_document_link': return json(await documents.handleDeleteDocumentLink(supabase, p));

      case 'submit': return json(await submissions.handleSubmit(supabase, env, p));
      case 'resubmit': return json(await submissions.handleResubmit(supabase, env, p));
      case 'update_submission': return json(await submissions.handleUpdateSubmission(supabase, p));
      case 'cancel_submission': return json(await submissions.handleCancelSubmission(supabase, p));
      case 'approve': return json(await submissions.handleApprove(supabase, env, p));
      case 'reject': return json(await submissions.handleReject(supabase, env, p));
      case 'request_revision': return json(await submissions.handleRevision(supabase, env, p));
      case 'forward_to_next': return json(await submissions.handleForwardToNext(supabase, env, p));
      case 'change_reviewer': return json(await submissions.handleChangeReviewer(supabase, env, p));
      case 'save_inline_comments': return json(await submissions.handleSaveInlineComments(supabase, p));
      case 'get_submissions': return json(await submissions.handleGetSubmissions(supabase, p));
      case 'get_report': return json(await submissions.handleGetReport(supabase, p));
      case 'check_submit_result': return json(await submissions.handleCheckSubmitResult(supabase, p));
      case 'get_submission_versions': return json(await handleGetSubmissionVersions(supabase, p));

      case 'save_draft': return json(await drafts.handleSaveDraft(supabase, p));
      case 'get_drafts': return json(await drafts.handleGetDrafts(supabase, p));
      case 'delete_draft': return json(await drafts.handleDeleteDraft(supabase, p));

      case 'get_workflows': return json(await workflowTemplates.handleGetWorkflows(supabase, p));
      case 'get_workflow_templates': return json(await workflowTemplates.handleGetWorkflowTemplates(supabase, p));
      case 'save_workflow_template': return json(await workflowTemplates.handleSaveWorkflowTemplate(supabase, p));
      case 'delete_workflow_template': return json(await workflowTemplates.handleDeleteWorkflowTemplate(supabase, p));
      case 'validate_workflow_template': return json(workflowTemplates.handleValidateWorkflowTemplate(p));

      default:
        return json({
          ok: false,
          error: `Hành động "${p.action}" chưa được hỗ trợ ở backend mới (đang di chuyển dần từ Google Apps Script — xem PROGRESS.md mục "Cần làm tiếp")`
        });
    }
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}
