-- KẾT NỐI KÊNH ĐĂNG: danh sách tài khoản/kênh mà tool sẽ đăng bài lên (Fanpage Facebook, TikTok, Zalo OA, kênh Youtube, Website),
-- mỗi cơ sở khai báo kênh của mình. Giai đoạn 1 chỉ KHAI BÁO (status = 'khai_bao'): tên, ID, link kênh — để người đăng bài thủ công
-- biết đăng ở đâu và để giao diện sẵn sàng. Khi nối API thật sẽ chuyển status sang 'da_ket_noi'; token/khoá truy cập sẽ lưu ở BẢNG RIÊNG
-- (channel_credentials, thêm cùng lúc nối API) — KHÔNG bao giờ để trong bảng này vì bảng này được trả về cho mọi người dùng xem.
CREATE TABLE channel_accounts (
  id               TEXT PRIMARY KEY,
  channel          TEXT NOT NULL CHECK (channel IN ('facebook','tiktok','zalo','youtube','web')),
  campus           TEXT NOT NULL CHECK (campus IN ('hoa_lac','tay_hn','chung')),
  name             TEXT NOT NULL,                  -- tên hiển thị: "FPT Schools Hòa Lạc", "fschools.edu.vn"...
  external_id      TEXT,                           -- Page ID / OA ID / Channel ID / địa chỉ website
  page_url         TEXT,                           -- link mở kênh
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'khai_bao' CHECK (status IN ('khai_bao','da_ket_noi','het_han','loi')),
  connected_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channel_accounts_idx ON channel_accounts (channel, campus);
-- Như các bảng khác: chỉ backend (service role) đọc/ghi.
ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
