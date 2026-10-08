import { newId } from '../ids.js';
import { loadPublishTarget } from './publish.js';

// ============================================================
// KẾT NỐI KÊNH ĐĂNG + CHUẨN BỊ BÀI ĐĂNG THEO KÊNH.
// Giai đoạn 1 (hiện tại): chỉ KHAI BÁO kênh (bảng channel_accounts, status 'khai_bao') và soạn sẵn "gói bài đăng" cho từng kênh
// (văn bản thuần theo giới hạn của kênh + danh sách ảnh) để người đăng sao chép nhanh. Chưa gọi API của nền tảng nào — khi nối
// API thật, token lưu ở bảng riêng, còn bảng này vẫn là danh sách hiển thị an toàn cho mọi người dùng.
// Xem: moi người dùng xem được kênh của cơ sở mình + dùng chung; thêm/sửa/xoá: manager, admin.
// ============================================================

const MANAGE_ROLES = ['manager', 'admin'];
const CAMPUSES = ['hoa_lac', 'tay_hn', 'chung'];
const ACCOUNT_CHANNELS = ['facebook', 'tiktok', 'zalo', 'youtube', 'web'];
// Giới hạn ký tự khuyến nghị cho phần mô tả/nội dung của từng kênh (người đăng thấy cảnh báo khi vượt).
const CHANNEL_LIMITS = { facebook: 63206, instagram: 2200, tiktok: 2200, youtube: 5000, zalo: 2000, web: 100000, email: 100000, sms: 300 };

async function getActor(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('id, name, role, campus, active').eq('id', userId).maybeSingle();
  return data && data.active !== false ? data : null;
}
const visibleCampuses = a => (['manager', 'admin', 'leader'].includes(a.role) || a.campus === 'chung') ? CAMPUSES : [a.campus, 'chung'];
const cleanText = (v, max) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max || 300) : null; };
const cleanUrl = v => { const s = String(v || '').trim(); return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 500) : null; };

export async function handleGetChannelAccounts(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor) return { ok: false, error: 'Chưa đăng nhập' };
  let q = supabase.from('channel_accounts')
    .select('id, channel, campus, name, external_id, page_url, note, status, connected_at, expires_at, created_by_name, created_at')
    .in('campus', visibleCampuses(actor)).order('channel').order('campus').order('name');
  if (p.channel) q = q.eq('channel', p.channel);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, accounts: data || [], can_manage: MANAGE_ROLES.includes(actor.role) };
}

export async function handleSaveChannelAccount(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !MANAGE_ROLES.includes(actor.role)) return { ok: false, error: 'Chỉ Trưởng ban/Admin được khai báo kênh đăng' };
  const a = p.account || {};
  const name = cleanText(a.name, 120);
  if (!name) return { ok: false, error: 'Thiếu tên kênh' };
  if (!ACCOUNT_CHANNELS.includes(a.channel)) return { ok: false, error: 'Loại kênh không hợp lệ' };
  if (!CAMPUSES.includes(a.campus)) return { ok: false, error: 'Cơ sở không hợp lệ' };
  const pageUrl = cleanUrl(a.page_url);
  if (String(a.page_url || '').trim() && !pageUrl) return { ok: false, error: 'Link kênh phải bắt đầu bằng http:// hoặc https://' };
  const row = {
    channel: a.channel, campus: a.campus, name, external_id: cleanText(a.external_id, 200), page_url: pageUrl,
    note: cleanText(a.note, 300), updated_at: new Date().toISOString()
  };
  if (a.id) {
    const { data, error } = await supabase.from('channel_accounts').update(row).eq('id', a.id).select('id');
    if (error) return { ok: false, error: error.message };
    if (!data || !data.length) return { ok: false, error: 'Không tìm thấy kênh' };
    return { ok: true, id: a.id };
  }
  const id = newId('CHA') + '_' + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase.from('channel_accounts').insert({ id, ...row, created_by: actor.id, created_by_name: actor.name });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

export async function handleDeleteChannelAccount(supabase, p) {
  const actor = await getActor(supabase, p.user_id);
  if (!actor || !MANAGE_ROLES.includes(actor.role)) return { ok: false, error: 'Chỉ Trưởng ban/Admin được xoá kênh đăng' };
  const { error } = await supabase.from('channel_accounts').delete().eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------- Gói bài đăng theo kênh ----------------
const DRIVE_FILE_RE = /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)(?:\/[^\s<>"'\]]*)?/g;

// Đổi nội dung có ký hiệu định dạng của tool (xem richtext.js) thành văn bản thuần để dán vào kênh: bỏ cỡ chữ/font/màu/gạch chân…,
// bảng thành từng dòng "ô | ô", liên kết thành "chữ (link)", ảnh Google Drive tách ra khỏi văn bản.
export function toPlainPost(content) {
  const images = [];
  let t = String(content || '').replace(/\r\n?/g, '\n');
  t = t.replace(DRIVE_FILE_RE, (m, id) => { if (!images.some(i => i.id === id)) images.push({ id, url: `https://drive.google.com/file/d/${id}/view` }); return ''; });
  t = t.replace(/\[table(?:=h)?\]\n?([\s\S]*?)\n?\[\/table\]/g, (m, body) =>
    '\n' + body.split('\n').map(r => r.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim()).join(' | ')).join('\n') + '\n');
  t = t.replace(/\[link=((?:https?:\/\/|mailto:)[^\]\s]+)\]([\s\S]*?)\[\/link\]/g, (m, url, inner) => (inner.trim() === url || !inner.trim() ? url : `${inner} (${url})`));
  t = t.replace(/\[size=\d{1,3}\]([\s\S]*?)\[\/size\]/g, '$1')
    .replace(/\[font=[A-Za-z ]{2,30}\]([\s\S]*?)\[\/font\]/g, '$1')
    .replace(/\[color=#[0-9a-fA-F]{6}\]([\s\S]*?)\[\/color\]/g, '$1')
    .replace(/\[bg=#[0-9a-fA-F]{6}\]([\s\S]*?)\[\/bg\]/g, '$1');
  t = t.replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/__([\s\S]+?)__/g, '$1').replace(/~~([\s\S]+?)~~/g, '$1').replace(/\*([^*\n]+?)\*/g, '$1');
  t = t.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, images };
}

export async function handleGetPublishPackage(supabase, p) {
  const tg = await loadPublishTarget(supabase, p);
  if (tg.error) return { ok: false, error: tg.error };
  const { data: sub } = await supabase.from('submissions').select('id, title, content, drive_links, campus').eq('id', tg.sub.id).maybeSingle();
  if (!sub) return { ok: false, error: 'Không tìm thấy bài viết' };
  const plain = toPlainPost(sub.content);
  // Link Drive người viết dán ở ô "Ảnh/video": ảnh nào chưa có trong nội dung thì thêm vào danh sách.
  const driveLinks = String(sub.drive_links || '').split(/\s+/).filter(u => /^https?:\/\//i.test(u));
  const files = [...plain.images.map(i => i.url)];
  driveLinks.forEach(u => { const m = /\/d\/([a-zA-Z0-9_-]+)/.exec(u); const k = m ? `https://drive.google.com/file/d/${m[1]}/view` : u; if (!files.includes(k)) files.push(k); });
  return {
    ok: true, submission_id: sub.id, channel: tg.channel, campus: sub.campus || 'chung', title: sub.title,
    text: plain.text, files, limit: CHANNEL_LIMITS[tg.channel] || 0
  };
}
