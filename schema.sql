-- ============================================================
-- FSchools Content Review — Postgres schema (Supabase)
-- Thiết kế tương ứng với backend_apps_script.js (Google Sheets backend v4)
-- CHỈ ĐỂ XEM TRƯỚC — chưa chạy lên Supabase thật.
--
-- Nguyên tắc chuyển đổi từ Google Sheets sang Postgres:
--   - Giữ nguyên các ID dạng chuỗi (USR_..., SUB_..., MAIL_..., BG_..., CAT_..., DOC_...)
--     làm PRIMARY KEY (TEXT) để không phải viết lại logic sinh ID ở backend.
--   - Các cột vốn là JSON string trong Sheets (reviewers, decisions, review_history,
--     inline_comments, workflow_steps snapshot, ai_scores, brand_check_result, match_rule,
--     assignment_rule, allowed_roles...) chuyển sang JSONB hoặc TEXT[] để Postgres validate
--     và query được, thay vì chuỗi text như trên Sheets.
--   - Các cột boolean từng lưu là chuỗi 'true'/'false' (is_shared) chuyển thành BOOLEAN thật.
--   - Các mốc thời gian ISO string chuyển thành TIMESTAMPTZ.
-- ============================================================

-- ============================================================
-- USERS
-- Nguồn: sheet "Users" — cột: id,email,password,name,role,campus,active,created_at,last_login
-- ============================================================
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  -- TODO bảo mật: app hiện lưu password dạng plaintext (kể cả gửi qua email khi tạo/đổi mật khẩu).
  -- Khi lên Postgres nên đổi sang lưu hash (bcrypt/argon2) và bỏ việc gửi mật khẩu qua email.
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('ctv','leader_content','leader','manager','admin')),
  campus      TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);

