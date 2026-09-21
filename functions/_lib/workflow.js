// ============================================================
// WORKFLOW ENGINE — port từ backend_apps_script.js (buildLegacyWorkflow,
// resolveWorkflowForSubmission, getRuntimeWorkflowFromRow, applyWorkflowDecision, ...).
//
// Khác biệt quan trọng so với bản Sheets: các cột JSON (reviewers, workflow_steps,
// review_history, inline_comments...) trên Postgres là JSONB thật — supabase-js trả về
// thẳng object/array JS, KHÔNG cần JSON.parse/readJsonSafe như bản Sheets cũ.
//
// Đơn giản hoá có chủ đích: bản Sheets có nhánh "legacy" (submission không có workflow_steps,
// chỉ có mảng reviewers phẳng kiểu cũ) để tương thích dữ liệu tạo TRƯỚC KHI workflow engine
// ra đời. Vì mọi submission tạo mới trên Postgres đều LUÔN có workflow_steps (submit() bên dưới
// luôn gọi resolveWorkflowForSubmission), nhánh legacy đó không thể xảy ra ở đây nên được bỏ.
// ============================================================

import { asBoolean } from './util.js';

export async function getActiveUsers(supabase) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, campus, active')
    .eq('active', true);
  if (error) throw new Error(error.message);
  return data.map(u => ({ id: String(u.id), email: u.email, name: u.name, role: u.role, campus: u.campus }));
}

export function campusMatches(ruleCampus, submissionCampus, userCampus) {
  if (!ruleCampus || ruleCampus === 'any') return true;
  if (ruleCampus === 'same' || ruleCampus === 'same_or_shared') {
    return userCampus === submissionCampus || userCampus === 'chung' || submissionCampus === 'chung';
  }
  if (Array.isArray(ruleCampus)) return ruleCampus.includes(userCampus);
  return userCampus === ruleCampus;
}

export function resolveAssignmentRule(activeUsers, rule, data) {
  const r = rule || {};
  if (r.type === 'fixed_users') {
    const ids = (r.user_ids || []).map(String);
    return activeUsers.filter(u => ids.includes(String(u.id)));
  }
  let candidates = activeUsers;
  if (r.roles && r.roles.length) candidates = candidates.filter(u => r.roles.includes(u.role));
  if (r.campus) candidates = candidates.filter(u => campusMatches(r.campus, data.campus, u.campus));
  if (r.exclude_user_ids) {
    const excluded = r.exclude_user_ids.map(String);
    candidates = candidates.filter(u => !excluded.includes(String(u.id)));
  }
  if (r.type === 'pool' && r.assignment_mode === 'one') return candidates.slice(0, 1);
  return candidates;
}

