import { createClient } from '@supabase/supabase-js';

// Dùng service_role key (bỏ qua RLS) vì mọi kiểm tra quyền (role admin/manager/...)
// được xử lý ngay trong code backend này, giống hệt cách backend_apps_script.js cũ làm
// trong từng hàm handle... — Postgres RLS cố tình không có policy nào (xem schema.sql).
export function getServiceClient(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Thiếu biến môi trường SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trên Cloudflare Pages');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}
