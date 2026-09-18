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
  (chứa SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/APP_URL, KHÔNG commit — giống `.env` nhưng đây
  là tên file riêng mà Wrangler tự đọc).
- **Backend Phase 2 — XONG, đã test kỹ thật trên Supabase (nhiều kịch bản, dọn sạch dữ liệu
  test sau đó).** Đây là phần workflow engine phức tạp nhất: `submit, resubmit,
  update_submission, cancel_submission, approve, reject, request_revision, forward_to_next,
  change_reviewer, save_inline_comments, get_submissions, get_report, check_submit_result,
  save_draft, get_drafts, delete_draft, get_submission_versions, get_workflows,
  get_workflow_templates, save_workflow_template, delete_workflow_template,
  validate_workflow_template`.
  Đã test qua browser (fetch trực tiếp `/api`) các kịch bản: workflow 2 bước tuần tự
  (submit → approve bước 1 → tự chuyển bước 2 → approve → status "approved"), duplicate
  decision bị chặn, revision → resubmit (dùng lại đúng workflow cũ, tăng send_count),
  forward_to_next (kể cả chặn "NO_NEXT_STEP" khi đã ở bước cuối), change_reviewer, inline
  comments, drafts CRUD, workflow templates CRUD (kèm chặn quyền `WORKFLOW_ADMIN_REQUIRED`
  cho role không phải admin/manager), get_report (tính điểm/tỷ lệ duyệt đúng). Email thông báo
  (duyệt/chuyển/kết quả) được ghi đúng vào `email_queue` ở mọi bước (verify trực tiếp qua script
  Node, không qua HTTP) — đúng thứ tự, đúng người nhận.
  Đơn giản hoá có chủ đích so với bản gốc: bỏ nhánh "workflow legacy không có workflow_steps"
  (bản Sheets giữ nhánh này để tương thích dữ liệu cũ trước khi có workflow engine — trên
  Postgres mọi submission LUÔN có workflow_steps ngay từ lúc tạo nên nhánh đó không thể xảy ra).
  Khoá đồng thời: thay `LockService` toàn cục (Apps Script) bằng "optimistic concurrency" đúng
  kiểu Postgres — mỗi UPDATE quyết định duyệt kèm `WHERE lock_version = <giá trị vừa đọc>`,
  0 dòng bị ảnh hưởng → trả lỗi `STALE_LOCK_VERSION` (khách phải tải lại/thử lại), tránh mất
  hoàn toàn "khoá toàn cục" chặn mọi submission khác trong lúc 1 submission đang được xử lý.
  Deploy live tại **https://review-content-fschools.pages.dev** — đã smoke-test qua PowerShell
  (không chỉ local) trước khi coi Phase 2 là xong.
- **Backend Phase 3 — XONG, đã test thật (kể cả gửi email thật qua Resend, không chỉ ghi hàng đợi).**
  `ai_check_content, ai_check_brand_image, ai_suggest_review, ai_chat` — đều gọi OpenAI
  (`gpt-4o-mini`) y hệt logic gốc, kể cả phần chặn từ cấm bằng code (không để AI tự phán) và
  logic build ngữ cảnh quy tắc/brand guide/persona người duyệt. Test qua browser: bài chứa từ
  cấm bị ép verdict CẦN SỬA/TỪ CHỐI đúng như kỳ vọng, bài sạch được DUYỆT với điểm hợp lý,
  ai_chat/ai_suggest_review trả lời đúng ngữ cảnh, ai_check_brand_image chấm ảnh test theo đúng
  4 tiêu chí (màu/logo/font/bố cục).
  `process_email_queue` — đã chọn **Resend** làm provider (thay GmailApp), gửi thật qua
  `functions/_lib/resend.js`. Test bằng địa chỉ test an toàn của Resend
  (`delivered@resend.dev` — không gửi vào hộp thư thật) → `process_email_queue` trả về
  `sent:1, failed:0`, xác nhận cơ chế gửi hoạt động đúng đầu-cuối.
  Email đang gửi từ địa chỉ mặc định của Resend (`onboarding@resend.dev`), chưa phải email
  @fpt.edu.vn thật — cần xác minh domain trên Resend sau nếu muốn gửi từ domain trường.
