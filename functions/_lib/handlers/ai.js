import { handleGetRules } from './rules.js';
import { callOpenAI, callOpenAIVision, callOpenAIChat } from '../openai.js';
import { getVerifiedFacts, factsPromptText } from './knowledge.js';

// ============================================================
// AI — port từ handleAiCheckContent/handleAiSuggestReview/handleAiCheckBrandImage/
// handleAiChat/buildAiRulesContext trong backend_apps_script.js.
//
// handleAiCheckContent/handleAiCheckBrandImage dùng OpenAI Structured Outputs
// (response_format: json_schema, strict:true — xem opts.jsonSchema ở openai.js) thay vì chỉ
// nhắc "trả JSON" trong prompt rồi tự JSON.parse. Trước đây nếu AI lỡ trả sai định dạng,
// JSON.parse ném lỗi bị try/catch nuốt mất, người dùng nhận kết quả rỗng không rõ lý do —
// giờ OpenAI tự validate đúng cấu trúc trước khi trả về nên gần như không còn xảy ra.
// ============================================================

const CONTENT_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['DUYỆT', 'CẦN SỬA', 'TỪ CHỐI'] },
    scores: {
      type: 'object',
      properties: {
        giong_van: { type: 'integer', minimum: 0, maximum: 10 },
        cta: { type: 'integer', minimum: 0, maximum: 10 },
        chinh_xac: { type: 'integer', minimum: 0, maximum: 10 },
        phu_hop: { type: 'integer', minimum: 0, maximum: 10 }
      },
      required: ['giong_van', 'cta', 'chinh_xac', 'phu_hop'],
      additionalProperties: false
    },
    positives: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
    suggestion: { type: 'string' }
  },
  required: ['verdict', 'scores', 'positives', 'issues', 'suggestion'],
  additionalProperties: false
};

function brandCriterionSchema() {
  return {
    type: 'object',
    properties: {
      trang_thai: { type: 'string', enum: ['dat', 'chua_dat', 'khong_chac'] },
      nhan_xet: { type: 'string' }
    },
    required: ['trang_thai', 'nhan_xet'],
    additionalProperties: false
  };
}

const BRAND_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    mau_sac: brandCriterionSchema(),
    logo: brandCriterionSchema(),
    font_chu: brandCriterionSchema(),
    bo_cuc: brandCriterionSchema(),
    luu_y: { type: 'string' }
  },
  required: ['mau_sac', 'logo', 'font_chu', 'bo_cuc', 'luu_y'],
  additionalProperties: false
};

async function getTextBrandGuides(supabase) {
  const { data } = await supabase.from('brand_guides').select('name, content').eq('type', 'text');
  return (data || []).map(r => `\n\n--- Brand guide: ${r.name || ''} ---\n${r.content}`).join('');
}

async function getImageBrandGuides(supabase) {
  const { data } = await supabase.from('brand_guides').select('name, content').eq('type', 'image');
  return (data || []).map(r => ({ name: r.name, file_id: r.content }));
}

// Tra theo user_id (KHÔNG phải tên hiển thị) — xem migration
// 20260923073531_personas_keyed_by_user_id.sql: tên hiển thị có thể trùng giữa 2 người dùng khác
// nhau hoặc bị đổi, khiến tra theo tên mất/nhầm persona một cách âm thầm.
async function getPersona(supabase, reviewerId) {
  if (!reviewerId) return null;
  try {
    const { data } = await supabase.from('personas').select('name, content').eq('user_id', reviewerId).maybeSingle();
    return data || null;
  } catch (e) { return null; }
}

