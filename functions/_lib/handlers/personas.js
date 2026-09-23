// ============================================================
// PERSONAS — port 1:1 từ handleGetPersonas/handleSavePersona/handleDeletePersona.
// Khoá theo user_id (KHÔNG phải tên hiển thị — xem migration
// 20260923073531_personas_keyed_by_user_id.sql: tra theo tên có rủi ro mất/nhầm dữ liệu khi đổi
// tên hoặc trùng tên hiển thị, đã gặp thật trong dữ liệu). "name" chỉ lưu kèm để hiện danh sách
// cho gọn — luôn lấy lại từ bảng users tại thời điểm lưu, không tin theo tên frontend tự gửi.
// ============================================================

export async function handleGetPersonas(supabase) {
  // Lấy tên HIỆN TẠI từ bảng users (qua FK personas.user_id → users.id) thay vì chỉ dùng cột
  // "name" snapshot lúc lưu — tránh danh sách Admin hiện tên cũ nếu người dùng đã đổi tên sau đó.
  const { data, error } = await supabase.from('personas').select('user_id, content, updated_at, users(name)').order('updated_at');
  if (error) return { ok: false, error: error.message };
  const personas = (data || []).map(p => ({
    user_id: p.user_id, content: p.content, updated_at: p.updated_at,
    name: (p.users && p.users.name) || '(người dùng đã xoá)'
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, personas };
}

export async function handleSavePersona(supabase, p) {
  if (!p.user_id || !p.content) return { ok: false, error: 'Thiếu người duyệt hoặc nội dung' };
  const { data: user, error: userError } = await supabase.from('users').select('name').eq('id', p.user_id).maybeSingle();
  if (userError) return { ok: false, error: userError.message };
  if (!user) return { ok: false, error: 'Không tìm thấy người dùng' };

  const { error } = await supabase
    .from('personas')
    .upsert({ user_id: p.user_id, name: user.name, content: p.content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function handleDeletePersona(supabase, p) {
  if (!p.user_id) return { ok: false, error: 'Thiếu người duyệt' };
  const { data, error } = await supabase.from('personas').delete().eq('user_id', p.user_id).select('user_id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy persona' };
  return { ok: true };
}
