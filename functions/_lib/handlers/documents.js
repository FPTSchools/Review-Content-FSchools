import { newId } from '../ids.js';

// ============================================================
// KHO TÀI LIỆU (DocumentCategories / DocumentLinks) — port 1:1 từ backend_apps_script.js.
// Khác biệt so với bản Sheets: allowed_roles giờ là TEXT[] thật (không phải JSON string).
// ============================================================

const DOC_CATEGORY_ROLES = ['ctv', 'leader_content', 'leader', 'manager', 'admin'];
const DOC_CATEGORY_COLORS = ['#FCE4E4','#FDEBD3','#FFF6D6','#E3F3D9','#D8F1EA','#DCEEFB','#E3E4FC','#F1E3FA','#FBE1F0','#E9E9E9'];
const DOC_CATEGORY_DEFAULT_COLOR = '#E9E9E9';

function isDocAdmin(p) {
  return ['admin', 'manager'].includes(String((p || {}).role || ''));
}

function canRoleViewCategory(role, category) {
  if (['admin', 'manager'].includes(String(role || ''))) return true;
  const allowed = Array.isArray(category.allowed_roles) ? category.allowed_roles : [];
  return allowed.includes(role);
}

function parseAllowedRoles(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(r => DOC_CATEGORY_ROLES.includes(r));
}

export async function handleGetDocumentCategories(supabase, p) {
  const role = (p || {}).role || '';
  const { data, error } = await supabase
    .from('document_categories')
    .select('id, name, sort_order, created_by, created_at, color, allowed_roles')
    .order('sort_order', { ascending: true });
  if (error) return { ok: false, error: error.message };

  const categories = data.map(c => ({ ...c, color: c.color || DOC_CATEGORY_DEFAULT_COLOR }));
  const visible = ['admin', 'manager'].includes(role) ? categories : categories.filter(c => canRoleViewCategory(role, c));
  return { ok: true, categories: visible, palette: DOC_CATEGORY_COLORS, roles: DOC_CATEGORY_ROLES };
}

export async function handleAddDocumentCategory(supabase, p) {
  if (!isDocAdmin(p)) return { ok: false, error: 'Chỉ admin/manager được thêm danh mục' };
  const name = String(p.name || '').trim();
  if (!name) return { ok: false, error: 'Thiếu tên danh mục' };
  const color = DOC_CATEGORY_COLORS.includes(p.color) ? p.color : DOC_CATEGORY_DEFAULT_COLOR;
  const allowedRoles = parseAllowedRoles(p.allowed_roles);

  const { data: existing, error: maxError } = await supabase
    .from('document_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (maxError) return { ok: false, error: maxError.message };
  const nextOrder = (existing && existing[0] ? Number(existing[0].sort_order) || 0 : 0) + 1;

  const id = newId('CAT');
  const { error } = await supabase.from('document_categories').insert({
    id, name, sort_order: nextOrder, created_by: p.user_id || p.user_name || null,
    created_at: new Date().toISOString(), color, allowed_roles: allowedRoles
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

export async function handleUpdateDocumentCategory(supabase, p) {
  if (!isDocAdmin(p)) return { ok: false, error: 'Chỉ admin/manager được sửa danh mục' };
  if (!p.id) return { ok: false, error: 'Thiếu id danh mục' };
  const patch = {};
  if (p.name !== undefined) patch.name = String(p.name).trim();
  if (p.sort_order !== undefined) patch.sort_order = Number(p.sort_order) || 0;
  if (p.color !== undefined && DOC_CATEGORY_COLORS.includes(p.color)) patch.color = p.color;
  if (p.allowed_roles !== undefined) patch.allowed_roles = parseAllowedRoles(p.allowed_roles);

  const { data, error } = await supabase.from('document_categories').update(patch).eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy danh mục' };
  return { ok: true };
}

export async function handleDeleteDocumentCategory(supabase, p) {
  if (!isDocAdmin(p)) return { ok: false, error: 'Chỉ admin/manager được xoá danh mục' };
  if (!p.id) return { ok: false, error: 'Thiếu id danh mục' };

  const { count, error: countError } = await supabase
    .from('document_links')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', p.id);
  if (countError) return { ok: false, error: countError.message };
  if (count && count > 0) return { ok: false, error: 'Danh mục còn link bên trong — hãy chuyển hoặc xoá link trước' };

  const { data, error } = await supabase.from('document_categories').delete().eq('id', p.id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, error: 'Không tìm thấy danh mục' };
  return { ok: true };
}

export async function handleGetDocumentLinks(supabase, p) {
  const role = (p || {}).role || '';
  let query = supabase
    .from('document_links')
    .select('id, category_id, title, url, note, added_by_id, added_by_name, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (p && p.category_id) query = query.eq('category_id', p.category_id);

  const { data: links, error } = await query;
  if (error) return { ok: false, error: error.message };

  if (['admin', 'manager'].includes(role)) return { ok: true, links };

  const { data: categories, error: catError } = await supabase
    .from('document_categories')
    .select('id, allowed_roles');
  if (catError) return { ok: false, error: catError.message };
  const visibleCatIds = new Set(categories.filter(c => canRoleViewCategory(role, c)).map(c => String(c.id)));
  return { ok: true, links: links.filter(l => visibleCatIds.has(String(l.category_id))) };
}

export async function handleAddDocumentLink(supabase, p) {
  const title = String(p.title || '').trim();
  const url = String(p.url || '').trim();
  if (!title || !url) return { ok: false, error: 'Thiếu tiêu đề hoặc link' };
  if (!p.category_id) return { ok: false, error: 'Thiếu danh mục' };

  if (!isDocAdmin(p)) {
    const { data: category, error: catError } = await supabase
      .from('document_categories')
      .select('id, allowed_roles')
      .eq('id', p.category_id)
      .maybeSingle();
    if (catError) return { ok: false, error: catError.message };
    if (!category || !canRoleViewCategory(p.role, category)) {
      return { ok: false, error: 'Bạn không có quyền thêm link vào danh mục này' };
    }
  }

  const id = newId('DOC');
  const now = new Date().toISOString();
  const { error } = await supabase.from('document_links').insert({
    id, category_id: p.category_id, title, url, note: p.note || null,
    added_by_id: p.user_id || null, added_by_name: p.user_name || null,
    created_at: now, updated_at: now
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

async function assertLinkOwnerOrAdmin(supabase, p) {
  const { data: link, error } = await supabase
    .from('document_links')
    .select('id, added_by_id')
    .eq('id', p.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!link) return { ok: false, error: 'Không tìm thấy link' };
  const isOwner = String(link.added_by_id || '') === String(p.user_id || '');
  if (!isOwner && !isDocAdmin(p)) return { ok: false, error: 'Bạn không có quyền thao tác trên link này' };
  return { ok: true };
}

export async function handleUpdateDocumentLink(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id link' };
  const guard = await assertLinkOwnerOrAdmin(supabase, p);
  if (!guard.ok) return guard;

  const patch = { updated_at: new Date().toISOString() };
  if (p.title !== undefined) patch.title = String(p.title).trim();
  if (p.url !== undefined) patch.url = String(p.url).trim();
  if (p.note !== undefined) patch.note = p.note;
  if (p.category_id !== undefined) patch.category_id = p.category_id;

  const { error } = await supabase.from('document_links').update(patch).eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function handleDeleteDocumentLink(supabase, p) {
  if (!p.id) return { ok: false, error: 'Thiếu id link' };
  const guard = await assertLinkOwnerOrAdmin(supabase, p);
  if (!guard.ok) return guard;

  const { error } = await supabase.from('document_links').delete().eq('id', p.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
