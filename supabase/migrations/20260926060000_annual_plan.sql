-- KẾ HOẠCH NĂM — thay sheet "Kế hoạch năm" trong file Kế hoạch truyền thông.
-- Mỗi dòng là 1 "tuyến" của kế hoạch năm (1 tổ/phòng, 1 series, 1 chiến dịch, 1 kênh báo chí...),
-- thuộc 1 nhóm (section). Nội dung từng tháng nằm trong cột JSONB "months":
--   { "2026-10": { "highlight": "...", "target": 4, "budget": 0, "format": "Video" }, ... }
-- Mục tiêu/thông điệp theo giai đoạn cũng là 1 dòng, section = 'muc_tieu'.
CREATE TABLE annual_plan_lines (
  id           TEXT PRIMARY KEY,
  campus       TEXT NOT NULL,
  school_year  TEXT NOT NULL,                     -- '2026-2027'
  section      TEXT NOT NULL CHECK (section IN ('muc_tieu','su_kien','lop_hoc','chu_de','campaign','tuyen_sinh','kenh_ngoai')),
  name         TEXT NOT NULL,
  note         TEXT,                              -- mô tả chung của tuyến/chiến dịch
  pillar_id    TEXT REFERENCES content_pillars (id) ON DELETE SET NULL,
  months       JSONB NOT NULL DEFAULT '{}',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'manual',    -- 'manual' | 'import' | 'copy'
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX annual_plan_lines_campus_year_idx ON annual_plan_lines (campus, school_year);

-- Chỉ backend (service role) đọc/ghi — giống các bảng khác của dự án.
ALTER TABLE annual_plan_lines ENABLE ROW LEVEL SECURITY;
