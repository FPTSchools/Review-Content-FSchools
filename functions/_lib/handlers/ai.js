import { handleGetRules } from './rules.js';
import { callOpenAI, callOpenAIVision, callOpenAIChat } from '../openai.js';

// ============================================================
// AI — port từ handleAiCheckContent/handleAiSuggestReview/handleAiCheckBrandImage/
// handleAiChat/buildAiRulesContext trong backend_apps_script.js.
// ============================================================

async function getTextBrandGuides(supabase) {
  const { data } = await supabase.from('brand_guides').select('name, content').eq('type', 'text');
  return (data || []).map(r => `\n\n--- Brand guide: ${r.name || ''} ---\n${r.content}`).join('');
}

async function getImageBrandGuides(supabase) {
  const { data } = await supabase.from('brand_guides').select('name, content').eq('type', 'image');
  return (data || []).map(r => ({ name: r.name, file_id: r.content }));
}

async function getPersonaContent(supabase, reviewerName) {
  if (!reviewerName) return '';
  try {
    const { data } = await supabase.from('personas').select('content').eq('name', reviewerName).maybeSingle();
    return data ? data.content : '';
  } catch (e) { return ''; }
}

// Ảnh cần chấm có thể là URL trực tiếp (Supabase Storage sau này) hoặc file id Google Drive
// (frontend hiện tại vẫn đang dùng Drive cho đến khi cắt hẳn sang backend mới).
function resolveImageUrl(fileId) {
  if (/^https?:\/\//i.test(fileId)) return fileId;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

async function buildAiRulesContext(supabase) {
  let rules = { banned_words: [], required_elements: [], brand_voice: '', logo_rules: '', history: [] };
  try {
    const result = await handleGetRules(supabase);
    if (result && result.rules) rules = result.rules;
  } catch (e) {}

  const bannedList = (rules.banned_words || []).map(w => (typeof w === 'object' ? w.text : w)).filter(Boolean);
  const required = (rules.required_elements || []).filter(Boolean);
  const brandGuideText = await getTextBrandGuides(supabase);
  const imageGuides = await getImageBrandGuides(supabase);

  const sections = [
    '=== QUY TẮC KIỂM DUYỆT DO ADMIN CÀI ĐẶT ===',
    `Giọng thương hiệu: ${rules.brand_voice || '(chưa cài đặt)'}`,
    `Yếu tố bắt buộc: ${required.length ? required.join('; ') : '(chưa cài đặt)'}`,
    `Từ/ngữ không được dùng: ${bannedList.length ? bannedList.join(', ') : '(không có)'}`,
    `Quy tắc logo và nhận diện: ${rules.logo_rules || '(chưa cài đặt)'}`,
    brandGuideText
      ? `\n=== BRAND GUIDE VĂN BẢN CHÍNH THỨC ===\n${brandGuideText}`
      : '\nBrand guide văn bản chính thức: (chưa có)',
    imageGuides.length
      ? `\nBrand guide hình ảnh chính thức: đã có ${imageGuides.length} tài liệu hình ảnh để đối chiếu khi kiểm tra ảnh.`
      : '\nBrand guide hình ảnh chính thức: (chưa có)'
  ];

  // "summary" (khác "promptText" gửi cho AI) — dữ liệu gọn để FRONTEND hiển thị lại cho người
  // dùng thấy AI vừa dùng những gì, tự phát hiện nếu thiếu rule/persona thay vì tin mù.
  const summary = {
    bannedCount: bannedList.length,
    requiredCount: required.length,
    hasBrandVoice: !!(rules.brand_voice && String(rules.brand_voice).trim()),
    hasLogoRules: !!(rules.logo_rules && String(rules.logo_rules).trim()),
    hasBrandGuideText: !!brandGuideText,
    imageGuideCount: imageGuides.length
  };

  return { rules, bannedList, required, brandGuideText, imageGuides, promptText: sections.join('\n'), summary };
}

export async function handleAiCheckContent(supabase, env, p) {
  const aiContext = await buildAiRulesContext(supabase);
  const rules = aiContext.rules;
  const voice = rules.brand_voice || 'Chuyên nghiệp, gần gũi, có CTA rõ ràng';
  const req = (rules.required_elements || []).join(', ') || 'CTA rõ ràng';
  const fullText = `${p.title || ''} ${p.content || ''}`.toLowerCase();

  const foundBanned = aiContext.bannedList.filter(w => w && fullText.indexOf(w.toLowerCase()) !== -1);
  const hasBanned = foundBanned.length > 0;
  const bannedNote = hasBanned
    ? ` Hệ thống đã xác định bài chứa từ cấm: [${foundBanned.join(', ')}]. Điểm chinh_xac PHẢI <=4, verdict PHẢI là CAN_SUA hoặc TU_CHOI, ghi nhận từ cấm vào issues.`
    : ' Hệ thống xác nhận bài KHÔNG chứa từ cấm nào. Tuyệt đối KHÔNG đề cập từ cấm trong issues.';

  let sys = `Bạn là chuyên gia kiểm duyệt content FPT Schools. Phong cách thương hiệu: ${voice}. Yếu tố bắt buộc: ${req}.` +
    bannedNote +
    ' Phản hồi KHÔNG dùng markdown, KHÔNG dùng **, chỉ text thuần.' +
    ' Trả về JSON DUY NHẤT không có text khác:' +
    ' {"verdict":"DUYET hoac CAN_SUA hoac TU_CHOI","scores":{"giong_van":0-10,"cta":0-10,"chinh_xac":0-10,"phu_hop":0-10}' +
    ',"positives":["nhan xet diem tot cu the bang tieng Viet"]' +
    ',"issues":["nhan xet diem can sua cu the bang tieng Viet"]' +
    ',"suggestion":"goi y sua cu the bang text thuan tieng Viet"}';
  sys += '\n\n' + aiContext.promptText;

  const prompt = `${sys}\n\nLoại: ${p.content_type || ''}\nĐối tượng: ${p.audience || ''}\n\nTIÊU ĐỀ: ${p.title || ''}\n\nNỘI DUNG:\n${p.content || ''}`;

  let raw;
  try { raw = await callOpenAI(env, prompt); } catch (e) { return { ok: false, error: e.message }; }

  let r = null;
  try {
    r = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (r && r.verdict) r.verdict = r.verdict.replace('DUYET', 'DUYỆT').replace('CAN_SUA', 'CẦN SỬA').replace('TU_CHOI', 'TỪ CHỐI');
    if (r && hasBanned) {
      r.scores = r.scores || {};
      if (!r.scores.chinh_xac || r.scores.chinh_xac > 4) r.scores.chinh_xac = 3;
      if (r.verdict === 'DUYỆT') r.verdict = 'CẦN SỬA';
      const issues = r.issues || [];
      const alreadyHas = issues.some(i => i.toLowerCase().indexOf('cấm') !== -1);
      if (!alreadyHas) issues.unshift(`Từ cấm: ${foundBanned.join(', ')}`);
      r.issues = issues;
    }
  } catch (e) {}

  return { ok: true, result: r, raw, meta: aiContext.summary };
}

export async function handleAiSuggestReview(supabase, env, p) {
  const aiContext = await buildAiRulesContext(supabase);

  // Phong cách người duyệt: LUÔN tra ở server theo reviewer_name (giống hệt handleAiChat) —
  // KHÔNG dùng p.persona do frontend tự gửi lên nữa. Lý do: cache PERSONAS_CACHE ở phía
  // trình duyệt (boss.html) chỉ được nạp khi vào trang "Cài đặt", mà trang đó ẨN với role
  // leader/manager → 2 role này trước đây gửi persona rỗng dù đã lưu style trong hệ thống,
  // AI vẫn chạy bình thường nên không ai nhận ra. Tra ở server loại bỏ hẳn lớp lỗi này.
  const reviewerName = p.reviewer_name || '';
  const personaText = reviewerName ? await getPersonaContent(supabase, reviewerName) : '';

  let sysPrompt = 'Bạn hỗ trợ người duyệt bài content FPT Schools. Đọc bài, viết nhận xét ngắn 3-4 câu: điểm tốt, điểm cần sửa cụ thể, hướng chỉnh. Tiếng Việt, KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần.';
  sysPrompt += '\n\n' + aiContext.promptText + '\nƯu tiên phát hiện và nêu rõ các điểm vi phạm quy tắc Admin trong nhận xét. Không tự bỏ qua từ cấm hoặc yếu tố bắt buộc.';
  if (personaText) sysPrompt += `\n\nPhong cách và tiêu chí của người duyệt:\n${personaText}`;

  const prompt = `${sysPrompt}\n\nBài: ${p.title || ''}\nLoại: ${p.content_type || ''}\n\n${p.content || ''}`;
  const meta = { ...aiContext.summary, personaUsed: !!personaText, personaName: personaText ? reviewerName : null };
  try {
    const suggestion = await callOpenAI(env, prompt);
    return { ok: true, suggestion, meta };
  } catch (e) {
    return { ok: false, error: e.message, meta };
  }
}

export async function handleAiCheckBrandImage(supabase, env, p) {
  const fileId = p.file_id;
  if (!fileId) return { ok: false, error: 'Thiếu file_id' };

  const aiContext = await buildAiRulesContext(supabase);
  const rules = aiContext.rules;
  const voice = rules.brand_voice || '';
  const req = (rules.required_elements || []).join(', ');
  const imageGuides = aiContext.imageGuides;
  const hasImageGuides = imageGuides.length > 0;

  const sys = 'Bạn là chuyên gia kiểm tra brand guideline cho FPT Schools.' +
    ' Nhiệm vụ: nhìn ảnh thiết kế (banner/poster/social post) và đánh giá xem có đúng chuẩn thương hiệu không.' +
    (voice ? ` Phong cách thương hiệu mô tả: ${voice}.` : '') +
    (req ? ` Yếu tố bắt buộc: ${req}.` : '') +
    (rules.logo_rules ? ` Quy tắc logo và nhận diện bắt buộc: ${rules.logo_rules}.` : '') +
    (hasImageGuides
      ? ' Ảnh ĐẦU TIÊN trong tin nhắn là bài cần chấm. Các ảnh SAU đó là ảnh brand guide chính thức từ HO (mẫu chuẩn) — hãy đối chiếu trực tiếp màu sắc, logo, font chữ, bố cục của ảnh cần chấm với các ảnh mẫu này, ưu tiên đối chiếu trực tiếp thay vì suy đoán chung.'
      : ' Lưu ý: hệ thống hiện CHƯA có brand guide hình ảnh chính thức (chưa có mã màu hex cụ thể, chưa có logo mẫu, chưa có font chuẩn được nạp sẵn) — bạn chỉ có thể suy luận dựa trên mô tả phong cách thương hiệu nói trên và kiến thức chung về thiết kế nhận diện trường học/giáo dục tại Việt Nam (tông màu FPT thường dùng cam/xanh dương/xanh lá, phong cách chuyên nghiệp, rõ ràng).') +
    ' Đánh giá 4 mục: mau_sac (màu sắc có hài hoà, có dùng tông thương hiệu hợp lý không), logo (có logo/nhận diện rõ ràng, đúng vị trí, không bị che/méo không), font_chu (font có dễ đọc, nhất quán, chuyên nghiệp không), bo_cuc (bố cục có cân đối, rõ thông tin chính, không rối không).' +
    ' Với mỗi mục, trả "dat" nếu đạt yêu cầu cơ bản, "chua_dat" nếu có vấn đề rõ ràng, "khong_chac" nếu không đủ căn cứ để kết luận (ví dụ không có brand guide chi tiết để so sánh màu chính xác).' +
    ' Phản hồi KHÔNG dùng markdown, chỉ text thuần. Trả về JSON DUY NHẤT, không kèm text khác:' +
    ' {"mau_sac":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"logo":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"font_chu":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    ',"bo_cuc":{"trang_thai":"dat/chua_dat/khong_chac","nhan_xet":"..."}' +
    `,"luu_y":"1 câu nhắc rằng đây là đánh giá tham khảo${hasImageGuides ? ', đã đối chiếu với brand guide chính thức từ HO' : ' do chưa có brand guide hình ảnh chính thức'}"}`;

  const contentArr = [
    { type: 'text', text: sys },
    { type: 'image_url', image_url: { url: resolveImageUrl(fileId) } },
    ...imageGuides.map(g => ({ type: 'image_url', image_url: { url: resolveImageUrl(g.file_id) } }))
  ];

  let raw;
  try { raw = await callOpenAIVision(env, contentArr); } catch (e) { return { ok: false, error: e.message }; }

  let result = null;
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch (e) {}
  return { ok: true, result, raw };
}

export async function handleAiChat(supabase, env, p) {
  const messages = p.messages || [];
  if (!messages.length) return { ok: false, error: 'No messages' };

  const aiContext = await buildAiRulesContext(supabase);
  const personaText = await getPersonaContent(supabase, p.reviewer_name);

  messages[0].content = messages[0].content +
    '\nLưu ý quan trọng: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần tiếng Việt.' +
    '\n\n' + aiContext.promptText +
    '\nKhi hỗ trợ người duyệt, phải đối chiếu nhận xét với các quy tắc Admin ở trên và chỉ ra vi phạm nếu có.';
  if (personaText) {
    messages[0].content += '\n\nLưu ý: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #. Chỉ viết text thuần.' +
      '\n\n=== PHONG CÁCH & TIÊU CHÍ NGƯỜI DUYỆT ===' + personaText;
  }

  const meta = { ...aiContext.summary, personaUsed: !!personaText, personaName: personaText ? p.reviewer_name : null };
  try {
    const reply = await callOpenAIChat(env, messages);
    return { ok: true, reply, meta };
  } catch (e) {
    return { ok: false, error: e.message, meta };
  }
}
