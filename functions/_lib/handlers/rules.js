// ============================================================
// RULES — port 1:1 từ handleGetRules/handleSaveRules trong backend_apps_script.js.
// Bảng "rules" lưu theo dòng-theo-loại (type: banned/required/brand_voice/logo_rules/history),
// giống hệt cấu trúc sheet "Rules" cũ — save luôn xoá hết và ghi lại toàn bộ.
// ============================================================

export async function handleGetRules(supabase) {
  const { data, error } = await supabase.from('rules').select('type, value, category, date');
  if (error) return { ok: false, error: error.message };

  const rules = { banned_words: [], required_elements: [], brand_voice: '', logo_rules: '', history: [] };
  for (const r of data) {
    if (r.type === 'banned') rules.banned_words.push({ text: r.value, type: r.category, date: r.date });
    if (r.type === 'required') rules.required_elements.push(r.value);
    if (r.type === 'brand_voice') rules.brand_voice = r.value;
    if (r.type === 'logo_rules') rules.logo_rules = r.value;
    if (r.type === 'history') rules.history.push({ action: r.value, date: r.date });
  }
  return { ok: true, rules };
}

export async function handleSaveRules(supabase, p) {
  const r = p.rules || {};
  const { error: delError } = await supabase.from('rules').delete().neq('id', -1);
  if (delError) return { ok: false, error: delError.message };

  const now = new Date().toISOString();
  const rows = [];
  (r.banned_words || []).forEach(w => rows.push({ type: 'banned', value: w.text, category: w.type, date: now }));
  (r.required_elements || []).forEach(e => rows.push({ type: 'required', value: e, category: null, date: now }));
  if (r.brand_voice) rows.push({ type: 'brand_voice', value: r.brand_voice, category: null, date: now });
  if (r.logo_rules) rows.push({ type: 'logo_rules', value: r.logo_rules, category: null, date: now });
  (r.history || []).forEach(h => rows.push({ type: 'history', value: h.action, category: null, date: h.date || now }));

  if (rows.length) {
    const { error: insError } = await supabase.from('rules').insert(rows);
    if (insError) return { ok: false, error: insError.message };
  }
  return { ok: true };
}
