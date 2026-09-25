// ============================================================
// SUBMISSION VERSIONS — port từ saveSubmissionVersion/updateLatestVersionComments/
// updateLatestVersionReview/handleGetSubmissionVersions/ensureSubmissionVersionForRow.
// ============================================================

export async function saveSubmissionVersion(supabase, submissionId, revisionNo, source) {
  if (!submissionId) return;
  const id = `${submissionId}_v${revisionNo || 1}`;
  const row = {
    id, submission_id: submissionId, revision_no: revisionNo || 1,
    user_id: source.user_id || null, user_name: source.user_name || null,
    title: source.title || null, content: source.content || null, note: source.note || null,
    drive_links: source.drive_links || null, evidence_links: source.evidence_links || null,
    reviewers: source.reviewers || [], inline_comments: source.inline_comments || [],
    review_history: source.review_history || [],
    submitted_at: source.submitted_at || new Date().toISOString(),
    status: source.status || 'new', updated_at: new Date().toISOString(),
    platform: source.platform || []
  };
  const { error } = await supabase.from('submission_versions').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

export async function ensureSubmissionVersionForRow(supabase, row) {
  if (!row || !row.id) return;
  await saveSubmissionVersion(supabase, row.id, Number(row.send_count) || 1, {
    submission_id: row.id, user_id: row.user_id, user_name: row.user_name,
    title: row.title, content: row.content, note: row.note,
    drive_links: row.drive_links, evidence_links: row.evidence_links, reviewers: row.reviewers,
    inline_comments: row.inline_comments || [], review_history: row.review_history || [],
    platform: row.platform || [], submitted_at: row.submitted_at, status: row.status
  });
}

async function findLatestVersionId(supabase, submissionId) {
  const { data, error } = await supabase
    .from('submission_versions')
    .select('id, revision_no')
    .eq('submission_id', submissionId)
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.id : null;
}

export async function updateLatestVersionComments(supabase, submissionId, comments) {
  const id = await findLatestVersionId(supabase, submissionId);
  if (!id) return;
  const { error } = await supabase
    .from('submission_versions')
    .update({ inline_comments: comments || [], updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateLatestVersionReview(supabase, submissionId, reviewHistory, status) {
  const id = await findLatestVersionId(supabase, submissionId);
  if (!id) return;
  const { error } = await supabase
    .from('submission_versions')
    .update({ review_history: reviewHistory || [], status: status || 'reviewed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function handleGetSubmissionVersions(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu submission id' };
  // CTV chỉ được xem lịch sử các vòng gửi của bài do chính mình viết (người duyệt/quản lý xem được mọi bài).
  if (p.role === 'ctv') {
    const { data: owner, error: ownerError } = await supabase.from('submissions').select('user_id').eq('id', p.id).maybeSingle();
    if (ownerError) return { ok: false, error: ownerError.message };
    if (!owner || String(owner.user_id) !== String(p.user_id)) return { ok: false, error: 'Bạn không có quyền xem bài này' };
  }
  const { data: versions, error } = await supabase
    .from('submission_versions')
    .select('*')
    .eq('submission_id', p.id)
    .order('revision_no', { ascending: true });
  if (error) return { ok: false, error: error.message };

  if (versions.length) return { ok: true, versions };

  // Dữ liệu cũ (nếu có) trước khi có SubmissionVersions vẫn xem được ở mức tối thiểu.
  const { data: sub, error: subError } = await supabase.from('submissions').select('*').eq('id', p.id).maybeSingle();
  if (subError) return { ok: false, error: subError.message };
  if (!sub) return { ok: true, versions: [] };

  return {
    ok: true,
    versions: [{
      id: `${p.id}_legacy`, submission_id: p.id, revision_no: Number(sub.send_count) || 1,
      user_id: sub.user_id, user_name: sub.user_name, title: sub.title, content: sub.content, note: sub.note,
      drive_links: sub.drive_links, evidence_links: sub.evidence_links, reviewers: sub.reviewers || [],
      inline_comments: sub.inline_comments || [], review_history: sub.review_history || [],
      submitted_at: sub.submitted_at, status: sub.status, updated_at: sub.submitted_at, platform: sub.platform || []
    }]
  };
}
