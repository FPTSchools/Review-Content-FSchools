-- ============================================================
-- Đổi khoá của bảng "personas" từ TÊN hiển thị (name) sang user_id.
--
-- Lý do: tra persona theo tên hiển thị có 2 rủi ro mất/nhầm dữ liệu đã xảy ra thật trong dữ liệu
-- hiện tại (kiểm tra trước khi viết migration này):
--   (1) Nếu tên người duyệt bị sửa (thêm chức danh, sửa chính tả) — persona lưu theo tên cũ sẽ
--       "biến mất" không cảnh báo, AI chạy tiếp bình thường mà không có phong cách cá nhân.
--   (2) Hai người dùng khác nhau trùng tên hiển thị — dữ liệu thật hiện có 2 user tên
--       "Thành Trung" (id khác nhau, cùng role leader_content) — lưu theo tên sẽ áp NHẦM persona
--       của người này cho người kia.
--
-- Bảng "personas" hiện đang RỖNG (chưa ai cấu hình persona nào, đã kiểm tra trước khi viết
-- migration này) nên chỉ cần ALTER cấu trúc, không cần di dời dữ liệu cũ.
-- ============================================================
ALTER TABLE personas ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE personas ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE personas DROP CONSTRAINT personas_pkey;
ALTER TABLE personas ADD PRIMARY KEY (user_id);
-- "name" giữ lại làm tên hiển thị tại thời điểm lưu — CHỈ để hiện danh sách cho gọn, KHÔNG dùng
-- để tra cứu — nên không còn là khoá chính, không cần UNIQUE nữa.
