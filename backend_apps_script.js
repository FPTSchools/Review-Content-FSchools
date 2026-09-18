// ============================================================
// FSCHOOLS CONTENT REVIEW v4 — Google Apps Script Backend
// Luồng duyệt: người số 1 tự quyết định duyệt luôn hoặc gửi lên
// ============================================================
const SHEET_ID = '1i4_1ITievilzg2SGW_zd2H_XZML8F8jWMX1cVbKHemw';
const APP_NAME = 'FSchools Content Review';
// URL production (Cloudflare Pages) — dùng để gắn link mở thẳng bài trong mail thông báo.
// Không có dấu / ở cuối.
const APP_URL = 'https://review-content.trunglt32.workers.dev';
// API key được lưu trong Script Properties (Project Settings > Script Properties)
// Key: OPENAI_API_KEY — không hard-code vào source
const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

// ============================================================
// WORKFLOW MULTI-LEVEL
// ============================================================
const WORKFLOW_TEMPLATE_HEADERS = ['workflow_id','version','name','match_rule_json','active','created_by','created_at'];
const WORKFLOW_STEP_HEADERS = ['workflow_id','workflow_version','step_id','step_order','label','mode','min_approvals','assignment_rule_json','sla_hours','on_approve','on_revision','on_reject'];
const SUBMISSION_STEP_HEADERS = ['id','submission_id','revision_no','step_id','step_order','label','mode','state','reviewer_ids_json','decisions_json','started_at','completed_at'];
const SUBMISSION_WORKFLOW_HEADERS = ['workflow_id','workflow_version','workflow_steps','current_step_id','lock_version','idempotency_key'];
const SUBMISSIONS_BASE_HEADERS = ['id','user_id','user_name','user_email','campus','content_type','audience','title','content','note','drive_links','ai_verdict','ai_scores','submitted_at','status','comment','score','reviewer_name','reviewed_at','send_count','original_id','reviewers','current_reviewer_id','current_reviewer_name','is_shared','current_reviewer_index','inline_comments','review_history','brand_check_result','evidence_links'];
// Cột mới thêm ở CUỐI (không chèn giữa) để không phá vỡ các chỉ số cột cũ đang hard-code khắp file.
const SUBMISSIONS_EXTRA_HEADERS = ['platform'];
const EMAIL_QUEUE_HEADERS = ['id','event_key','to_email','to_name','subject','body','html_body','status','attempts','last_error','created_at','sent_at'];

// ============================================================
// ROUTER
// ============================================================
function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    switch (p.action) {
      case 'login':                return jsonRes(handleLogin(p));
      case 'submit':               return jsonRes(handleSubmit(p));
      case 'resubmit':             return jsonRes(handleResubmit(p));
      case 'update_submission':    return jsonRes(handleUpdateSubmission(p));
      case 'cancel_submission':    return jsonRes(handleCancelSubmission(p));
      case 'approve':              return jsonRes(handleApprove(p));
      case 'reject':               return jsonRes(handleReject(p));
      case 'request_revision':     return jsonRes(handleRevision(p));
      case 'forward_to_next':      return jsonRes(handleForwardToNext(p));
      case 'change_reviewer':      return jsonRes(handleChangeReviewer(p));
      case 'save_inline_comments': return jsonRes(handleSaveInlineComments(p));
      case 'save_draft':            return jsonRes(handleSaveDraft(p));
      case 'get_drafts':            return jsonRes(handleGetDrafts(p));
      case 'delete_draft':          return jsonRes(handleDeleteDraft(p));
      case 'get_submission_versions': return jsonRes(handleGetSubmissionVersions(p));
      case 'ai_check_content':     return jsonRes(handleAiCheckContent(p));
      case 'ai_check_brand_image': return jsonRes(handleAiCheckBrandImage(p));
      case 'ai_suggest_review':    return jsonRes(handleAiSuggestReview(p));
      case 'ai_chat':             return jsonRes(handleAiChat(p));
      case 'get_submissions':      return jsonRes(handleGetSubmissions(p));
      case 'get_workflows':        return jsonRes(handleGetWorkflows(p));
      case 'get_workflow_templates': return jsonRes(handleGetWorkflowTemplates(p));
      case 'save_workflow_template': return jsonRes(handleSaveWorkflowTemplate(p));
      case 'delete_workflow_template': return jsonRes(handleDeleteWorkflowTemplate(p));
      case 'validate_workflow_template': return jsonRes(handleValidateWorkflowTemplate(p));
      case 'get_report':           return jsonRes(handleGetReport(p));
      case 'get_rules':            return jsonRes(handleGetRules());
      case 'save_rules':           return jsonRes(handleSaveRules(p));
      case 'get_users':            return jsonRes(handleGetUsers());
      case 'add_user':             return jsonRes(handleAddUser(p));
      case 'update_user':          return jsonRes(handleUpdateUser(p));
      case 'delete_user':          return jsonRes(handleDeleteUser(p));
      case 'get_personas':         return jsonRes(handleGetPersonas());
      case 'save_persona':         return jsonRes(handleSavePersona(p));
      case 'delete_persona':       return jsonRes(handleDeletePersona(p));
      case 'get_brand_guides':        return jsonRes(handleGetBrandGuides());
      case 'save_brand_guide_text':   return jsonRes(handleSaveBrandGuideText(p));
      case 'save_brand_guide_image':  return jsonRes(handleSaveBrandGuideImage(p));
      case 'delete_brand_guide':      return jsonRes(handleDeleteBrandGuide(p));
      case 'fix_user_campus':    return jsonRes(handleFixUserCampus());
      case 'seed_parallel_workflow': return jsonRes(seedParallelWorkflowV2());
      case 'get_document_categories':   return jsonRes(handleGetDocumentCategories(p));
      case 'add_document_category':     return jsonRes(handleAddDocumentCategory(p));
      case 'update_document_category':  return jsonRes(handleUpdateDocumentCategory(p));
      case 'delete_document_category':  return jsonRes(handleDeleteDocumentCategory(p));
      case 'get_document_links':        return jsonRes(handleGetDocumentLinks(p));
      case 'add_document_link':         return jsonRes(handleAddDocumentLink(p));
      case 'update_document_link':      return jsonRes(handleUpdateDocumentLink(p));
      case 'delete_document_link':      return jsonRes(handleDeleteDocumentLink(p));
      case 'check_submit_result':       return jsonRes(handleCheckSubmitResult(p));
      case 'process_email_queue':       return jsonRes(processEmailQueue(p));
      default: return jsonRes({ ok: false, error: 'Unknown action' });
    }
  } catch(err) {
    return jsonRes({ ok: false, error: err.toString() });
  }
}

function doGet(e) {
  return jsonRes({ ok: true, message: APP_NAME + ' API v4 running' });
}

// ============================================================
// CACHE (perf fix) — Users/Rules/DocumentCategories ít đổi trong
// ngày nhưng trước đây đọc thẳng Sheet ở MỌI lần gọi. Cache tạm
// (script-wide, dùng chung cho mọi người dùng) trong ít phút để
// giảm tải, và bị xoá ngay khi có ai sửa dữ liệu tương ứng.
// ============================================================
function getCached(key, ttlSeconds, computeFn) {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached);
    const value = computeFn();
    try { cache.put(key, JSON.stringify(value), ttlSeconds); } catch (e) {} // im lặng nếu value > 100KB (giới hạn CacheService)
    return value;
  } catch (e) {
    return computeFn(); // cache lỗi (hiếm) — vẫn trả dữ liệu đúng, chỉ mất phần tăng tốc
  }
}
function invalidateCache(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

// ============================================================
// AUTH
// ============================================================
function handleLogin(p) {
  const sheet = getSheet('Users');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, email, password, name, role, campus, active] = rows[i];
    if (email.toLowerCase() === p.email.toLowerCase()
        && password === p.password
        && active === true) {
      const now = new Date().toISOString();
      sheet.getRange(i + 1, 9).setValue(now);
      return { ok: true, user: { id, email, name, role, campus, last_login: now } };
    }
  }
  return { ok: false, error: 'Email hoặc mật khẩu không đúng' };
}

// ============================================================
// WORKFLOW HELPERS
// ============================================================
function readJsonSafe(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch(e) { return fallback; }
}

function buildLegacyWorkflow(reviewers) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const groups = {};
  list.filter(r => r && r.id).forEach((r, i) => {
    const order = Math.max(1, Number(r.order || i + 1));
    if (!groups[order]) groups[order] = [];
    groups[order].push(r);
  });
  const orders = Object.keys(groups).map(Number).sort((a, b) => a - b);
  return {
    workflow_id: 'manual_chain',
    workflow_version: 1,
    name: 'Chuỗi reviewer thủ công',
    steps: orders.map((order, i) => ({
      step_id: 'manual_' + order,
      step_order: i + 1,
      label: groups[order].map(r => r.name || '').filter(Boolean).join(' + ') || ('Bước ' + order),
      mode: groups[order].length > 1 ? 'parallel_any' : 'sequential',
      min_approvals: 1,
      reviewer_ids: groups[order].map(r => String(r.id)),
      reviewers: groups[order].map(r => ({ id: String(r.id), name: r.name || '', email: r.email || '', order })),
      assignment_rule: { type: 'fixed_users', user_ids: groups[order].map(r => String(r.id)) },
      state: 'pending',
      decisions: []
    }))
  };
}


function handleCheckSubmitResult(p) {
  const key = String(p.idempotency_key || '').trim();
  if (!key) return { ok: false, error: 'Thiếu idempotency_key' };
  const sheet = getSubmissionSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][35] || '') === key) {
      return { ok: true, found: true, id: rows[i][0], status: rows[i][14], title: rows[i][7] };
    }
  }
  return { ok: true, found: false };
}

function getEmailQueueSheet() {
  return getSheetWithHeaders('EmailQueue', EMAIL_QUEUE_HEADERS);
}

function enqueueEmail(email, name, subject, body, htmlBody, eventKey) {
  if (!email) return { ok: false, error: 'Thiếu địa chỉ email' };
  const sheet = getEmailQueueSheet();
  const rows = sheet.getDataRange().getValues();
  const key = String(eventKey || ('EMAIL_' + Date.now() + '_' + Math.random().toString(36).slice(2)));
  const duplicate = rows.slice(1).find(r => String(r[1] || '') === key && String(r[7] || '') !== 'failed');
  if (duplicate) return { ok: true, queued: false, duplicate: true, id: duplicate[0] };
  const id = 'MAIL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  sheet.appendRow([id, key, String(email), String(name || ''), String(subject || ''), String(body || ''), String(htmlBody || ''), 'queued', 0, '', new Date().toISOString(), '']);
  return { ok: true, queued: true, id };
}

function processEmailQueue(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return { ok: false, error: 'Email queue đang bận' }; }
  try {
    const sheet = getEmailQueueSheet();
    const rows = sheet.getDataRange().getValues();
    const now = new Date().toISOString();
    let processed = 0, sent = 0, failed = 0;
    for (let i = 1; i < rows.length && processed < 20; i++) {
      const status = String(rows[i][7] || '');
      const attempts = Number(rows[i][8] || 0);
      if (status !== 'queued' && !(status === 'failed' && attempts < 3)) continue;
      const row = i + 1;
      sheet.getRange(row, 8, 1, 3).setValues([['sending', attempts + 1, '']]);
      processed++;
      try {
        GmailApp.sendEmail(String(rows[i][2]), String(rows[i][4]), String(rows[i][5]), { htmlBody: String(rows[i][6] || '') });
        sheet.getRange(row, 8, 1, 5).setValues([['sent', attempts + 1, '', rows[i][10] || now, now]]);
        sent++;
      } catch (e) {
        sheet.getRange(row, 8, 1, 3).setValues([['failed', attempts + 1, String(e && e.message || e)] ]);
        failed++;
      }
    }
    return { ok: true, processed, sent, failed };
  } finally { lock.releaseLock(); }
}

function setupEmailQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processEmailQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processEmailQueue').timeBased().everyMinutes(1).create();
  return { ok: true, message: 'Đã cài trigger xử lý EmailQueue mỗi phút' };
}


function getActiveUsers() {
  const sheet = getSheet('Users');
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1).map(r => ({
    id: String(r[0] || ''), email: r[1] || '', name: r[3] || '',
    role: r[4] || '', campus: r[5] || '', active: r[6] === true
  })).filter(u => u.id && u.active);
}

function campusMatches(ruleCampus, submissionCampus, userCampus) {
  if (!ruleCampus || ruleCampus === 'any') return true;
  if (ruleCampus === 'same' || ruleCampus === 'same_or_shared') {
    return userCampus === submissionCampus || userCampus === 'chung' || submissionCampus === 'chung';
  }
  if (Array.isArray(ruleCampus)) return ruleCampus.includes(userCampus);
  return userCampus === ruleCampus;
}

function resolveAssignmentRule(rule, data) {
  const users = getActiveUsers();
  const r = rule || {};
  if (r.type === 'fixed_users') {
    return users.filter(u => (r.user_ids || []).map(String).includes(String(u.id)));
  }
  let candidates = users;
  if (r.roles && r.roles.length) candidates = candidates.filter(u => r.roles.includes(u.role));
  if (r.campus) candidates = candidates.filter(u => campusMatches(r.campus, data.campus, u.campus));
  if (r.exclude_user_ids) candidates = candidates.filter(u => !r.exclude_user_ids.map(String).includes(String(u.id)));
  if (r.type === 'pool' && r.assignment_mode === 'one') return candidates.slice(0, 1);
  return candidates;
}

function loadWorkflowDefinitions() {
  const templateSheet = getSheetWithHeaders('WorkflowTemplates', WORKFLOW_TEMPLATE_HEADERS);
  const stepSheet = getSheetWithHeaders('WorkflowSteps', WORKFLOW_STEP_HEADERS);
  const templates = templateSheet.getDataRange().getValues().slice(1).map(r => ({
    workflow_id: String(r[0] || ''), version: Number(r[1]) || 1, name: r[2] || '',
    match_rule: readJsonSafe(r[3], {}), active: r[4] === true || String(r[4]).toLowerCase() === 'true',
    created_by: r[5] || '', created_at: r[6] || ''
  })).filter(t => t.workflow_id && t.active);
  const steps = stepSheet.getDataRange().getValues().slice(1).map(r => ({
    workflow_id: String(r[0] || ''), workflow_version: Number(r[1]) || 1,
    step_id: String(r[2] || ''), step_order: Number(r[3]) || 1, label: r[4] || '',
    mode: r[5] || 'sequential', min_approvals: Number(r[6]) || 1,
    assignment_rule: readJsonSafe(r[7], {}), sla_hours: Number(r[8]) || 0,
    on_approve: r[9] || 'next_step', on_revision: r[10] || 'revision', on_reject: r[11] || 'rejected'
  })).filter(s => s.workflow_id && s.step_id);
  templates.forEach(t => {
    t.steps = steps.filter(s => s.workflow_id === t.workflow_id && s.workflow_version === t.version)
      .sort((a,b) => a.step_order - b.step_order);
  });
  return templates;
}

