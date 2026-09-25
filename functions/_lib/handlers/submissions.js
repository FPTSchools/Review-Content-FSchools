import { newId } from '../ids.js';
import { asBoolean, addHistory, toJsonb } from '../util.js';
import {
  resolveWorkflowForSubmission, getRuntimeWorkflow, activeWorkflowStep, firstPendingReviewer,
  findActorForWorkflow, applyWorkflowDecision, buildWorkflowPatch, saveSubmissionStepSnapshot, getActiveUsers
} from '../workflow.js';
import {
  saveSubmissionVersion, ensureSubmissionVersionForRow, updateLatestVersionReview, updateLatestVersionComments
} from '../submissionVersions.js';
import { sendReviewerEmail, sendForwardEmail, sendCTVEmail } from '../email.js';
import { logAiAccuracy } from './aiAccuracy.js';
import { linkPlanItemToSubmission } from './planning.js';

// ============================================================
// SUBMISSIONS — port từ handleSubmit/handleResubmit/handleUpdateSubmission/
// handleCancelSubmission/processDecision/handleForwardToNext(handleWorkflowForward)/
// handleChangeReviewer/handleSaveInlineComments/handleGetSubmissions/handleGetReport/
// handleCheckSubmitResult trong backend_apps_script.js.
//
// Đơn giản hoá có chủ đích: bỏ nhánh "legacy không workflow" (xem ghi chú đầu file workflow.js)
// — mọi submission trên Postgres luôn có workflow_steps nên chỉ cần code đường workflow.
//
// Khoá đồng thời (concurrency): bản Sheets dùng LockService khoá TOÀN CỤC cho mọi thao tác
// duyệt bài. Postgres không cần khoá toàn cục — dùng "optimistic concurrency" đúng kiểu: mỗi
// UPDATE ràng buộc thêm `.eq('lock_version', <giá trị đã đọc>)`; nếu 0 dòng bị ảnh hưởng nghĩa
// là có request khác đã ghi đè trước đó → trả lỗi STALE_LOCK_VERSION để client thử lại.
// ============================================================

