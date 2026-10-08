-- ĐỊNH MỨC BÀI THEO KÊNH: mỗi cơ sở đặt số bài mong muốn cho từng kênh theo TUẦN hoặc THÁNG (vd Fanpage Hòa Lạc 7 bài/tuần).
-- Tiến độ = số bài ĐÃ DUYỆT cho kênh đó trong kỳ (đối chiếu với định mức), kèm số bài đã đăng thật (publish_slots) để tham khảo.
-- Không có dòng = kênh đó chưa đặt định mức. Đặt định mức = 0 thì xoá dòng.
CREATE TABLE channel_quotas (
  id          TEXT PRIMARY KEY,
  campus      TEXT NOT NULL CHECK (campus IN ('hoa_lac','tay_hn')),
  channel     TEXT NOT NULL CHECK (channel IN ('facebook','instagram','tiktok','youtube','web','email','zalo','sms')),
  period      TEXT NOT NULL CHECK (period IN ('week','month')),
  target      INTEGER NOT NULL CHECK (target > 0 AND target <= 999),
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campus, channel, period)
);
-- Như các bảng khác: chỉ backend (service role) đọc/ghi.
ALTER TABLE channel_quotas ENABLE ROW LEVEL SECURITY;