function workflowMatches(template, data) {
  const rule = template.match_rule || {};
  if (rule.content_types && rule.content_types.length && !rule.content_types.includes(data.content_type)) return false;
  if (rule.campuses && rule.campuses.length && !rule.campuses.includes(data.campus)) return false;
  if (rule.is_shared !== undefined && String(rule.is_shared) !== String(asBoolean(data.is_shared))) return false;
  return true;
}

function resolveWorkflowForSubmission(data) {
  const legacy = buildLegacyWorkflow(data.reviewers || []);
  const requestedId = data.workflow_id || 'manual_chain';
  if (requestedId === 'manual_chain') {
    if (!legacy.steps.length) throw new Error('WORKFLOW_NO_REVIEWER');
    return legacy;
  }
  const template = loadWorkflowDefinitions().find(t => t.workflow_id === requestedId && workflowMatches(t, data));
  if (!template || !template.steps.length) throw new Error('WORKFLOW_NOT_FOUND_OR_NO_STEPS');
  const runtimeSteps = template.steps.map(s => {
    const reviewers = resolveAssignmentRule(s.assignment_rule, data);
    if (!reviewers.length) throw new Error('WORKFLOW_STEP_NO_REVIEWER:' + s.step_id);
    const ids = reviewers.map(u => String(u.id));
    const min = s.mode === 'parallel_all' ? Math.max(s.min_approvals || ids.length, ids.length) : Math.max(s.min_approvals || 1, 1);
    if (min > ids.length) throw new Error('WORKFLOW_INVALID_MIN_APPROVALS:' + s.step_id);
    return {
      step_id: s.step_id, step_order: s.step_order, label: s.label,
      mode: s.mode || 'sequential', min_approvals: min,
      reviewer_ids: ids,
      reviewers: reviewers.map(u => ({ id: String(u.id), name: u.name, email: u.email })),
      assignment_rule: s.assignment_rule, state: 'pending', decisions: []
    };
  });
  return { workflow_id: template.workflow_id, workflow_version: template.version, name: template.name, steps: runtimeSteps };
}

function getRuntimeWorkflowFromRow(row) {
  const parsed = readJsonSafe(row[32], null);
  if (parsed && parsed.steps && parsed.steps.length) {
    const idxById = parsed.steps.findIndex(s => String(s.step_id) === String(row[33] || ''));
    return {
      workflow_id: parsed.workflow_id || row[30] || 'manual_chain',
      workflow_version: Number(parsed.workflow_version || row[31]) || 1,
      steps: parsed.steps,
      current_step_index: idxById >= 0 ? idxById : Math.max(0, Number(row[25]) || 0),
      lock_version: Number(row[34]) || 1,
      idempotency_key: row[35] || ''
    };
  }
  const legacy = buildLegacyWorkflow(readJsonSafe(row[21], []));
  return {
    workflow_id: 'manual_chain', workflow_version: 1, steps: legacy.steps,
    current_step_index: Math.min(Math.max(0, Number(row[25]) || 0), Math.max(legacy.steps.length - 1, 0)),
    lock_version: Number(row[34]) || 1, idempotency_key: row[35] || ''
  };
}

function activeWorkflowStep(runtime) {
  return runtime.steps[runtime.current_step_index] || null;
}

function stepHasEnoughApprovals(step) {
  const approvals = (step.decisions || []).filter(d => d.action === 'approve').length;
  const minimum = Number(step.min_approvals) || 1;
  if (step.mode === 'parallel_all') return approvals >= Math.max(minimum, (step.reviewer_ids || []).length);
  if (step.mode === 'parallel_any') return approvals >= minimum;
  return approvals >= 1;
}

function firstPendingReviewer(step) {
  const decided = new Set((step.decisions || []).map(d => String(d.user_id)));
  return (step.reviewers || []).find(r => !decided.has(String(r.id))) || (step.reviewers || [])[0] || null;
}

function persistWorkflowRuntime(sheet, rowNumber, row, runtime, revisionNo) {
  const step = activeWorkflowStep(runtime);
  const current = firstPendingReviewer(step || { reviewers: [] });
  const flatReviewers = runtime.steps.flatMap(s => s.reviewers || []);
  sheet.getRange(rowNumber, 22).setValue(JSON.stringify(flatReviewers));
  sheet.getRange(rowNumber, 23).setValue(current ? current.id : '');
  sheet.getRange(rowNumber, 24).setValue(current ? current.name : '');
  sheet.getRange(rowNumber, 26).setValue(runtime.current_step_index || 0);
  sheet.getRange(rowNumber, 31, 1, 6).setValues([[
    runtime.workflow_id || 'manual_chain', runtime.workflow_version || 1,
    JSON.stringify({ workflow_id: runtime.workflow_id, workflow_version: runtime.workflow_version, steps: runtime.steps }),
    step ? step.step_id : '', runtime.lock_version || 1, runtime.idempotency_key || ''
  ]]);
  saveSubmissionStepSnapshot(row[0], revisionNo || row[19] || 1, runtime);
}

function saveSubmissionStepSnapshot(submissionId, revisionNo, runtime) {
  const sheet = getSheetWithHeaders('SubmissionSteps', SUBMISSION_STEP_HEADERS);
  const rows = sheet.getDataRange().getValues();
  (runtime.steps || []).forEach(step => {
    const id = String(submissionId) + '_v' + String(revisionNo) + '_' + String(step.step_id);
    const values = [id, submissionId, revisionNo, step.step_id, step.step_order || 0, step.label || '', step.mode || 'sequential', step.state || 'pending', JSON.stringify(step.reviewer_ids || []), JSON.stringify(step.decisions || []), step.started_at || new Date().toISOString(), step.completed_at || ''];
    const existing = rows.findIndex(r => String(r[0]) === id);
    if (existing >= 1) sheet.getRange(existing + 1, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
  });
}

function findActorForWorkflow(p, step, row) {
  const id = p.reviewer_id ? String(p.reviewer_id) : '';
  if (id && (step.reviewer_ids || []).map(String).includes(id)) return id;
  if (!id && (step.reviewer_ids || []).length === 1 && p.reviewer_name && String(p.reviewer_name) === String(row[23])) return String(step.reviewer_ids[0]);
  return id;
}

function applyWorkflowDecision(sheet, rowNumber, row, p, action) {
  const runtime = getRuntimeWorkflowFromRow(row);
  if (!runtime.steps.length) return { handled: false };
  const step = activeWorkflowStep(runtime);
  if (!step) return { handled: false };
  const actorId = findActorForWorkflow(p, step, row);
  const actor = getActiveUsers().find(u => String(u.id) === String(actorId));
  const override = !!p.override && actor && actor.role === 'manager';
  if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) return { handled: true, error: 'STALE_LOCK_VERSION' };
  if (!actorId || (!(step.reviewer_ids || []).map(String).includes(String(actorId)) && !override)) return { handled: true, error: 'NOT_ASSIGNED_REVIEWER' };
  if (!override && (step.decisions || []).some(d => String(d.user_id) === String(actorId))) return { handled: true, error: 'DUPLICATE_DECISION' };
  if (!['approved','revision','rejected'].includes(action)) return { handled: true, error: 'INVALID_WORKFLOW_ACTION' };
  if (action !== 'approved' && !String(p.comment || '').trim()) return { handled: true, error: 'COMMENT_REQUIRED' };

  step.decisions = step.decisions || [];
  step.decisions.push({ user_id: String(actorId), action: action === 'approved' ? 'approve' : action === 'revision' ? 'revision' : 'reject', comment: p.comment || '', score: p.score || '', at: new Date().toISOString() });
  let nextStatus = 'reviewing';
  let nextStep = false;
  if (action === 'rejected') {
    step.state = 'rejected'; nextStatus = 'rejected';
  } else if (action === 'revision') {
    step.state = 'revision'; nextStatus = 'revision';
  } else {
    const stepComplete = stepHasEnoughApprovals(step);
    if (stepComplete) {
      step.state = 'approved';
      step.completed_at = new Date().toISOString();
      if (runtime.current_step_index < runtime.steps.length - 1) {
        runtime.current_step_index += 1;
        nextStep = activeWorkflowStep(runtime);
        if (nextStep) {
          nextStep.state = 'pending';
          nextStep.started_at = new Date().toISOString();
        }
        nextStatus = 'reviewing';
      } else {
        nextStatus = 'approved';
      }
    } else {
      step.state = 'in_review';
      nextStatus = 'reviewing';
    }
  }
  runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;
  persistWorkflowRuntime(sheet, rowNumber, row, runtime, row[19] || 1);
  sheet.getRange(rowNumber, 15).setValue(nextStatus);
  return { handled: true, ok: true, status: nextStatus, next_step: nextStep, runtime };
}

function handleGetWorkflows(p) {
  const data = p || {};
  const workflows = loadWorkflowDefinitions().filter(w => workflowMatches(w, data));
  return { ok: true, workflows: workflows.map(w => ({ workflow_id: w.workflow_id, version: w.version, name: w.name, active: w.active, steps: w.steps.map(s => ({ step_id: s.step_id, step_order: s.step_order, label: s.label, mode: s.mode, min_approvals: s.min_approvals, assignment_rule: s.assignment_rule })) })) };
}

function assertWorkflowAdmin(p) {
  if (!['admin', 'manager'].includes(String(p.role || ''))) throw new Error('WORKFLOW_ADMIN_REQUIRED');
}

function normalizeWorkflowSteps(rawSteps) {
  if (!Array.isArray(rawSteps) || !rawSteps.length) throw new Error('WORKFLOW_STEPS_REQUIRED');
  return rawSteps.map((step, index) => ({
    step_id: String(step.step_id || ('step_' + (index + 1))).trim(),
    step_order: Number(step.step_order || index + 1),
    label: String(step.label || ('Bước ' + (index + 1))).trim(),
    mode: ['sequential', 'parallel_any', 'parallel_all'].includes(step.mode) ? step.mode : 'sequential',
    min_approvals: Math.max(1, Number(step.min_approvals || 1)),
    assignment_rule: typeof step.assignment_rule === 'string' ? readJsonSafe(step.assignment_rule, {}) : (step.assignment_rule || {}),
    sla_hours: Number(step.sla_hours || 0),
    on_approve: step.on_approve || 'next_step',
    on_revision: step.on_revision || 'revision',
    on_reject: step.on_reject || 'rejected'
  })).sort((a, b) => a.step_order - b.step_order);
}

function workflowTemplateRows() {
  const sheet = getSheetWithHeaders('WorkflowTemplates', WORKFLOW_TEMPLATE_HEADERS);
  return { sheet, rows: sheet.getDataRange().getValues() };
}

function buildWorkflowTemplateObject(templateRow, stepRows) {
  const workflowId = String(templateRow[0] || '');
  const version = Number(templateRow[1]) || 1;
  return {
    workflow_id: workflowId,
    version,
    name: templateRow[2] || workflowId,
    match_rule: readJsonSafe(templateRow[3], {}),
    active: templateRow[4] === true || String(templateRow[4]).toLowerCase() === 'true',
    created_by: templateRow[5] || '',
    created_at: templateRow[6] || '',
    steps: stepRows.filter(r => String(r[0]) === workflowId && Number(r[1]) === version).map(r => ({
      step_id: String(r[2] || ''), step_order: Number(r[3]) || 1, label: r[4] || '',
      mode: r[5] || 'sequential', min_approvals: Number(r[6]) || 1,
      assignment_rule: readJsonSafe(r[7], {}), sla_hours: Number(r[8]) || 0,
      on_approve: r[9] || 'next_step', on_revision: r[10] || 'revision', on_reject: r[11] || 'rejected'
    })).sort((a, b) => a.step_order - b.step_order)
  };
}

function handleGetWorkflowTemplates(p) {
  assertWorkflowAdmin(p || {});
  const templateData = workflowTemplateRows();
  const stepSheet = getSheetWithHeaders('WorkflowSteps', WORKFLOW_STEP_HEADERS);
  const stepRows = stepSheet.getDataRange().getValues().slice(1);
  const templates = templateData.rows.slice(1).filter(r => r[0]).map(r => buildWorkflowTemplateObject(r, stepRows));
  return { ok: true, templates };
}

function handleValidateWorkflowTemplate(p) {
  const template = p.template || p.data || {};
  const errors = [];
  const workflowId = String(template.workflow_id || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(workflowId)) errors.push('workflow_id phải dài 3–80 ký tự, chỉ gồm chữ, số, _ hoặc -.');
  if (!String(template.name || '').trim()) errors.push('Thiếu tên workflow.');
  let steps = [];
  try { steps = normalizeWorkflowSteps(template.steps); } catch(e) { errors.push(e.message); }
  const ids = new Set();
  steps.forEach(step => {
    if (!step.step_id) errors.push('Step thiếu step_id.');
    if (ids.has(step.step_id)) errors.push('Trùng step_id: ' + step.step_id);
    ids.add(step.step_id);
    if (step.mode === 'parallel_all' && step.min_approvals < 1) errors.push('parallel_all cần min_approvals >= 1.');
    const rule = step.assignment_rule || {};
    if (rule.type === 'fixed_users' && (!Array.isArray(rule.user_ids) || !rule.user_ids.length)) errors.push('Step ' + step.step_id + ' thiếu user_ids.');
    if (rule.type === 'role_and_campus' && (!Array.isArray(rule.roles) || !rule.roles.length)) errors.push('Step ' + step.step_id + ' thiếu roles.');
  });
  return { ok: errors.length === 0, errors, normalized_steps: steps };
}

