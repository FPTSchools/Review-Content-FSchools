# PROGRESS — FSchools Content Review: Migration Google Sheets → Supabase

> File này để bất kỳ ai (người hoặc Claude Code) mở dự án lên, dù ở máy nào, cũng
> hiểu ngay: đã làm gì, đang ở bước nào, cần làm tiếp gì — không cần đọc lại lịch sử chat.
> Cập nhật file này vào **cuối mỗi buổi làm việc**, rồi `git commit` + `git push`.

## Cập nhật gần nhất: 2026-09-18

## Bối cảnh dự án
- Công cụ nội bộ "FSchools Content Review" cho ~15-20 người dùng cùng lúc.
- Hiện trạng cũ: Frontend tĩnh (index.html/boss.html/ctv.html) trên Cloudflare Pages,
  backend là Google Apps Script (`backend_apps_script.js`), database là Google Sheets.
- Lý do đổi sang Supabase: Google Sheets làm database bị **lag** khi gửi duyệt bài,
  xem lại bài cũ, và kho tài liệu hay **vào được lúc không**. Mục tiêu: chuyển database
  sang Supabase (Postgres) để ổn định/nhanh hơn, giữ nguyên nghiệp vụ hiện có.

## Tài khoản/hạ tầng hiện tại (không chứa secret)
- GitHub repo: https://github.com/FPTSchools/Review-Content-FSchools (tài khoản trường, để bàn giao sau này)
- Supabase project ref: `jiqnvzbyjbkkyclwecfa` (project mới, tài khoản trường)
- Frontend: Cloudflare Pages — **chưa cập nhật** sang tài khoản Cloudflare mới trong repo/phiên làm việc này
- `.env` (KHÔNG commit — nằm trong `.gitignore`): chứa `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. Mỗi máy (nhà/trường) cần tự tạo file `.env` riêng, copy tay
  3 dòng này — GitHub sẽ không mang file này sang máy kia.

## Đã làm
- [x] Clone/khởi tạo code trong thư mục này, đẩy lên repo GitHub mới (`FPTSchools/Review-Content-FSchools`)
- [x] Tạo `.env` + `.gitignore` (chặn `.env` khỏi Git)
- [x] Đọc `backend_apps_script.js`, thiết kế **schema Postgres tương ứng** → xuất ra
      [`schema.sql`](schema.sql) (13 bảng tương ứng 13 sheet: users, submissions,
      submission_versions, submission_steps, workflow_templates, workflow_steps, drafts,
      rules, personas, brand_guides, document_categories, document_links, email_queue)
- [x] Cài công cụ dòng lệnh cần thiết trên máy này: Git, GitHub CLI (`gh`), Supabase CLI
      (Supabase CLI không có trên winget — đã tải binary trực tiếp từ GitHub Releases,
      giải nén vào `%LOCALAPPDATA%\Programs\SupabaseCLI`, thêm vào PATH máy này)
- [x] Đăng nhập GitHub CLI bằng tài khoản FPTSchools (máy này)
- [x] `supabase login` (tài khoản Supabase trường) — chạy ở terminal riêng của người dùng
- [x] `supabase init` — tạo `supabase/config.toml` (đã commit; `.temp` bị `.gitignore` loại trừ, không chứa secret)
- [x] `supabase link --project-ref jiqnvzbyjbkkyclwecfa` — đã nối thành công tới project
      "Review_Content" (vùng ap-southeast-1, trạng thái ACTIVE_HEALTHY)

## Quy ước làm việc đã chốt với người dùng
- **Làm thẳng trên nhánh `main`, không dùng quy trình branch + Pull Request** — vì chỉ có
  1 người quản lý dự án này, không cần bước review qua PR.
- Trước khi tạo bảng thật, đã cùng chốt 3 điểm nghiệp vụ (không đổi cấu trúc schema.sql):
  giữ nguyên 5 vai trò hiện có; giữ cột password dạng text (sẽ hash khi viết backend mới,
  chưa đổi vội); đồng ý hướng chuyển ảnh brand guide từ Google Drive sang Supabase Storage sau.

## Đang ở bước nào
- **Đã tạo bảng thật trên Supabase** (project Review_Content, `jiqnvzbyjbkkyclwecfa`) — 13 bảng
  theo đúng `schema.sql`, qua migration `supabase/migrations/20260918034517_init_schema.sql`,
  áp dụng bằng `supabase db push`. Xác nhận qua `supabase migration list`: local và remote khớp.
  **Database hiện đã có cấu trúc bảng nhưng CHƯA có dữ liệu thật** (chưa migrate dữ liệu từ
  Google Sheets sang, chưa có backend mới ghi vào đây).

## Cần làm tiếp (thứ tự đề xuất)
1. Viết backend mới (thay Google Apps Script) để đọc/ghi Supabase thay vì Google Sheets —
   **chưa bắt đầu**. Cần quyết định công nghệ backend mới (vd: Cloudflare Worker/Functions gọi
   thẳng Supabase, hoặc Supabase Edge Functions) — sẽ bàn khi tới bước này.
2. Lên kế hoạch di chuyển dữ liệu thật đang có trong Google Sheets sang các bảng Supabase
   tương ứng (data migration) — chưa bắt đầu, chỉ nên làm sau khi backend mới đã sẵn sàng.
3. Cập nhật Cloudflare Pages sang tài khoản mới (chưa làm trong phiên này).
4. Máy còn lại (nhà/trường) cần tự chạy `supabase login` riêng 1 lần (token đăng nhập không
   đi theo Git) trước khi dùng được lệnh `supabase` ở máy đó. Sau khi `git pull`, thư mục
   `supabase/` (config + migration) đã có sẵn, chỉ cần `supabase link --project-ref jiqnvzbyjbkkyclwecfa`
   lại (không cần link lại nếu đã pull đúng, nhưng an toàn thì chạy lại 1 lần cho chắc).

## Ghi chú / rủi ro cần nhớ
- `backend_apps_script.js` hiện lưu **mật khẩu người dùng dạng plaintext** (kể cả gửi qua
  email) — nên đổi sang lưu hash khi viết backend mới trên Supabase.
- `brand_guides` (ảnh mẫu) hiện lưu trên Google Drive (file id) — nên chuyển sang Supabase
  Storage khi migrate thật.
- 2 máy (nhà + trường) dùng chung tài khoản Claude Pro nhưng **không tự đồng bộ** chat/memory
  giữa 2 máy → luôn dựa vào file này + Git (`git pull` đầu buổi, `git push` cuối buổi) làm
  nguồn thông tin chính, đừng dựa vào việc Claude "nhớ" buổi làm việc trước ở máy kia.
