import { sendViaResend } from '../resend.js';

// ============================================================
// EMAIL QUEUE PROCESSOR — port từ processEmailQueue trong backend_apps_script.js.
// Bản gốc chạy qua time-based trigger mỗi phút trong Apps Script. Cloudflare Pages Functions
// không có sẵn cơ chế lập lịch — action này CHỈ chạy khi được gọi (thủ công hoặc từ 1 Cloudflare
// Cron Trigger riêng sẽ cấu hình sau, xem PROGRESS.md). Lấy tối đa 20 email mỗi lần gọi, giống
// giới hạn gốc, để tránh 1 lần gọi chạy quá lâu.
// ============================================================

export async function handleProcessEmailQueue(supabase, env) {
  const { data: rows, error } = await supabase
    .from('email_queue')
    .select('*')
    .or('status.eq.queued,and(status.eq.failed,attempts.lt.3)')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) return { ok: false, error: error.message };

  let processed = 0, sent = 0, failed = 0;
  for (const row of rows) {
    processed++;
    await supabase.from('email_queue').update({ status: 'sending', attempts: (row.attempts || 0) + 1 }).eq('id', row.id);
    try {
      await sendViaResend(env, { to: row.to_email, subject: row.subject, html: row.html_body, text: row.body });
      await supabase.from('email_queue').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
      sent++;
    } catch (e) {
      await supabase.from('email_queue').update({ status: 'failed', last_error: String((e && e.message) || e) }).eq('id', row.id);
      failed++;
    }
  }
  return { ok: true, processed, sent, failed };
}
