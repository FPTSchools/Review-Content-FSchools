-- ============================================================
-- Tạo bucket Supabase Storage cho ảnh mẫu brand guide (logo, banner chuẩn, mã màu...) — thay cho
-- Google Drive cũ. TODO này đã được ghi chú sẵn trong handleSaveBrandGuideImage()
-- (functions/_lib/handlers/brandGuides.js) từ đợt chuyển hệ thống, giờ làm nốt.
--
-- Bucket để PUBLIC (đọc công khai qua URL) vì:
--   (1) OpenAI Vision API cần fetch được ảnh trực tiếp qua URL khi chấm brand guide — dùng bucket
--       riêng tư sẽ phải tự ký URL có hạn dùng, phức tạp không cần thiết cho ảnh này.
--   (2) Đây là ảnh mẫu nhận diện thương hiệu (logo, banner...) dùng nội bộ để AI/nhân sự tham
--       chiếu — không phải dữ liệu nhạy cảm, tương đương mức công khai của link Drive cũ vẫn
--       đang dùng (drive.google.com/thumbnail — về bản chất cũng là link công khai không cần đăng
--       nhập, chỉ ẩn danh nhờ URL khó đoán).
-- Ghi/xoá file luôn đi qua backend bằng service_role key (bỏ qua RLS) nên không cần thêm policy
-- nào trên storage.objects, giống nguyên tắc RLS đã áp dụng cho toàn bộ bảng khác trong dự án.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-guides',
  'brand-guides',
  true,
  5242880, -- 5MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;
