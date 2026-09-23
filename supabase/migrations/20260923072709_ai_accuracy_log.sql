-- ============================================================
-- AI ACCURACY LOG — theo dõi AI kiểm duyệt (ai_verdict lúc CTV gửi bài) có khớp với quyết định
-- CUỐI CÙNG của người duyệt (approved/rejected/revision) hay không, cho từng VÒNG gửi riêng
-- (mỗi lần gửi lại là 1 vòng). Ghi 1 dòng khi 1 vòng đạt trạng thái cuối, CHỈ khi CTV đã chạy AI
-- trước khi gửi (ai_verdict khác rỗng) — không có gì để so sánh thì bỏ qua.
--
-- KHÔNG tính lại từ bảng "submissions" vì cột ai_verdict ở đó bị GHI ĐÈ mỗi lần gửi lại (chỉ giữ
-- vòng mới nhất) — bảng riêng này giữ lịch sử đầy đủ qua nhiều vòng để tính % chính xác đúng
-- nghĩa "theo thời gian", tránh thiên lệch (những vòng "CẦN SỬA" rồi được gửi lại sẽ mất dấu nếu
-- chỉ đọc từ submissions).
-- ============================================================
CREATE TABLE ai_accuracy_log (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  send_count    INTEGER NOT NULL,
  title         TEXT,
  content_type  TEXT,
  campus        TEXT,
  ai_verdict    TEXT NOT NULL CHECK (ai_verdict IN ('DUYỆT','CẦN SỬA','TỪ CHỐI')),
  ai_scores     JSONB,
  human_status  TEXT NOT NULL CHECK (human_status IN ('approved','rejected','revision')),
  is_match      BOOLEAN NOT NULL,
  reviewer_name TEXT,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_accuracy_log_decided_at_idx ON ai_accuracy_log (decided_at DESC);
CREATE INDEX ai_accuracy_log_submission_idx ON ai_accuracy_log (submission_id);

-- Giống các bảng khác: app dùng service_role key ở backend, không tạo policy nào ở đây để chặn
-- hoàn toàn truy cập trực tiếp bằng anon key.
ALTER TABLE ai_accuracy_log ENABLE ROW LEVEL SECURITY;