function handleSaveWorkflowTemplate(p) {
  assertWorkflowAdmin(p || {});
  const template = p.template || p.data || {};
  const validation = handleValidateWorkflowTemplate({ template });
  if (!validation.ok) return { ok: false, error: 'Workflow không hợp lệ', errors: validation.errors };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
    const templateData = workflowTemplateRows();
    const templateSheet = templateData.sheet;
    const workflowId = String(template.workflow_id).trim();
    const existingRows = templateData.rows;
    let version = Number(template.version) || 0;
    if (!version) {
      const versions = existingRows.slice(1).filter(r => String(r[0]) === workflowId).map(r => Number(r[1]) || 0);
      version = versions.length ? Math.max(...versions) + 1 : 1;
    }
    const active = template.active !== false;
    const now = new Date().toISOString();
    let rowIndex = existingRows.findIndex(r => String(r[0]) === workflowId && Number(r[1]) === version);
    const templateValues = [workflowId, version, String(template.name).trim(), JSON.stringify(template.match_rule || {}), active, p.user_id || p.created_by || '', now];
    if (rowIndex >= 1) templateSheet.getRange(rowIndex + 1, 1, 1, templateValues.length).setValues([templateValues]);
    else { templateSheet.appendRow(templateValues); rowIndex = templateSheet.getLastRow() - 1; }

    if (active) {
      const currentRows = templateSheet.getDataRange().getValues();
      for (let i = 1; i < currentRows.length; i++) {
        if (String(currentRows[i][0]) === workflowId && Number(currentRows[i][1]) !== version && (currentRows[i][4] === true || String(currentRows[i][4]).toLowerCase() === 'true')) templateSheet.getRange(i + 1, 5).setValue(false);
      }
    }

    const stepSheet = getSheetWithHeaders('WorkflowSteps', WORKFLOW_STEP_HEADERS);
    const stepRows = stepSheet.getDataRange().getValues();
    for (let i = stepRows.length - 1; i >= 1; i--) {
      if (String(stepRows[i][0]) === workflowId && Number(stepRows[i][1]) === version) stepSheet.deleteRow(i + 1);
    }
    validation.normalized_steps.forEach(step => stepSheet.appendRow([
      workflowId, version, step.step_id, step.step_order, step.label, step.mode, step.min_approvals,
      JSON.stringify(step.assignment_rule || {}), step.sla_hours, step.on_approve, step.on_revision, step.on_reject
    ]));
    return { ok: true, workflow_id: workflowId, version, active };
  } finally { lock.releaseLock(); }
}

function handleDeleteWorkflowTemplate(p) {
  assertWorkflowAdmin(p || {});
  const workflowId = String(p.workflow_id || '').trim();
  const version = p.version === undefined || p.version === '' ? null : Number(p.version);
  if (!workflowId) return { ok: false, error: 'Thiếu workflow_id' };
  const sheet = getSheetWithHeaders('WorkflowTemplates', WORKFLOW_TEMPLATE_HEADERS);
  const rows = sheet.getDataRange().getValues();
  let changed = 0;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === workflowId && (version === null || Number(rows[i][1]) === version)) {
      sheet.getRange(i + 1, 5).setValue(false); changed++;
    }
  }
  return { ok: true, deactivated: changed };
}

// ============================================================
// SUBMIT
// Cột Submissions:
// 1:id 2:user_id 3:user_name 4:user_email
// 5:campus 6:content_type 7:audience
// 8:title 9:content 10:note
// 11:drive_links 12:ai_verdict 13:ai_scores
// 14:submitted_at 15:status
// 16:comment 17:score 18:reviewer_name 19:reviewed_at
// 20:send_count 21:original_id
// 22:reviewers 23:current_reviewer_id 24:current_reviewer_name
// 25:is_shared 26:current_reviewer_index
// 27:inline_comments
// 28:review_history (JSON array các vòng đã duyệt)
// 29:brand_check_result (JSON — kết quả AI chấm brand guide cho ảnh, nếu có)
// 30:evidence_links (link minh chứng bản quyền ảnh học sinh / nhạc / tác quyền — không bắt buộc, có thể nhiều link)
// ============================================================
function handleSubmit(p) {
  const d = p.data || {};
  const sheet = getSubmissionSheet();
  const rows = sheet.getDataRange().getValues();
  const idempotencyKey = d.idempotency_key || p.idempotency_key || '';
  if (idempotencyKey) {
    const existing = rows.slice(1).find(r => String(r[35] || '') === String(idempotencyKey) && String(r[1] || '') === String(d.user_id || ''));
    if (existing) return { ok: true, id: existing[0], duplicate: true };
  }

  const workflow = resolveWorkflowForSubmission(d);
  const firstStep = workflow.steps[0];
  const firstReviewer = firstPendingReviewer(firstStep);
  const allReviewers = workflow.steps.flatMap(s => s.reviewers || []);
  const id = 'SUB_' + Date.now();
  const submittedAt = new Date().toISOString();
  const runtime = { ...workflow, current_step_index: 0, lock_version: 1, idempotency_key: idempotencyKey };

  sheet.appendRow([
    id,
    d.user_id, d.user_name, d.user_email,
    d.campus, d.content_type, d.audience,
    d.title, d.content, d.note,
    d.drive_links || '',
    d.ai_verdict || '', d.ai_scores || '',
    submittedAt,
    'new',
    '', '', '', '',
    d.send_count || 1,
    d.original_id || '',
    JSON.stringify(allReviewers),
    firstReviewer ? firstReviewer.id : '',
    firstReviewer ? firstReviewer.name : '',
    asBoolean(d.is_shared) ? 'true' : 'false',
    0,
    '',   // inline_comments
    '[]', // review_history
    d.brand_check_result || '',
    d.evidence_links || '',
    workflow.workflow_id || 'manual_chain',
    workflow.workflow_version || 1,
    JSON.stringify(runtime),
    firstStep ? firstStep.step_id : '',
    runtime.lock_version,
    idempotencyKey,
    JSON.stringify(d.platform || [])
  ]);

  const rowNumber = sheet.getLastRow();
  const insertedRow = sheet.getRange(rowNumber, 1, 1, 37).getValues()[0];
  persistWorkflowRuntime(sheet, rowNumber, insertedRow, runtime, parseInt(d.send_count || 1, 10) || 1);

  saveSubmissionVersion(id, parseInt(d.send_count || 1, 10) || 1, {
    submission_id: id,
    user_id: d.user_id,
    user_name: d.user_name,
    title: d.title,
    content: d.content,
    note: d.note,
    drive_links: d.drive_links || '',
    evidence_links: d.evidence_links || '',
    platform: d.platform || [],
    reviewers: allReviewers,
    inline_comments: '[]',
    review_history: '[]',
    submitted_at: submittedAt,
    status: 'new'
  });

  (runtime.steps[0] && runtime.steps[0].reviewers || []).forEach(reviewer => {
    sendReviewerEmail(reviewer.email, reviewer.name, d, id, runtime.steps[0].step_order || 1, runtime.steps[0].reviewers.length);
  });
  return { ok: true, id, workflow_id: workflow.workflow_id, workflow_version: workflow.workflow_version };
}

// ============================================================
// RESUBMIT
// ============================================================
function handleResubmit(p) {
  const d = p.data || {};
  const sheet = getSubmissionSheet();
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(d.original_id)) {
      const row = i + 1;
      if (String(rows[i][35] || '') && String(rows[i][35]) === String(d.idempotency_key || '')) return { ok: true, id: d.original_id, duplicate: true };
      if (String(rows[i][14]) !== 'revision') return { ok: false, error: 'Chỉ bài đang yêu cầu sửa mới được gửi lại' };
      ensureSubmissionVersionForRow(rows[i]);

      const runtime = getRuntimeWorkflowFromRow(rows[i]);
      if (!runtime.steps.length) return { ok: false, error: 'Submission chưa có workflow reviewer' };
      runtime.current_step_index = 0;
      runtime.idempotency_key = d.idempotency_key || runtime.idempotency_key || '';
      runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;
      runtime.steps = runtime.steps.map(step => ({ ...step, state: 'pending', decisions: [], started_at: '', completed_at: '' }));
      const firstReviewer = firstPendingReviewer(runtime.steps[0]);
      const allReviewers = runtime.steps.flatMap(s => s.reviewers || []);
      const submittedAt = new Date().toISOString();
      const history = addHistory(rows[i][27], d.user_name || rows[i][2], 'resubmitted', d.note || '', '');

      sheet.getRange(row, 6).setValue(d.content_type);
      sheet.getRange(row, 7).setValue(d.audience);
      sheet.getRange(row, 8).setValue(d.title);
      sheet.getRange(row, 9).setValue(d.content);
      sheet.getRange(row, 10).setValue(d.note);
      sheet.getRange(row, 11).setValue(d.drive_links || '');
      sheet.getRange(row, 12).setValue(d.ai_verdict || '');
      sheet.getRange(row, 13).setValue(d.ai_scores || '');
      sheet.getRange(row, 14).setValue(submittedAt);
      sheet.getRange(row, 15).setValue('new');
      sheet.getRange(row, 16).setValue('');
      sheet.getRange(row, 17).setValue('');
      sheet.getRange(row, 18).setValue('');
      sheet.getRange(row, 19).setValue('');
      sheet.getRange(row, 20).setValue(d.send_count || (Number(rows[i][19]) || 1) + 1);
      sheet.getRange(row, 25).setValue(asBoolean(d.is_shared) ? 'true' : 'false');
      sheet.getRange(row, 27).setValue('');
      sheet.getRange(row, 28).setValue(history);
      sheet.getRange(row, 29).setValue(d.brand_check_result || '');
      sheet.getRange(row, 30).setValue(d.evidence_links || '');
      sheet.getRange(row, 37).setValue(JSON.stringify(d.platform || []));
      persistWorkflowRuntime(sheet, row, sheet.getRange(row, 1, 1, 37).getValues()[0], runtime, parseInt(d.send_count || 2, 10) || 2);

      saveSubmissionVersion(d.original_id, parseInt(d.send_count || 2, 10) || 2, {
        submission_id: d.original_id,
        user_id: d.user_id || rows[i][1], user_name: d.user_name || rows[i][2],
        title: d.title, content: d.content, note: d.note,
        drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
        platform: d.platform || [],
        reviewers: allReviewers, inline_comments: '[]', review_history: history,
        submitted_at: submittedAt, status: 'new'
      });

      (runtime.steps[0] && runtime.steps[0].reviewers || []).forEach(reviewer => {
        sendReviewerEmail(reviewer.email, reviewer.name, d, d.original_id, runtime.steps[0].step_order || 1, runtime.steps[0].reviewers.length);
      });
      return { ok: true, id: d.original_id, workflow_id: runtime.workflow_id, workflow_version: runtime.workflow_version };
    }
  }
  return { ok: false, error: 'Không tìm thấy bài cần gửi lại' };
}

// ============================================================
// SỬA BÀI KHI CHƯA CÓ QUYẾT ĐỊNH (status new/reviewing)
// Khác resubmit: không tạo vòng gửi mới, không tăng send_count,
// không đổi lại workflow/reviewer — chỉ sửa nội dung bài đang chờ duyệt.
// ============================================================
function handleUpdateSubmission(p) {
  const d = p.data || {};
  if (!d.id) return { ok: false, error: 'Thiếu id bài viết' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
    const sheet = getSubmissionSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(d.id)) continue;
      if (String(rows[i][1]) !== String(d.user_id)) return { ok: false, error: 'Bạn không có quyền sửa bài này' };
      if (!['new', 'reviewing'].includes(String(rows[i][14]))) return { ok: false, error: 'Chỉ sửa được bài đang chờ duyệt (chưa có quyết định)' };
      const row = i + 1;
      sheet.getRange(row, 6, 1, 5).setValues([[d.content_type || '', d.audience || '', d.title || '', d.content || '', d.note || '']]);
      sheet.getRange(row, 11).setValue(d.drive_links || '');
      sheet.getRange(row, 30).setValue(d.evidence_links || '');
      sheet.getRange(row, 37).setValue(JSON.stringify(d.platform || []));
      saveSubmissionVersion(d.id, parseInt(rows[i][19]) || 1, {
        submission_id: d.id, user_id: rows[i][1], user_name: rows[i][2],
        title: d.title || '', content: d.content || '', note: d.note || '',
        drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
        platform: d.platform || [], reviewers: rows[i][21], inline_comments: rows[i][26],
        review_history: rows[i][27], submitted_at: rows[i][13], status: rows[i][14]
      });
      return {
        ok: true, id: d.id, content_type: d.content_type || '', audience: d.audience || '',
        title: d.title || '', content: d.content || '', note: d.note || '',
        drive_links: d.drive_links || '', evidence_links: d.evidence_links || '', platform: d.platform || []
      };
    }
    return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// HỦY BÀI KHI CHƯA CÓ QUYẾT ĐỊNH (status new/reviewing) — CTV tự rút bài, không gửi nữa
// ============================================================
function handleCancelSubmission(p) {
  const d = p.data || p || {};
  if (!d.id) return { ok: false, error: 'Thiếu id bài viết' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
    const sheet = getSubmissionSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(d.id)) continue;
      if (String(rows[i][1]) !== String(d.user_id)) return { ok: false, error: 'Bạn không có quyền hủy bài này' };
      if (!['new', 'reviewing'].includes(String(rows[i][14]))) return { ok: false, error: 'Chỉ hủy được bài đang chờ duyệt (chưa có quyết định)' };
      const row = i + 1;
      sheet.getRange(row, 15).setValue('cancelled');
      return { ok: true, id: d.id, status: 'cancelled' };
    }
    return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// WORKFLOW DECISION DISPATCH
