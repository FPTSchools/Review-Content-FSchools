import { newId } from '../ids.js';

// ============================================================
// BRAND GUIDES — port từ handleGetBrandGuides/handleSaveBrandGuideText/handleDeleteBrandGuide.
// type='image' (ảnh mẫu) CHƯA làm ở phase này — cần tích hợp Supabase Storage trước
// (xem handleSaveBrandGuideImage — trả lỗi rõ ràng thay vì im lặng bỏ qua).
// ============================================================

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

export async function handleSaveBrandGuideImage() {
  // TODO: cần bucket Supabase Storage cho ảnh brand guide (thay Google Drive cũ) — làm ở phase sau.
  return { ok: false, error: 'Upload ảnh brand guide chưa được hỗ trợ ở backend mới (đang chờ tích hợp Supabase Storage)' };
}

export async function handleDeleteBrandGuide(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id' };
  // Lưu ý: nếu là type='image' sau này có ảnh lưu trên Supabase Storage, cần xoá cả file storage
  // tương ứng ở đây — chưa cần thiết vì upload ảnh chưa được hỗ trợ (xem handleSaveBrandGuideImage).
  const { data, error } = await supabase.from('brand_guides').delete().eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy' };
  return { ok: true };
}
