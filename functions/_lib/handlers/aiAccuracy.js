import { newId } from '../ids.js';

// ============================================================
// AI ACCURACY LOG — đối chiếu "AI nói gì lúc CTV gửi bài" (ai_verdict, chấm 1 lần khi gửi) với
// "người duyệt quyết định gì cuối cùng" (human_status, sau khi hoàn tất workflow của vòng đó).
// Ghi vào bảng riêng ai_accuracy_log thay vì đọc lại `submissions` vì cột ai_verdict ở đó bị GHI
// ĐÈ mỗi lần CTV gửi lại — chỉ còn vòng mới nhất, không đủ để tính % chính xác "theo thời gian"
// hay phát hiện AI đang lệch hướng dần (xem thêm ghi chú trong migration).
// ============================================================

// Cách quy đổi "AI nói đúng ý người duyệt hay không": so khớp trực tiếp theo nghĩa tương ứng,
// không phải so chuỗi y hệt (AI trả "DUYỆT"/"CẦN SỬA"/"TỪ CHỐI", người duyệt trả
// "approved"/"revision"/"rejected" — 2 hệ nhãn khác nhau).
const VERDICT_TO_STATUS = { 'DUYỆT': 'approved', 'CẦN SỬA': 'revision', 'TỪ CHỐI': 'rejected' };

// Gọi ngay sau khi 1 vòng gửi đạt trạng thái CUỐI (approved/rejected/revision) — xem
// processDecision() trong submissions.js. Bỏ qua im lặng nếu CTV chưa chạy AI trước khi gửi
// (ai_verdict rỗng) — không có gì để so sánh. Lỗi ghi log không được làm hỏng việc duyệt bài nên
// luôn bọc try/catch ở nơi gọi.
export async function logAiAccuracy(supabase, row, humanStatus, reviewerName) {
  const aiVerdict = row.ai_verdict;
  if (!aiVerdict || !VERDICT_TO_STATUS[aiVerdict]) return;

  await supabase.from('ai_accuracy_log').insert({
    id: newId('AIACC'),
    submission_id: row.id,
    send_count: row.send_count || 1,
    title: row.title || '',
    content_type: row.content_type || null,
    campus: row.campus || null,
    ai_verdict: aiVerdict,
    ai_scores: row.ai_scores || null,
    human_status: humanStatus,
    is_match: VERDICT_TO_STATUS[aiVerdict] === humanStatus,
    reviewer_name: reviewerName || null
  });
}

export async function handleGetAiAccuracyReport(supabase, p) {
  let query = supabase.from('ai_accuracy_log').select('*').order('decided_at', { ascending: true });
  if (p.from) query = query.gte('decided_at', new Date(p.from).toISOString());
  if (p.to) query = query.lte('decided_at', new Date(p.to).toISOString());
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const rows = data || [];
  const total = rows.length;
  const matched = rows.filter(r => r.is_match).length;

  // Ma trận đối chiếu: AI nói gì (hàng) → người duyệt quyết định gì (cột). Giúp thấy rõ AI hay
  // lệch theo hướng nào (ví dụ hay nói DUYỆT nhưng người duyệt lại yêu cầu sửa) thay vì chỉ 1 %.
  const matrix = {
    'DUYỆT': { approved: 0, revision: 0, rejected: 0 },
    'CẦN SỬA': { approved: 0, revision: 0, rejected: 0 },
    'TỪ CHỐI': { approved: 0, revision: 0, rejected: 0 }
  };
  rows.forEach(r => { if (matrix[r.ai_verdict]) matrix[r.ai_verdict][r.human_status]++; });

  // Xu hướng theo tuần — để thấy % khớp đang tăng/giảm theo thời gian, không chỉ 1 con số tĩnh.
  const weekMap = {};
  rows.forEach(r => {
    const d = new Date(r.decided_at);
    const monday = new Date(d);
    const day = (monday.getUTCDay() + 6) % 7; // 0=Thứ 2
    monday.setUTCDate(monday.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    if (!weekMap[key]) weekMap[key] = { week_start: key, total: 0, matched: 0 };
    weekMap[key].total++;
    if (r.is_match) weekMap[key].matched++;
  });
  const weekly = Object.values(weekMap)
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map(w => ({ ...w, matchRate: w.total ? Math.round(w.matched / w.total * 100) : 0 }));

  // Vài lượt lệch gần nhất — để xem cụ thể bài nào AI đoán sai, không chỉ số liệu trừu tượng.
  const recentMismatches = rows.filter(r => !r.is_match).slice(-20).reverse().map(r => ({
    submission_id: r.submission_id, title: r.title, ai_verdict: r.ai_verdict, human_status: r.human_status,
    reviewer_name: r.reviewer_name, content_type: r.content_type, campus: r.campus, decided_at: r.decided_at
  }));

  return {
    ok: true,
    overview: { total, matched, mismatch: total - matched, matchRate: total ? Math.round(matched / total * 100) : 0 },
    matrix,
    weekly,
    recentMismatches,
    period: { from: p.from, to: p.to }
  };
}