// ============================================================
// ============================================================
// XỬ LÝ QUYẾT ĐỊNH DUYỆT — dùng chung cho APPROVE / REJECT / REVISION
// (perf fix, 08/09→sau): trước đây mỗi hành động lấy khóa hệ thống
// 2 LẦN liên tiếp (1 lần trong handleWorkflowDecisionAction dù bài
// không chạy workflow nhiều bước, 1 lần nữa trong handleApprove/...)
// và trong lúc giữ khóa còn quét toàn bộ sheet SubmissionVersions +
// EmailQueue. Giờ gộp lại: 1 lần khóa, 1 lần đọc sheet, ghi bằng
// setValues() theo dải liền nhau thay vì nhiều setValue() rời. Các
// việc không tranh chấp với dòng Submissions (cập nhật lịch sử vòng
// gửi ở sheet khác, gửi email) được đưa RA NGOÀI vùng giữ khóa.
// ============================================================
function processDecision(p, action) {
  let outcome = null;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
    const sheet = getSubmissionSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(p.id)) continue;
      const row = i + 1;
      const now = new Date().toISOString();

      // Ưu tiên luồng workflow nhiều bước (song song/leo thang) nếu bài đang chạy workflow đó.
      const transition = applyWorkflowDecision(sheet, row, rows[i], p, action);
      if (transition.handled) {
        if (!transition.ok) { outcome = { ok: false, error: transition.error }; break; }
        const history = addHistory(rows[i][27], p.reviewer_name || p.reviewer_id, action, p.comment, p.score);
        sheet.getRange(row, 16, 1, 4).setValues([[p.comment || '', p.score || '', p.reviewer_name || p.reviewer_id || '', now]]);
        sheet.getRange(row, 28).setValue(history);
        const terminal = ['approved','rejected','revision'].includes(transition.status);
        outcome = {
          ok: true, status: transition.status, history, revisionNo: rows[i][19] || 1, reviewedAt: now,
          comment: p.comment || '', score: p.score || '', reviewerName: p.reviewer_name || p.reviewer_id || '',
          ctv: { email: rows[i][3], name: rows[i][2], title: rows[i][7] },
          nextStep: terminal ? null : activeWorkflowStep(transition.runtime),
          emailData: { user_name: rows[i][2], title: rows[i][7], content_type: rows[i][5], campus: rows[i][4], note: rows[i][9], platform: readJsonSafe(rows[i][36], []) },
          stepOrder: (transition.runtime.current_step_index || 0) + 1
        };
        break;
      }

      // Luồng đơn giản (manual_chain — bài không chạy workflow nhiều bước).
      const nextStatus = action; // 'approved' | 'rejected' | 'revision'
      const historyScore = action === 'approved' ? p.score : '';
      const history = addHistory(rows[i][27], p.reviewer_name, action, p.comment, historyScore);
      // Ghi đè lại đúng giá trị điểm cũ (cột 17) khi reject/revision để không đổi hành vi cũ
      // (bản gốc chỉ set điểm khi approve) — vẫn gộp được thành 1 dải liền nhau (15-19).
      const scoreValue = action === 'approved' ? (p.score || '') : rows[i][16];
      sheet.getRange(row, 15, 1, 5).setValues([[nextStatus, p.comment || '', scoreValue, p.reviewer_name || '', now]]);
      sheet.getRange(row, 28).setValue(history);
      outcome = {
        ok: true, status: nextStatus, history, revisionNo: rows[i][19] || 1, reviewedAt: now,
        comment: p.comment || '', score: scoreValue, reviewerName: p.reviewer_name || '',
        ctv: { email: rows[i][3], name: rows[i][2], title: rows[i][7] },
        nextStep: null, emailData: null, stepOrder: null
      };
      break;
    }
    if (!outcome) outcome = { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }

  if (!outcome.ok) return outcome;

  // Từ đây trở xuống KHÔNG cần giữ khóa Submissions — ghi vào sheet khác (SubmissionVersions,
  // EmailQueue), không tranh chấp với dòng vừa xử lý.
  updateLatestVersionReview(p.id, outcome.history, outcome.status);

  if (outcome.nextStep) {
    (outcome.nextStep.reviewers || []).filter(r => !(outcome.nextStep.decisions || []).some(d => String(d.user_id) === String(r.id))).forEach(reviewer => {
      sendReviewerEmail(reviewer.email, reviewer.name, outcome.emailData, p.id, outcome.nextStep.step_order || outcome.stepOrder, outcome.nextStep.reviewers.length);
    });
  } else if (['approved','rejected','revision'].includes(outcome.status)) {
    sendCTVEmail(outcome.ctv.email, outcome.ctv.name, outcome.ctv.title, outcome.status, outcome.comment, outcome.score, p.id, outcome.revisionNo);
  }

  // Trả kèm các trường vừa đổi để FE tự cập nhật đúng 1 dòng trong danh sách đang có,
  // không cần gọi lại get_submissions (quét lại toàn bộ sheet) sau mỗi lần duyệt.
  return {
    ok: true, id: p.id, status: outcome.status, comment: outcome.comment, score: outcome.score,
    reviewer_name: outcome.reviewerName, reviewed_at: outcome.reviewedAt, review_history: outcome.history
  };
}

// ============================================================
// APPROVE — Người duyệt duyệt luôn (không cần leo thang)
// Bài → approved, tất cả reviewer còn lại thấy ở "Tất cả bài"
// ============================================================
function handleApprove(p) { return processDecision(p, 'approved'); }

// ============================================================
// REJECT
// ============================================================
function handleReject(p) { return processDecision(p, 'rejected'); }

// ============================================================
// REQUEST REVISION
// ============================================================
function handleRevision(p) { return processDecision(p, 'revision'); }

// ============================================================
// WORKFLOW FORWARD
// ============================================================
function handleWorkflowForward(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
  const sheet = getSubmissionSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(p.id)) continue;
    const row = i + 1;
    const runtime = getRuntimeWorkflowFromRow(rows[i]);
    if (!runtime.steps.length || runtime.workflow_id === 'manual_chain' && !rows[i][32]) return null;
    const step = activeWorkflowStep(runtime);
    if (!step) return { ok: false, error: 'NO_ACTIVE_WORKFLOW_STEP' };
    const actorId = findActorForWorkflow(p, step, rows[i]);
    if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) return { ok: false, error: 'STALE_LOCK_VERSION' };
    if (!actorId || !(step.reviewer_ids || []).map(String).includes(String(actorId))) return { ok: false, error: 'NOT_ASSIGNED_REVIEWER' };
    if (runtime.current_step_index >= runtime.steps.length - 1) return { ok: false, error: 'NO_NEXT_STEP' };
    if ((step.decisions || []).some(d => String(d.user_id) === String(actorId))) return { ok: false, error: 'DUPLICATE_DECISION' };

    step.state = 'forwarded';
    step.decisions = step.decisions || [];
    step.decisions.push({ user_id: String(actorId), action: 'forwarded', comment: p.note || '', at: new Date().toISOString() });
    const history = addHistory(rows[i][27], p.forwarder_name || p.reviewer_name || actorId, 'forwarded', p.note || '', '');
    runtime.current_step_index += 1;
    const nextStep = activeWorkflowStep(runtime);
    if (nextStep) { nextStep.state = 'pending'; nextStep.started_at = new Date().toISOString(); }
    runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;
    persistWorkflowRuntime(sheet, row, rows[i], runtime, rows[i][19] || 1);
    sheet.getRange(row, 15).setValue('new');
    sheet.getRange(row, 28).setValue(history);
    updateLatestVersionReview(p.id, history, 'forwarded');
    const nextReviewer = firstPendingReviewer(nextStep || { reviewers: [] });
    if (nextReviewer) {
      const emailData = { user_name: rows[i][2], title: rows[i][7], content_type: rows[i][5], campus: rows[i][4], note: rows[i][9], platform: readJsonSafe(rows[i][36], []) };
      sendForwardEmail(nextReviewer.email, nextReviewer.name, emailData, p.id, p.forwarder_name || p.reviewer_name || actorId, runtime.current_step_index + 1, nextStep.reviewers.length);
    }
    return { ok: true, next_reviewer: nextReviewer || null, status: 'new' };
  }
  return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// FORWARD TO NEXT
// Người số 1 quyết định gửi lên người số 2
// Ghi lại vào review_history: "Người số 1 đã duyệt/xem xét và chuyển lên"
// ============================================================
function handleForwardToNext(p) {
  const workflowResult = handleWorkflowForward(p);
  if (workflowResult) return workflowResult;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
  const sheet = getSubmissionSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      const row = i + 1;
      const reviewers  = JSON.parse(rows[i][21] || '[]');
      const currentIdx = parseInt(rows[i][25]) || 0;
      const nextIdx    = currentIdx + 1;

      if (nextIdx >= reviewers.length) {
        return { ok: false, error: 'Không còn người duyệt tiếp theo.' };
      }

      const nextReviewer = reviewers[nextIdx];

      // Ghi lịch sử: người hiện tại đã xem xét và chuyển lên
      const history = addHistory(
        rows[i][27],
        p.forwarder_name,
        'forwarded',
        p.note || '',
        ''
      );

      sheet.getRange(row, 23).setValue(nextReviewer.id);
      sheet.getRange(row, 24).setValue(nextReviewer.name);
      sheet.getRange(row, 26).setValue(nextIdx);
      sheet.getRange(row, 15).setValue('new'); // reset về new để người tiếp theo thấy
      sheet.getRange(row, 28).setValue(history);
      updateLatestVersionReview(p.id, history);

      const subData = {
        user_name: rows[i][2], title: rows[i][7],
        content_type: rows[i][5], campus: rows[i][4], note: rows[i][9],
        platform: readJsonSafe(rows[i][36], [])
      };
      sendForwardEmail(
        nextReviewer.email, nextReviewer.name,
        subData, p.id, p.forwarder_name,
        nextIdx + 1, reviewers.length
      );
      return { ok: true, next_reviewer: nextReviewer };
    }
  }
  return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// CHANGE REVIEWER
// ============================================================
function handleChangeReviewer(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
    const sheet = getSubmissionSheet();
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(p.id)) {
        const row = i + 1;
        const runtime = getRuntimeWorkflowFromRow(rows[i]);
        if (runtime.steps.length && (runtime.workflow_id !== 'manual_chain' || rows[i][32])) {
          if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) return { ok: false, error: 'STALE_LOCK_VERSION' };
          const step = activeWorkflowStep(runtime);
          if (!step) return { ok: false, error: 'NO_ACTIVE_WORKFLOW_STEP' };
        const oldReviewer = firstPendingReviewer(step);
        const changer = getActiveUsers().find(u => String(u.id) === String(p.reviewer_id));
        if (p.reviewer_id && !(step.reviewer_ids || []).map(String).includes(String(p.reviewer_id)) && (!changer || changer.role !== 'manager')) return { ok: false, error: 'NOT_ASSIGNED_REVIEWER' };
        const replacement = getActiveUsers().find(u => String(u.id) === String(p.new_reviewer_id));
        if (!replacement) return { ok: false, error: 'REVIEWER_NOT_FOUND' };
        step.reviewer_ids = [String(replacement.id)];
        step.reviewers = [{ id: String(replacement.id), name: replacement.name, email: replacement.email }];
        step.decisions = [];
        step.state = 'pending';
        runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;
        const history = addHistory(rows[i][27], p.changed_by_name || p.reviewer_name || 'system', 'reviewer_changed', (oldReviewer ? oldReviewer.name : '') + ' → ' + replacement.name, '');
        persistWorkflowRuntime(sheet, row, rows[i], runtime, rows[i][19] || 1);
        sheet.getRange(row, 15).setValue('new');
        sheet.getRange(row, 28).setValue(history);
        updateLatestVersionReview(p.id, history, 'reviewer_changed');
        const subData = { user_name: rows[i][2], user_email: rows[i][3], title: rows[i][7], content_type: rows[i][5], campus: rows[i][4], audience: rows[i][6], note: rows[i][9], drive_links: rows[i][10], platform: readJsonSafe(rows[i][36], []) };
        sendReviewerEmail(replacement.email, replacement.name, subData, p.id, step.step_order || 1, (step.reviewers || []).length);
        return { ok: true, next_reviewer: replacement };
      }
      let reviewers    = JSON.parse(rows[i][21] || '[]');
      const currentIdx = parseInt(rows[i][25]) || 0;

      reviewers[currentIdx] = {
        id: p.new_reviewer_id,
        name: p.new_reviewer_name,
        email: p.new_reviewer_email,
        order: currentIdx + 1
      };

      sheet.getRange(row, 22).setValue(JSON.stringify(reviewers));
      sheet.getRange(row, 23).setValue(p.new_reviewer_id);
      sheet.getRange(row, 24).setValue(p.new_reviewer_name);
      sheet.getRange(row, 15).setValue('new');

      // L5: bổ sung đủ field để sendReviewerEmail không bị thiếu dữ liệu
      const subData = {
        user_name:    rows[i][2], user_email:   rows[i][3],
        title:        rows[i][7], content_type: rows[i][5],
        campus:       rows[i][4], audience:     rows[i][6],
        note:         rows[i][9], drive_links:  rows[i][10],
        platform:     readJsonSafe(rows[i][36], [])
      };
      sendReviewerEmail(
        p.new_reviewer_email, p.new_reviewer_name,
        subData, p.id, currentIdx + 1, reviewers.length
      );
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// SAVE INLINE COMMENTS — merge thay vì ghi đè (L4)
// ============================================================
function handleSaveInlineComments(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { ok: false, error: 'Hệ thống đang bận, vui lòng thử lại sau.' }; }
  try {
  const sheet = getSubmissionSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      // Frontend gửi toàn bộ danh sách hiện tại. Ghi đè thay vì merge để comment
      // đã bị xóa trên giao diện cũng được xóa thật khỏi Sheet.
      if (!Array.isArray(p.inline_comments)) {
        return { ok: false, error: 'inline_comments phải là một mảng' };
      }
      const currentComments = p.inline_comments;
      sheet.getRange(i + 1, 27).setValue(JSON.stringify(currentComments));
      updateLatestVersionComments(p.id, currentComments);
      return { ok: true, count: currentComments.length };
    }
  }
  return { ok: false, error: 'Không tìm thấy bài' };
  } finally { lock.releaseLock(); }
}

// ============================================================
// GET SUBMISSIONS
// Trả về bài theo role:
// - admin/manager: tất cả
// - leader: cơ sở mình + content chung
// - leader_content: cơ sở mình + content chung
// - ctv: bài của mình
// Thêm flag: in_my_queue (bài đang ở hàng chờ của mình)
// ============================================================
function isActiveWorkflowReviewer(submission, userId) {
  const runtime = readJsonSafe(submission.workflow_steps, null);
  if (!runtime || !Array.isArray(runtime.steps)) return String(submission.current_reviewer_id) === String(userId);
  const step = runtime.steps.find(s => String(s.step_id) === String(submission.current_step_id)) || runtime.steps[Number(submission.current_reviewer_index) || 0];
  return !!(step && Array.isArray(step.reviewer_ids) && step.reviewer_ids.map(String).includes(String(userId)));
}

function handleGetSubmissions(p) {
  const sheet = getSubmissionSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: [] };
  const headers = rows[0];

  const role   = p.role;
  const userId = p.user_id;
  const campus = p.campus;

  // Tối ưu (perf fix): CTV chỉ có vài bài trong số hàng nghìn dòng của cả hệ thống —
  // lọc theo user_id ngay trên mảng thô TRƯỚC khi dựng object cho từng dòng,
  // thay vì map hết 37 cột của TOÀN BỘ sheet rồi mới lọc. Các role khác (admin/
  // manager/leader/leader_content) cần xét theo workflow đang active nên vẫn
  // phải dựng object trước khi lọc được.
  const rawRows = (role === 'ctv')
    ? rows.slice(1).filter(r => String(r[1]) === String(userId))
    : rows.slice(1);
  let list = rawRows.map(r => rowToObj(headers, r));

  if (role !== 'ctv') {
    list = list.filter(s => {
      const assignedWorkflow = isActiveWorkflowReviewer(s, userId);
      if (role === 'admin')          return true;
      if (role === 'manager')        return true;
      if (role === 'leader')         return assignedWorkflow || s.campus === campus || s.is_shared === 'true';
      if (role === 'leader_content') {
        if (assignedWorkflow) return true;
        if (campus === 'chung') return true; // quản lý cả 2 cơ sở → thấy tất cả
        return s.campus === campus || (s.is_shared === 'true' && s.campus !== campus);
      }
      return false;
    });
  }

  // Đánh dấu bài nào đang trong hàng chờ của user hiện tại theo workflow step.
  list.forEach(s => {
    const runtime = readJsonSafe(s.workflow_steps, null);
    const steps = runtime && Array.isArray(runtime.steps) ? runtime.steps : [];
    const currentStep = steps.find(step => String(step.step_id) === String(s.current_step_id)) || steps[Number(s.current_reviewer_index) || 0];
    const activeReviewerIds = currentStep && Array.isArray(currentStep.reviewer_ids)
      ? currentStep.reviewer_ids.map(String)
      : (s.current_reviewer_id ? [String(s.current_reviewer_id)] : []);
    const decisions = currentStep && Array.isArray(currentStep.decisions) ? currentStep.decisions : [];
    const alreadyDecided = decisions.some(d => String(d.user_id) === String(userId));
    s.workflow_steps_parsed = steps;
    s.current_step = currentStep || null;
    s.current_reviewer_ids = activeReviewerIds;
    s.in_my_queue = activeReviewerIds.includes(String(userId)) && !alreadyDecided && !['approved','rejected','revision','cancelled'].includes(s.status);

    // Parse review_history để FE hiển thị
    try { s.review_history_parsed = JSON.parse(s.review_history || '[]'); }
    catch(e) { s.review_history_parsed = []; }
    try { s.platform_parsed = JSON.parse(s.platform || '[]'); }
    catch(e) { s.platform_parsed = []; }
  });

  list.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  return { ok: true, data: list };
}

