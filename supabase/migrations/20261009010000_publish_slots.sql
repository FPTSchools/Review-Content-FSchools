-- LỊCH ĐĂNG: mỗi bài ĐÃ DUYỆT × mỗi kênh đăng = 1 "suất đăng" (publish slot): ngày/giờ dự kiến đăng, đã đăng chưa, link bài đã đăng.
-- Suất đăng chỉ được tạo khi có người đặt lịch hoặc bấm "Đã đăng" — bài đã duyệt chưa có dòng nào vẫn hiện trong hàng chờ
-- (suy ra từ submissions.platform), nên không cần đồng bộ lúc duyệt bài.
CREATE TABLE publish_slots (
  id              TEXT PRIMARY KEY,
  submission_id   TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('facebook','instagram','tiktok','youtube','web','email','zalo','sms')),
  campus          TEXT,                              -- chép từ bài để lọc theo cơ sở
  scheduled_date  DATE,                              -- NULL = chưa lên lịch
  scheduled_time  TEXT,                              -- 'HH:MM' (không bắt buộc)
  status          TEXT NOT NULL DEFAULT 'cho_dang' CHECK (status IN ('cho_dang','da_dang')),
  post_link       TEXT,
  posted_at       TIMESTAMPTZ,
  posted_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  posted_by_name  TEXT,
  note            TEXT,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, channel)
);
CREATE INDEX publish_slots_date_idx ON publish_slots (status, scheduled_date);
-- Như các bảng khác: chỉ backend (service role) đọc/ghi.
ALTER TABLE publish_slots ENABLE ROW LEVEL SECURITY;
