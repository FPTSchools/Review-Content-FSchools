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
- Frontend: Cloudflare Pages — **2 bản TÁCH BIỆT HOÀN TOÀN, không liên quan nhau**:
  - Bản cũ (đang chạy thật, dùng Google Apps Script + Sheets) nằm ở 1 tài khoản Cloudflare riêng —
    KHÔNG đụng vào, vẫn phục vụ người dùng thật bình thường trong suốt quá trình làm dự án này.
  - Dự án migrate này (repo hiện tại) **đã deploy lên tài khoản Cloudflare MỚI** (đăng nhập
    bằng email `thpt@fpt.edu.vn`), project Pages tên `review-content-fschools`, xem preview
    tại **https://review-content-fschools.pages.dev** (đã test `/api` thật, đọc/ghi Supabase
    OK). Đây chỉ là bản xem trước song song — **frontend thật (index/boss/ctv.html) trong bản
    deploy này vẫn đang gọi Google Apps Script cũ** (chưa đổi API URL), nên trang HTML hiển thị
    y hệt bản cũ, chỉ có `/api` là backend mới đã chạy được, có thể gọi thử độc lập.
    Việc "cắt sang" cho người dùng thật chỉ xảy ra khi người dùng chủ động chuyển hẳn (đổi domain
    người dùng đang dùng sang trỏ về đây), không phải một bước kỹ thuật tự động.
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
- [x] Cài Node.js (chưa có sẵn trên máy) + `npm install` (thư viện `@supabase/supabase-js`,
      `wrangler` là devDependency local trong `node_modules`, không cài global)
- [x] Viết backend Cloudflare Pages Functions Phase 1 (xem mục "Đang ở bước nào") + test bằng
      `wrangler pages dev` cục bộ (đọc/ghi Supabase thật qua API, dọn sạch dữ liệu test sau đó)
- [x] Đăng nhập Wrangler CLI vào tài khoản Cloudflare MỚI (`thpt@fpt.edu.vn`) qua OAuth
- [x] Tạo project Cloudflare Pages `review-content-fschools`, set 2 secret
      (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) qua `wrangler pages secret put`, deploy
      thành công, test `/api` thật trên https://review-content-fschools.pages.dev — hoạt động
      đúng (đọc/ghi Supabase OK).
      ⚠️ Lưu ý kỹ thuật: `wrangler pages secret put` set qua PowerShell pipe (`"value" | wrangler...`)
      bị lỗi "Invalid API key" — nghi do PowerShell thêm ký tự xuống dòng vào giá trị secret.
      Khắc phục bằng cách ghi giá trị ra file tạm (không có newline thừa) rồi redirect stdin từ
      file đó, SAU ĐÓ **phải deploy lại 1 lần nữa** thì secret mới mới có hiệu lực (đổi secret
      không tự áp dụng cho deployment đang chạy).

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
- **Backend mới (Cloudflare Pages Functions) — Phase 1 xong, đã test thật trên Supabase (tạo/xoá
  dữ liệu test qua API rồi dọn sạch, không còn rác trong DB).** Chạy được ở `functions/api/index.js`
  (router, giữ nguyên giao thức cũ: POST `/api` body `{action,...}` → trả `{ok,...}`, y hệt cách
  frontend gọi `APPS_SCRIPT_URL` hiện tại — **frontend CHƯA đổi sang endpoint mới**, vẫn đang gọi
  Google Apps Script như cũ, an toàn vì backend mới chưa đủ action để thay thế hoàn toàn).
  Action đã port + test OK: `login, get_users, add_user, update_user, delete_user, get_rules,
  save_rules, get_personas, save_persona, delete_persona, get_brand_guides,
  save_brand_guide_text, delete_brand_guide, get_document_categories, add_document_category,
  update_document_category, delete_document_category, get_document_links, add_document_link,
  update_document_link, delete_document_link`.
  Test cục bộ bằng `npx wrangler pages dev .` (Node.js đã cài máy này) + file `.dev.vars`
  (chứa SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, KHÔNG commit — giống `.env` nhưng đây là tên
  file riêng mà Wrangler tự đọc).

