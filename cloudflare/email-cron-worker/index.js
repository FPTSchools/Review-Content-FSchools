// Worker riêng, chỉ để lập lịch — không chứa logic nghiệp vụ. Toàn bộ logic gửi email
// (đọc email_queue, gọi Resend) nằm ở functions/_lib/handlers/emailQueue.js trong project
// chính; worker này chỉ gọi vào đúng action đó qua HTTP mỗi khi Cron Trigger bắn.
const API_URL = 'https://review-content-fschools.pages.dev/api';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_email_queue' })
      })
    );
  },

  // Cho phép gọi thủ công qua trình duyệt/PowerShell để kiểm tra worker còn sống, không cần
  // đợi đến kỳ Cron tiếp theo.
  async fetch(request, env, ctx) {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process_email_queue' })
    });
    return new Response(await resp.text(), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
  }
};