export async function handleSubmit(supabase, env, p) {
  const d = p.data || {};
  const idempotencyKey = d.idempotency_key || p.idempotency_key || '';

  if (idempotencyKey && d.user_id) {
    const { data: existing, error: findError } = await supabase
      .from('submissions').select('id').eq('user_id', d.user_id).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (findError) return { ok: false, error: findError.message };
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  let workflow;
  try {
    workflow = await resolveWorkflowForSubmission(supabase, d);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const allReviewers = workflow.steps.flatMap(s => s.reviewers || []);
  const id = newId('SUB');
  const submittedAt = new Date().toISOString();
  const sendCount = parseInt(d.send_count || 1, 10) || 1;
  const runtime = { ...workflow, current_step_index: 0, lock_version: 1, idempotency_key: idempotencyKey || null };

  const row = {
    id, user_id: d.user_id, user_name: d.user_name, user_email: d.user_email,
    campus: d.campus || null, content_type: d.content_type || null, audience: d.audience || null,
    title: d.title, content: d.content || null, note: d.note || null,
    drive_links: d.drive_links || null, ai_verdict: d.ai_verdict || null, ai_scores: toJsonb(d.ai_scores),
    submitted_at: submittedAt, status: 'new',
    send_count: sendCount, original_id: d.original_id || null,
    reviewers: allReviewers, is_shared: asBoolean(d.is_shared),
    inline_comments: [], review_history: [],
    brand_check_result: toJsonb(d.brand_check_result), evidence_links: d.evidence_links || null,
    platform: Array.isArray(d.platform) ? d.platform : [],
    ...buildWorkflowPatch(runtime)
  };

  const { error: insertError } = await supabase.from('submissions').insert(row);
  if (insertError) return { ok: false, error: insertError.message };

  await saveSubmissionStepSnapshot(supabase, id, sendCount, runtime);
  await saveSubmissionVersion(supabase, id, sendCount, {
    submission_id: id, user_id: d.user_id, user_name: d.user_name, title: d.title, content: d.content,
    note: d.note, drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
    platform: d.platform || [], reviewers: allReviewers, inline_comments: [], review_history: [],
    submitted_at: submittedAt, status: 'new'
  });

  // Bài viết từ 1 đầu việc kế hoạch tháng (nút "Viết bài" ở trang Kế hoạch) — nối lại để trang
  // Kế hoạch tự hiện tiến độ theo trạng thái duyệt. Lỗi nối không được chặn việc gửi bài.
  if (d.plan_item_id) {
    try { await linkPlanItemToSubmission(supabase, d.plan_item_id, id); } catch (e) {}
  }

  const firstStep = workflow.steps[0];
  for (const reviewer of (firstStep && firstStep.reviewers) || []) {
    await sendReviewerEmail(supabase, env, reviewer.email, reviewer.name, d, id, firstStep.step_order || 1);
  }

  return { ok: true, id, workflow_id: workflow.workflow_id, workflow_version: workflow.workflow_version };
}

export async function handleResubmit(supabase, env, p) {
  const d = p.data || {};
  const { data: row, error } = await supabase.from('submissions').select('*').eq('id', d.original_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài cần gửi lại' };
  if (row.idempotency_key && row.idempotency_key === String(d.idempotency_key || '')) {
    return { ok: true, id: d.original_id, duplicate: true };
  }
  if (row.status !== 'revision') return { ok: false, error: 'Chỉ bài đang yêu cầu sửa mới được gửi lại' };

  await ensureSubmissionVersionForRow(supabase, row);

  // Người gửi được chọn lại người duyệt ở mỗi lần gửi lại → chạy theo quy trình MỚI (số bước,
  // ai ở bước nào), KHÔNG dùng lại quy trình của lần gửi đầu. Chỉ khi lần gửi lại không kèm
  // người duyệt nào (client cũ/payload thiếu) mới dùng lại quy trình đã lưu.
  const oldRuntime = getRuntimeWorkflow(row);
  const chosenNewReviewers = Array.isArray(d.reviewers) && d.reviewers.length > 0;
  const chosenNewWorkflow = d.workflow_id && d.workflow_id !== 'manual_chain';
  let runtime;
  if (chosenNewReviewers || chosenNewWorkflow) {
    let workflow;
    try {
      workflow = await resolveWorkflowForSubmission(supabase, d);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    runtime = { ...workflow, current_step_index: 0 };
  } else {
    if (!oldRuntime.steps.length) return { ok: false, error: 'Submission chưa có workflow reviewer' };
    runtime = { ...oldRuntime, current_step_index: 0 };
  }
  runtime.idempotency_key = d.idempotency_key || row.idempotency_key || null;
  runtime.lock_version = (Number(row.lock_version) || 1) + 1;
  runtime.steps = runtime.steps.map(step => ({ ...step, state: 'pending', decisions: [], started_at: null, completed_at: null }));

  const allReviewers = runtime.steps.flatMap(s => s.reviewers || []);
  const submittedAt = new Date().toISOString();
  const history = addHistory(row.review_history, d.user_name || row.user_name, 'resubmitted', d.note || '', '');
  const newSendCount = parseInt(d.send_count || (Number(row.send_count) || 1) + 1, 10);

  const patch = {
    content_type: d.content_type, audience: d.audience, title: d.title, content: d.content, note: d.note,
    drive_links: d.drive_links || '', ai_verdict: d.ai_verdict || null, ai_scores: toJsonb(d.ai_scores),
    submitted_at: submittedAt, status: 'new', comment: null, score: null, reviewer_name: null, reviewed_at: null,
    send_count: newSendCount, is_shared: asBoolean(d.is_shared), inline_comments: [], review_history: history,
    brand_check_result: toJsonb(d.brand_check_result), evidence_links: d.evidence_links || '',
    platform: Array.isArray(d.platform) ? d.platform : [],
    ...buildWorkflowPatch(runtime)
  };

  const { data: updated, error: updateError } = await supabase
    .from('submissions').update(patch).eq('id', d.original_id).eq('lock_version', row.lock_version).select('id');
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated.length) return { ok: false, error: 'STALE_LOCK_VERSION' };

  await saveSubmissionStepSnapshot(supabase, d.original_id, newSendCount, runtime);
  await saveSubmissionVersion(supabase, d.original_id, newSendCount, {
    submission_id: d.original_id, user_id: d.user_id || row.user_id, user_name: d.user_name || row.user_name,
    title: d.title, content: d.content, note: d.note, drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
    platform: d.platform || [], reviewers: allReviewers, inline_comments: [], review_history: history,
    submitted_at: submittedAt, status: 'new'
  });

  const firstStep = runtime.steps[0];
  for (const reviewer of (firstStep && firstStep.reviewers) || []) {
    await sendReviewerEmail(supabase, env, reviewer.email, reviewer.name, d, d.original_id, firstStep.step_order || 1);
  }

  return { ok: true, id: d.original_id, workflow_id: runtime.workflow_id, workflow_version: runtime.workflow_version };
}

export async function handleUpdateSubmission(supabase, p) {
  const d = p.data || {};
  if (!d.id) return { ok: false, error: 'Thiếu id bài viết' };
  const { data: row, error } = await supabase.from('submissions').select('*').eq('id', d.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài' };
  if (String(row.user_id) !== String(d.user_id)) return { ok: false, error: 'Bạn không có quyền sửa bài này' };
  if (!['new', 'reviewing'].includes(row.status)) return { ok: false, error: 'Chỉ sửa được bài đang chờ duyệt (chưa có quyết định)' };

  const patch = {
    content_type: d.content_type || '', audience: d.audience || '', title: d.title || '', content: d.content || '',
    note: d.note || '', drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
    platform: Array.isArray(d.platform) ? d.platform : []
  };
  const { error: updateError } = await supabase.from('submissions').update(patch).eq('id', d.id);
  if (updateError) return { ok: false, error: updateError.message };

  await saveSubmissionVersion(supabase, d.id, Number(row.send_count) || 1, {
    submission_id: d.id, user_id: row.user_id, user_name: row.user_name,
    title: d.title || '', content: d.content || '', note: d.note || '',
    drive_links: d.drive_links || '', evidence_links: d.evidence_links || '',
    platform: d.platform || [], reviewers: row.reviewers, inline_comments: row.inline_comments,
    review_history: row.review_history, submitted_at: row.submitted_at, status: row.status
  });

  return {
    ok: true, id: d.id, content_type: d.content_type || '', audience: d.audience || '',
    title: d.title || '', content: d.content || '', note: d.note || '',
    drive_links: d.drive_links || '', evidence_links: d.evidence_links || '', platform: d.platform || []
  };
}

export async function handleCancelSubmission(supabase, p) {
  const d = p.data || p || {};
  if (!d.id) return { ok: false, error: 'Thiếu id bài viết' };
  const { data: row, error } = await supabase.from('submissions').select('id, user_id, status').eq('id', d.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài' };
  if (String(row.user_id) !== String(d.user_id)) return { ok: false, error: 'Bạn không có quyền hủy bài này' };
  if (!['new', 'reviewing'].includes(row.status)) return { ok: false, error: 'Chỉ hủy được bài đang chờ duyệt (chưa có quyết định)' };

  const { error: updateError } = await supabase.from('submissions').update({ status: 'cancelled' }).eq('id', d.id);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, id: d.id, status: 'cancelled' };
}

export async function handleCheckSubmitResult(supabase, p) {
  const key = String(p.idempotency_key || '').trim();
  if (!key) return { ok: false, error: 'Thiếu idempotency_key' };
  const { data, error } = await supabase.from('submissions').select('id, status, title').eq('idempotency_key', key).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, found: false };
  return { ok: true, found: true, id: data.id, status: data.status, title: data.title };
}

async function processDecision(supabase, env, p, action) {
  const { data: row, error } = await supabase.from('submissions').select('*').eq('id', p.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài' };

  const runtime = getRuntimeWorkflow(row);
  const activeUsers = await getActiveUsers(supabase);
  const result = applyWorkflowDecision(runtime, row, p, action, activeUsers);

  if (!result.handled) return { ok: false, error: 'Bài không có reviewer nào được gán (workflow rỗng)' };
  if (!result.ok) return { ok: false, error: result.error };

  const now = new Date().toISOString();
  const history = addHistory(row.review_history, p.reviewer_name || p.reviewer_id, action, p.comment, p.score);
  const patch = {
    comment: p.comment || '', score: p.score || null, reviewer_name: p.reviewer_name || p.reviewer_id || '',
    reviewed_at: now, review_history: history, status: result.status,
    ...buildWorkflowPatch(result.runtime)
  };

  const { data: updated, error: updateError } = await supabase
    .from('submissions').update(patch).eq('id', p.id).eq('lock_version', row.lock_version).select('id');
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated.length) return { ok: false, error: 'STALE_LOCK_VERSION' };

  await saveSubmissionStepSnapshot(supabase, p.id, row.send_count || 1, result.runtime);
  await updateLatestVersionReview(supabase, p.id, history, result.status);

  const terminal = ['approved', 'rejected', 'revision'].includes(result.status);
  if (result.nextStep) {
    const undecided = (result.nextStep.reviewers || [])
      .filter(r => !(result.nextStep.decisions || []).some(dd => String(dd.user_id) === String(r.id)));
    const emailData = { user_name: row.user_name, title: row.title, content_type: row.content_type, campus: row.campus, note: row.note, platform: row.platform || [] };
    for (const reviewer of undecided) {
      await sendReviewerEmail(supabase, env, reviewer.email, reviewer.name, emailData, p.id, result.nextStep.step_order || result.stepOrder);
    }
  } else if (terminal) {
    await sendCTVEmail(supabase, env, row.user_email, row.user_name, row.title, result.status, p.comment || '', p.score || '', p.id, row.send_count || 1);
  }

  // Đối chiếu AI vs người duyệt CHỈ khi vòng này đã ngã ngũ (terminal) — `row` ở đây vẫn là bản
  // ghi TRƯỚC patch, nên row.ai_verdict đúng là AI đã chấm gì cho ĐÚNG vòng đang được quyết định
  // (không lẫn với vòng khác). Lỗi ghi log không được chặn việc duyệt bài.
  if (terminal) {
    try { await logAiAccuracy(supabase, row, result.status, p.reviewer_name || p.reviewer_id || ''); } catch (e) {}
  }

  return {
    ok: true, id: p.id, status: result.status, comment: p.comment || '', score: p.score || '',
    reviewer_name: p.reviewer_name || p.reviewer_id || '', reviewed_at: now, review_history: history
  };
}

export const handleApprove = (supabase, env, p) => processDecision(supabase, env, p, 'approved');
export const handleReject = (supabase, env, p) => processDecision(supabase, env, p, 'rejected');
export const handleRevision = (supabase, env, p) => processDecision(supabase, env, p, 'revision');

export async function handleForwardToNext(supabase, env, p) {
  const { data: row, error } = await supabase.from('submissions').select('*').eq('id', p.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài' };

  const runtime = getRuntimeWorkflow(row);
  if (!runtime.steps.length) return { ok: false, error: 'NO_ACTIVE_WORKFLOW_STEP' };
  const step = activeWorkflowStep(runtime);
  if (!step) return { ok: false, error: 'NO_ACTIVE_WORKFLOW_STEP' };

  const actorId = findActorForWorkflow(p, step, row);
  if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) {
    return { ok: false, error: 'STALE_LOCK_VERSION' };
  }
  if (!actorId || !(step.reviewer_ids || []).map(String).includes(String(actorId))) return { ok: false, error: 'NOT_ASSIGNED_REVIEWER' };
  if (runtime.current_step_index >= runtime.steps.length - 1) return { ok: false, error: 'NO_NEXT_STEP' };
  if ((step.decisions || []).some(d => String(d.user_id) === String(actorId))) return { ok: false, error: 'DUPLICATE_DECISION' };

  step.state = 'forwarded';
  step.decisions = step.decisions || [];
  step.decisions.push({ user_id: String(actorId), action: 'forwarded', comment: p.note || '', at: new Date().toISOString() });
  const history = addHistory(row.review_history, p.forwarder_name || p.reviewer_name || actorId, 'forwarded', p.note || '', '');
  runtime.current_step_index += 1;
  const nextStep = activeWorkflowStep(runtime);
  if (nextStep) { nextStep.state = 'pending'; nextStep.started_at = new Date().toISOString(); }
  runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;

  const patch = { status: 'new', review_history: history, ...buildWorkflowPatch(runtime) };
  const { data: updated, error: updateError } = await supabase
    .from('submissions').update(patch).eq('id', p.id).eq('lock_version', row.lock_version).select('id');
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated.length) return { ok: false, error: 'STALE_LOCK_VERSION' };

  await saveSubmissionStepSnapshot(supabase, p.id, row.send_count || 1, runtime);
  await updateLatestVersionReview(supabase, p.id, history, 'forwarded');

  const nextReviewer = firstPendingReviewer(nextStep || { reviewers: [] });
  if (nextReviewer) {
    const emailData = { user_name: row.user_name, title: row.title, content_type: row.content_type, campus: row.campus, note: row.note, platform: row.platform || [] };
    await sendForwardEmail(supabase, env, nextReviewer.email, nextReviewer.name, emailData, p.id, p.forwarder_name || p.reviewer_name, runtime.current_step_index + 1);
  }
  return { ok: true, next_reviewer: nextReviewer || null, status: 'new' };
}

export async function handleChangeReviewer(supabase, env, p) {
  const { data: row, error } = await supabase.from('submissions').select('*').eq('id', p.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Không tìm thấy bài' };

  const runtime = getRuntimeWorkflow(row);
  if (!runtime.steps.length) return { ok: false, error: 'Bài không có workflow đang chạy' };
  if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) {
    return { ok: false, error: 'STALE_LOCK_VERSION' };
  }
  const step = activeWorkflowStep(runtime);
  if (!step) return { ok: false, error: 'NO_ACTIVE_WORKFLOW_STEP' };

  const activeUsers = await getActiveUsers(supabase);
  const oldReviewer = firstPendingReviewer(step);
  const changer = activeUsers.find(u => String(u.id) === String(p.reviewer_id));
  if (p.reviewer_id && !(step.reviewer_ids || []).map(String).includes(String(p.reviewer_id)) && (!changer || changer.role !== 'manager')) {
    return { ok: false, error: 'NOT_ASSIGNED_REVIEWER' };
  }
  const replacement = activeUsers.find(u => String(u.id) === String(p.new_reviewer_id));
  if (!replacement) return { ok: false, error: 'REVIEWER_NOT_FOUND' };

  step.reviewer_ids = [String(replacement.id)];
  step.reviewers = [{ id: String(replacement.id), name: replacement.name, email: replacement.email }];
  step.decisions = [];
  step.state = 'pending';
  runtime.lock_version = (Number(runtime.lock_version) || 1) + 1;
  const history = addHistory(
    row.review_history, p.changed_by_name || p.reviewer_name || 'system', 'reviewer_changed',
    `${oldReviewer ? oldReviewer.name : ''} → ${replacement.name}`, ''
  );

  const patch = { status: 'new', review_history: history, ...buildWorkflowPatch(runtime) };
  const { data: updated, error: updateError } = await supabase
    .from('submissions').update(patch).eq('id', p.id).eq('lock_version', row.lock_version).select('id');
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated.length) return { ok: false, error: 'STALE_LOCK_VERSION' };

  await saveSubmissionStepSnapshot(supabase, p.id, row.send_count || 1, runtime);
  await updateLatestVersionReview(supabase, p.id, history, 'reviewer_changed');

  const subData = {
    user_name: row.user_name, user_email: row.user_email, title: row.title, content_type: row.content_type,
    campus: row.campus, audience: row.audience, note: row.note, drive_links: row.drive_links, platform: row.platform || []
  };
  await sendReviewerEmail(supabase, env, replacement.email, replacement.name, subData, p.id, step.step_order || 1);

  return { ok: true, next_reviewer: replacement };
}

export async function handleSaveInlineComments(supabase, p) {
  if (!Array.isArray(p.inline_comments)) return { ok: false, error: 'inline_comments phải là một mảng' };
  const { data, error } = await supabase.from('submissions').update({ inline_comments: p.inline_comments }).eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data.length) return { ok: false, error: 'Không tìm thấy bài' };
  await updateLatestVersionComments(supabase, p.id, p.inline_comments);
  return { ok: true, count: p.inline_comments.length };
}