- **Lập lịch tự động cho `process_email_queue` — XONG.** Cloudflare Pages không hỗ trợ Cron
  Trigger trực tiếp nên đã tạo 1 Cloudflare Worker riêng, nhỏ, chỉ để lập lịch:
  `cloudflare/email-cron-worker/` (deploy độc lập bằng `wrangler deploy`, KHÁC với
  `wrangler pages deploy` dùng cho project chính) — cứ mỗi 2 phút gọi `/api` với
  `{action:"process_email_queue"}`. Đã test thật: chèn 1 email test vào hàng đợi, đợi đúng
  1 chu kỳ, xác nhận qua `wrangler tail` thấy Cron chạy "Ok", và email chuyển từ trạng thái
  "queued" sang "sent" tự động, không cần gọi tay. Worker này tên
  `review-content-fschools-email-cron`, chạy trên cùng tài khoản Cloudflare mới.

## Cần làm tiếp (thứ tự đề xuất)
1. (Tuỳ chọn, không gấp) Xác minh domain @fpt.edu.vn trên Resend để email gửi ra trông
   chuyên nghiệp hơn (hiện đang từ `onboarding@resend.dev`) — cần nhờ IT thêm bản ghi DNS.
2. `save_brand_guide_image` (upload ảnh mẫu) hiện trả lỗi rõ ràng "chưa hỗ trợ" — cần tạo
   bucket Supabase Storage rồi làm sau (thay vì Google Drive cũ).