// ============================================================
// GET REPORT
// ============================================================
function handleGetReport(p) {
  const sheet = getSubmissionSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, overview: {}, ctv_list: [] };
  const headers = rows[0];
  let list = rows.slice(1).map(r => rowToObj(headers, r));

  if (p.from) list = list.filter(s => new Date(s.submitted_at) >= new Date(p.from));
  if (p.to)   list = list.filter(s => new Date(s.submitted_at) <= new Date(p.to));
  if (p.campus && p.campus !== 'all') {
    list = list.filter(s => s.campus === p.campus || s.is_shared === 'true');
  }

  const ctvMap = {};
  list.forEach(s => {
    const key = s.user_id;
    if (!ctvMap[key]) {
      ctvMap[key] = {
        user_id: s.user_id, name: s.user_name, campus: s.campus,
        total: 0, approved: 0, revision: 0, rejected: 0, pending: 0,
        scores: [], total_score: 0
      };
    }
    ctvMap[key].total++;
    if (s.status === 'approved') {
      ctvMap[key].approved++;
      if (s.score) {
        const sc = parseFloat(s.score);
        if (!isNaN(sc)) { ctvMap[key].scores.push(sc); ctvMap[key].total_score += sc; }
      }
    }
    if (s.status === 'revision') ctvMap[key].revision++;
    if (s.status === 'rejected') ctvMap[key].rejected++;
    if (['new','reviewing'].includes(s.status)) ctvMap[key].pending++;
  });

  const ctvList = Object.values(ctvMap).map(c => {
    const approvalRate = c.total ? Math.round(c.approved / c.total * 100) : 0;
    const avgScore = c.scores.length ? Math.round(c.total_score / c.scores.length * 10) / 10 : 0;
    const finalScore = Math.round((approvalRate * 0.5 + avgScore * 5) * 10) / 10;
    return { ...c, approvalRate, avgScore, finalScore };
  });

  ctvList.sort((a, b) => b.finalScore - a.finalScore);
  ctvList.forEach((c, i) => c.rank = i + 1);

  const overview = {
    total: list.length,
    approved: list.filter(s => s.status === 'approved').length,
    revision: list.filter(s => s.status === 'revision').length,
    rejected: list.filter(s => s.status === 'rejected').length,
    pending:  list.filter(s => ['new','reviewing'].includes(s.status)).length,
    avg_approval_rate: ctvList.length
      ? Math.round(ctvList.reduce((s, c) => s + c.approvalRate, 0) / ctvList.length) : 0
  };

  return { ok: true, overview, ctv_list: ctvList, period: { from: p.from, to: p.to } };
}

// ============================================================
// RULES
// ============================================================
function handleGetRules() {
  return getCached('rules_v1', 180, () => {
    const sheet = getSheet('Rules');
    const rows  = sheet.getDataRange().getValues();
    const rules = { banned_words: [], required_elements: [], brand_voice: '', logo_rules: '', history: [] };
    rows.slice(1).forEach(r => {
      const [type, value, category, date] = r;
      if (type === 'banned')      rules.banned_words.push({ text: value, type: category, date });
      if (type === 'required')    rules.required_elements.push(value);
      if (type === 'brand_voice') rules.brand_voice = value;
      if (type === 'logo_rules')  rules.logo_rules  = value;
      if (type === 'history')     rules.history.push({ action: value, date });
    });
    return { ok: true, rules };
  });
}

function handleSaveRules(p) {
  const sheet = getSheet('Rules');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  const r = p.rules;
  (r.banned_words || []).forEach(w =>
    sheet.appendRow(['banned', w.text, w.type, new Date().toISOString()]));
  (r.required_elements || []).forEach(e =>
    sheet.appendRow(['required', e, '', new Date().toISOString()]));
  if (r.brand_voice) sheet.appendRow(['brand_voice', r.brand_voice, '', new Date().toISOString()]);
  if (r.logo_rules)  sheet.appendRow(['logo_rules',  r.logo_rules,  '', new Date().toISOString()]);
  (r.history || []).forEach(h =>
    sheet.appendRow(['history', h.action, '', h.date]));
  invalidateCache('rules_v1');
  return { ok: true };
}

// ============================================================
// USERS
// ============================================================
function handleGetUsers() {
  return getCached('users_v1', 180, () => {
    const sheet = getSheet('Users');
    const rows  = sheet.getDataRange().getValues();
    const headers = rows[0];
    const users = rows.slice(1).map(r => {
      const u = rowToObj(headers, r);
      delete u.password;
      return u;
    });
    return { ok: true, users };
  });
}

function handleAddUser(p) {
  const sheet = getSheet('Users');
  const id = 'USR_' + Date.now();
  sheet.appendRow([
    id, p.email, p.password, p.name,
    p.role, p.campus, true,
    new Date().toISOString(), ''
  ]);
  try {
    GmailApp.sendEmail(
      p.email,
      'Tài khoản ' + APP_NAME,
      'Chào ' + p.name + ',\n\nTài khoản của bạn đã được tạo.\nEmail: ' + p.email + '\nMật khẩu: ' + p.password + '\n\nTrân trọng,\n' + APP_NAME
    );
  } catch(e) {}
  invalidateCache('users_v1');
  return { ok: true, id };
}

function handleUpdateUser(p) {
  const sheet = getSheet('Users');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      const row = i + 1;
      if (p.name)   sheet.getRange(row, 4).setValue(p.name);
      if (p.email)  sheet.getRange(row, 2).setValue(p.email);
      if (p.role)   sheet.getRange(row, 5).setValue(p.role);
      if (p.campus !== undefined) sheet.getRange(row, 6).setValue(p.campus);
      if (p.password) {
        sheet.getRange(row, 3).setValue(p.password);
        const emailTo = p.email || rows[i][1];
        const nameTo  = p.name || rows[i][3];
        try {
          GmailApp.sendEmail(
            emailTo,
            'Mật khẩu mới - ' + APP_NAME,
            'Chào ' + nameTo + ',\n\nMật khẩu tài khoản của bạn vừa được đổi.\nEmail: ' + emailTo + '\nMật khẩu mới: ' + p.password + '\n\nTrân trọng,\n' + APP_NAME
          );
        } catch(e) {}
      }
      invalidateCache('users_v1');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy user' };
}

function handleDeleteUser(p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const sheet = getSheet('Users');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      sheet.deleteRow(i + 1);
      invalidateCache('users_v1');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy user' };
}

// ============================================================
// DRAFT SYNC + SUBMISSION VERSIONS
// ============================================================
const DRAFT_HEADERS = ['id','user_id','user_name','payload_json','created_at','updated_at'];
const VERSION_HEADERS = ['id','submission_id','revision_no','user_id','user_name','title','content','note','drive_links','evidence_links','reviewers','inline_comments','review_history','submitted_at','status','updated_at','platform'];

function ensureHeadersOnSheet(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0eeea');
    sheet.setFrozenRows(1);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  headers.forEach(header => {
    if (!existing.includes(String(header))) {
      const nextColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextColumn).setValue(header).setFontWeight('bold').setBackground('#f0eeea');
      existing.push(String(header));
    }
  });
}

function getSheetWithHeaders(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreate(ss, name);
  ensureHeadersOnSheet(sheet, headers);
  return sheet;
}

function getSubmissionSheet() {
  const sheet = getSheet('Submissions');
  ensureHeadersOnSheet(sheet, SUBMISSIONS_BASE_HEADERS.concat(SUBMISSION_WORKFLOW_HEADERS).concat(SUBMISSIONS_EXTRA_HEADERS));
  return sheet;
}

function handleSaveDraft(p) {
  const d = p.draft || {};
  if (!p.user_id || !d.id) return { ok: false, error: 'Thiếu user_id hoặc draft id' };
  const sheet = getSheetWithHeaders('Drafts', DRAFT_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  const payload = JSON.stringify(d);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(d.id) && String(rows[i][1]) === String(p.user_id)) {
      const storedAt = new Date(rows[i][5] || 0).getTime();
      const incomingAt = new Date(d.updated_at || now).getTime();
      if (storedAt && incomingAt && incomingAt < storedAt) {
        return { ok: true, id: d.id, updated_at: rows[i][5], ignored_stale: true };
      }
      const savedAt = d.updated_at || now;
      sheet.getRange(i + 1, 4).setValue(payload);
      sheet.getRange(i + 1, 6).setValue(savedAt);
      return { ok: true, id: d.id, updated_at: savedAt };
    }
  }
  const savedAt = d.updated_at || now;
  sheet.appendRow([d.id, p.user_id, p.user_name || '', payload, d.created_at || savedAt, savedAt]);
  return { ok: true, id: d.id, updated_at: savedAt };
}

function handleGetDrafts(p) {
  if (!p.user_id) return { ok: false, error: 'Thiếu user_id' };
  const sheet = getSheetWithHeaders('Drafts', DRAFT_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const drafts = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(p.user_id)) continue;
    try {
      const draft = JSON.parse(rows[i][3] || '{}');
      draft.id = draft.id || rows[i][0];
      draft.created_at = draft.created_at || rows[i][4];
      draft.updated_at = rows[i][5] || draft.updated_at;
      drafts.push(draft);
    } catch(e) {}
  }
  drafts.sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return { ok: true, drafts: drafts.slice(0, 50) };
}

function handleDeleteDraft(p) {
  if (!p.user_id || !p.id) return { ok: false, error: 'Thiếu user_id hoặc draft id' };
  const sheet = getSheetWithHeaders('Drafts', DRAFT_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id) && String(rows[i][1]) === String(p.user_id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy draft' };
}

function ensureSubmissionVersionForRow(rowData) {
  if (!rowData || !rowData[0]) return;
  const revisionNo = Number(rowData[19]) || 1;
  saveSubmissionVersion(rowData[0], revisionNo, {
    submission_id: rowData[0], user_id: rowData[1], user_name: rowData[2],
    title: rowData[7], content: rowData[8], note: rowData[9],
    drive_links: rowData[10], evidence_links: rowData[29], reviewers: rowData[21],
    inline_comments: rowData[26] || '[]', review_history: rowData[27] || '[]',
    platform: rowData[36] || '[]',
    submitted_at: rowData[13], status: rowData[14]
  });
}

function saveSubmissionVersion(submissionId, revisionNo, source) {
  if (!submissionId) return;
  const sheet = getSheetWithHeaders('SubmissionVersions', VERSION_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const id = String(submissionId) + '_v' + String(revisionNo || 1);
  const reviewers = Array.isArray(source.reviewers) ? JSON.stringify(source.reviewers) : (source.reviewers || '[]');
  const platform = Array.isArray(source.platform) ? JSON.stringify(source.platform) : (source.platform || '[]');
  const values = [
    id,
    submissionId,
    revisionNo || 1,
    source.user_id || '',
    source.user_name || '',
    source.title || '',
    source.content || '',
    source.note || '',
    source.drive_links || '',
    source.evidence_links || '',
    reviewers,
    source.inline_comments || '[]',
    source.review_history || '[]',
    source.submitted_at || new Date().toISOString(),
    source.status || 'new',
    new Date().toISOString(),
    platform
  ];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      sheet.getRange(i + 1, 1, 1, values.length).setValues([values]);
      return;
    }
  }
  sheet.appendRow(values);
}

function updateLatestVersionComments(submissionId, comments) {
  const sheet = getSheetWithHeaders('SubmissionVersions', VERSION_HEADERS);
  const rows = sheet.getDataRange().getValues();
  let latestRow = -1;
  let latestRevision = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(submissionId) && Number(rows[i][2]) >= latestRevision) {
      latestRevision = Number(rows[i][2]);
      latestRow = i + 1;
    }
  }
  if (latestRow > 0) {
    sheet.getRange(latestRow, 12).setValue(JSON.stringify(comments || []));
    sheet.getRange(latestRow, 16).setValue(new Date().toISOString());
  }
}

function updateLatestVersionReview(submissionId, reviewHistory, status) {
  const sheet = getSheetWithHeaders('SubmissionVersions', VERSION_HEADERS);
  const rows = sheet.getDataRange().getValues();
  let latestRow = -1;
  let latestRevision = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(submissionId) && Number(rows[i][2]) >= latestRevision) {
      latestRevision = Number(rows[i][2]);
      latestRow = i + 1;
    }
  }
  if (latestRow > 0) {
    sheet.getRange(latestRow, 13).setValue(reviewHistory || '[]');
    sheet.getRange(latestRow, 15).setValue(status || 'reviewed');
    sheet.getRange(latestRow, 16).setValue(new Date().toISOString());
  }
}

