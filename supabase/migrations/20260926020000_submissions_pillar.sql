-- Gắn mỗi bài gửi duyệt với 1 trụ content (Humans, Tin tức-sự kiện, ...) để báo cáo đếm được
-- mỗi người viết bao nhiêu bài theo từng trụ — khớp với các đầu mục của Kế hoạch tháng.
-- Bài viết từ đầu việc kế hoạch lấy trụ của đầu việc; bài viết tự do do CTV chọn trong form.
-- Bài cũ (trước khi có cột này) để trống → hiện "Chưa phân loại" trong báo cáo.
ALTER TABLE submissions ADD COLUMN pillar_id TEXT REFERENCES content_pillars (id) ON DELETE SET NULL;
CREATE INDEX submissions_pillar_idx ON submissions (pillar_id);

-- Bài đã nối với đầu việc kế hoạch (nếu có) nhận luôn trụ của đầu việc đó.
UPDATE submissions s SET pillar_id = pi.pillar_id
FROM plan_items pi
WHERE pi.submission_id = s.id AND s.pillar_id IS NULL AND pi.pillar_id IS NOT NULL;
