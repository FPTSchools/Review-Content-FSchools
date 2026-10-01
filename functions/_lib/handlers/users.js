import { newId } from '../ids.js';
import { normalizeEmail } from '../util.js';
import { sendNewAccountEmail, sendPasswordChangedEmail, sendSelfPasswordChangedEmail } from '../email.js';
import { createSessionToken } from '../session.js';

// ============================================================
// USERS — port 1:1 từ handleLogin/handleGetUsers/handleAddUser/handleUpdateUser/handleDeleteUser
// trong backend_apps_script.js (bảng Users → bảng "users" trên Supabase).
// ============================================================

export async function handleLogin(supabase, env, p) {
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

  const session = await createSessionToken(env, user);
  return {
    ok: true,
    token: session.token,
    expires_at: session.expires_at,
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

export async function handleAddUser(supabase, env, p) {
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

  // Gửi email thông tin đăng nhập qua Gmail API (giữ đúng hành vi bản Apps Script cũ:
  // best-effort, lỗi gửi mail không chặn việc tạo tài khoản).
  let email_sent = false;
  try {
    const res = await sendNewAccountEmail(supabase, env, email, p.name, p.password);
    email_sent = !!(res && res.ok);
  } catch (e) {}
  return { ok: true, id, email_sent };
}

export async function handleUpdateUser(supabase, env, p) {
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

  const { data, error } = await supabase.from('users').update(patch).eq('id', p.id).select('id, email, name').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Không tìm thấy user' };

  if (p.password) {
    let email_sent = false;
    try {
      const res = await sendPasswordChangedEmail(supabase, env, data.email, data.name, p.password);
      email_sent = !!(res && res.ok);
    } catch (e) {}
    return { ok: true, email_sent };
  }
  return { ok: true };
}

// Mỗi người tự sửa hồ sơ của CHÍNH MÌNH (p.user_id bị ép theo phiên ở bindIdentity):
// chỉ được đổi tên hiển thị và mật khẩu. Email, vai trò, cơ sở chỉ Admin sửa (update_user).
// Đổi mật khẩu phải nhập đúng mật khẩu hiện tại; xong thì mọi phiên cũ (máy khác) mất hiệu lực
// và trả token mới để máy đang dùng không bị đăng xuất.
export const MIN_PASSWORD_LENGTH = 8;

export async function handleUpdateMyProfile(supabase, env, p) {
  const { data: user, error } = await supabase
    .from('users').select('id, email, password, name, role, campus, active').eq('id', p.user_id).maybeSingle();
  if (error) return { ok: false, error: 'Lỗi hệ thống, thử lại sau' };
  if (!user || user.active !== true) return { ok: false, error: 'Không tìm thấy tài khoản' };

  const patch = {};
  const name = String(p.name == null ? '' : p.name).trim();
  if (p.name !== undefined) {
    if (!name) return { ok: false, error: 'Tên hiển thị không được để trống' };
    if (name.length > 60) return { ok: false, error: 'Tên hiển thị tối đa 60 ký tự' };
    if (name !== user.name) patch.name = name;
  }

  const newPassword = String(p.new_password || '');
  if (newPassword) {
    if (String(p.current_password || '') !== user.password) return { ok: false, error: 'Mật khẩu hiện tại không đúng' };
    if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự` };
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return { ok: false, error: 'Mật khẩu mới cần có cả chữ và số' };
    if (newPassword === user.password) return { ok: false, error: 'Mật khẩu mới phải khác mật khẩu hiện tại' };
    patch.password = newPassword; // TODO bảo mật: nên hash
  }

  if (!Object.keys(patch).length) return { ok: false, error: 'Không có thay đổi nào để lưu' };

  const { error: upErr } = await supabase.from('users').update(patch).eq('id', user.id);
  if (upErr) return { ok: false, error: upErr.message };

  const updated = { ...user, ...patch };
  const out = {
    ok: true,
    user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, campus: updated.campus }
  };
  if (patch.password) {
    const session = await createSessionToken(env, updated);
    out.token = session.token;
    out.expires_at = session.expires_at;
    try { await sendSelfPasswordChangedEmail(supabase, env, updated.email, updated.name); } catch (e) {}
  }
  return out;
}

export async function handleDeleteUser(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const { data, error } = await supabase.from('users').delete().eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy user' };
  return { ok: true };
}