// Ảnh cần chấm có thể là URL trực tiếp (Supabase Storage sau này) hoặc file id Google Drive
// (frontend hiện tại vẫn đang dùng Drive cho đến khi cắt hẳn sang backend mới).
function resolveImageUrl(fileId) {
  if (/^https?:\/\//i.test(fileId)) return fileId;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '...' : s;
}

// Ví dụ mẫu (few-shot) lấy từ CHÍNH bài thật đã qua duyệt — không tự bịa ví dụ, vì bài thật đã
// được người duyệt thật chấm điểm/góp ý mới đúng "giọng FPT Schools" thật sự, hiệu quả hơn hẳn so
// với chỉ chỉnh câu lệnh. Lấy 1 bài ĐÃ DUYỆT điểm cao nhất (ví dụ tốt) + 1 bài CẦN SỬA/TỪ CHỐI có
// nhận xét cụ thể (ví dụ chưa tốt kèm lý do), ưu tiên cùng loại content với bài đang kiểm tra nếu
// có đủ dữ liệu. Không có gì phù hợp (hệ thống mới, chưa có bài nào duyệt) thì bỏ qua, không lỗi.
async function buildFewShotExamples(supabase, contentType) {
  async function pickGood() {
    let q = supabase.from('submissions').select('title, content, content_type, score')
      .eq('status', 'approved').not('score', 'is', null).not('content', 'is', null)
      .order('score', { ascending: false }).order('submitted_at', { ascending: false }).limit(5);
    const { data } = await q;
    let rows = data || [];
    if (contentType) {
      const sameType = rows.filter(r => r.content_type === contentType);
      if (sameType.length) rows = sameType;
    }
    return rows.find(r => r.content && r.content.length > 50) || null;
  }
  async function pickWeak() {
    let q = supabase.from('submissions').select('title, content, content_type, comment, status')
      .in('status', ['revision', 'rejected']).not('comment', 'is', null).not('content', 'is', null)
      .order('reviewed_at', { ascending: false }).limit(8);
    const { data } = await q;
    let rows = data || [];
    if (contentType) {
      const sameType = rows.filter(r => r.content_type === contentType);
      if (sameType.length) rows = sameType;
    }
    return rows.find(r => r.content && r.content.length > 50 && r.comment && r.comment.trim().length > 10) || null;
  }

  let good = null, weak = null;
  try { [good, weak] = await Promise.all([pickGood(), pickWeak()]); } catch (e) {}
  if (!good && !weak) return { promptText: '', hasExample: false };

  const parts = ['\n=== VÍ DỤ THAM KHẢO TỪ BÀI THẬT ĐÃ QUA DUYỆT (để hiểu đúng chuẩn/giọng văn FPT Schools) ==='];
  if (good) {
    parts.push(`\n--- Ví dụ bài ĐÃ DUYỆT, điểm ${good.score}/10 ---\nTiêu đề: ${good.title}\n${truncate(good.content, 600)}`);
  }
  if (weak) {
    const label = weak.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'CẦN SỬA';
    parts.push(`\n--- Ví dụ bài ${label}, kèm lý do người duyệt đã ghi ---\nTiêu đề: ${weak.title}\n${truncate(weak.content, 400)}\nLý do: ${truncate(weak.comment, 300)}`);
  }
  return { promptText: parts.join('\n'), hasExample: true };
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
  const fewShot = await buildFewShotExamples(supabase, p.content_type);
  // Kho thông tin chuẩn: đối chiếu số liệu trong bài (học phí, học bổng, ngày, thành tích...).
  let factsBlock = '', factsCount = 0;
  try {
    const { text, kept } = factsPromptText(await getVerifiedFacts(supabase, p.campus), 7000);
    factsCount = kept.length;
    if (kept.length) {
      factsBlock = '\n\n=== THÔNG TIN CHUẨN ĐÃ XÁC MINH CỦA TRƯỜNG ===\n' + text +
        '\nĐối chiếu mọi thông tin cụ thể trong bài (con số, học phí, học bổng, ngày tháng, chỉ tiêu, thành tích, tên chương trình, địa chỉ, số điện thoại) với danh sách trên:' +
        '\n- Bài nêu KHÁC thông tin chuẩn → thêm vào issues dòng bắt đầu bằng "Sai thông tin chuẩn:" (nêu đúng theo thông tin chuẩn) và chinh_xac tối đa 5, verdict không được là DUYỆT.' +
        '\n- Bài nêu thông tin cụ thể KHÔNG có trong danh sách → thêm vào issues dòng bắt đầu bằng "Chưa xác minh:" để CTV kiểm tra lại nguồn (không tự trừ nặng điểm).';
    }
  } catch (e) {}
  const meta = { ...aiContext.summary, hasFewShotExample: fewShot.hasExample, factsCount };
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
    ' Viết positives/issues/suggestion bằng tiếng Việt, text thuần (không markdown, không **).';
  sys += '\n\n' + aiContext.promptText + fewShot.promptText + factsBlock;

  const prompt = `${sys}\n\nLoại: ${p.content_type || ''}\n\nTIÊU ĐỀ: ${p.title || ''}\n\nNỘI DUNG:\n${p.content || ''}`;

  let raw;
  try {
    raw = await callOpenAI(env, prompt, { jsonSchema: { name: 'content_check', schema: CONTENT_CHECK_SCHEMA } });
  } catch (e) { return { ok: false, error: e.message, meta }; }

  let r = null;
  try {
    r = JSON.parse(raw);
    if (hasBanned) {
      r.scores = r.scores || {};
      if (!r.scores.chinh_xac || r.scores.chinh_xac > 4) r.scores.chinh_xac = 3;
      if (r.verdict === 'DUYỆT') r.verdict = 'CẦN SỬA';
      const issues = r.issues || [];
      const alreadyHas = issues.some(i => i.toLowerCase().indexOf('cấm') !== -1);
      if (!alreadyHas) issues.unshift(`Từ cấm: ${foundBanned.join(', ')}`);
      r.issues = issues;
    }
  } catch (e) {
    // Với response_format json_schema, OpenAI đã tự validate đúng cấu trúc trước khi trả về —
    // nếu vẫn lỗi tới đây (mạng đứt giữa chừng, response bị cắt...) thì báo rõ cho người dùng
    // thay vì trả "result: null" im lặng như cách cũ.
    return { ok: false, error: 'AI trả về không đúng định dạng, vui lòng thử lại', meta };
  }

  return { ok: true, result: r, raw, meta };
}

// ------------------------------------------------------------
// AI VIẾT NHÁP TỪ DÀN Ý — bước "Dàn ý → AI viết" của luồng kế hoạch. Bài nháp bám: quy tắc Admin
// (giọng thương hiệu, yếu tố bắt buộc, từ cấm, brand guide), phong cách của người duyệt đã chọn,
// ví dụ bài thật đã duyệt, và CHỈ số liệu trong Kho thông tin chuẩn (đã xác minh, còn hạn). Thiếu thông
// tin thì để [CẦN BỔ SUNG: ...] thay vì bịa. CTV luôn phải soát lại trước khi gửi duyệt.
// ------------------------------------------------------------
// Thứ tự trường có chủ đích: AI sinh JSON theo thứ tự khai báo, nên bắt nó liệt kê thông tin CÒN THIẾU
// và thông tin sẽ dùng TRƯỚC khi viết bài — nếu để draft đầu tiên, AI hay viết vòng vo ("một số lượng
// nhất định") cho chỗ thiếu thay vì để [CẦN BỔ SUNG] (đã gặp khi test).
const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    missing_info: { type: 'array', items: { type: 'string' } },
    facts_used: { type: 'array', items: { type: 'string' } },
    draft: { type: 'string' },
    note: { type: 'string' }
  },
  required: ['missing_info', 'facts_used', 'draft', 'note'],
  additionalProperties: false
};
const PLATFORM_GUIDE = {
  facebook: 'Facebook: câu mở đầu gây chú ý trong 1-2 dòng, đoạn ngắn 1-3 câu, emoji vừa phải đầu đoạn, CTA rõ, 3-5 hashtag ở cuối.',
  instagram: 'Instagram: caption ngắn gọn, giàu hình ảnh, emoji, hashtag cuối bài.',
  tiktok: 'TikTok: viết dạng kịch bản/caption video ngắn — câu hook 3 giây đầu, ý ngắn, nhịp nhanh, CTA cuối.',
  youtube: 'Youtube: mô tả video — 2 câu tóm tắt đầu, các ý chính, CTA đăng ký/xem thêm.',
  web: 'Website: bài đầy đủ hơn — đoạn mở đầu tóm ý, các đoạn có ý rõ ràng (có thể mở đầu đoạn bằng câu chủ đề in đậm), văn phong chỉn chu, hạn chế emoji.',
  email: 'Email: lời chào phụ huynh/học sinh, nội dung chính ngắn gọn, 1 CTA rõ ràng, lời kết lịch sự; không hashtag.',
  zalo: 'Zalo: ngắn gọn, thân thiện, 1 CTA; không hashtag.',
  sms: 'SMS: rất ngắn (dưới 300 ký tự), không emoji, không dấu chấm than liên tiếp, có tên trường và 1 CTA.'
};
const LENGTH_GUIDE = { ngan: 'khoảng 80-130 chữ', vua: 'khoảng 150-250 chữ', dai: 'khoảng 350-500 chữ' };

