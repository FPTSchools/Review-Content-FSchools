// Chuyển MẬT KHẨU đang lưu chữ thường sang dạng băm (PBKDF2) cho mọi tài khoản, và xoá mật khẩu còn nằm lại trong email đã gửi.
// Chạy khô (chỉ đếm, không ghi):  node migration/hash_passwords.mjs
// Ghi thật:                       node migration/hash_passwords.mjs --apply
// An toàn khi chạy lại (bỏ qua mật khẩu đã băm). Hệ quả: mọi phiên đăng nhập đang mở bị đăng xuất 1 lần (phiên gắn với mật khẩu đã lưu).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { hashPassword, isHashed } from '../functions/_lib/password.js';

const apply = process.argv.includes('--apply');
const env = {};
for (const l of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users, error } = await sb.from('users').select('id, email, password');
if (error) { console.error(error.message); process.exit(1); }
const plain = users.filter(u => !isHashed(u.password));
console.log(`Tài khoản: ${users.length} · còn chữ thường: ${plain.length}`);
if (apply) {
  for (const u of plain) {
    const hashed = await hashPassword(u.password);
    const { error: e } = await sb.from('users').update({ password: hashed }).eq('id', u.id).eq('password', u.password);   // chỉ ghi nếu mật khẩu chưa bị đổi trong lúc chạy
    console.log(' ', u.email, e ? 'LỖI ' + e.message : 'đã băm');
  }
}

const { data: mails } = await sb.from('email_queue').select('id, event_key, body')
  .or('event_key.like.new_account:%,event_key.like.password_changed:%').eq('status', 'sent').neq('body', '[Nội dung có mật khẩu — đã xoá sau khi gửi]');
console.log(`Email còn chứa mật khẩu: ${(mails || []).length}`);
if (apply && (mails || []).length) {
  const { error: e } = await sb.from('email_queue').update({ body: '[Nội dung có mật khẩu — đã xoá sau khi gửi]', html_body: '[Nội dung có mật khẩu — đã xoá sau khi gửi]' }).in('id', mails.map(m => m.id));
  console.log(e ? 'LỖI xoá nội dung email: ' + e.message : 'Đã xoá nội dung email chứa mật khẩu');
}
if (!apply) console.log('(chạy khô — thêm --apply để ghi thật)');