function isActiveWorkflowReviewer(submission, userId) {
  const runtime = submission.workflow_steps;
  if (!runtime || !Array.isArray(runtime.steps)) return String(submission.current_reviewer_id) === String(userId);
  const step = runtime.steps.find(s => String(s.step_id) === String(submission.current_step_id))
    || runtime.steps[Number(submission.current_reviewer_index) || 0];
  return !!(step && Array.isArray(step.reviewer_ids) && step.reviewer_ids.map(String).includes(String(userId)));
}

export async function handleGetSubmissions(supabase, p) {
  const role = p.role;
  const userId = p.user_id;
  const campus = p.campus;

  let query = supabase.from('submissions').select('*');
  if (role === 'ctv') query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  let list = data;
  if (role !== 'ctv') {
    list = list.filter(s => {
      const assignedWorkflow = isActiveWorkflowReviewer(s, userId);
      if (role === 'admin') return true;
      if (role === 'manager') return true;
      if (role === 'leader') return assignedWorkflow || s.campus === campus || s.is_shared === true;
      if (role === 'leader_content') {
        if (assignedWorkflow) return true;
        if (campus === 'chung') return true;
        return s.campus === campus || (s.is_shared === true && s.campus !== campus);
      }
      return false;
    });
  }

  list.forEach(s => {
    const runtime = s.workflow_steps;
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
    s.in_my_queue = activeReviewerIds.includes(String(userId)) && !alreadyDecided && !['approved', 'rejected', 'revision', 'cancelled'].includes(s.status);
    s.review_history_parsed = s.review_history || [];
    s.platform_parsed = s.platform || [];
  });

  list.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  return { ok: true, data: list };
}

