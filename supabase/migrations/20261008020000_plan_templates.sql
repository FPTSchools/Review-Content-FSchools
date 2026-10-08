-- MẪU KẾ HOẠCH NĂM: nơi lưu đường link Google Sheet mẫu mà từng phòng ban/tổ nhà trường dùng để lập kế hoạch cả năm.
-- Hiện ở trang Kế hoạch & Lịch, tab "Mẫu kế hoạch năm". Mọi người xem được; Leader Content/Trưởng phòng/Trưởng ban/Admin thêm, sửa, xoá.
CREATE TABLE plan_templates (
  id              TEXT PRIMARY KEY,
  school_year     TEXT NOT NULL,                  -- '2026-2027'
  department      TEXT NOT NULL,                  -- phòng ban / tổ lập kế hoạch
  title           TEXT NOT NULL,                  -- tên mẫu
  url             TEXT NOT NULL,                  -- link Google Sheet
  note            TEXT,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_templates_year_idx ON plan_templates (school_year, department);
-- Như các bảng khác: chỉ backend (service role) đọc/ghi.
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
