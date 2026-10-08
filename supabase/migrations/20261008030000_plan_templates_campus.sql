-- Link kế hoạch năm: phân loại theo cơ sở (hoa_lac | tay_hn | chung = dùng chung cả 2 cơ sở).
ALTER TABLE plan_templates
  ADD COLUMN campus TEXT NOT NULL DEFAULT 'chung' CHECK (campus IN ('hoa_lac', 'tay_hn', 'chung'));
CREATE INDEX plan_templates_campus_idx ON plan_templates (campus, school_year);
