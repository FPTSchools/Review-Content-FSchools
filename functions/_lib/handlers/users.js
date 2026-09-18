import { newId } from '../ids.js';
import { normalizeEmail } from '../util.js';

// ============================================================
// USERS — port 1:1 từ handleLogin/handleGetUsers/handleAddUser/handleUpdateUser/handleDeleteUser
// trong backend_apps_script.js (bảng Users → bảng "users" trên Supabase).
// ============================================================

export async function handleLogin(supabase, p) {
  const email = String(p.email || '').trim();
  const password = String(p.password || '');
  if (!email || !password) return { ok: false, error: 'Email hoặc mật khẩu không đúng' };

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password, name, role, campus, active')
    .ilike('email', email)
    .maybeSingle();

  if (error) return { ok: false, error: 'Lỗi hệ thống, thử lại sau' };
  if (!user || user.password !== password || user.active !== true) {
    return { ok: false, error: 'Email hoặc mật khẩu không đúng' };
  }

  const now = new Date().toISOString();
  await supabase.from('users').update({ last_login: now }).eq('id', user.id);

  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, campus: user.campus, last_login: now }
  };
}

export async function handleGetUsers(supabase) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, campus, active, created_at, last_login')
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, users: data };
}

export async function handleAddUser(supabase, p) {
  if (!p.email || !p.password || !p.name || !p.role) {
    return { ok: false, error: 'Thiếu thông tin bắt buộc (email/password/name/role)' };
  }
  const email = normalizeEmail(p.email);
  if (!email) return { ok: false, error: 'Email không hợp lệ: ' + p.email };
  const id = newId('USR');
  const { error } = await supabase.from('users').insert({
    id,
    email,
    password: p.password, // TODO bảo mật: nên hash trước khi lưu — xem ghi chú trong schema.sql
    name: p.name,
    role: p.role,
    campus: p.campus || null,
    active: true
  });
  if (error) return { ok: false, error: error.message };

  // TODO: backend cũ gửi email thông báo tài khoản mới qua GmailApp — backend mới chưa có
  // provider gửi email (cần chọn Resend/SendGrid/... ở phase sau). Tạm thời KHÔNG gửi mail,
  // admin cần tự báo mật khẩu cho người dùng mới qua kênh khác.
  return { ok: true, id, email_sent: false };
}

export async function handleUpdateUser(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const patch = {};
  if (p.name) patch.name = p.name;
  if (p.email) {
    const email = normalizeEmail(p.email);
    if (!email) return { ok: false, error: 'Email không hợp lệ: ' + p.email };
    patch.email = email;
  }
  if (p.role) patch.role = p.role;
  if (p.campus !== undefined) patch.campus = p.campus;
  if (p.password) patch.password = p.password; // TODO bảo mật: nên hash

  const { data, error } = await supabase.from('users').update(patch).eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy user' };

  if (p.password) {
    // TODO: backend cũ gửi email mật khẩu mới qua GmailApp — chưa có provider email ở backend mới.
    return { ok: true, email_sent: false };
  }
  return { ok: true };
}

export async function handleDeleteUser(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const { data, error } = await supabase.from('users').delete().eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy user' };
  return { ok: true };
}