function handleGetSubmissionVersions(p) {
  if (!p.id) return { ok: false, error: 'Thiếu submission id' };
  const sheet = getSheetWithHeaders('SubmissionVersions', VERSION_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const versions = rows.slice(1)
    .filter(r => String(r[1]) === String(p.id))
    .map(r => rowToObj(headers, r));
  // Dữ liệu cũ trước khi có SubmissionVersions vẫn xem được ở mức tối thiểu.
  if (!versions.length) {
    const subSheet = getSubmissionSheet();
    const subRows = subSheet.getDataRange().getValues();
    for (let i = 1; i < subRows.length; i++) {
      if (String(subRows[i][0]) === String(p.id)) {
        versions.push({
          id: String(p.id) + '_legacy', submission_id: p.id,
          revision_no: Number(subRows[i][19]) || 1,
          user_id: subRows[i][1], user_name: subRows[i][2],
          title: subRows[i][7], content: subRows[i][8], note: subRows[i][9],
          drive_links: subRows[i][10], evidence_links: subRows[i][29],
          reviewers: subRows[i][21], inline_comments: subRows[i][26],
          review_history: subRows[i][27], submitted_at: subRows[i][13],
          status: subRows[i][14], updated_at: subRows[i][13], platform: subRows[i][36] || '[]'
        });
        break;
      }
    }
  }
  versions.sort((a,b) => Number(a.revision_no || 0) - Number(b.revision_no || 0));
  versions.forEach(v => {
    try { v.inline_comments_parsed = JSON.parse(v.inline_comments || '[]'); } catch(e) { v.inline_comments_parsed = []; }
    try { v.review_history_parsed = JSON.parse(v.review_history || '[]'); } catch(e) { v.review_history_parsed = []; }
    try { v.platform_parsed = JSON.parse(v.platform || '[]'); } catch(e) { v.platform_parsed = []; }
  });
  return { ok: true, versions };
}

// ============================================================
// EMAIL
// ============================================================
// Trang đích theo vai trò: ctv/leader_content xem & duyệt ở ctv.html,
// leader/manager/admin ở boss.html.
function fileForRole(role) {
  return (role === 'ctv' || role === 'leader_content') ? 'ctv.html' : 'boss.html';
}

// Tìm vai trò của người nhận theo email để build đúng link mở bài.
// Nếu không tìm thấy (email lạ/đã xoá), mặc định trỏ về ctv.html.
function buildOpenLink(email, submissionId) {
  if (!submissionId) return APP_URL;
  let role = 'ctv';
  try {
    const users = getActiveUsers();
    const u = users.find(x => String(x.email).toLowerCase() === String(email || '').toLowerCase());
    if (u) role = u.role;
  } catch (e) {}
  return String(APP_URL).replace(/\/$/, '') + '/' + fileForRole(role) + '?open=' + encodeURIComponent(String(submissionId));
}

function emailHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
}

function openButtonHtml(link, label) {
  const safeLink = emailHtml(link);
  return '<p style="margin:20px 0"><a href="' + safeLink + '" style="display:inline-block;background:#F26522;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600">' + emailHtml(label || 'Mở bài cần duyệt') + '</a></p>' +
    '<p style="font-size:12px;color:#666">Nếu nút không hoạt động, sao chép đường dẫn sau vào trình duyệt:<br><a href="' + safeLink + '">' + safeLink + '</a></p>';
}

function sendReviewerEmail(email, name, d, id, orderNum, totalReviewers) {
  const campusMap = { hoa_lac: 'FSC Hòa Lạc', tay_hn: 'FSC Tây HN', chung: 'Cả 2' };
  const subject = '[Duyệt bài] ' + d.user_name + ': ' + d.title;
  const platformTxt = Array.isArray(d.platform) ? d.platform.join(', ') : '';
  const body =
    'Chào ' + name + ',\n\n' +
    d.user_name + ' vừa gửi bài cần bạn duyệt.\n\n' +
    'Tiêu đề  : ' + d.title + '\n' +
    'Loại     : ' + (d.content_type || '') + '\n' +
    (platformTxt ? 'Nền tảng : ' + platformTxt + '\n' : '') +
    'Cơ sở    : ' + (campusMap[d.campus] || d.campus || '') + '\n' +
    'Ghi chú  : ' + (d.note || '(không có)') + '\n\n' +
    'Bạn có thể duyệt luôn hoặc chuyển lên người duyệt tiếp theo nếu cần.\n\n' +
    'Bấm vào đây để mở bài: ' + buildOpenLink(email, id) + '\n\n' + APP_NAME;
  const link = buildOpenLink(email, id);
  const htmlBody = '<p>Chào ' + emailHtml(name) + ',</p>' +
    '<p><b>' + emailHtml(d.user_name) + '</b> vừa gửi bài cần bạn duyệt.</p>' +
    '<p><b>Tiêu đề:</b> ' + emailHtml(d.title) + '<br><b>Loại:</b> ' + emailHtml(d.content_type || '') + '<br><b>Cơ sở:</b> ' + emailHtml(campusMap[d.campus] || d.campus || '') + '<br><b>Ghi chú:</b> ' + emailHtml(d.note || '(không có)') + '</p>' +
    '<p>Bạn có thể duyệt luôn hoặc chuyển lên người duyệt tiếp theo.</p>' + openButtonHtml(link, 'Mở bài cần duyệt') + '<p>' + emailHtml(APP_NAME) + '</p>';
  return enqueueEmail(email, name, subject, body, htmlBody, 'reviewer:' + id + ':' + String(d.send_count || 1) + ':' + String(orderNum || 1) + ':' + String(email));
}

function sendForwardEmail(email, name, d, id, forwarderName, orderNum, totalReviewers) {
  const campusMap = { hoa_lac: 'FSC Hòa Lạc', tay_hn: 'FSC Tây HN', chung: 'Cả 2' };
  const subject = '[Chuyển duyệt] ' + forwarderName + ' → bạn: ' + d.title;
  const platformTxt = Array.isArray(d.platform) ? d.platform.join(', ') : '';
  const body =
    'Chào ' + name + ',\n\n' +
    forwarderName + ' vừa chuyển bài "' + d.title + '" lên để bạn duyệt.\n\n' +
    'Tiêu đề  : ' + d.title + '\n' +
    'Loại     : ' + (d.content_type || '') + '\n' +
    (platformTxt ? 'Nền tảng : ' + platformTxt + '\n' : '') +
    'Cơ sở    : ' + (campusMap[d.campus] || d.campus || '') + '\n\n' +
    'Bấm vào đây để mở bài: ' + buildOpenLink(email, id) + '\n\n' + APP_NAME;
  const link = buildOpenLink(email, id);
  const htmlBody = '<p>Chào ' + emailHtml(name) + ',</p>' +
    '<p>' + emailHtml(forwarderName) + ' vừa chuyển bài <b>' + emailHtml(d.title) + '</b> lên để bạn duyệt.</p>' +
    '<p><b>Người gửi:</b> ' + emailHtml(d.user_name) + '<br><b>Loại:</b> ' + emailHtml(d.content_type || '') + '<br><b>Cơ sở:</b> ' + emailHtml(campusMap[d.campus] || d.campus || '') + '</p>' +
    openButtonHtml(link, 'Mở bài được chuyển duyệt') + '<p>' + emailHtml(APP_NAME) + '</p>';
  return enqueueEmail(email, name, subject, body, htmlBody, 'forward:' + id + ':' + String(d.send_count || 1) + ':' + String(orderNum || 1) + ':' + String(email));
}

function sendCTVEmail(email, name, title, status, comment, score, id, revisionNo) {
  const lbl = { approved: '✅ ĐÃ DUYỆT', revision: '🔁 CẦN SỬA', rejected: '❌ TỪ CHỐI' };
  const subject = '[Kết quả] ' + (lbl[status] || status) + ' — "' + title + '"';
  const link = id ? (String(APP_URL).replace(/\/$/, '') + '/ctv.html?open=' + encodeURIComponent(String(id))) : '';
  const body =
    'Chào ' + name + ',\n\n' +
    'Bài "' + title + '" vừa được xem xét.\n\n' +
    'Kết quả : ' + (lbl[status] || status) + '\n' +
    (score ? 'Điểm    : ' + score + '/10\n' : '') +
    'Nhận xét: ' + (comment || '(không có)') + '\n\n' +
    (link ? 'Bấm vào đây để mở bài: ' + link + '\n\n' : '') +
    'Trân trọng,\n' + APP_NAME;
  const htmlBody = '<p>Chào ' + emailHtml(name) + ',</p>' +
    '<p>Bài <b>' + emailHtml(title) + '</b> vừa được xem xét.</p>' +
    '<p><b>Kết quả:</b> ' + emailHtml(lbl[status] || status) + (score ? '<br><b>Điểm:</b> ' + emailHtml(score) + '/10' : '') + '<br><b>Nhận xét:</b> ' + emailHtml(comment || '(không có)') + '</p>' +
    (link ? openButtonHtml(link, 'Mở bài của tôi') : '') + '<p>Trân trọng,<br>' + emailHtml(APP_NAME) + '</p>';
  return enqueueEmail(email, name, subject, body, htmlBody, 'ctv:' + id + ':' + String(revisionNo || 1) + ':' + String(status));
}

// ============================================================
// HELPERS
// ============================================================
function asBoolean(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function addHistory(rawJson, reviewerName, action, comment, score) {
  let history = [];
  try { history = JSON.parse(rawJson || '[]'); } catch(e) {}
  history.push({
    reviewer: reviewerName,
    action,
    comment: comment || '',
    score: score || '',
    at: new Date().toISOString()
  });
  return JSON.stringify(history);
}

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}
function getOrCreate(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}
function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SETUP — Chạy 1 lần
// ============================================================
// ============================================================
// AI PROXY — gọi OpenAI từ server-side (tránh CORS + bảo mật key)
// ============================================================
function callOpenAI(prompt) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 900,
    temperature: 0.3
  });
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
    payload: payload,
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(resp.getContentText());
  if (json.error) throw new Error(json.error.message || 'OpenAI error');
  return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
}

function handleAiCheckContent(p) {
  var aiContext = buildAiRulesContext();
  var rules = aiContext.rules;
  var bannedList = aiContext.bannedList;
  var voice = rules.brand_voice || 'Chuyên nghiệp, gần gũi, có CTA rõ ràng';
  var req   = (rules.required_elements || []).join(', ') || 'CTA rõ ràng';
  var fullText = ((p.title || '') + ' ' + (p.content || '')).toLowerCase();

  // Kiểm tra từ cấm bằng code — không để AI tự phán
  var foundBanned = [];
  bannedList.forEach(function(w) {
    if (w && fullText.indexOf(w.toLowerCase()) !== -1) foundBanned.push(w);
  });
  var hasBanned = foundBanned.length > 0;

  var bannedNote = hasBanned
    ? ' Hệ thống đã xác định bài chứa từ cấm: [' + foundBanned.join(', ') + ']. Điểm chinh_xac PHẢI <=4, verdict PHẢI là CAN_SUA hoặc TU_CHOI, ghi nhận từ cấm vào issues.'
    : ' Hệ thống xác nhận bài KHÔNG chứa từ cấm nào. Tuyệt đối KHÔNG đề cập từ cấm trong issues.';

  var sys = 'Bạn là chuyên gia kiểm duyệt content FPT Schools.' +
    ' Phong cách thương hiệu: ' + voice + '. Yếu tố bắt buộc: ' + req + '.' +
    bannedNote +
    ' Phản hồi KHÔNG dùng markdown, KHÔNG dùng **, chỉ text thuần.' +
    ' Trả về JSON DUY NHẤT không có text khác:' +
    ' {"verdict":"DUYET hoac CAN_SUA hoac TU_CHOI","scores":{"giong_van":0-10,"cta":0-10,"chinh_xac":0-10,"phu_hop":0-10}' +
    ',"positives":["nhan xet diem tot cu the bang tieng Viet"]' +
    ',"issues":["nhan xet diem can sua cu the bang tieng Viet"]' +
    ',"suggestion":"goi y sua cu the bang text thuan tieng Viet"}';

  sys += '\n\n' + aiContext.promptText;

  var prompt = sys +
    '\n\nLoại: ' + (p.content_type || '') + '\nĐối tượng: ' + (p.audience || '') +
    '\n\nTIÊU ĐỀ: ' + (p.title || '') + '\n\nNỘI DUNG:\n' + (p.content || '');

  var raw = callOpenAI(prompt);
  var r = null;
  try {
    r = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (r && r.verdict) {
      r.verdict = r.verdict.replace('DUYET','DUYỆT').replace('CAN_SUA','CẦN SỬA').replace('TU_CHOI','TỪ CHỐI');
    }
    if (r && hasBanned) {
      r.scores = r.scores || {};
      if (!r.scores.chinh_xac || r.scores.chinh_xac > 4) r.scores.chinh_xac = 3;
      if (r.verdict === 'DUYỆT') r.verdict = 'CẦN SỬA';
      var issues = r.issues || [];
      var alreadyHas = issues.some(function(i){ return i.toLowerCase().indexOf('cấm') !== -1; });
      if (!alreadyHas) issues.unshift('Từ cấm: ' + foundBanned.join(', '));
      r.issues = issues;
    }
  } catch(e) {}
  return { ok: true, result: r, raw: raw };
}

function handleAiSuggestReview(p) {
  // p.title, p.content, p.content_type, p.persona (optional)
  var aiContext = buildAiRulesContext();
  var sysPrompt = 'Bạn hỗ trợ người duyệt bài content FPT Schools. Đọc bài, viết nhận xét ngắn 3-4 câu: điểm tốt, điểm cần sửa cụ thể, hướng chỉnh. Tiếng Việt, KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần.';
  sysPrompt += '\n\n' + aiContext.promptText + '\nƯu tiên phát hiện và nêu rõ các điểm vi phạm quy tắc Admin trong nhận xét. Không tự bỏ qua từ cấm hoặc yếu tố bắt buộc.';
  if (p.persona) sysPrompt += '\n\nPhong cách và tiêu chí của người duyệt:\n' + p.persona;

  var prompt = sysPrompt + '\n\nBài: ' + (p.title || '') + '\nLoại: ' + (p.content_type || '') + '\n\n' + (p.content || '');
  var sug = callOpenAI(prompt);
  return { ok: true, suggestion: sug };
}

