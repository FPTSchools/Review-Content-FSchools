-- KHO TÀI LIỆU: chia danh mục theo KHU VỰC — Dùng chung / Sale / PR - Truyền thông.
-- Khu vực chỉ là lớp nhóm để dễ tìm; ai được xem danh mục nào vẫn do Admin chọn ở "allowed_roles"
-- (theo chức vụ) như trước. Danh mục cũ để 'chung', Admin chuyển sang khu vực đúng trong màn Quản lý.
ALTER TABLE document_categories
  ADD COLUMN area TEXT NOT NULL DEFAULT 'chung' CHECK (area IN ('chung', 'sale', 'pr'));
