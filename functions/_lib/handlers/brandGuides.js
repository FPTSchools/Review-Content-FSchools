import { newId } from '../ids.js';

// ============================================================
// BRAND GUIDES — port từ handleGetBrandGuides/handleSaveBrandGuideText/handleDeleteBrandGuide.
// type='image' (ảnh mẫu) lưu trên Supabase Storage bucket "brand-guides" (bucket public — xem
// migration 20260923080026_brand_guide_storage_bucket.sql để biết lý do để public). Cột
// brand_guides.content lưu thẳng URL công khai của ảnh — ai.js (resolveImageUrl) đã sẵn sàng
// nhận URL http(s) trực tiếp từ trước (chỉ cần thêm nhánh Drive file id cho dữ liệu Drive cũ),
// nên không cần sửa gì ở phía dùng ảnh cho AI chấm brand guide.
// ============================================================

const BRAND_GUIDE_BUCKET = 'brand-guides';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // khớp file_size_limit đã đặt cho bucket

function extFromMimeType(mimeType) {
  return String(mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
}

export async function handleGetBrandGuides(supabase) {
  const { data, error } = await supabase
    .from('brand_guides')
    .select('id, name, type, content, mime_type, updated_at');
  if (error) return { ok: false, error: error.message };

  const guides = data.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    content: r.type === 'text' ? r.content : '',
    file_id: r.type === 'image' ? r.content : '',
    mime_type: r.mime_type || '',
    updated_at: r.updated_at || ''
  }));
  return { ok: true, guides };
}

export async function handleSaveBrandGuideText(supabase, p) {
  if (!p.name || !p.content) return { ok: false, error: 'Thiếu tên hoặc nội dung' };
  const now = new Date().toISOString();

  const { data: existing, error: findError } = await supabase
    .from('brand_guides')
    .select('id')
    .eq('name', p.name)
    .eq('type', 'text')
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  if (existing) {
    const { error } = await supabase
      .from('brand_guides')
      .update({ content: p.content, updated_at: now })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: existing.id };
  }

  const id = newId('BG');
  const { error } = await supabase
    .from('brand_guides')
    .insert({ id, name: p.name, type: 'text', content: p.content, mime_type: null, updated_at: now });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

export async function handleSaveBrandGuideImage(supabase, p) {
  if (!p.name || !p.image_base64) return { ok: false, error: 'Thiếu tên hoặc ảnh' };
  const mimeType = p.mime_type || 'image/png';
  if (!/^image\/(png|jpe?g|webp)$/i.test(mimeType)) {
    return { ok: false, error: 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP' };
  }

  let bytes;
  try {
    bytes = Uint8Array.from(atob(p.image_base64), c => c.charCodeAt(0));
  } catch (e) {
    return { ok: false, error: 'Dữ liệu ảnh không hợp lệ' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Ảnh quá lớn (tối đa 5MB)' };

  const id = newId('BG');
  const path = `${id}.${extFromMimeType(mimeType)}`;

  const { error: uploadError } = await supabase.storage
    .from(BRAND_GUIDE_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) return { ok: false, error: 'Lỗi tải ảnh lên: ' + uploadError.message };

  const { data: pub } = supabase.storage.from(BRAND_GUIDE_BUCKET).getPublicUrl(path);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('brand_guides')
    .insert({ id, name: p.name, type: 'image', content: pub.publicUrl, mime_type: mimeType, updated_at: now });
  if (error) {
    // Lưu DB thất bại — dọn lại file vừa tải lên, tránh rác mồ côi trong storage.
    try { await supabase.storage.from(BRAND_GUIDE_BUCKET).remove([path]); } catch (e) {}
    return { ok: false, error: error.message };
  }
  return { ok: true, id };
}

export async function handleDeleteBrandGuide(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  const { data: row } = await supabase.from('brand_guides').select('type, mime_type').eq('id', p.id).maybeSingle();

  const { data, error } = await supabase.from('brand_guides').delete().eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy' };

  if (row && row.type === 'image') {
    const path = `${p.id}.${extFromMimeType(row.mime_type)}`;
    try { await supabase.storage.from(BRAND_GUIDE_BUCKET).remove([path]); } catch (e) {}
  }
  return { ok: true };
}