// ============================================================
// AI CHECK BRAND GUIDE — chấm điểm ảnh thiết kế (màu, logo, font, bố cục)
// Dùng GPT-4o-mini vision. Chuẩn đối chiếu: brand_voice + required_elements
// trong tab Rules — hệ thống CHƯA có brand guide hình ảnh chính thức, nên
// kết quả chỉ là tham khảo, không thay thế người duyệt.
// ============================================================
function handleAiCheckBrandImage(p) {
  var fileId = p.file_id;
  if (!fileId) return { ok: false, error: 'Thiếu file_id' };

  var aiContext = buildAiRulesContext();
  var rules = aiContext.rules;
  var voice = rules.brand_voice || '';
  var req   = (rules.required_elements || []).join(', ');

  var imageGuides = aiContext.imageGuides;
  var hasImageGuides = imageGuides.length > 0;

  var sys = 'Bạn là chuyên gia kiểm tra brand guideline cho FPT Schools.' +
    ' Nhiệm vụ: nhìn ảnh thiết kế (banner/poster/social post) và đánh giá xem có đúng chuẩn thương hiệu không.' +
    (voice ? (' Phong cách thương hiệu mô tả: ' + voice + '.') : '') +
    (req   ? (' Yếu tố bắt buộc: ' + req + '.') : '') +
    (rules.logo_rules ? (' Quy tắc logo và nhận diện bắt buộc: ' + rules.logo_rules + '.') : '') +
    (hasImageGuides
      ? ' Ảnh ĐẦU TIÊN trong tin nhắn là bài cần chấm. Các ảnh SAU đó là ảnh brand guide chính thức từ HO (mẫu chuẩn) — hãy đối chiếu trực tiếp màu sắc, logo, font chữ, bố cục của ảnh cần chấm với các ảnh mẫu này, ưu tiên đối chiếu trực tiếp thay vì suy đoán chung.'
      : ' Lưu ý: hệ thống hiện CHƯA có brand guide hình ảnh chính thức (chưa có mã màu hex cụ thể, chưa có logo mẫu, chưa có font chuẩn được nạp sẵn) —' +
        ' bạn chỉ có thể suy luận dựa trên mô tả phong cách thương hiệu nói trên và kiến thức chung về thiết kế nhận diện trường học/giáo dục tại Việt Nam (tông màu FPT thường dùng cam/xanh dương/xanh lá, phong cách chuyên nghiệp, rõ ràng).') +
    ' Đánh giá 4 mục: mau_sac (màu sắc có hài hoà, có dùng tông thương hiệu hợp lý không), logo (có logo/nhận diện rõ ràng, đúng vị trí, không bị che/méo không), font_chu (font có dễ đọc, nhất quán, chuyên nghiệp không), bo_cuc (bố cục có cân đối, rõ thông tin chính, không rối không).' +
    ' Với mỗi mục, trả "dat" nếu đạt yêu cầu cơ bản, "chua_dat" nếu có vấn đề rõ ràng, "khong_chac" nếu không đủ căn cứ để kết luận (ví dụ không có brand guide chi tiết để so sánh màu chính xác).' +
    ' Phản hồi KHÔNG dùng markdown, chỉ text thuần. Trả về JSON DUY NHẤT, không kèm text khác:' +
    ' {"mau_sac":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"logo":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"font_chu":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"bo_cuc":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"luu_y":"1 câu nhắc rằng đây là đánh giá tham khảo' + (hasImageGuides ? ', đã đối chiếu với brand guide chính thức từ HO' : ' do chưa có brand guide hình ảnh chính thức') + '"}';

  var imageUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
  var contentArr = [
    { type: 'text', text: sys },
    { type: 'image_url', image_url: { url: imageUrl } }
  ];
  imageGuides.forEach(function(g) {
    contentArr.push({ type: 'image_url', image_url: { url: 'https://drive.google.com/thumbnail?id=' + g.file_id + '&sz=w1000' } });
  });

  var url = 'https://api.openai.com/v1/chat/completions';
  var payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: contentArr
    }],
    max_tokens: 700,
    temperature: 0.3
  });
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
    payload: payload,
    muteHttpExceptions: true
  };
  var resp = UrlFetchApp.fetch(url, options);
  var json = JSON.parse(resp.getContentText());
  if (json.error) return { ok: false, error: json.error.message || 'OpenAI error' };
  var raw = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';

  var result = null;
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch(e) {}
  return { ok: true, result: result, raw: raw };
}

// ============================================================
// AI CHAT — multi-turn conversation
// ============================================================
function getPersonaContent(reviewerName) {
  // Đọc phong cách người duyệt từ Sheet Personas — lọc đúng theo tên người duyệt hiện tại,
  // không gộp toàn bộ phong cách của mọi người vào 1 prompt như trước
  if (!reviewerName) return '';
  try {
    const sheet = getSheet('Personas');
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === reviewerName && rows[i][1]) return String(rows[i][1]);
    }
  } catch(e) {}
  return '';
}

function handleGetPersonas() {
  const sheet = getSheet('Personas');
  const rows  = sheet.getDataRange().getValues();
  const personas = rows.slice(1)
    .filter(r => r[0])
    .map(r => ({ name: r[0], content: r[1] || '', updated_at: r[2] || '' }));
  return { ok: true, personas };
}

function handleSavePersona(p) {
  if (!p.name || !p.content) return { ok: false, error: 'Thiếu tên người duyệt hoặc nội dung' };
  const sheet = getSheet('Personas');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.name) {
      sheet.getRange(i + 1, 2).setValue(p.content);
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return { ok: true };
    }
  }
  sheet.appendRow([p.name, p.content, new Date().toISOString()]);
  return { ok: true };
}

function handleDeletePersona(p) {
  if (!p.name) return { ok: false, error: 'Thiếu tên người duyệt' };
  const sheet = getSheet('Personas');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.name) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy persona' };
}

// ============================================================
// BRAND GUIDE (HO cập nhật) — sheet riêng "BrandGuides"
// Cột: id, name, type ('text'|'image'), content (text: nội dung .md; image: Drive file id), mime_type, updated_at
// - Loại 'text': nội dung .md được ghép vào prompt của ai_check_content (kiểm duyệt chữ)
// - Loại 'image': ảnh mẫu chính thức, lưu trên Drive, dùng làm ảnh tham chiếu cho ai_check_brand_image (AI vision)
// ============================================================
function handleGetBrandGuides() {
  const sheet = getSheet('BrandGuides');
  const rows  = sheet.getDataRange().getValues();
  const guides = rows.slice(1).filter(r => r[0]).map(r => ({
    id: r[0], name: r[1], type: r[2],
    content: r[2] === 'text' ? r[3] : '',
    file_id: r[2] === 'image' ? r[3] : '',
    mime_type: r[4] || '',
    updated_at: r[5] || ''
  }));
  return { ok: true, guides };
}

function handleSaveBrandGuideText(p) {
  if (!p.name || !p.content) return { ok: false, error: 'Thiếu tên hoặc nội dung' };
  const sheet = getSheet('BrandGuides');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === p.name && rows[i][2] === 'text') {
      sheet.getRange(i + 1, 4).setValue(p.content);
      sheet.getRange(i + 1, 6).setValue(new Date().toISOString());
      return { ok: true };
    }
  }
  const id = 'BG_' + Date.now();
  sheet.appendRow([id, p.name, 'text', p.content, '', new Date().toISOString()]);
  return { ok: true, id: id };
}

function handleSaveBrandGuideImage(p) {
  if (!p.name || !p.image_base64) return { ok: false, error: 'Thiếu tên hoặc ảnh' };
  try {
    const mime  = p.mime_type || 'image/png';
    const bytes = Utilities.base64Decode(p.image_base64);
    const blob  = Utilities.newBlob(bytes, mime, p.name);
    const file  = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const sheet = getSheet('BrandGuides');
    const id = 'BG_' + Date.now();
    sheet.appendRow([id, p.name, 'image', file.getId(), mime, new Date().toISOString()]);
    return { ok: true, id: id, file_id: file.getId() };
  } catch(e) {
    return { ok: false, error: 'Lỗi tải ảnh lên Drive: ' + e.toString() };
  }
}

function handleDeleteBrandGuide(p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const sheet = getSheet('BrandGuides');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      if (rows[i][2] === 'image' && rows[i][3]) {
        try { DriveApp.getFileById(rows[i][3]).setTrashed(true); } catch(e) {}
      }
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy' };
}

// Ghép nội dung tất cả brand guide dạng text — dùng cho ai_check_content
function getTextBrandGuides() {
  try {
    const sheet = getSheet('BrandGuides');
    const rows  = sheet.getDataRange().getValues();
    let result = '';
    rows.slice(1).forEach(function(r) {
      if (r[2] === 'text' && r[3]) result += '\n\n--- Brand guide: ' + (r[1] || '') + ' ---\n' + r[3];
    });
    return result;
  } catch(e) { return ''; }
}

// Danh sách brand guide dạng ảnh — dùng cho ai_check_brand_image
function getImageBrandGuides() {
  try {
    const sheet = getSheet('BrandGuides');
    const rows  = sheet.getDataRange().getValues();
    return rows.slice(1).filter(function(r){ return r[2] === 'image' && r[3]; })
      .map(function(r){ return { name: r[1], file_id: r[3] }; });
  } catch(e) { return []; }
}

// Gom toàn bộ cấu hình kiểm duyệt do Admin quản lý thành một nguồn duy nhất.
// AI luôn đọc trực tiếp từ Sheet Rules/BrandGuides, không phụ thuộc frontend có
// truyền thiếu rules hay không.
function buildAiRulesContext() {
  let rules = { banned_words: [], required_elements: [], brand_voice: '', logo_rules: '', history: [] };
  try {
    const result = handleGetRules();
    if (result && result.rules) rules = result.rules;
  } catch(e) {}

  const bannedList = (rules.banned_words || [])
    .map(w => typeof w === 'object' ? w.text : w)
    .filter(Boolean);
  const required = (rules.required_elements || []).filter(Boolean);
  const brandGuideText = getTextBrandGuides();
  const imageGuides = getImageBrandGuides();
  const sections = [
    '=== QUY TẮC KIỂM DUYỆT DO ADMIN CÀI ĐẶT ===',
    'Giọng thương hiệu: ' + (rules.brand_voice || '(chưa cài đặt)'),
    'Yếu tố bắt buộc: ' + (required.length ? required.join('; ') : '(chưa cài đặt)'),
    'Từ/ngữ không được dùng: ' + (bannedList.length ? bannedList.join(', ') : '(không có)'),
    'Quy tắc logo và nhận diện: ' + (rules.logo_rules || '(chưa cài đặt)'),
    brandGuideText
      ? '\n=== BRAND GUIDE VĂN BẢN CHÍNH THỨC ===\n' + brandGuideText
      : '\nBrand guide văn bản chính thức: (chưa có)',
    imageGuides.length
      ? '\nBrand guide hình ảnh chính thức: đã có ' + imageGuides.length + ' tài liệu hình ảnh để đối chiếu khi kiểm tra ảnh.'
      : '\nBrand guide hình ảnh chính thức: (chưa có)'
  ];
  return {
    rules,
    bannedList,
    required,
    brandGuideText,
    imageGuides,
    promptText: sections.join('\n')
  };
}

function handleAiChat(p) {
  var messages = p.messages || [];
  if (!messages.length) return { ok: false, error: 'No messages' };

  var aiContext = buildAiRulesContext();
  // Đọc persona .md của đúng người duyệt hiện tại (Sheet Personas) để inject vào system message đầu
  var personaText = getPersonaContent(p.reviewer_name);
  // Luôn thêm no-markdown instruction
  if (messages.length) messages[0].content = messages[0].content + '\nLưu ý quan trọng: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần tiếng Việt.' + '\n\n' + aiContext.promptText + '\nKhi hỗ trợ người duyệt, phải đối chiếu nhận xét với các quy tắc Admin ở trên và chỉ ra vi phạm nếu có.';
  if (personaText) {
    // Nếu message đầu là system context, thêm persona vào
    messages[0].content = messages[0].content + '\n\nLưu ý: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #. Chỉ viết text thuần.' + '\n\n=== PHONG CÁCH & TIÊU CHÍ NGƯỜI DUYỆT ===' + personaText;
  }

  var url = 'https://api.openai.com/v1/chat/completions';
  var payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: messages,
    max_tokens: 1200,
    temperature: 0.4
  });
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
    payload: payload,
    muteHttpExceptions: true
  };
  var resp = UrlFetchApp.fetch(url, options);
  var json = JSON.parse(resp.getContentText());
  if (json.error) return { ok: false, error: json.error.message || 'OpenAI error' };
  var reply = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  return { ok: true, reply: reply };
}

// Sửa campus nhầm của Chính TQ và Vân Anh LT trong Sheet Users
function handleFixUserCampus() {
  var sheet = getSheet('Users');
  var rows  = sheet.getDataRange().getValues();
  var fixed = 0;
  for (var i = 1; i < rows.length; i++) {
    var email = rows[i][1];
    var campus = rows[i][5];
    // Chính TQ: tay_hn
    if (email === 'chinh.tq@fschools.vn' && campus !== 'tay_hn') {
      sheet.getRange(i+1, 6).setValue('tay_hn');
      fixed++;
    }
    // Vân Anh LT: hoa_lac
    if (email === 'van-anh.lt@fschools.vn' && campus !== 'hoa_lac') {
      sheet.getRange(i+1, 6).setValue('hoa_lac');
      fixed++;
    }
  }
  if (fixed) invalidateCache('users_v1');
  return { ok: true, fixed: fixed };
}

// Chạy 1 lần trong Apps Script editor (hoặc gọi action 'seed_parallel_workflow') để nâng cấp
// workflow chuẩn "standard_multilevel" từ tuần tự (leader_content → leader → manager)
// sang: leader_content duyệt trước → sau đó Trưởng phòng/Trưởng ban duyệt SONG SONG
// (chỉ cần 1 trong 2 người duyệt là xong). Tạo ra version mới (v2) và tự động deactivate
// version cũ — không xoá dữ liệu version cũ, chỉ ngừng áp dụng.
// Bài nào chọn workflow này ở màn hình gửi bài sẽ tự chạy theo luồng song song;
// vẫn có thể chọn "Chuỗi reviewer thủ công hiện tại" nếu muốn tự tay chọn người duyệt.
function seedParallelWorkflowV2() {
  const result = handleSaveWorkflowTemplate({
    role: 'admin',
    user_id: 'system',
    template: {
      workflow_id: 'standard_multilevel',
      name: 'Duyệt content nhiều cấp — song song Trưởng phòng/Trưởng ban',
      match_rule: {},
      active: true,
      steps: [
        {
          step_id: 'content_review', step_order: 1, label: 'Leader Content',
          mode: 'sequential', min_approvals: 1,
          assignment_rule: { type: 'role_and_campus', roles: ['leader_content'], campus: 'same_or_shared' },
          sla_hours: 24, on_approve: 'next_step', on_revision: 'revision', on_reject: 'rejected'
        },
        {
          step_id: 'leader_manager_parallel', step_order: 2,
          label: 'Trưởng phòng / Trưởng ban (song song — 1 người duyệt là xong)',
          mode: 'parallel_any', min_approvals: 1,
          assignment_rule: { type: 'role_and_campus', roles: ['leader', 'manager'], campus: 'same_or_shared' },
          sla_hours: 24, on_approve: 'next_step', on_revision: 'revision', on_reject: 'rejected'
        }
      ]
    }
  });
  Logger.log(JSON.stringify(result));
  return result;
}

// ============================================================
// KHO TÀI LIỆU (DocumentCategories / DocumentLinks)
// ============================================================
const DOC_CATEGORY_HEADERS = ['id', 'name', 'sort_order', 'created_by', 'created_at', 'color', 'allowed_roles'];
const DOC_LINK_HEADERS = ['id', 'category_id', 'title', 'url', 'note', 'added_by_id', 'added_by_name', 'created_at', 'updated_at'];

// Quản lý danh mục: giới hạn admin/manager (đồng bộ với các màn quản trị khác trong hệ thống:
// Quản lý rule, Nhân sự, Workflow duyệt đều giới hạn admin+manager).
function assertDocAdmin(p) {
  if (!['admin', 'manager'].includes(String((p || {}).role || ''))) throw new Error('DOC_ADMIN_REQUIRED');
}

// Danh sách vai trò hợp lệ để cấu hình phân quyền xem/thêm link theo danh mục.
const DOC_CATEGORY_ROLES = ['ctv', 'leader_content', 'leader', 'manager', 'admin'];