-- ============================================================
-- WORKFLOW TEMPLATES / STEPS
-- Nguồn: sheet "WorkflowTemplates" + "WorkflowSteps"
-- Mỗi workflow có nhiều version; chỉ 1 version active tại 1 thời điểm cho mỗi workflow_id.
-- ============================================================
CREATE TABLE workflow_templates (
  workflow_id TEXT NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  match_rule  JSONB NOT NULL DEFAULT '{}',   -- { content_types, campuses, is_shared }
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE workflow_steps (
  workflow_id       TEXT NOT NULL,
  workflow_version  INTEGER NOT NULL,
  step_id           TEXT NOT NULL,
  step_order        INTEGER NOT NULL,
  label             TEXT NOT NULL,
  mode              TEXT NOT NULL DEFAULT 'sequential'
                      CHECK (mode IN ('sequential','parallel_any','parallel_all')),
  min_approvals     INTEGER NOT NULL DEFAULT 1,
  assignment_rule   JSONB NOT NULL DEFAULT '{}', -- { type, user_ids | roles | campus | exclude_user_ids | assignment_mode }
  sla_hours         INTEGER NOT NULL DEFAULT 0,
  on_approve        TEXT NOT NULL DEFAULT 'next_step',
  on_revision       TEXT NOT NULL DEFAULT 'revision',
  on_reject         TEXT NOT NULL DEFAULT 'rejected',
  PRIMARY KEY (workflow_id, workflow_version, step_id),
  FOREIGN KEY (workflow_id, workflow_version)
    REFERENCES workflow_templates (workflow_id, version) ON DELETE CASCADE
);

CREATE INDEX workflow_templates_active_idx ON workflow_templates (workflow_id) WHERE active;

-- ============================================================
-- SUBMISSIONS (bảng trung tâm)
-- Nguồn: sheet "Submissions" — 37 cột (base 30 + workflow runtime 6 + platform 1)
-- ============================================================
CREATE TABLE submissions (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users (id),
  user_name               TEXT NOT NULL,
  user_email              TEXT NOT NULL,
  campus                  TEXT,
  content_type            TEXT,
  audience                TEXT,
  title                   TEXT NOT NULL,
  content                 TEXT,
  note                    TEXT,
  drive_links             TEXT,
  ai_verdict              TEXT,
  ai_scores               JSONB,
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                  TEXT NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new','reviewing','revision','approved','rejected','cancelled')),
  comment                 TEXT,
  score                   NUMERIC,
  reviewer_name           TEXT,
  reviewed_at             TIMESTAMPTZ,
  send_count              INTEGER NOT NULL DEFAULT 1,
  -- Bài gốc khi submission này là bản gửi lại/nhân bản của một bài trước đó (không bắt buộc).
  original_id             TEXT REFERENCES submissions (id) ON DELETE SET NULL,
  reviewers               JSONB NOT NULL DEFAULT '[]',   -- snapshot toàn bộ reviewer của mọi step lúc gửi
  current_reviewer_id     TEXT REFERENCES users (id),
  current_reviewer_name   TEXT,
  is_shared               BOOLEAN NOT NULL DEFAULT FALSE,
  current_reviewer_index  INTEGER NOT NULL DEFAULT 0,
  inline_comments         JSONB,
  review_history          JSONB NOT NULL DEFAULT '[]',
  brand_check_result      JSONB,
  evidence_links          TEXT,
  -- Workflow runtime (multi-step, song song/leo thang)
  workflow_id             TEXT NOT NULL DEFAULT 'manual_chain',
  workflow_version        INTEGER NOT NULL DEFAULT 1,
  workflow_steps          JSONB,   -- snapshot { workflow_id, workflow_version, steps:[{step_id,state,decisions,...}] }
  current_step_id         TEXT,
  lock_version            INTEGER NOT NULL DEFAULT 1,   -- optimistic locking cho hành động duyệt
  idempotency_key         TEXT,
  platform                TEXT[] NOT NULL DEFAULT '{}'
);

-- Idempotency: handleSubmit chặn trùng theo (user_id, idempotency_key)
CREATE UNIQUE INDEX submissions_user_idempotency_uq
  ON submissions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX submissions_user_id_idx          ON submissions (user_id);
CREATE INDEX submissions_status_idx           ON submissions (status);
CREATE INDEX submissions_campus_idx           ON submissions (campus);
CREATE INDEX submissions_current_reviewer_idx ON submissions (current_reviewer_id);
CREATE INDEX submissions_submitted_at_idx     ON submissions (submitted_at DESC);

-- ============================================================
-- SUBMISSION VERSIONS (lịch sử mỗi lần gửi/sửa)
-- Nguồn: sheet "SubmissionVersions"
-- ============================================================
CREATE TABLE submission_versions (
  id              TEXT PRIMARY KEY,
  submission_id   TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  revision_no     INTEGER NOT NULL,
  user_id         TEXT REFERENCES users (id),
  user_name       TEXT,
  title           TEXT,
  content         TEXT,
  note            TEXT,
  drive_links     TEXT,
  evidence_links  TEXT,
  reviewers       JSONB,
  inline_comments JSONB,
  review_history  JSONB,
  submitted_at    TIMESTAMPTZ,
  status          TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform        TEXT[] DEFAULT '{}',
  UNIQUE (submission_id, revision_no)
);

CREATE INDEX submission_versions_submission_idx ON submission_versions (submission_id);

-- ============================================================
-- SUBMISSION STEPS (audit trail runtime của từng step theo mỗi vòng gửi)
-- Nguồn: sheet "SubmissionSteps"
-- ============================================================
CREATE TABLE submission_steps (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  revision_no    INTEGER NOT NULL,
  step_id        TEXT NOT NULL,
  step_order     INTEGER NOT NULL DEFAULT 0,
  label          TEXT,
  mode           TEXT NOT NULL DEFAULT 'sequential'
                   CHECK (mode IN ('sequential','parallel_any','parallel_all')),
  state          TEXT NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending','in_review','approved','rejected','revision','forwarded')),
  reviewer_ids   JSONB NOT NULL DEFAULT '[]',
  decisions      JSONB NOT NULL DEFAULT '[]',
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ
);

CREATE INDEX submission_steps_submission_idx ON submission_steps (submission_id, revision_no);

-- ============================================================
-- DRAFTS (bài viết nháp, tự lưu)
-- Nguồn: sheet "Drafts"
-- ============================================================
CREATE TABLE drafts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id),
  user_name  TEXT,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX drafts_user_id_idx ON drafts (user_id);

-- ============================================================
-- RULES (cấu hình kiểm duyệt: từ cấm, yêu cầu bắt buộc, brand voice, logo, lịch sử sửa)
-- Nguồn: sheet "Rules" — dạng EAV theo cột "type". handleSaveRules xoá hết và ghi lại toàn bộ
-- mỗi lần lưu, nên giữ nguyên cấu trúc dòng-theo-loại để khớp hành vi backend hiện tại.
-- ============================================================
CREATE TABLE rules (
  id       BIGSERIAL PRIMARY KEY,
  type     TEXT NOT NULL CHECK (type IN ('banned','required','brand_voice','logo_rules','history')),
  value    TEXT,
  category TEXT,
  date     TIMESTAMPTZ
);

