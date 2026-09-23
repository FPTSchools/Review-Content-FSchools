// ============================================================
// OpenAI proxy — port từ callOpenAI trong backend_apps_script.js.
// Gọi từ server (Cloudflare) để giữ bí mật OPENAI_API_KEY, giống lý do bản GAS gốc.
// ============================================================

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Thử lại khi OpenAI lỗi TẠM THỜI (quá tải, lỗi server, mạng chập chờn) — trước đây gọi 1 lần
// duy nhất, hễ lỗi là báo lỗi thẳng cho người dùng dù chỉ là một lượt nghẽn thoáng qua.
// KHÔNG thử lại với lỗi do chính request sai (sai key, sai định dạng...) vì thử lại cũng vô ích.
const MAX_RETRIES = 2;              // tối đa 3 lượt gọi (1 lần đầu + 2 lần thử lại)
const RETRY_BASE_DELAY_MS = 500;    // chờ 500ms rồi 1000ms giữa các lần thử lại
const REQUEST_TIMEOUT_MS = 10000;   // 1 lượt gọi quá 10s coi như treo — huỷ và thử lại thay vì chờ vô hạn
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Ngân sách 3 lượt × 10s + 1.5s chờ giữa các lượt = tối đa ~31.5s — vẫn nằm trong 40s mà
// frontend tự huỷ request cho ai_suggest_review/ai_check_brand_image (xem callAPI trong
// ctv.html/boss.html), để tránh tình huống backend còn đang thử lại mà frontend đã bỏ cuộc.

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIRaw(env, body) {
  if (!env.OPENAI_API_KEY) throw new Error('Thiếu OPENAI_API_KEY trên server');

  let lastError = new Error('Không gọi được AI, vui lòng thử lại');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_DELAY_MS * attempt);

    let resp;
    try {
      resp = await fetchWithTimeout(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // fetch() ném lỗi khi mất mạng giữa chừng hoặc bị huỷ do quá REQUEST_TIMEOUT_MS
      // (AbortError) — cả 2 trường hợp đều đáng thử lại, không phải lỗi do request sai.
      lastError = e && e.name === 'AbortError' ? new Error('OpenAI phản hồi quá chậm') : e;
      continue;
    }

    let json;
    try {
      json = await resp.json();
    } catch (e) {
      lastError = new Error('Không đọc được phản hồi từ AI');
      if (RETRYABLE_STATUS.has(resp.status)) continue;
      throw lastError;
    }

    if (json.error) {
      lastError = new Error(json.error.message || 'OpenAI error');
      if (RETRYABLE_STATUS.has(resp.status)) continue;
      throw lastError; // lỗi do request (sai key, sai định dạng...) — thử lại cũng vô ích
    }

    const msg = json.choices && json.choices[0] && json.choices[0].message;
    // Structured Outputs có thể "từ chối" thay vì trả content (hiếm với nội dung nội bộ trường học,
    // nhưng nếu xảy ra mà không bắt riêng thì code cũ sẽ cố JSON.parse('') và âm thầm trả về rỗng).
    // Đây không phải lỗi tạm thời (thử lại sẽ ra kết quả giống hệt) nên không đưa vào vòng lặp.
    if (msg && msg.refusal) throw new Error('AI từ chối trả lời: ' + msg.refusal);
    return (msg && msg.content) || '';
  }
  throw lastError;
}

// Dựng response_format kiểu "json_schema" (Structured Outputs) — ép OpenAI trả ĐÚNG cấu trúc
// khai báo, thay vì chỉ nhắc trong prompt rồi tự parse JSON bằng tay (cách cũ: AI trả sai định
// dạng — ví dụ thừa chữ, thiếu dấu ngoặc — sẽ khiến JSON.parse ném lỗi, bị try/catch nuốt mất,
// người dùng nhận kết quả rỗng mà không rõ vì sao). Dùng strict:true để OpenAI validate chặt.
function jsonSchemaFormat(name, schema) {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

export function callOpenAI(env, prompt, opts = {}) {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 900,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.3
  };
  if (opts.jsonSchema) body.response_format = jsonSchemaFormat(opts.jsonSchema.name, opts.jsonSchema.schema);
  return callOpenAIRaw(env, body);
}

export function callOpenAIVision(env, contentArr, opts = {}) {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: contentArr }],
    max_tokens: opts.max_tokens || 700,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.3
  };
  if (opts.jsonSchema) body.response_format = jsonSchemaFormat(opts.jsonSchema.name, opts.jsonSchema.schema);
  return callOpenAIRaw(env, body);
}

export function callOpenAIChat(env, messages, opts = {}) {
  return callOpenAIRaw(env, {
    model: 'gpt-4o-mini',
    messages,
    max_tokens: opts.max_tokens || 1200,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.4
  });
}
