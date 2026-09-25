// Worker riêng, chỉ để lập lịch — không chứa logic nghiệp vụ. Toàn bộ logic gửi email
// (đọc email_queue, gọi Gmail API) nằm ở functions/_lib/handlers/emailQueue.js trong project
// chính; worker này chỉ gọi vào đúng action đó qua HTTP mỗi khi Cron Trigger bắn.
//
// /api yêu cầu đăng nhập cho mọi action, riêng process_email_queue chỉ nhận khi kèm header
// X-Cron-Secret khớp secret CRON_SECRET của project Pages. Đặt cùng giá trị cho worker này:
//   cd cloudflare/email-cron-worker && npx wrangler secret put CRON_SECRET
const API_URL = 'https://review-content-fschools.pages.dev/api';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': env.CRON_SECRET || '' },
        body: JSON.stringify({ action: 'process_email_queue' })
      })
    );
  },

  // Không còn gọi hộ /api cho người lạ (mang theo khoá bí mật) — chỉ báo worker còn sống.
  async fetch() {
    return new Response('email cron worker alive', { status: 200 });
  }
};