CREATE INDEX rules_type_idx ON rules (type);

-- ============================================================
-- PERSONAS (phong cách duyệt bài riêng theo từng người duyệt — dùng cho AI gợi ý)
-- Nguồn: sheet "Personas" — ban đầu khoá theo "name" (tên người duyệt), đã đổi sang khoá theo
-- user_id ở migration 20260923073531_personas_keyed_by_user_id.sql — tra theo tên hiển thị có
-- rủi ro mất/nhầm dữ liệu khi đổi tên hoặc trùng tên hiển thị (đã gặp thật: 2 user tên
-- "Thành Trung" khác id). "name" giữ lại chỉ để hiện danh sách cho gọn, KHÔNG dùng để tra cứu.
-- ============================================================
CREATE TABLE personas (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- BRAND GUIDES (brand guide dạng text markdown hoặc ảnh mẫu)
-- Nguồn: sheet "BrandGuides"
-- type='text'  → content chứa nội dung markdown.
-- type='image' → content chứa URL công khai của ảnh trên Supabase Storage (bucket "brand-guides",
--                xem migration 20260923080026_brand_guide_storage_bucket.sql) — đã thay cho Google
--                Drive file id như bản Apps Script cũ.
-- ============================================================
CREATE TABLE brand_guides (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('text','image')),
  content    TEXT,
  mime_type  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOCUMENT CATEGORIES / LINKS (kho tài liệu nội bộ)
-- Nguồn: sheet "DocumentCategories" + "DocumentLinks"
-- ============================================================
CREATE TABLE document_categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- App cho phép lưu user_id hoặc user_name (fallback) vào created_by nên không đặt FK cứng tới users.
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  color         TEXT NOT NULL DEFAULT '#E9E9E9'
                  CHECK (color IN ('#FCE4E4','#FDEBD3','#FFF6D6','#E3F3D9','#D8F1EA',
                                    '#DCEEFB','#E3E4FC','#F1E3FA','#FBE1F0','#E9E9E9')),
  -- Vai trò được xem danh mục này; rỗng = không ai xem được (trừ admin/manager).
  allowed_roles TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE document_links (
  id             TEXT PRIMARY KEY,
  -- Backend chặn xoá danh mục khi còn link (DOC_ADMIN check) → dùng RESTRICT để khớp hành vi.
  category_id    TEXT NOT NULL REFERENCES document_categories (id) ON DELETE RESTRICT,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  note           TEXT,
  added_by_id    TEXT REFERENCES users (id),
  added_by_name  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX document_links_category_idx ON document_links (category_id);

-- ============================================================
-- EMAIL QUEUE (hàng đợi gửi mail, xử lý theo trigger mỗi phút)
-- Nguồn: sheet "EmailQueue"
-- ============================================================
CREATE TABLE email_queue (
  id          TEXT PRIMARY KEY,
  event_key   TEXT,
  to_email    TEXT NOT NULL,
  to_name     TEXT,
  subject     TEXT,
  body        TEXT,
  html_body   TEXT,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

-- enqueueEmail chặn trùng theo event_key CHỈ KHI bản ghi cũ chưa ở trạng thái 'failed'.
CREATE UNIQUE INDEX email_queue_event_key_active_uq
  ON email_queue (event_key)
  WHERE event_key IS NOT NULL AND status <> 'failed';

CREATE INDEX email_queue_status_idx ON email_queue (status);

-- ============================================================
-- AI ACCURACY LOG (đối chiếu ai_verdict lúc gửi bài với quyết định cuối cùng của người duyệt)
-- Nguồn: migration 20260923072709_ai_accuracy_log.sql — không có trong sheet cũ, tính năng mới.
-- Ghi 1 dòng mỗi khi 1 vòng gửi đạt trạng thái cuối (approved/rejected/revision) VÀ CTV đã chạy
-- AI trước khi gửi. Tách riêng khỏi "submissions" vì ai_verdict ở đó bị ghi đè mỗi lần gửi lại.
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

-- ============================================================
-- ROW LEVEL SECURITY
-- App hiện dùng hệ thống đăng nhập riêng (bảng users tự quản lý), không dùng Supabase Auth.
-- Mọi truy vấn nên đi qua backend bằng service_role key (bỏ qua RLS); anon key không nên
-- có policy nào ở đây → bật RLS trên tất cả bảng nhưng KHÔNG tạo policy để mặc định chặn
-- hoàn toàn truy cập từ client dùng anon key.
-- ============================================================
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_guides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_accuracy_log      ENABLE ROW LEVEL SECURITY;
