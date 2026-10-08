// ============================================================
// BĂM MẬT KHẨU — PBKDF2-SHA256 (WebCrypto, chạy được cả trên Cloudflare Workers lẫn Node).
// Định dạng lưu: pbkdf2$<số vòng>$<salt base64>$<hash base64>. Mỗi mật khẩu có salt ngẫu nhiên riêng.
// Cloudflare Workers chỉ cho tối đa 100.000 vòng PBKDF2 nên dùng đúng mức đó; số vòng được ghi trong chuỗi lưu nên sau này
// có thể tăng và hệ thống tự băm lại khi người dùng đăng nhập (needsRehash).
// Mật khẩu cũ dạng chữ thường (chưa băm) vẫn đăng nhập được 1 lần để tự chuyển sang dạng băm (xem handleLogin).
// ============================================================

export const PBKDF2_ITERATIONS = 100000;
const PREFIX = 'pbkdf2$';
const enc = new TextEncoder();

const toB64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export const isHashed = stored => String(stored || '').startsWith(PREFIX);

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `${PREFIX}${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

// So sánh không phụ thuộc thời gian (không lộ độ giống nhau qua thời gian phản hồi).
function constantTimeEqual(a, b) {
  const x = a instanceof Uint8Array ? a : enc.encode(String(a)), y = b instanceof Uint8Array ? b : enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Đúng mật khẩu? Hỗ trợ cả dạng băm (mới) và dạng chữ thường (cũ, chưa chuyển).
export async function verifyPassword(password, stored) {
  const s = String(stored || '');
  if (!isHashed(s)) return constantTimeEqual(String(password), s);
  const parts = s.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false;
  try {
    const expected = fromB64(parts[3]);
    return constantTimeEqual(await derive(password, fromB64(parts[2]), iterations), expected);
  } catch (e) { return false; }
}

// Cần băm lại (còn là chữ thường, hoặc băm với số vòng thấp hơn mức hiện tại)?
export function needsRehash(stored) {
  if (!isHashed(stored)) return true;
  return Number(String(stored).split('$')[1]) < PBKDF2_ITERATIONS;
}
