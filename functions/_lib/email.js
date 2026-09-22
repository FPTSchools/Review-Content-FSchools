import { newId } from './ids.js';

// ============================================================
// EMAIL — port từ backend_apps_script.js (sendReviewerEmail/sendForwardEmail/sendCTVEmail).
// Khác biệt: bản Sheets gửi email THẬT ngay qua GmailApp. Backend mới CHƯA có provider gửi
// email (cần chọn ở Phase 3 — vd Resend/SendGrid) nên ở đây chỉ GHI vào bảng "email_queue",
// y hệt cơ chế enqueueEmail cũ — không mất thông báo, chỉ tạm thời chưa gửi thật được.
// ============================================================

const CAMPUS_MAP = { hoa_lac: 'FSC Hòa Lạc', tay_hn: 'FSC Tây HN', chung: 'Cả 2' };
const APP_NAME = 'FSchools Content Review';

function emailHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
}

function openButtonHtml(link, label) {
  const safeLink = emailHtml(link);
  return `<p style="margin:20px 0"><a href="${safeLink}" style="display:inline-block;background:#F26522;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600">${emailHtml(label || 'Mở bài cần duyệt')}</a></p>` +
    `<p style="font-size:12px;color:#666">Nếu nút không hoạt động, sao chép đường dẫn sau vào trình duyệt:<br><a href="${safeLink}">${safeLink}</a></p>`;
}

function fileForRole(role) {
  return (role === 'ctv' || role === 'leader_content') ? 'ctv.html' : 'boss.html';
}

async function buildOpenLink(supabase, appUrl, email, submissionId) {
  if (!submissionId) return appUrl;
  let role = 'ctv';
  try {
    const { data } = await supabase.from('users').select('role').ilike('email', email || '').maybeSingle();
    if (data) role = data.role;
  } catch (e) {}
  return String(appUrl).replace(/\/$/, '') + '/' + fileForRole(role) + '?open=' + encodeURIComponent(String(submissionId));
}

