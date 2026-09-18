// ============================================================
// Gửi email thật qua Resend — thay GmailApp trong bản Apps Script cũ.
// Dùng domain gửi mặc định của Resend (onboarding@resend.dev) vì chưa xác minh domain riêng
// @fpt.edu.vn — đổi FROM_ADDRESS ở đây khi domain đã được xác minh trên Resend.
// ============================================================

const RESEND_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'FSchools Content Review <onboarding@resend.dev>';

export async function sendViaResend(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) throw new Error('Thiếu RESEND_API_KEY trên server');
  const resp = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html: html || undefined,
      text: text || undefined
    })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json && (json.message || json.name)) || `Resend lỗi HTTP ${resp.status}`);
  return json;
}
