export function asBoolean(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

// Frontend hiện tại có thể gửi ai_scores/brand_check_result dạng chuỗi JSON (như thời còn gọi
// Apps Script) — cột JSONB muốn nhận object/array thật, nên parse hộ nếu là chuỗi.
export function toJsonb(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (e) { return value; }
  }
  return value;
}

// Lưu ý: review_history trên Postgres là JSONB (mảng thật), không phải chuỗi JSON như Sheets cũ
// → addHistory nhận/trả về MẢNG, không cần JSON.stringify/parse như bản Apps Script gốc.
export function addHistory(existing, reviewerName, action, comment, score) {
  const history = Array.isArray(existing) ? existing.slice() : [];
  history.push({
    reviewer: reviewerName,
    action,
    comment: comment || '',
    score: score || '',
    at: new Date().toISOString()
  });
  return history;
}
