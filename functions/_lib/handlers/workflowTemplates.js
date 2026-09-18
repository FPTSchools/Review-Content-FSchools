import { loadWorkflowDefinitions, workflowMatches } from '../workflow.js';

// ============================================================
// WORKFLOW TEMPLATES — port từ handleGetWorkflows/handleGetWorkflowTemplates/
// handleSaveWorkflowTemplate/handleDeleteWorkflowTemplate/handleValidateWorkflowTemplate.
// ============================================================

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
    assignment_rule: step.assignment_rule || {},
    sla_hours: Number(step.sla_hours || 0),
    on_approve: step.on_approve || 'next_step',
    on_revision: step.on_revision || 'revision',
    on_reject: step.on_reject || 'rejected'
  })).sort((a, b) => a.step_order - b.step_order);
}

export function handleValidateWorkflowTemplate(p) {
  const template = p.template || p.data || {};
  const errors = [];
  const workflowId = String(template.workflow_id || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(workflowId)) errors.push('workflow_id phải dài 3–80 ký tự, chỉ gồm chữ, số, _ hoặc -.');
  if (!String(template.name || '').trim()) errors.push('Thiếu tên workflow.');

  let steps = [];
  try { steps = normalizeWorkflowSteps(template.steps); } catch (e) { errors.push(e.message); }

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

export async function handleGetWorkflows(supabase, p) {
  const data = p || {};
  const definitions = await loadWorkflowDefinitions(supabase);
  const workflows = definitions.filter(w => workflowMatches(w, data));
  return {
    ok: true,
    workflows: workflows.map(w => ({
      workflow_id: w.workflow_id, version: w.version, name: w.name, active: w.active,
      steps: w.steps.map(s => ({
        step_id: s.step_id, step_order: s.step_order, label: s.label, mode: s.mode,
        min_approvals: s.min_approvals, assignment_rule: s.assignment_rule
      }))
    }))
  };
}

export async function handleGetWorkflowTemplates(supabase, p) {
  assertWorkflowAdmin(p || {});
  const { data: templates, error: tplError } = await supabase
    .from('workflow_templates')
    .select('workflow_id, version, name, match_rule, active, created_by, created_at');
  if (tplError) return { ok: false, error: tplError.message };

  const { data: steps, error: stepError } = await supabase
    .from('workflow_steps')
    .select('workflow_id, workflow_version, step_id, step_order, label, mode, min_approvals, assignment_rule, sla_hours, on_approve, on_revision, on_reject');
  if (stepError) return { ok: false, error: stepError.message };

  const result = templates.filter(t => t.workflow_id).map(t => ({
    workflow_id: t.workflow_id, version: t.version, name: t.name || t.workflow_id,
    match_rule: t.match_rule || {}, active: t.active, created_by: t.created_by || '', created_at: t.created_at || '',
    steps: steps
      .filter(s => s.workflow_id === t.workflow_id && s.workflow_version === t.version)
      .sort((a, b) => a.step_order - b.step_order)
  }));
  return { ok: true, templates: result };
}

export async function handleSaveWorkflowTemplate(supabase, p) {
  assertWorkflowAdmin(p || {});
  const template = p.template || p.data || {};
  const validation = handleValidateWorkflowTemplate({ template });
  if (!validation.ok) return { ok: false, error: 'Workflow không hợp lệ', errors: validation.errors };

  const workflowId = String(template.workflow_id).trim();
  let version = Number(template.version) || 0;
  if (!version) {
    const { data: existingVersions, error: verError } = await supabase
      .from('workflow_templates').select('version').eq('workflow_id', workflowId);
    if (verError) return { ok: false, error: verError.message };
    version = existingVersions.length ? Math.max(...existingVersions.map(v => Number(v.version) || 0)) + 1 : 1;
  }

  const active = template.active !== false;
  const now = new Date().toISOString();

  const { error: upsertError } = await supabase.from('workflow_templates').upsert({
    workflow_id: workflowId, version, name: String(template.name).trim(),
    match_rule: template.match_rule || {}, active, created_by: p.user_id || p.created_by || null, created_at: now
  }, { onConflict: 'workflow_id,version' });
  if (upsertError) return { ok: false, error: upsertError.message };

  if (active) {
    const { error: deactivateError } = await supabase
      .from('workflow_templates')
      .update({ active: false })
      .eq('workflow_id', workflowId)
      .neq('version', version);
    if (deactivateError) return { ok: false, error: deactivateError.message };
  }

  const { error: deleteStepsError } = await supabase
    .from('workflow_steps').delete().eq('workflow_id', workflowId).eq('workflow_version', version);
  if (deleteStepsError) return { ok: false, error: deleteStepsError.message };

  const stepRows = validation.normalized_steps.map(step => ({
    workflow_id: workflowId, workflow_version: version, step_id: step.step_id, step_order: step.step_order,
    label: step.label, mode: step.mode, min_approvals: step.min_approvals, assignment_rule: step.assignment_rule || {},
    sla_hours: step.sla_hours, on_approve: step.on_approve, on_revision: step.on_revision, on_reject: step.on_reject
  }));
  const { error: insertStepsError } = await supabase.from('workflow_steps').insert(stepRows);
  if (insertStepsError) return { ok: false, error: insertStepsError.message };

  return { ok: true, workflow_id: workflowId, version, active };
}

export async function handleDeleteWorkflowTemplate(supabase, p) {
  assertWorkflowAdmin(p || {});
  const workflowId = String(p.workflow_id || '').trim();
  if (!workflowId) return { ok: false, error: 'Thiếu workflow_id' };
  const version = p.version === undefined || p.version === '' ? null : Number(p.version);

  let query = supabase.from('workflow_templates').update({ active: false }).eq('workflow_id', workflowId);
  if (version !== null) query = query.eq('version', version);
  const { data, error } = await query.select('version');
  if (error) return { ok: false, error: error.message };
  return { ok: true, deactivated: data.length };
}