// Chốt chặn bằng code (không tin AI): mọi con số trong bài nháp phải có trong thông tin chuẩn / dàn ý /
// tiêu đề. AI dù được dặn vẫn có thể "bịa cho hợp lý" (đã gặp khi test: tự viết "100 chỉ tiêu lớp 10").
// Số không có nguồn → bọc thành [CẦN XÁC MINH: ...] ngay trong bài để CTV bắt buộc phải xử lý.
const NUMBER_RE = /\d+(?:[.,]\d{3})*(?:[ ]\d{3})*(?:[.,]\d+)?/g;
// So TRỌN con số (98.500.000 ≠ 98) và phân biệt có/không "%" (100% học bổng ≠ 100 chỉ tiêu).
const numberKey = (raw, nextChar) => String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '') + (nextChar === '%' ? '%' : '');
const nextNonSpace = (text, i) => { const m = /^\s*(.)/.exec(text.slice(i)); return m ? m[1] : ''; };
export function markUnverifiedNumbers(draft, sourceText) {
  const src = String(sourceText);
  const allowed = new Set();
  for (const m of src.matchAll(NUMBER_RE)) allowed.add(numberKey(m[0], nextNonSpace(src, m.index + m[0].length)));
  const found = [];
  const out = String(draft).replace(NUMBER_RE, (raw, offset, whole) => {
    const d = raw.replace(/\D/g, '');
    const before = whole.slice(Math.max(0, offset - 12), offset);
    if (/#[^\s#]*$/.test(before)) return raw;                       // nằm trong hashtag
    if (Number(d) <= 12 && d.length <= 2) return raw;                 // lớp 9-12, tháng, số nhỏ
    if (allowed.has(numberKey(raw, nextNonSpace(whole, offset + raw.length)))) return raw;
    const sentence = whole.slice(Math.max(0, offset - 40), offset + raw.length + 30).replace(/\s+/g, ' ').trim();
    found.push({ number: raw, context: sentence });
    return `[CẦN XÁC MINH: ${raw}]`;
  });
  return { draft: out, unverified: found };
}

export async function handleAiWriteFromOutline(supabase, env, p) {
  const outline = String(p.outline || '').trim();
  if (outline.length < 10) return { ok: false, error: 'Nhập dàn ý (các ý chính của bài) trước khi nhờ AI viết' };

  const [aiContext, fewShot, facts] = await Promise.all([
    buildAiRulesContext(supabase),
    buildFewShotExamples(supabase, p.content_type_code || p.content_type),
    getVerifiedFacts(supabase, p.campus).catch(() => [])
  ]);
  const { text: factsText, kept } = factsPromptText(facts);

  // Phong cách của những người duyệt bài này (tối đa 3 người đầu trong danh sách đã chọn).
  const reviewerIds = (Array.isArray(p.reviewer_ids) ? p.reviewer_ids : []).map(String).filter(Boolean).slice(0, 3);
  const personas = (await Promise.all(reviewerIds.map(id => getPersona(supabase, id)))).filter(Boolean);

  const platforms = (Array.isArray(p.platform) ? p.platform : []).filter(k => PLATFORM_GUIDE[k]);
  const platformGuide = platforms.length ? platforms.map(k => '- ' + PLATFORM_GUIDE[k]).join('\n') + (platforms.length > 1 ? '\n- Bài đăng nhiều kênh: viết 1 bản dùng được cho kênh chính (kênh đầu tiên), giữ văn phong phù hợp cả các kênh còn lại.' : '') : '- Chưa chọn kênh: viết dạng bài Facebook.';
  const length = LENGTH_GUIDE[p.length] || LENGTH_GUIDE.vua;
  const banned = aiContext.bannedList;

  const prompt = [
    'Bạn là biên tập viên content của FPT Schools (hệ thống trường THPT FPT). Viết 1 bài NHÁP hoàn chỉnh từ dàn ý của CTV, để CTV soát lại rồi gửi duyệt.',
    '',
    '=== YÊU CẦU BÀI ===',
    `Tiêu đề / chủ đề: ${p.title || '(chưa có — tự đặt theo dàn ý)'}`,
    `Cơ sở: ${p.campus_label || p.campus || 'chưa chọn'} · Loại content: ${p.content_type || 'chưa chọn'} · Trụ content: ${p.pillar_name || 'chưa chọn'}`,
    `Độ dài: ${length}.`,
    'Kênh đăng:', platformGuide,
    '',
    '=== DÀN Ý CỦA CTV (bám sát, đủ các ý; được sắp lại cho mạch lạc) ===',
    outline.slice(0, 3000),
    '',
    aiContext.promptText,
    banned.length ? `TUYỆT ĐỐI không dùng các từ/cụm từ: ${banned.join(', ')}.` : '',
    aiContext.required.length ? `Bài PHẢI có: ${aiContext.required.join('; ')}.` : '',
    '',
    '=== THÔNG TIN CHUẨN ĐÃ XÁC MINH (nguồn DUY NHẤT cho thông tin cụ thể) ===',
    kept.length ? factsText : '(Kho thông tin chuẩn chưa có thông tin nào cho cơ sở này.)',
    'Quy tắc về thông tin:',
    '- Mọi con số, ngày tháng, học phí, học bổng, chỉ tiêu, thành tích, tên chương trình, địa chỉ, số điện thoại, website, hạn nộp hồ sơ... CHỈ được lấy từ danh sách trên, giữ đúng giá trị.',
    '- Dàn ý cần 1 thông tin cụ thể mà danh sách không có (hoặc dàn ý tự nêu số liệu không có trong danh sách): KHÔNG tự bịa, KHÔNG làm tròn; viết đúng chỗ đó là [CẦN BỔ SUNG: <thông tin cần>] và ghi vào missing_info.',
    '- Kể cả con số nghe hợp lý (chỉ tiêu, số học sinh, tỉ lệ đỗ, số giải, năm thành lập, diện tích, số phòng...) mà KHÔNG có trong danh sách thì cũng phải để [CẦN BỔ SUNG: ...]. Hệ thống sẽ tự đối chiếu mọi con số trong bài với danh sách sau khi bạn viết.',
    '- Cũng KHÔNG được viết vòng vo để né chỗ thiếu (vd "một số lượng nhất định", "số lượng lớn", "nhiều suất", "hấp dẫn") — phải để đúng [CẦN BỔ SUNG: <thông tin cần>] ngay tại câu đó.',
    '- Cách làm: đọc từng ý của dàn ý → ý nào cần thông tin cụ thể mà danh sách không có thì ghi vào missing_info TRƯỚC, sau đó mới viết draft (mỗi mục trong missing_info phải có 1 chỗ [CẦN BỔ SUNG: ...] tương ứng trong draft).',
    '- facts_used: mã các thông tin đã dùng (vd "F2").',
    personas.length ? '\n=== PHONG CÁCH NGƯỜI DUYỆT BÀI NÀY (viết hợp tiêu chí của họ) ===\n' + personas.map(x => `--- ${x.name} ---\n${truncate(x.content, 1500)}`).join('\n') : '',
    fewShot.promptText ? fewShot.promptText + '\n(Chỉ tham khảo giọng văn/cách trình bày của ví dụ, KHÔNG chép nội dung hay số liệu từ ví dụ.)' : '',
    '',
    '=== ĐỊNH DẠNG ===',
    'draft: tiếng Việt, text thuần, xuống dòng giữa các đoạn; được dùng **chữ đậm** cho 1-3 ý quan trọng; không dùng #, không bảng, không markdown khác; không viết lời dẫn kiểu "Dưới đây là bài viết". Không lặp lại tiêu đề ở dòng đầu trừ khi kênh là Website.',
    'note: 1-2 câu nhắc CTV cần kiểm tra hoặc bổ sung gì trước khi gửi duyệt.'
  ].filter(s => s !== '').join('\n');

  const meta = {
    ...aiContext.summary, hasFewShotExample: fewShot.hasExample, factsCount: kept.length,
    personaNames: personas.map(x => x.name)
  };
  let raw;
  try {
    raw = await callOpenAI(env, prompt, {
      jsonSchema: { name: 'write_from_outline', schema: WRITE_SCHEMA },
      max_tokens: p.length === 'dai' ? 1800 : 1200, temperature: 0.6, timeoutMs: 30000, retries: 1
    });
  } catch (e) { return { ok: false, error: e.message, meta }; }

  let r;
  try { r = JSON.parse(raw); } catch (e) { return { ok: false, error: 'AI trả về không đúng định dạng, vui lòng thử lại', meta }; }

  // Mã [F3] → thông tin thật (để hiện cho CTV biết bài đã dựa vào thông tin nào).
  const used = [...new Set((r.facts_used || []).map(c => Number(String(c).replace(/\D/g, ''))).filter(n => n >= 1 && n <= kept.length))]
    .map(n => ({ id: kept[n - 1].id, code: 'F' + n, title: kept[n - 1].title, category: kept[n - 1].category }));
  // Chốt chặn cuối: AI vẫn có thể lỡ dùng từ cấm — báo ra để CTV sửa, không tự xoá âm thầm.
  const low = String(r.draft || '').toLowerCase();
  const bannedFound = banned.filter(w => w && low.includes(String(w).toLowerCase()));
  // Số liệu không có nguồn (thông tin chuẩn đã dùng + dàn ý + tiêu đề) → đánh dấu ngay trong bài.
  const sources = [kept.map(f => `${f.title} ${f.content}`).join('\n'), outline, p.title || ''].join('\n');
  // Dọn ký hiệu in đậm lẻ (AI đôi khi quên đóng "**") để ô soạn thảo không hiện "**" thừa.
  let draftText = String(r.draft || '').trim();
  if ((draftText.match(/\*\*/g) || []).length % 2) {
    const i = draftText.lastIndexOf('**');
    draftText = draftText.slice(0, i) + draftText.slice(i + 2);
  }
  const checked = markUnverifiedNumbers(draftText, sources);
  // AI đôi khi tự ghi kèm "[CẦN BỔ SUNG: ...]" vào missing_info — bỏ phần ký hiệu cho dễ đọc.
  const missing = (r.missing_info || []).map(s => String(s).trim()
    .replace(/^\[?\s*CẦN BỔ SUNG\s*:?\s*/i, '').replace(/\s*\[CẦN BỔ SUNG[^\]]*\]?\s*$/i, '').replace(/\]?\s*\.?$/, '').trim()).filter(Boolean)
    .concat(checked.unverified.map(u => `Số "${u.number}" chưa có trong Kho thông tin chuẩn (…${u.context}…)`));

  return {
    ok: true,
    draft: checked.draft,
    facts_used: used,
    missing_info: missing,
    unverified_numbers: checked.unverified.map(u => u.number),
    note: r.note || '',
    banned_found: bannedFound,
    meta
  };
}