## Cần làm tiếp (thứ tự đề xuất)
1. **Backend Phase 2 (việc lớn nhất còn lại) — chưa bắt đầu**: port luồng gửi bài/duyệt bài
   nhiều bước (`submit, resubmit, update_submission, cancel_submission, approve, reject,
   request_revision, forward_to_next, change_reviewer, save_inline_comments, get_submissions,
   workflow templates CRUD, drafts, submission versions`) — đây là phần phức tạp nhất
   (workflow engine, optimistic locking, lịch sử duyệt) trong `backend_apps_script.js`,
   nên làm cẩn thận riêng, không gộp vội.
2. **Backend Phase 3**: các action gọi AI (`ai_check_content, ai_check_brand_image,
   ai_suggest_review, ai_chat`) — cần OpenAI API key mới (đưa vào biến môi trường Cloudflare,
   KHÔNG hard-code), và `process_email_queue` — cần chọn provider gửi email thay GmailApp
   (chưa chọn — ví dụ Resend/SendGrid), vì hiện `add_user`/`update_user` mật khẩu mới KHÔNG
   tự gửi mail (trả `email_sent:false`, admin phải tự báo thủ công).
3. `save_brand_guide_image` (upload ảnh mẫu) hiện trả lỗi rõ ràng "chưa hỗ trợ" — cần tạo
   bucket Supabase Storage rồi làm sau (thay vì Google Drive cũ).
4. Khi Phase 2+3 xong và test kỹ: đổi hằng số API URL trong `index.html/boss.html/ctv.html`
   (hiện là `APPS_SCRIPT_URL`) sang endpoint `/api` của Cloudflare Functions **trong bản deploy
   ở tài khoản Cloudflare MỚI** (không đụng gì tới bản cũ đang chạy thật ở tài khoản Cloudflare
   cũ) — đây là bước chuẩn bị bản mới sẵn sàng, KHÔNG phải "cắt sang cho người dùng thật" (việc
   đó chỉ xảy ra khi người dùng chủ động chuyển qua dùng domain/bản mới sau này).
5. Lên kế hoạch di chuyển dữ liệu thật đang có trong Google Sheets sang các bảng Supabase
   tương ứng (data migration) — làm sau khi Phase 2 xong.
6. ~~Kết nối repo này với tài khoản Cloudflare MỚI~~ — **XONG** (project `review-content-fschools`,
   xem "Đã làm"). Khi thêm `OPENAI_API_KEY` ở Phase 3, set thêm secret bằng cách tương tự
   (`wrangler pages secret put OPENAI_API_KEY --project-name review-content-fschools`, nhớ dùng
   cách ghi file tạm + redirect stdin, KHÔNG pipe trực tiếp qua PowerShell — xem ghi chú kỹ thuật
   ở "Đã làm" — và nhớ deploy lại sau khi set secret).
7. Máy còn lại (nhà/trường): sau `git pull`, cần tự tạo file `.dev.vars` (copy nội dung giống
   `.env`) và chạy `npm install` trước khi `npx wrangler pages dev .` test được; cũng cần tự
   `supabase login` và (nếu muốn tự deploy Cloudflare từ máy đó) `wrangler login` 1 lần —
   các phiên đăng nhập CLI này không đi theo Git, mỗi máy tự đăng nhập riêng.

## Ghi chú / rủi ro cần nhớ
- `backend_apps_script.js` hiện lưu **mật khẩu người dùng dạng plaintext** (kể cả gửi qua
  email) — nên đổi sang lưu hash khi viết backend mới trên Supabase.
- `brand_guides` (ảnh mẫu) hiện lưu trên Google Drive (file id) — nên chuyển sang Supabase
  Storage khi migrate thật.
- 2 máy (nhà + trường) dùng chung tài khoản Claude Pro nhưng **không tự đồng bộ** chat/memory
  giữa 2 máy → luôn dựa vào file này + Git (`git pull` đầu buổi, `git push` cuối buổi) làm
  nguồn thông tin chính, đừng dựa vào việc Claude "nhớ" buổi làm việc trước ở máy kia.
