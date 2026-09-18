// ============================================================
// DRAFTS — port từ handleSaveDraft/handleGetDrafts/handleDeleteDraft.
// ============================================================

export async function handleSaveDraft(supabase, p) {
  const d = p.draft || {};
  if (!p.user_id || !d.id) return { ok: false, error: 'Thiếu user_id hoặc draft id' };
  const now = new Date().toISOString();

  const { data: existing, error: findError } = await supabase
    .from('drafts').select('id, updated_at').eq('id', d.id).eq('user_id', p.user_id).maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  if (existing) {
    const storedAt = new Date(existing.updated_at || 0).getTime();
    const incomingAt = new Date(d.updated_at || now).getTime();
    if (storedAt && incomingAt && incomingAt < storedAt) {
      return { ok: true, id: d.id, updated_at: existing.updated_at, ignored_stale: true };
    }
    const savedAt = d.updated_at || now;
    const { error } = await supabase.from('drafts').update({ payload: d, updated_at: savedAt }).eq('id', d.id).eq('user_id', p.user_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: d.id, updated_at: savedAt };
  }

  const savedAt = d.updated_at || now;
  const { error } = await supabase.from('drafts').insert({
    id: d.id, user_id: p.user_id, user_name: p.user_name || null,
    payload: d, created_at: d.created_at || savedAt, updated_at: savedAt
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: d.id, updated_at: savedAt };
}

export async function handleGetDrafts(supabase, p) {
  if (!p.user_id) return { ok: false, error: 'Thiếu user_id' };
  const { data, error } = await supabase
    .from('drafts')
    .select('id, payload, created_at, updated_at')
    .eq('user_id', p.user_id)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: error.message };

  const drafts = data.map(row => ({
    ...(row.payload || {}),
    id: (row.payload && row.payload.id) || row.id,
    created_at: (row.payload && row.payload.created_at) || row.created_at,
    updated_at: row.updated_at || (row.payload && row.payload.updated_at)
  }));
  return { ok: true, drafts };
}

export async function handleDeleteDraft(supabase, p) {
  if (!p.user_id || !p.id) return { ok: false, error: 'Thiếu user_id hoặc draft id' };
  const { data, error } = await supabase.from('drafts').delete().eq('id', p.id).eq('user_id', p.user_id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy draft' };
  return { ok: true };
}
