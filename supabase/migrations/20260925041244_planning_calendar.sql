-- ============================================================
-- GIAI ĐOẠN 1 — KẾ HOẠCH & LỊCH (dựa theo file "Kế hoạch truyền thông THPT FPT Hà Nội" của cơ sở
-- Hòa Lạc, dùng chung form cho mọi cơ sở qua cột campus).
--   content_pillars : trụ content (danh mục Admin sửa được)
--   school_events   : lịch sự kiện theo năm học — nhập từ file ở trạng thái "chờ xác nhận",
--                     Leader Content xác nhận lại ngày cho năm học mới
--   plan_items      : đầu việc của kế hoạch content tháng (thay sheet "Kế hoạch content Tháng XX");
--                     nối với submissions khi CTV bấm "Viết bài" và gửi duyệt
-- ============================================================

CREATE TABLE content_pillars (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO content_pillars (id, name, sort_order) VALUES
  ('PIL_tin_tuc',    'Tin tức, thông báo, hoạt động, sự kiện', 1),
  ('PIL_moi_truong', 'Môi trường học tập',                     2),
  ('PIL_humans',     'Humans',                                 3),
  ('PIL_the_manh',   'Thế mạnh đào tạo',                       4),
  ('PIL_tuong_tac',  'Content tương tác, sáng tạo',            5);

CREATE TABLE school_events (
  id            TEXT PRIMARY KEY,
  campus        TEXT NOT NULL,                     -- hoa_lac | tay_hn | chung
  school_year   TEXT NOT NULL,                     -- vd '2026-2027'
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  title         TEXT NOT NULL,
  department    TEXT,                              -- Tổ/Phòng phụ trách
  start_date    DATE,                              -- khi status='cho_xac_nhan' đây chỉ là NGÀY GỢI Ý
  end_date      DATE,
  time_note     TEXT,                              -- giờ/buổi, hoặc thời gian gốc ghi trong file năm trước
  status        TEXT NOT NULL DEFAULT 'cho_xac_nhan'
                  CHECK (status IN ('cho_xac_nhan', 'da_xac_nhan', 'huy')),
  lead_days     INTEGER NOT NULL DEFAULT 14,       -- bắt đầu chuẩn bị truyền thông trước bao nhiêu ngày
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  confirmed_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  confirmed_at  TIMESTAMPTZ,
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX school_events_campus_year_idx ON school_events (campus, school_year, month);

CREATE TABLE plan_items (
  id             TEXT PRIMARY KEY,
  campus         TEXT NOT NULL,
  plan_month     DATE NOT NULL,                    -- ngày 1 của tháng kế hoạch
  pillar_id      TEXT REFERENCES content_pillars (id) ON DELETE SET NULL,
  event_id       TEXT REFERENCES school_events (id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  highlight      TEXT,                             -- highlight nội dung
  reference      TEXT,                             -- chi tiết bài viết / ref
  channels       TEXT[] NOT NULL DEFAULT '{}',     -- cùng giá trị với submissions.platform
  format         TEXT,                             -- hình thức: bài viết + album, clip reels...
  assignee_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  deadline       DATE,
  publish_date   DATE,
  submission_id  TEXT REFERENCES submissions (id) ON DELETE SET NULL,
  post_link      TEXT,
  created_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX plan_items_campus_month_idx ON plan_items (campus, plan_month);
CREATE INDEX plan_items_assignee_idx     ON plan_items (assignee_id);
CREATE INDEX plan_items_submission_idx   ON plan_items (submission_id);

-- Giống mọi bảng khác: chỉ backend (service_role) truy cập, không mở policy cho anon key.
ALTER TABLE content_pillars ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_items      ENABLE ROW LEVEL SECURITY;
