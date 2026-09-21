// ============================================================
// Gửi email thật qua Gmail API — thay Resend (Resend cần xác minh domain qua DNS, không khả thi
// vì domain @fpt.edu.vn do IT trung tâm quản lý). Dùng lại đúng tài khoản Gmail đã gửi thành
// công trước đây qua GmailApp (Apps Script) — không cần domain riêng, không tốn phí.
//
// Cơ chế: dùng OAuth2 "refresh token" lấy 1 lần (xem PROGRESS.md phần thiết lập) để đổi lấy
// access token mỗi lần gửi, rồi gọi Gmail API users.messages.send với nội dung email đã mã hoá
// MIME + base64url — đây là cách gửi mail CHÍNH THỨC của Google (khác SMTP thủ công), tương
// đương độ tin cậy với GmailApp cũ vì cùng dùng 1 tài khoản, chỉ khác cách gọi.
// ============================================================

async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Không lấy được access token Gmail: ' + JSON.stringify(data));
  return data.access_token;
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeHeaderUtf8(value) {
  // Tiêu đề (Subject/To/From) có thể chứa tiếng Việt có dấu — mã hoá theo chuẩn MIME
  // (RFC 2047) để không bị lỗi hiển thị ở phần mềm đọc mail.
  return '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(value))) + '?=';
}

function buildMime({ from, to, subject, html, text }) {
  const boundary = 'fschools_boundary_' + Date.now();
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderUtf8(subject || '')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(text || ''))),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html || text || ''))),
    '',
    `--${boundary}--`
  ];
  return lines.join('\r\n');
}

export async function sendViaGmail(env, { to, subject, html, text }) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER_EMAIL) {
    throw new Error('Thiếu biến môi trường GMAIL_* trên server');
  }
  const accessToken = await getAccessToken(env);
  const from = `FSchools Content Review <${env.GMAIL_SENDER_EMAIL}>`;
  const mime = buildMime({ from, to, subject, html, text });
  const raw = base64UrlEncode(mime);

  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json.error && json.error.message) || `Gmail API lỗi HTTP ${resp.status}`);
  return json;
}