export async function handleGetReport(supabase, p) {
  let query = supabase.from('submissions').select('*');
  if (p.from) query = query.gte('submitted_at', new Date(p.from).toISOString());
  if (p.to) query = query.lte('submitted_at', new Date(p.to).toISOString());
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  let list = data;
  if (p.campus && p.campus !== 'all') {
    list = list.filter(s => s.campus === p.campus || s.is_shared === true);
  }

  const ctvMap = {};
  list.forEach(s => {
    const key = s.user_id;
    if (!ctvMap[key]) {
      ctvMap[key] = { user_id: s.user_id, name: s.user_name, campus: s.campus, total: 0, approved: 0, revision: 0, rejected: 0, pending: 0, scores: [], total_score: 0 };
    }
    ctvMap[key].total++;
    if (s.status === 'approved') {
      ctvMap[key].approved++;
      const sc = parseFloat(s.score);
      if (!isNaN(sc)) { ctvMap[key].scores.push(sc); ctvMap[key].total_score += sc; }
    }
    if (s.status === 'revision') ctvMap[key].revision++;
    if (s.status === 'rejected') ctvMap[key].rejected++;
    if (['new', 'reviewing'].includes(s.status)) ctvMap[key].pending++;
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
    pending: list.filter(s => ['new', 'reviewing'].includes(s.status)).length,
    avg_approval_rate: ctvList.length ? Math.round(ctvList.reduce((s, c) => s + c.approvalRate, 0) / ctvList.length) : 0
  };

  return { ok: true, overview, ctv_list: ctvList, period: { from: p.from, to: p.to } };
}
