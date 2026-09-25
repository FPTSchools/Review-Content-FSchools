// ============================================================
// PHIÊN ĐĂNG NHẬP — token ký HMAC-SHA256, không cần bảng phiên trong DB.
//
// Token = base64url(JSON{u,exp,pv}) + "." + base64url(HMAC(SESSION_SECRET, phần trước)).
//   u   = id người dùng, exp = hạn (ms), pv = "dấu vân tay" của mật khẩu hiện tại.
// Đổi mật khẩu → pv đổi → mọi token cũ của người đó tự mất hiệu lực (không cần bảng thu hồi).
// Tài khoản bị tắt/xoá cũng mất hiệu lực vì router luôn tra lại user từ DB ở mỗi request.
// Chỉ đăng nhập lại mới có token mới; SESSION_SECRET chỉ nằm ở secret Cloudflare / .dev.vars.
// ============================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64urlFromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function getSecret(env) {
  const secret = env && env.SESSION_SECRET;
  if (!secret || String(secret).length < 32) throw new Error('SESSION_SECRET chưa được cấu hình (tối thiểu 32 ký tự)');
  return String(secret);
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function sign(secret, message) {
  const key = await hmacKey(secret, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// Dấu vân tay mật khẩu: HMAC(secret, mật khẩu) — không lộ mật khẩu, đổi mật khẩu là đổi giá trị.
export async function passwordFingerprint(env, password) {
  const bytes = await sign(getSecret(env), 'pw:' + String(password || ''));
  return b64urlFromBytes(bytes).slice(0, 16);
}

export async function createSessionToken(env, user) {
  const secret = getSecret(env);
  const payload = {
    u: String(user.id),
    exp: Date.now() + SESSION_TTL_MS,
    pv: await passwordFingerprint(env, user.password)
  };
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const sig = b64urlFromBytes(await sign(secret, body));
  return { token: `${body}.${sig}`, expires_at: new Date(payload.exp).toISOString() };
}

// Trả payload nếu chữ ký đúng và chưa hết hạn, ngược lại null. So khớp chữ ký bằng
// crypto.subtle.verify (thời gian không phụ thuộc nội dung — chống dò chữ ký).
export async function verifySessionToken(env, token) {
  const secret = getSecret(env);
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let sigBytes, payload;
  try {
    sigBytes = bytesFromB64url(parts[1]);
    payload = JSON.parse(dec.decode(bytesFromB64url(parts[0])));
  } catch (e) {
    return null;
  }
  const key = await hmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(parts[0]));
  if (!valid) return null;
  if (!payload || !payload.u || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

// So sánh 2 chuỗi bí mật (dùng cho CRON_SECRET) không lộ độ dài phần khớp.
export async function safeEqual(a, b) {
  const secret = 'compare-' + String(a || '').length; // khoá tạm, chỉ để băm 2 vế cùng độ dài
  const [ha, hb] = await Promise.all([sign(secret, String(a || '')), sign(secret, String(b || ''))]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < ha.length && i < hb.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