export async function enqueueEmail(supabase, email, name, subject, body, htmlBody, eventKey) {
  if (!email) return { ok: false, error: 'Thiếu địa chỉ email' };
  const key = String(eventKey || ('EMAIL_' + Date.now() + '_' + Math.random().toString(36).slice(2)));

  const { data: dup } = await supabase
    .from('email_queue')
    .select('id')
    .eq('event_key', key)
    .neq('status', 'failed')
    .maybeSingle();
  if (dup) return { ok: true, queued: false, duplicate: true, id: dup.id };

  const id = newId('MAIL');
  const { error } = await supabase.from('email_queue').insert({
    id, event_key: key, to_email: String(email), to_name: String(name || ''),
    subject: String(subject || ''), body: String(body || ''), html_body: String(htmlBody || ''),
    status: 'queued', attempts: 0, created_at: new Date().toISOString()
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, queued: true, id };
}

export async function sendReviewerEmail(supabase, env, email, name, d, id, orderNum) {
  const appUrl = env.APP_URL || '';
  const subject = `[Duyệt bài] ${d.user_name}: ${d.title}`;
  const platformTxt = Array.isArray(d.platform) ? d.platform.join(', ') : '';
  const link = await buildOpenLink(supabase, appUrl, email, id);
  const body = `Chào ${name},\n\n${d.user_name} vừa gửi bài cần bạn duyệt.\n\n` +
    `Tiêu đề  : ${d.title}\n` +
    `Loại     : ${d.content_type || ''}\n` +
    (platformTxt ? `Nền tảng : ${platformTxt}\n` : '') +
    `Cơ sở    : ${CAMPUS_MAP[d.campus] || d.campus || ''}\n` +
    `Ghi chú  : ${d.note || '(không có)'}\n\n` +
    `Bạn có thể duyệt luôn hoặc chuyển lên người duyệt tiếp theo nếu cần.\n\n` +
    `Bấm vào đây để mở bài: ${link}\n\n${APP_NAME}`;
  const htmlBody = `<p>Chào ${emailHtml(name)},</p>` +
    `<p><b>${emailHtml(d.user_name)}</b> vừa gửi bài cần bạn duyệt.</p>` +
    `<p><b>Tiêu đề:</b> ${emailHtml(d.title)}<br><b>Loại:</b> ${emailHtml(d.content_type || '')}<br><b>Cơ sở:</b> ${emailHtml(CAMPUS_MAP[d.campus] || d.campus || '')}<br><b>Ghi chú:</b> ${emailHtml(d.note || '(không có)')}</p>` +
    `<p>Bạn có thể duyệt luôn hoặc chuyển lên người duyệt tiếp theo.</p>${openButtonHtml(link, 'Mở bài cần duyệt')}<p>${emailHtml(APP_NAME)}</p>`;
  return enqueueEmail(supabase, email, name, subject, body, htmlBody, `reviewer:${id}:${d.send_count || 1}:${orderNum || 1}:${email}`);
}

export async function sendForwardEmail(supabase, env, email, name, d, id, forwarderName, orderNum) {
  const appUrl = env.APP_URL || '';
  const subject = `[Chuyển duyệt] ${forwarderName} → bạn: ${d.title}`;
  const platformTxt = Array.isArray(d.platform) ? d.platform.join(', ') : '';
  const link = await buildOpenLink(supabase, appUrl, email, id);
  const body = `Chào ${name},\n\n${forwarderName} vừa chuyển bài "${d.title}" lên để bạn duyệt.\n\n` +
    `Tiêu đề  : ${d.title}\n` +
    `Loại     : ${d.content_type || ''}\n` +
    (platformTxt ? `Nền tảng : ${platformTxt}\n` : '') +
    `Cơ sở    : ${CAMPUS_MAP[d.campus] || d.campus || ''}\n\n` +
    `Bấm vào đây để mở bài: ${link}\n\n${APP_NAME}`;
  const htmlBody = `<p>Chào ${emailHtml(name)},</p>` +
    `<p>${emailHtml(forwarderName)} vừa chuyển bài <b>${emailHtml(d.title)}</b> lên để bạn duyệt.</p>` +
    `<p><b>Người gửi:</b> ${emailHtml(d.user_name)}<br><b>Loại:</b> ${emailHtml(d.content_type || '')}<br><b>Cơ sở:</b> ${emailHtml(CAMPUS_MAP[d.campus] || d.campus || '')}</p>` +
    `${openButtonHtml(link, 'Mở bài được chuyển duyệt')}<p>${emailHtml(APP_NAME)}</p>`;
  return enqueueEmail(supabase, email, name, subject, body, htmlBody, `forward:${id}:${d.send_count || 1}:${orderNum || 1}:${email}`);
}

export async function sendNewAccountEmail(supabase, env, email, name, password) {
  const appUrl = env.APP_URL || '';
  const loginLink = String(appUrl).replace(/\/$/, '') + '/index.html';
  const subject = `Tài khoản ${APP_NAME}`;
  const body = `Chào ${name},\n\nTài khoản của bạn trên ${APP_NAME} đã được tạo.\n\n` +
    `Email    : ${email}\n` +
    `Mật khẩu : ${password}\n\n` +
    `Đăng nhập tại: ${loginLink}\n\n${APP_NAME}`;
  const htmlBody = `<p>Chào ${emailHtml(name)},</p>` +
    `<p>Tài khoản của bạn trên <b>${emailHtml(APP_NAME)}</b> đã được tạo.</p>` +
    `<p><b>Email:</b> ${emailHtml(email)}<br><b>Mật khẩu:</b> ${emailHtml(password)}</p>` +
    openButtonHtml(loginLink, 'Đăng nhập ngay') + `<p>${emailHtml(APP_NAME)}</p>`;
  return enqueueEmail(supabase, email, name, subject, body, htmlBody, `new_account:${email}:${Date.now()}`);
}

export async function sendPasswordChangedEmail(supabase, env, email, name, password) {
  const appUrl = env.APP_URL || '';
  const loginLink = String(appUrl).replace(/\/$/, '') + '/index.html';
  const subject = `Mật khẩu mới - ${APP_NAME}`;
  const body = `Chào ${name},\n\nMật khẩu tài khoản của bạn trên ${APP_NAME} vừa được đổi.\n\n` +
    `Email       : ${email}\n` +
    `Mật khẩu mới: ${password}\n\n` +
    `Đăng nhập tại: ${loginLink}\n\n${APP_NAME}`;
  const htmlBody = `<p>Chào ${emailHtml(name)},</p>` +
    `<p>Mật khẩu tài khoản của bạn trên <b>${emailHtml(APP_NAME)}</b> vừa được đổi.</p>` +
    `<p><b>Email:</b> ${emailHtml(email)}<br><b>Mật khẩu mới:</b> ${emailHtml(password)}</p>` +
    openButtonHtml(loginLink, 'Đăng nhập ngay') + `<p>${emailHtml(APP_NAME)}</p>`;
  return enqueueEmail(supabase, email, name, subject, body, htmlBody, `password_changed:${email}:${Date.now()}`);
}

export async function sendCTVEmail(supabase, env, email, name, title, status, comment, score, id, revisionNo) {
  const appUrl = env.APP_URL || '';
  const lbl = { approved: '✅ ĐÃ DUYỆT', revision: '🔁 CẦN SỬA', rejected: '❌ TỪ CHỐI' };
  const subject = `[Kết quả] ${lbl[status] || status} — "${title}"`;
  const link = id ? (String(appUrl).replace(/\/$/, '') + '/ctv.html?open=' + encodeURIComponent(String(id))) : '';
  const body = `Chào ${name},\n\nBài "${title}" vừa được xem xét.\n\n` +
    `Kết quả : ${lbl[status] || status}\n` +
    (score ? `Điểm    : ${score}/10\n` : '') +
    `Nhận xét: ${comment || '(không có)'}\n\n` +
    (link ? `Bấm vào đây để mở bài: ${link}\n\n` : '') +
    `Trân trọng,\n${APP_NAME}`;
  const htmlBody = `<p>Chào ${emailHtml(name)},</p>` +
    `<p>Bài <b>${emailHtml(title)}</b> vừa được xem xét.</p>` +
    `<p><b>Kết quả:</b> ${emailHtml(lbl[status] || status)}${score ? `<br><b>Điểm:</b> ${emailHtml(score)}/10` : ''}<br><b>Nhận xét:</b> ${emailHtml(comment || '(không có)')}</p>` +
    (link ? openButtonHtml(link, 'Mở bài của tôi') : '') + `<p>Trân trọng,<br>${emailHtml(APP_NAME)}</p>`;
  return enqueueEmail(supabase, email, name, subject, body, htmlBody, `ctv:${id}:${revisionNo || 1}:${status}`);
}
