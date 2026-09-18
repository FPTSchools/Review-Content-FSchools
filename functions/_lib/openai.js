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
  return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
}

export function callOpenAI(env, prompt, opts = {}) {
  return callOpenAIRaw(env, {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 900,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.3
  });
}

export function callOpenAIVision(env, contentArr, opts = {}) {
  return callOpenAIRaw(env, {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: contentArr }],
    max_tokens: opts.max_tokens || 700,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.3
  });
}

export function callOpenAIChat(env, messages, opts = {}) {
  return callOpenAIRaw(env, {
    model: 'gpt-4o-mini',
    messages,
    max_tokens: opts.max_tokens || 1200,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.4
  });
}
