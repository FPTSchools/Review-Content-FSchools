-- KHO THÔNG TIN CHUẨN — mỗi dòng là 1 thông tin "chuẩn" của 1 cơ sở (hoặc chung 2 cơ sở): học phí,
-- học bổng, chương trình, cơ sở vật chất, thành tích, liên hệ... để AI viết/kiểm tra bài chỉ dùng số liệu
-- đúng, không tự bịa.
-- Luồng: CTV/Leader Content đề xuất → 'cho_xac_minh' → Admin/Trưởng ban/Trưởng phòng 'da_xac_minh' hoặc
-- 'tu_choi'. "Hết hạn" KHÔNG lưu riêng mà suy ra: đã xác minh + valid_until < hôm nay (tránh phải chạy
-- job cập nhật trạng thái). AI chỉ dùng thông tin đã xác minh và còn hạn.
CREATE TABLE knowledge_facts (
  id                 TEXT PRIMARY KEY,
  campus             TEXT NOT NULL CHECK (campus IN ('hoa_lac','tay_hn','chung')),
  category           TEXT NOT NULL,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  source             TEXT,                          -- nguồn: văn bản, link thông báo, người cung cấp...
  valid_until        DATE,                          -- hết hạn sau ngày này (NULL = không có hạn)
  status             TEXT NOT NULL DEFAULT 'cho_xac_minh' CHECK (status IN ('cho_xac_minh','da_xac_minh','tu_choi')),
  review_note        TEXT,                          -- lý do từ chối / ghi chú của người xác minh
  submitted_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  submitted_by_name  TEXT,
  verified_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  verified_by_name   TEXT,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_facts_campus_status_idx ON knowledge_facts (campus, status);

ALTER TABLE knowledge_facts ENABLE ROW LEVEL SECURITY;