3. ~~Chuẩn bị frontend gọi backend mới~~ — **XONG.** Đã đổi giá trị hằng số `APPS_SCRIPT_URL`
   trong cả 3 file (`index.html`, `boss.html`, `ctv.html`) từ URL Google Apps Script sang `/api`
   (path tương đối — hoạt động đúng vì frontend và backend giờ chạy chung 1 domain Cloudflare
   Pages). Không đổi tên biến hay logic gọi API nào khác — chỉ đổi giá trị URL, giảm rủi ro.
   Đã rà soát bằng agent con: **toàn bộ 43 action mà 3 file frontend gọi tới đều đã có route
   tương ứng trong backend mới** (không hành động nào rơi vào nhánh lỗi "chưa hỗ trợ").
   Đã test bằng tay qua giao diện thật (không chỉ gọi API thô): tạo user CTV + Leader test,
   đăng nhập CTV → điền form → chọn người duyệt → gửi bài → xác nhận bài hiện đúng trạng thái
   trong "Bài của tôi" → đăng xuất → đăng nhập Leader → thấy bài trong hàng chờ duyệt → bấm
   Duyệt → hàng chờ trống. Toàn bộ chạy đúng trên bản deploy MỚI
   (https://review-content-fschools.pages.dev), **bản cũ đang chạy thật hoàn toàn không bị
   động tới** (khác tài khoản Cloudflare, không tự deploy theo repo này — đã xác nhận với
   người dùng trước khi sửa). Dữ liệu test đã dọn sạch khỏi Supabase sau khi test xong.
   **Lưu ý quan trọng**: dù code đã sẵn sàng, bản deploy ở `review-content-fschools.pages.dev`
   HIỆN TẠI đã là 1 bản chạy đầy đủ trên backend mới — nhưng chưa có người dùng thật nào được
   thông báo/trỏ sang dùng nó. Việc "cắt sang thật" (báo người dùng đổi link, hoặc trỏ domain
   chính về đây) vẫn là quyết định riêng, cần làm SAU khi di chuyển xong dữ liệu thật (mục 4).
4. ~~Di chuyển dữ liệu thật từ Google Sheets sang Supabase~~ — **XONG (2026-09-18).** Người
   dùng xuất Google Sheets ra file `.xlsx`, script `migration/migrate_from_sheets_export.mjs`
   (đã commit, giữ làm hồ sơ — KHÔNG chạy lại trên dữ liệu đã có) đọc file đó và ghi vào Supabase.
   Đã ghi thành công: 11 users (10 thật + 1 placeholder), 41 submissions, 32 submission_versions,
   41 submission_steps, 3 workflow_templates, 5 workflow_steps, 8 drafts, 7 document_categories,
   18 document_links, 22 rules, 1 brand_guide, 16 email_queue (toàn bộ đã ở trạng thái "sent" —
   an toàn, Cron sẽ không gửi lại). Đã xác minh bằng cách gọi thật API mới
   (`get_users`, `get_submissions`, `get_report` đều đúng số liệu) **và đăng nhập thành công
   bằng tài khoản admin thật** (`trung@fschools.vn`) — dữ liệu thật đã sống trên Supabase.
   2 quyết định đã thống nhất với người dùng khi di chuyển:
   - 1 tài khoản đã bị xoá nhưng còn 2 bài viết gắn vào (`USR_1781238666751` "Hưng Đỗ") →
     tạo lại thành user placeholder (`active:false`, không đăng nhập được) để giữ tên + bài viết.
   - 19 dòng lịch sử (SubmissionVersions/SubmissionSteps) gắn với 5 submission đã bị xoá khỏi
     Sheets từ trước (không rõ lý do, có thể do sửa tay) → bỏ qua, không di chuyển.
   **Lưu ý quan trọng chưa xử lý**: vì bản Sheets cũ (Cloudflare tài khoản cũ) vẫn đang chạy
   thật song song, dữ liệu trên Supabase sẽ dần **lệch** so với Sheets kể từ giờ (submission mới,
   duyệt bài mới ở bản cũ sẽ KHÔNG tự động xuất hiện trên Supabase). Nếu khoảng cách tới lúc cắt
   sang thật dài, nên chạy lại script này 1 lần nữa ngay trước khi cắt (script hiện ghi thẳng,
   chưa có chế độ "chỉ thêm phần mới" — cần nâng cấp nếu chạy lần 2 trên dữ liệu đã có).
5. Máy còn lại (nhà/trường): sau `git pull`, cần tự tạo file `.dev.vars` (copy nội dung giống
   `.env`, thêm `APP_URL=http://localhost:8788`, `OPENAI_API_KEY`, `RESEND_API_KEY`) và chạy
   `npm install` trước khi `npx wrangler pages dev .` test được; cũng cần tự `supabase login`
   và (nếu muốn tự deploy Cloudflare từ máy đó) `wrangler login` 1 lần — các phiên đăng nhập CLI
   này không đi theo Git, mỗi máy tự đăng nhập riêng.
6. **Bước cuối cùng còn lại: quyết định thời điểm "cắt sang thật"** — báo người dùng thật đổi
   sang dùng `review-content-fschools.pages.dev` (hoặc trỏ domain chính về đây), sau khi đã chạy
   lại migration 1 lần cuối cho dữ liệu mới nhất. Đây là quyết định của người dùng, không phải
   bước kỹ thuật — hỏi trước khi làm.

## Ghi chú / rủi ro cần nhớ
- `backend_apps_script.js` hiện lưu **mật khẩu người dùng dạng plaintext** (kể cả gửi qua
  email) — nên đổi sang lưu hash khi viết backend mới trên Supabase.
- `brand_guides` (ảnh mẫu) hiện lưu trên Google Drive (file id) — nên chuyển sang Supabase
  Storage khi migrate thật.
- 2 máy (nhà + trường) dùng chung tài khoản Claude Pro nhưng **không tự đồng bộ** chat/memory
  giữa 2 máy → luôn dựa vào file này + Git (`git pull` đầu buổi, `git push` cuối buổi) làm
  nguồn thông tin chính, đừng dựa vào việc Claude "nhớ" buổi làm việc trước ở máy kia.