// admin/manager luôn thấy MỌI danh mục (kể cả chưa cấu hình quyền) để còn quản lý được;
// các vai trò khác chỉ thấy danh mục có mặt trong allowed_roles của danh mục đó.
// Danh mục chưa cấu hình allowed_roles (rỗng) = KHÔNG ai xem được, kể cả người tạo,
// cho đến khi admin/manager vào Quản lý danh mục để chọn vai trò được xem.
function canRoleViewCategory(role, category) {
  if (['admin', 'manager'].includes(String(role || ''))) return true;
  let allowed = [];
  try { allowed = JSON.parse(category.allowed_roles || '[]'); } catch (e) {}
  return Array.isArray(allowed) && allowed.includes(role);
}

function parseAllowedRoles(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(r => DOC_CATEGORY_ROLES.includes(r));
}

// Bảng màu nhạt cho phép chọn khi tạo/sửa danh mục — chỉ giới hạn trong danh sách này
// để đảm bảo luôn là màu nhạt, dễ nhìn, đồng bộ giao diện.
const DOC_CATEGORY_COLORS = ['#FCE4E4','#FDEBD3','#FFF6D6','#E3F3D9','#D8F1EA','#DCEEFB','#E3E4FC','#F1E3FA','#FBE1F0','#E9E9E9'];
const DOC_CATEGORY_DEFAULT_COLOR = '#E9E9E9';

function handleGetDocumentCategories(p) {
  const role = (p || {}).role || '';
  // Cache danh sách ĐẦY ĐỦ (chưa lọc theo role) — dùng chung được cho mọi role gọi vào.
  const categories = getCached('doc_categories_v1', 180, () => {
    const sheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const list = rows.slice(1).filter(r => r[0]).map(r => rowToObj(headers, r));
    list.forEach(c => { if (!c.color) c.color = DOC_CATEGORY_DEFAULT_COLOR; });
    list.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
    return list;
  });
  // admin/manager thấy tất cả (kể cả chưa cấu hình quyền) để quản lý; vai trò khác chỉ thấy danh mục được cấp quyền.
  const visible = ['admin', 'manager'].includes(role) ? categories : categories.filter(c => canRoleViewCategory(role, c));
  return { ok: true, categories: visible, palette: DOC_CATEGORY_COLORS, roles: DOC_CATEGORY_ROLES };
}

function handleAddDocumentCategory(p) {
  try { assertDocAdmin(p); } catch (e) { return { ok: false, error: 'Chỉ admin/manager được thêm danh mục' }; }
  const name = String((p.name || '')).trim();
  if (!name) return { ok: false, error: 'Thiếu tên danh mục' };
  const color = DOC_CATEGORY_COLORS.includes(p.color) ? p.color : DOC_CATEGORY_DEFAULT_COLOR;
  const allowedRoles = parseAllowedRoles(p.allowed_roles);
  const sheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const maxOrder = rows.slice(1).reduce((m, r) => Math.max(m, Number(r[2]) || 0), 0);
  const id = 'CAT_' + Date.now();
  sheet.appendRow([id, name, maxOrder + 1, p.user_id || p.user_name || '', new Date().toISOString(), color, JSON.stringify(allowedRoles)]);
  invalidateCache('doc_categories_v1');
  return { ok: true, id };
}

function handleUpdateDocumentCategory(p) {
  try { assertDocAdmin(p); } catch (e) { return { ok: false, error: 'Chỉ admin/manager được sửa danh mục' }; }
  if (!p.id) return { ok: false, error: 'Thiếu id danh mục' };
  const sheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) {
      if (p.name !== undefined) sheet.getRange(i + 1, 2).setValue(String(p.name).trim());
      if (p.sort_order !== undefined) sheet.getRange(i + 1, 3).setValue(Number(p.sort_order) || 0);
      if (p.color !== undefined && DOC_CATEGORY_COLORS.includes(p.color)) sheet.getRange(i + 1, 6).setValue(p.color);
      if (p.allowed_roles !== undefined) sheet.getRange(i + 1, 7).setValue(JSON.stringify(parseAllowedRoles(p.allowed_roles)));
      invalidateCache('doc_categories_v1');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy danh mục' };
}

function handleDeleteDocumentCategory(p) {
  try { assertDocAdmin(p); } catch (e) { return { ok: false, error: 'Chỉ admin/manager được xoá danh mục' }; }
  if (!p.id) return { ok: false, error: 'Thiếu id danh mục' };
  const linkSheet = getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);
  const linkRows = linkSheet.getDataRange().getValues();
  const hasLinks = linkRows.slice(1).some(r => String(r[1]) === String(p.id));
  if (hasLinks) return { ok: false, error: 'Danh mục còn link bên trong — hãy chuyển hoặc xoá link trước' };
  const sheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) { sheet.deleteRow(i + 1); invalidateCache('doc_categories_v1'); return { ok: true }; }
  }
  return { ok: false, error: 'Không tìm thấy danh mục' };
}

function handleGetDocumentLinks(p) {
  const role = (p || {}).role || '';
  const sheet = getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  let links = rows.slice(1).filter(r => r[0]).map(r => rowToObj(headers, r));
  if (p && p.category_id) links = links.filter(l => String(l.category_id) === String(p.category_id));
  // Chỉ trả về link thuộc danh mục mà vai trò gọi API được phép xem.
  if (!['admin', 'manager'].includes(role)) {
    const catSheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
    const catRows = catSheet.getDataRange().getValues();
    const catHeaders = catRows[0];
    const categories = catRows.slice(1).filter(r => r[0]).map(r => rowToObj(catHeaders, r));
    const visibleCatIds = new Set(categories.filter(c => canRoleViewCategory(role, c)).map(c => String(c.id)));
    links = links.filter(l => visibleCatIds.has(String(l.category_id)));
  }
  links.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { ok: true, links };
}

function handleAddDocumentLink(p) {
  const title = String((p.title || '')).trim();
  const url = String((p.url || '')).trim();
  if (!title || !url) return { ok: false, error: 'Thiếu tiêu đề hoặc link' };
  if (!p.category_id) return { ok: false, error: 'Thiếu danh mục' };
  // Chặn thêm link vào danh mục mà vai trò này không có quyền (phòng trường hợp gọi thẳng API, bỏ qua dropdown FE).
  if (!['admin', 'manager'].includes(String(p.role || ''))) {
    const catSheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
    const catRows = catSheet.getDataRange().getValues();
    const catHeaders = catRows[0];
    const category = catRows.slice(1).filter(r => r[0]).map(r => rowToObj(catHeaders, r)).find(c => String(c.id) === String(p.category_id));
    if (!category || !canRoleViewCategory(p.role, category)) return { ok: false, error: 'Bạn không có quyền thêm link vào danh mục này' };
  }
  const sheet = getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);
  const id = 'DOC_' + Date.now();
  const now = new Date().toISOString();
  sheet.appendRow([id, p.category_id, title, url, p.note || '', p.user_id || '', p.user_name || '', now, now]);
  return { ok: true, id };
}

function handleUpdateDocumentLink(p) {
  if (!p.id) return { ok: false, error: 'Thiếu id link' };
  const sheet = getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) {
      const isOwner = String(rows[i][5]) === String(p.user_id || '');
      const isAdmin = ['admin', 'manager'].includes(String(p.role || ''));
      if (!isOwner && !isAdmin) return { ok: false, error: 'Bạn không có quyền sửa link này' };
      if (p.title !== undefined) sheet.getRange(i + 1, 3).setValue(String(p.title).trim());
      if (p.url !== undefined) sheet.getRange(i + 1, 4).setValue(String(p.url).trim());
      if (p.note !== undefined) sheet.getRange(i + 1, 5).setValue(p.note);
      if (p.category_id !== undefined) sheet.getRange(i + 1, 2).setValue(p.category_id);
      sheet.getRange(i + 1, 9).setValue(new Date().toISOString());
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy link' };
}

function handleDeleteDocumentLink(p) {
  if (!p.id) return { ok: false, error: 'Thiếu id link' };
  const sheet = getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) {
      const isOwner = String(rows[i][5]) === String(p.user_id || '');
      const isAdmin = ['admin', 'manager'].includes(String(p.role || ''));
      if (!isOwner && !isAdmin) return { ok: false, error: 'Bạn không có quyền xoá link này' };
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy link' };
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let s = getOrCreate(ss, 'Users');
  if (s.getLastRow() === 0) {
    s.appendRow(['id','email','password','name','role','campus','active','created_at','last_login']);
    s.getRange(1,1,1,9).setFontWeight('bold').setBackground('#f0eeea');
    s.appendRow(['USR_001','trung@fschools.vn','Admin@123','Trung (Admin)','admin','chung',true,new Date().toISOString(),'']);
    s.appendRow(['USR_002','phuong.lx@fschools.vn','Boss@123','Phương LX','manager','chung',true,new Date().toISOString(),'']);
    s.appendRow(['USR_003','chinh.tq@fschools.vn','Leader@123','Chính TQ','leader','tay_hn',true,new Date().toISOString(),'']);
    s.appendRow(['USR_004','van-anh.lt@fschools.vn','Leader@123','Vân Anh LT','leader','hoa_lac',true,new Date().toISOString(),'']);
    s.appendRow(['USR_005','canh@fschools.vn','Lc@123','Cảnh','leader_content','hoa_lac',true,new Date().toISOString(),'']);
    s.appendRow(['USR_006','huyen@fschools.vn','Lc@123','Huyền','leader_content','hoa_lac',true,new Date().toISOString(),'']);
    s.appendRow(['USR_007','minh-trang@fschools.vn','Lc@123','Minh Trang','leader_content','tay_hn',true,new Date().toISOString(),'']);
    s.appendRow(['USR_008','quynh-huong@fschools.vn','Ctv@123','Quỳnh Hương','ctv','tay_hn',true,new Date().toISOString(),'']);
  }

  s = getOrCreate(ss, 'Submissions');
  if (s.getLastRow() === 0) {
    s.appendRow([
      'id','user_id','user_name','user_email',
      'campus','content_type','audience',
      'title','content','note',
      'drive_links','ai_verdict','ai_scores',
      'submitted_at','status',
      'comment','score','reviewer_name','reviewed_at',
      'send_count','original_id',
      'reviewers','current_reviewer_id','current_reviewer_name',
      'is_shared','current_reviewer_index',
      'inline_comments','review_history',
      'brand_check_result','evidence_links'
    ]);
    s.getRange(1,1,1,30).setFontWeight('bold').setBackground('#f0eeea');
    s.setColumnWidth(9, 400);
    s.setFrozenRows(1);
  }

  s = getOrCreate(ss, 'Rules');
  if (s.getLastRow() === 0) {
    s.appendRow(['type','value','category','date']);
    s.getRange(1,1,1,4).setFontWeight('bold').setBackground('#f0eeea');
    s.appendRow(['brand_voice','Chuyên nghiệp, gần gũi, trung thực. Không dùng từ cảm thán quá mức. Có CTA rõ ràng.','','']);
    s.appendRow(['logo_rules','Logo FPT Schools không thay đổi màu, tỷ lệ. Vùng trống tối thiểu 1/4 chiều cao logo.','','']);
    s.appendRow(['banned','siêu','noi_bo','']);
    s.appendRow(['banned','cực kỳ','noi_bo','']);
    s.appendRow(['banned','đảm bảo 100%','nha_nuoc','']);
    s.appendRow(['required','CTA rõ ràng','','']);
    s.appendRow(['required','Thông tin liên hệ hoặc link đăng ký','','']);
  }

  s = getOrCreate(ss, 'Personas');
  if (s.getLastRow() === 0) {
    s.appendRow(['name','content','updated_at']);
    s.getRange(1,1,1,3).setFontWeight('bold').setBackground('#f0eeea');
  }

  s = getOrCreate(ss, 'BrandGuides');
  if (s.getLastRow() === 0) {
    s.appendRow(['id','name','type','content','mime_type','updated_at']);
    s.getRange(1,1,1,6).setFontWeight('bold').setBackground('#f0eeea');
  }

  // Các sheet bổ sung cho draft, version history và workflow nhiều cấp.
  getSheetWithHeaders('Drafts', DRAFT_HEADERS);
  getSheetWithHeaders('SubmissionVersions', VERSION_HEADERS);
  getSheetWithHeaders('WorkflowTemplates', WORKFLOW_TEMPLATE_HEADERS);
  getSheetWithHeaders('WorkflowSteps', WORKFLOW_STEP_HEADERS);
  getSheetWithHeaders('SubmissionSteps', SUBMISSION_STEP_HEADERS);
  ensureHeadersOnSheet(getSheet('Submissions'), SUBMISSIONS_BASE_HEADERS.concat(SUBMISSION_WORKFLOW_HEADERS).concat(SUBMISSIONS_EXTRA_HEADERS));
  getSheetWithHeaders('DocumentLinks', DOC_LINK_HEADERS);

  const docCategorySheet = getSheetWithHeaders('DocumentCategories', DOC_CATEGORY_HEADERS);
  if (docCategorySheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    [
      ['Báo cáo', '#DCEEFB'], ['Kế hoạch', '#E3E4FC'], ['Ảnh', '#FBE1F0'], ['Video', '#F1E3FA'],
      ['Link họp', '#E3F3D9'], ['Link logo', '#FFF6D6'], ['Hợp đồng', '#FDEBD3']
    ].forEach(([name, color], i) => docCategorySheet.appendRow(['CAT_' + (i + 1), name, i + 1, 'system', now, color, '[]']));
  }

  const workflowTemplateSheet = getSheet('WorkflowTemplates');
  if (workflowTemplateSheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    workflowTemplateSheet.appendRow([
      'standard_multilevel', 1, 'Duyệt content nhiều cấp chuẩn', JSON.stringify({}), true, 'system', now
    ]);
    const workflowStepSheet = getSheet('WorkflowSteps');
    workflowStepSheet.appendRow(['standard_multilevel', 1, 'content_review', 1, 'Leader Content', 'sequential', 1, JSON.stringify({ type: 'role_and_campus', roles: ['leader_content'], campus: 'same_or_shared' }), 24, 'next_step', 'revision', 'rejected']);
    workflowStepSheet.appendRow(['standard_multilevel', 1, 'leader_review', 2, 'Leader', 'sequential', 1, JSON.stringify({ type: 'role_and_campus', roles: ['leader'], campus: 'same_or_shared' }), 24, 'next_step', 'revision', 'rejected']);
    workflowStepSheet.appendRow(['standard_multilevel', 1, 'manager_review', 3, 'Manager', 'sequential', 1, JSON.stringify({ type: 'role_and_campus', roles: ['manager'], campus: 'any' }), 24, 'next_step', 'revision', 'rejected']);
  }

  Logger.log('Setup v6 hoàn tất.');
}
