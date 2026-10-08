// ============================================================
// CHỐNG DÒ MẬT KHẨU — đếm đăng nhập sai theo email, IP và cặp email+IP (bảng login_attempts), tạm khoá khi sai nhiều lần.
// Khoá theo CẶP email+IP là chính (5 lần): người lạ dò mật khẩu của 1 tài khoản không khoá được chủ tài khoản đang đăng nhập
// từ máy khác. Hai ngưỡng rộng hơn (theo email 10 lần, theo IP 30 lần) chặn kẻ dò đổi IP hoặc dò nhiều tài khoản từ 1 máy; IP
// ngưỡng cao vì cả trường dùng chung 1 mạng. Hết thời gian khoá thì tự mở lại. Khoá áp dụng cả khi email không tồn tại
// (không lộ email nào có trong hệ thống).
// ============================================================

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const LIMITS = { ei: 5, e: 10, ip: 30 };

export function loginKeys(email, ip) {
  const e = String(email || '').trim().toLowerCase().slice(0, 200);
  const i = String(ip || 'unknown').slice(0, 64);
  return { ei: `ei:${e}|${i}`, e: `e:${e}`, ip: `ip:${i}` };
}

// Trả về số phút còn bị khoá (0 nếu không bị khoá) + các dòng đã đọc (dùng lại khi ghi nhận lần sai).
export async function checkLoginLock(supabase, keys) {
  const { data } = await supabase.from('login_attempts').select('*').in('key', Object.values(keys));
  const rows = {};
  (data || []).forEach(r => { rows[r.key] = r; });
  const now = Date.now();
  let until = 0;
  Object.values(rows).forEach(r => { const t = r.locked_until ? Date.parse(r.locked_until) : 0; if (t > now && t > until) until = t; });
  return { minutes: until ? Math.max(1, Math.ceil((until - now) / 60000)) : 0, rows };
}

export async function recordLoginFailure(supabase, keys, rows) {
  const now = Date.now();
  const upserts = Object.entries(keys).map(([kind, key]) => {
    const r = rows[key];
    const fresh = !r || (now - Date.parse(r.window_start) > WINDOW_MS && !(r.locked_until && Date.parse(r.locked_until) > now));
    const fails = (fresh ? 0 : r.fails) + 1;
    const locked = fails >= LIMITS[kind];
    return {
      key, fails: locked ? 0 : fails, window_start: fresh ? new Date(now).toISOString() : r.window_start,
      locked_until: locked ? new Date(now + LOCK_MS).toISOString() : (r && r.locked_until) || null
    };
  });
  await supabase.from('login_attempts').upsert(upserts, { onConflict: 'key' });
  if (Math.random() < 0.02) await supabase.from('login_attempts').delete().lt('window_start', new Date(now - 24 * 3600 * 1000).toISOString());
}

// Đăng nhập đúng: xoá bộ đếm của email và cặp email+IP (bộ đếm IP giữ nguyên).
export async function clearLoginFailures(supabase, keys) {
  await supabase.from('login_attempts').delete().in('key', [keys.ei, keys.e].filter(Boolean));
}