export function buildLegacyWorkflow(reviewers) {
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

export async function loadWorkflowDefinitions(supabase) {
  const { data: templates, error: tplError } = await supabase
    .from('workflow_templates')
    .select('workflow_id, version, name, match_rule, active, created_by, created_at')
    .eq('active', true);
  if (tplError) throw new Error(tplError.message);

  const { data: steps, error: stepError } = await supabase
    .from('workflow_steps')
    .select('workflow_id, workflow_version, step_id, step_order, label, mode, min_approvals, assignment_rule, sla_hours, on_approve, on_revision, on_reject');
  if (stepError) throw new Error(stepError.message);

  return templates.map(t => ({
    workflow_id: t.workflow_id,
    version: t.version,
    name: t.name,
    match_rule: t.match_rule || {},
    active: t.active,
    steps: steps
      .filter(s => s.workflow_id === t.workflow_id && s.workflow_version === t.version)
      .sort((a, b) => a.step_order - b.step_order)
      .map(s => ({
        step_id: s.step_id, step_order: s.step_order, label: s.label, mode: s.mode || 'sequential',
        min_approvals: s.min_approvals || 1, assignment_rule: s.assignment_rule || {}, sla_hours: s.sla_hours || 0,
        on_approve: s.on_approve || 'next_step', on_revision: s.on_revision || 'revision', on_reject: s.on_reject || 'rejected'
      }))
  }));
}

export function workflowMatches(template, data) {
  const rule = template.match_rule || {};
  if (rule.content_types && rule.content_types.length && !rule.content_types.includes(data.content_type)) return false;
  if (rule.campuses && rule.campuses.length && !rule.campuses.includes(data.campus)) return false;
  if (rule.is_shared !== undefined && String(rule.is_shared) !== String(asBoolean(data.is_shared))) return false;
  return true;
}

export async function resolveWorkflowForSubmission(supabase, data) {
  const legacy = buildLegacyWorkflow(data.reviewers || []);
  const requestedId = data.workflow_id || 'manual_chain';
  if (requestedId === 'manual_chain') {
    if (!legacy.steps.length) throw new Error('WORKFLOW_NO_REVIEWER');
    return legacy;
  }

  const activeUsers = await getActiveUsers(supabase);
  const definitions = await loadWorkflowDefinitions(supabase);
  const template = definitions.find(t => t.workflow_id === requestedId && workflowMatches(t, data));
  if (!template || !template.steps.length) throw new Error('WORKFLOW_NOT_FOUND_OR_NO_STEPS');

  const runtimeSteps = template.steps.map(s => {
    const reviewers = resolveAssignmentRule(activeUsers, s.assignment_rule, data);
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

// Dựng lại "runtime" (trạng thái workflow đang chạy) từ 1 dòng submissions đã đọc từ DB.
export function getRuntimeWorkflow(row) {
  const parsed = row.workflow_steps || null;
  const steps = (parsed && Array.isArray(parsed.steps)) ? parsed.steps : [];
  const idxById = steps.findIndex(s => String(s.step_id) === String(row.current_step_id || ''));
  return {
    workflow_id: (parsed && parsed.workflow_id) || row.workflow_id || 'manual_chain',
    workflow_version: Number((parsed && parsed.workflow_version) || row.workflow_version) || 1,
    steps,
    current_step_index: idxById >= 0 ? idxById : Math.max(0, Number(row.current_reviewer_index) || 0),
    lock_version: Number(row.lock_version) || 1,
    idempotency_key: row.idempotency_key || ''
  };
}

export function activeWorkflowStep(runtime) {
  return runtime.steps[runtime.current_step_index] || null;
}

export function stepHasEnoughApprovals(step) {
  const approvals = (step.decisions || []).filter(d => d.action === 'approve').length;
  const minimum = Number(step.min_approvals) || 1;
  if (step.mode === 'parallel_all') return approvals >= Math.max(minimum, (step.reviewer_ids || []).length);
  if (step.mode === 'parallel_any') return approvals >= minimum;
  return approvals >= 1;
}

export function firstPendingReviewer(step) {
  const decided = new Set((step.decisions || []).map(d => String(d.user_id)));
  return (step.reviewers || []).find(r => !decided.has(String(r.id))) || (step.reviewers || [])[0] || null;
}

export function findActorForWorkflow(p, step, row) {
  const id = p.reviewer_id ? String(p.reviewer_id) : '';
  if (id && (step.reviewer_ids || []).map(String).includes(id)) return id;
  if (!id && (step.reviewer_ids || []).length === 1 && p.reviewer_name && String(p.reviewer_name) === String(row.current_reviewer_name)) {
    return String(step.reviewer_ids[0]);
  }
  return id;
}

// Trả về patch (object) để UPDATE vào bảng submissions, tương ứng với persistWorkflowRuntime
// trong bản Apps Script gốc (ghi lại reviewers/current_reviewer_*/workflow_steps/lock_version...).
export function buildWorkflowPatch(runtime) {
  const step = activeWorkflowStep(runtime);
  const current = firstPendingReviewer(step || { reviewers: [] });
  const flatReviewers = runtime.steps.flatMap(s => s.reviewers || []);
  return {
    reviewers: flatReviewers,
    current_reviewer_id: current ? current.id : null,
    current_reviewer_name: current ? current.name : null,
    current_reviewer_index: runtime.current_step_index || 0,
    workflow_id: runtime.workflow_id || 'manual_chain',
    workflow_version: runtime.workflow_version || 1,
    workflow_steps: { workflow_id: runtime.workflow_id, workflow_version: runtime.workflow_version, steps: runtime.steps },
    current_step_id: step ? step.step_id : null,
    lock_version: runtime.lock_version || 1,
    idempotency_key: runtime.idempotency_key || null
  };
}

export async function saveSubmissionStepSnapshot(supabase, submissionId, revisionNo, runtime) {
  const rows = (runtime.steps || []).map(step => ({
    id: `${submissionId}_v${revisionNo}_${step.step_id}`,
    submission_id: submissionId,
    revision_no: revisionNo,
    step_id: step.step_id,
    step_order: step.step_order || 0,
    label: step.label || '',
    mode: step.mode || 'sequential',
    state: step.state || 'pending',
    reviewer_ids: step.reviewer_ids || [],
    decisions: step.decisions || [],
    started_at: step.started_at || new Date().toISOString(),
    completed_at: step.completed_at || null
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('submission_steps').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

// Áp 1 quyết định (approve/revision/rejected) vào runtime — thuần JS, KHÔNG đụng DB.
// Trả { ok:false, error } nếu quyết định không hợp lệ, hoặc { ok:true, runtime, status, nextStep }.
export function applyWorkflowDecision(runtime, row, p, action, activeUsers) {
  if (!runtime.steps.length) return { handled: false };
  const step = activeWorkflowStep(runtime);
  if (!step) return { handled: false };

  const actorId = findActorForWorkflow(p, step, row);
  const actor = activeUsers.find(u => String(u.id) === String(actorId));
  const override = !!p.override && actor && actor.role === 'manager';

  if (p.expected_lock_version !== undefined && Number(p.expected_lock_version) !== Number(runtime.lock_version)) {
    return { handled: true, ok: false, error: 'STALE_LOCK_VERSION' };
  }
  if (!actorId || (!(step.reviewer_ids || []).map(String).includes(String(actorId)) && !override)) {
    return { handled: true, ok: false, error: 'NOT_ASSIGNED_REVIEWER' };
  }
  if (!override && (step.decisions || []).some(d => String(d.user_id) === String(actorId))) {
    return { handled: true, ok: false, error: 'DUPLICATE_DECISION' };
  }
  if (!['approved', 'revision', 'rejected'].includes(action)) {
    return { handled: true, ok: false, error: 'INVALID_WORKFLOW_ACTION' };
  }
  if (action !== 'approved' && !String(p.comment || '').trim()) {
    return { handled: true, ok: false, error: 'COMMENT_REQUIRED' };
  }

  step.decisions = step.decisions || [];
  step.decisions.push({
    user_id: String(actorId),
    action: action === 'approved' ? 'approve' : action === 'revision' ? 'revision' : 'reject',
    comment: p.comment || '', score: p.score || '', at: new Date().toISOString()
  });

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
        if (nextStep) { nextStep.state = 'pending'; nextStep.started_at = new Date().toISOString(); }
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
  return { handled: true, ok: true, status: nextStatus, nextStep, runtime, stepOrder: (runtime.current_step_index || 0) + 1 };
}
