// ============================================================
// PERSONAS — port 1:1 từ handleGetPersonas/handleSavePersona/handleDeletePersona.
// Khoá theo "name" (tên người duyệt) — giống sheet "Personas" cũ.
// ============================================================

export async function handleGetPersonas(supabase) {
  const { data, error } = await supabase.from('personas').select('name, content, updated_at').order('name');
  if (error) return { ok: false, error: error.message };
  return { ok: true, personas: data };
}

export async function handleSavePersona(supabase, p) {
  if (!p.name || !p.content) return { ok: false, error: 'Thiếu tên người duyệt hoặc nội dung' };
  const { error } = await supabase
    .from('personas')
    .upsert({ name: p.name, content: p.content, updated_at: new Date().toISOString() }, { onConflict: 'name' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function handleDeletePersona(supabase, p) {
  if (!p.name) return { ok: false, error: 'Thiếu tên người duyệt' };
  const { data, error } = await supabase.from('personas').delete().eq('name', p.name).select('name');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy persona' };
  return { ok: true };
}