export async function handleAiSuggestReview(supabase, env, p) {
  const aiContext = await buildAiRulesContext(supabase);
  const fewShot = await buildFewShotExamples(supabase, p.content_type);

  // Phong cách người duyệt: LUÔN tra ở server theo reviewer_id (giống hệt handleAiChat), KHÔNG
  // theo tên hiển thị — xem ghi chú ở getPersona() và migration
  // 20260923073531_personas_keyed_by_user_id.sql. Trước đây từng có bug tương tự khi tra theo
  // tên (đã sửa ở lần trước) — đổi sang id để loại bỏ tận gốc rủi ro trùng/đổi tên.
  const persona = p.reviewer_id ? await getPersona(supabase, p.reviewer_id) : null;
  const personaText = persona ? persona.content : '';

  let sysPrompt = 'Bạn hỗ trợ người duyệt bài content FPT Schools. Đọc bài, viết nhận xét ngắn 3-4 câu: điểm tốt, điểm cần sửa cụ thể, hướng chỉnh. Tiếng Việt, KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần.';
  sysPrompt += '\n\n' + aiContext.promptText + fewShot.promptText + '\nƯu tiên phát hiện và nêu rõ các điểm vi phạm quy tắc Admin trong nhận xét. Không tự bỏ qua từ cấm hoặc yếu tố bắt buộc.';
  if (personaText) sysPrompt += `\n\nPhong cách và tiêu chí của người duyệt:\n${personaText}`;

  const prompt = `${sysPrompt}\n\nBài: ${p.title || ''}\nLoại: ${p.content_type || ''}\n\n${p.content || ''}`;
  const meta = { ...aiContext.summary, hasFewShotExample: fewShot.hasExample, personaUsed: !!personaText, personaName: persona ? persona.name : null };
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
    ' Viết nhan_xet/luu_y bằng tiếng Việt, text thuần (không markdown).' +
    ` luu_y: 1 câu nhắc rằng đây là đánh giá tham khảo${hasImageGuides ? ', đã đối chiếu với brand guide chính thức từ HO' : ' do chưa có brand guide hình ảnh chính thức'}.`;

  const contentArr = [
    { type: 'text', text: sys },
    { type: 'image_url', image_url: { url: resolveImageUrl(fileId) } },
    ...imageGuides.map(g => ({ type: 'image_url', image_url: { url: resolveImageUrl(g.file_id) } }))
  ];

  let raw;
  try {
    raw = await callOpenAIVision(env, contentArr, { jsonSchema: { name: 'brand_image_check', schema: BRAND_IMAGE_SCHEMA } });
  } catch (e) { return { ok: false, error: e.message }; }

  let result = null;
  try { result = JSON.parse(raw); } catch (e) {
    return { ok: false, error: 'AI trả về không đúng định dạng, vui lòng thử lại' };
  }
  return { ok: true, result, raw };
}

