// ============================================================
// OpenAI proxy — port từ callOpenAI trong backend_apps_script.js.
// Gọi từ server (Cloudflare) để giữ bí mật OPENAI_API_KEY, giống lý do bản GAS gốc.
// ============================================================

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function callOpenAIRaw(env, body) {
  if (!env.OPENAI_API_KEY) throw new Error('Thiếu OPENAI_API_KEY trên server');
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || 'OpenAI error');
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  // Structured Outputs có thể "từ chối" thay vì trả content (hiếm với nội dung nội bộ trường học,
  // nhưng nếu xảy ra mà không bắt riêng thì code cũ sẽ cố JSON.parse('') và âm thầm trả về rỗng).
  if (msg && msg.refusal) throw new Error('AI từ chối trả lời: ' + msg.refusal);
  return (msg && msg.content) || '';
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