export async function handleAiChat(supabase, env, p) {
  const messages = p.messages || [];
  if (!messages.length) return { ok: false, error: 'No messages' };

  const aiContext = await buildAiRulesContext(supabase);
  const persona = p.reviewer_id ? await getPersona(supabase, p.reviewer_id) : null;
  const personaText = persona ? persona.content : '';

  messages[0].content = messages[0].content +
    '\nLưu ý quan trọng: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #, chỉ text thuần tiếng Việt.' +
    '\n\n' + aiContext.promptText +
    '\nKhi hỗ trợ người duyệt, phải đối chiếu nhận xét với các quy tắc Admin ở trên và chỉ ra vi phạm nếu có.';
  if (personaText) {
    messages[0].content += '\n\nLưu ý: KHÔNG dùng markdown, KHÔNG dùng **, KHÔNG dùng #. Chỉ viết text thuần.' +
      '\n\n=== PHONG CÁCH & TIÊU CHÍ NGƯỜI DUYỆT ===' + personaText;
  }

  const meta = { ...aiContext.summary, personaUsed: !!personaText, personaName: persona ? persona.name : null };
  try {
    const reply = await callOpenAIChat(env, messages);
    return { ok: true, reply, meta };
  } catch (e) {
    return { ok: false, error: e.message, meta };
  }
}
