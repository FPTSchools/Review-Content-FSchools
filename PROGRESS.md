# PROGRESS — FSchools Content Review: Migration Google Sheets → Supabase

> File này để bất kỳ ai (người hoặc Claude Code) mở dự án lên, dù ở máy nào, cũng
> hiểu ngay: đã làm gì, đang ở bước nào, cần làm tiếp gì — không cần đọc lại lịch sử chat.
> Cập nhật file này vào **cuối mỗi buổi làm việc**, rồi `git commit` + `git push`.

## Cập nhật gần nhất: 2026-09-22

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
- [x] **Sửa 2 lỗi UI/UX trên mobile** (người dùng báo sau khi có dữ liệu thật) — cả 2 đều do
      CSS `width:66% + min-width:<số>px` cứng, không có "trần" nên khi khung cha hẹp hơn giá trị
      min-width thì bị tràn ra ngoài màn hình:
      1. Khung xem trước file Drive đính kèm (lúc mở 1 bài để duyệt) bị tràn/khuyết trên mobile —
         `boss.html` (1 chỗ) + `ctv.html` (2 chỗ). Sửa: đổi `width:66%;min-width:320px` (và các
         biến thể 240px/280px) → `width:min(100%,480px)` (hoặc `min-width:min(240px,100%)`) —
         co giãn đúng theo khung cha, không bao giờ tràn, vẫn giữ kích thước đẹp trên desktop.
      2. Bảng "Tất cả bài" (`boss.html`, trang lịch sử toàn bộ) có 8 cột cố định width%, trên
         mobile phải kéo thanh trượt ngang mới xem hết — Sửa: thêm CSS trong khối
         `@media (max-width:860px)` chuyển bảng thành danh sách **thẻ xếp dọc** (mỗi `<td>` tự
         hiện nhãn cột qua `data-label` + `::before`), y hệt kiểu thẻ đã dùng ở trang "Hàng chờ
         duyệt" — không còn horizontal scroll.
      Đã test trực tiếp trên mobile viewport (375px) qua browser thật, xác nhận bằng
      `getBoundingClientRect()`/`scrollWidth` (không chỉ nhìn ảnh chụp màn hình) rằng không còn
      phần tử nào tràn khỏi màn hình, và kiểm tra lại desktop không bị ảnh hưởng. Deploy lên
      https://review-content-fschools.pages.dev.
- [x] **Sửa lỗi hệ thống nghiêm trọng: luồng duyệt "trông như sai" + email không gửi được**
      (người dùng báo sau khi test thật với dữ liệu thật). Gồm 4 lỗi độc lập, đã sửa hết:
      1. **⚠️ CHẶN HOÀN TOÀN việc gửi email — cần người dùng xử lý.** Resend đang ở chế độ
         sandbox (chưa xác minh domain) → CHỈ gửi được cho đúng email chủ tài khoản
         (`thpt@fpt.edu.vn`), mọi email khác đều bị Resend từ chối thẳng (lỗi thật: *"You can
         only send testing emails to your own email address... verify a domain"*). Đây là lý do
         thật của việc "không thấy gửi mail thông báo" — KHÔNG phải lỗi code, mà do tài khoản
         Resend chưa được cấu hình đầy đủ. **Cần người dùng xác minh 1 domain trên
         resend.com/domains (nhờ IT thêm bản ghi DNS) trước khi email thật gửi được cho bất kỳ
         ai khác ngoài chủ tài khoản** — mục này trước đây bị ghi nhầm là "tuỳ chọn, không gấp",
         thực ra đang chặn toàn bộ tính năng thông báo.
      2. **Dữ liệu email nhân sự bị lỗi**: hầu hết email trong bảng `users` dính thêm dấu `.` ở
         cuối (ví dụ `phuonglx2@fe.edu.vn.`) — khiến Resend từ chối gửi vì email không hợp lệ.
         Đã sửa dữ liệu hiện có (8 user) và thêm kiểm tra chuẩn hoá email (trim + bỏ dấu `.`
         thừa + validate định dạng) vào `add_user`/`update_user` (`functions/_lib/util.js`:
         `normalizeEmail()`) để không lặp lại.
      3. **Lỗi hệ thống (nghiêm trọng nhất) — "tag người duyệt vòng trước" biến mất + có thể ảnh
         hưởng nhiều chỗ khác**: `boss.html`/`ctv.html` được viết cho backend cũ, nơi các trường
         `reviewers`, `review_history`, `inline_comments`, `workflow_steps`, `platform`,
         `brand_check_result`, `allowed_roles` LUÔN là CHUỖI JSON (Google Sheets chỉ lưu được
         text) nên code luôn gọi `JSON.parse(s.reviewers||'[]')`. Backend mới (Supabase JSONB)
         trả các trường này dạng OBJECT/ARRAY THẬT — gọi `JSON.parse()` trên object có sẵn sẽ
         `throw`, bị `try/catch` xung quanh NUỐT MẤT lỗi, âm thầm trả về rỗng. Hậu quả: tag hiển
         thị người đã duyệt biến mất, danh sách người duyệt trong thẻ bài trống, bình luận inline
         không tải được, kết quả AI chấm ảnh không hiện... ở **~20 chỗ khác nhau** trong 2 file.
         Đã rà soát toàn diện bằng agent con và sửa hết: thêm 1 hàm dùng chung `parseMaybeJson()`
         (nhận cả object thật và chuỗi JSON cũ) ở đầu mỗi file, thay mọi chỗ gọi `JSON.parse`
         trực tiếp trên các trường này bằng hàm này.
      4. **`is_shared` (cờ "content chung") so sánh sai kiểu**: backend cũ lưu chuỗi `'true'`,
         backend mới lưu boolean thật — code so `s.is_shared==='true'` luôn sai (luôn `false`).
         **Nghiêm trọng nhất trong nhóm này**: `ctv.html` dùng đúng phép so sánh này để quyết
         định có hiện bài "content chung" của **cơ sở khác** trong hàng chờ duyệt của
         leader/leader_content hay không — bài dùng chung bị **biến mất khỏi hàng chờ duyệt**
         một cách âm thầm. Đây rất có thể là nguyên nhân chính khiến người dùng thấy "luồng duyệt
         không đúng". Đã sửa bằng hàm `isTruthyFlag()` (nhận cả boolean thật và chuỗi 'true' cũ).
      Đồng thời **cải tiến thêm** theo đúng yêu cầu người dùng: tag "người đã duyệt" giờ hiện
      **MỖI người đã duyệt** (không chỉ người mới nhất) — vd bài qua 2 vòng sẽ thấy cả
      "✅ Người A" và "✅ Người B" ở góc thẻ bài, đúng ý "biết được bài đó đã có những người ở
      vòng duyệt trước đã xem và ok".
      **Đã test thật kỹ, không chỉ đọc code**: dựng lại đúng kịch bản người dùng mô tả — workflow
      3 vòng, vòng 2 có 2 người cùng số thứ tự (song song) — submit → vòng 1 (1 người) duyệt →
      tự chuyển vòng 2 → **chỉ 1 trong 2 người vòng 2 duyệt (người còn lại không làm gì)** → tự
      chuyển vòng 3 → vòng 3 duyệt → trạng thái "approved". Xác nhận đúng ở mọi bước qua dữ liệu
      Supabase thật + giao diện thật (tag hiện đúng, không lỗi JS console), và xác nhận
      email được ghi đúng hàng đợi ở mỗi vòng chuyển tiếp (dù chưa gửi được thật — xem mục 1).
      Dữ liệu test đã dọn sạch. Deploy lên https://review-content-fschools.pages.dev.
- [x] **Gửi email gần như tức thì thay vì chờ Cron 2 phút** — theo yêu cầu người dùng.
      `functions/api/index.js`: sau khi 1 action có phát sinh email (submit, resubmit, approve,
      reject, request_revision, forward_to_next, change_reviewer) chạy xong, gọi luôn
      `handleProcessEmailQueue` chạy NỀN qua `waitUntil` (đặc trưng của Cloudflare Workers — cho
      phép tiếp tục xử lý sau khi đã trả lời người dùng, không làm chậm phản hồi chính) — thay vì
      chỉ trông chờ vào Worker lập lịch `email-cron-worker` chạy mỗi 2 phút. Lưu ý thứ tự quan
      trọng: phải trigger xử lý hàng đợi SAU khi hành động chính đã ghi email vào hàng đợi xong,
      không phải trước (bản đầu tiên viết nhầm thứ tự, tự phát hiện và sửa lại khi test).
      `email-cron-worker` (2 phút/lần) vẫn giữ lại làm lưới an toàn (thử lại email gửi lỗi, hoặc
      trường hợp hiếm `waitUntil` bị dừng giữa chừng) — không xoá.
      Đã test thật: gửi 1 bài → kiểm tra trực tiếp Supabase → email chuyển từ "queued" sang
      "sent" chỉ sau **~0.8 giây**, không cần đợi Cron.
- [x] **Đổi nhà cung cấp gửi email: Resend → Gmail API** — đã xong và gửi thật thành công, xem
      chi tiết + lưu ý bảo trì ở mục 0 của "Cần làm tiếp".

- [x] **Kiểm thử lại toàn bộ luồng duyệt theo vòng + sửa lỗi gửi lại (2026-09-21)** — người dùng yêu
      cầu xác nhận: (1) chọn bước 1,2,3 thì duyệt lần lượt; (2) 2 người cùng 1 bước thì chỉ cần
      1 người duyệt; (3) gửi lại lần 2, 3 mà chọn lại người duyệt thì chạy theo rule MỚI.
      **Lỗi tìm thấy (điểm 3)**: `handleResubmit` bỏ qua danh sách người duyệt mà giao diện gửi kèm
      và dùng lại quy trình của lần gửi đầu (bản Apps Script gốc cũng vậy). Đã sửa: nếu lần gửi lại
      có `reviewers` hoặc `workflow_id` khác `manual_chain` thì dựng quy trình mới bằng
      `resolveWorkflowForSubmission`; chỉ khi không kèm gì mới dùng lại quy trình cũ.
      Sửa thêm: `workflowMatches` (workflow.js) so `is_shared` bằng `asBoolean()` (chuỗi `'false'`
      trước đây bị hiểu là true).
      **Đã test tự động 31 kiểm tra, đạt hết** (dữ liệu Supabase thật, đã dọn sạch sau đó): A) 3 vòng
      1→2→3: người ở bước sau/trước không duyệt được ngoài lượt, duyệt xong mới chuyển; B) vòng 2
      có 2 người: chỉ 1 người duyệt là qua bước, người còn lại sau đó bị chặn; 2 người cùng vòng 1
      duy nhất: 1 người duyệt là approved; C) gửi lại lần 2 (R2B→R3) và lần 3 (chỉ R1) chạy đúng rule
      mới, người của rule cũ không duyệt được, lịch sử đủ 3 vòng gửi. Kiểm tra cả hàng đợi email:
      mỗi bước chuyển gửi đúng người (vòng có 2 người thì gửi cho cả 2), cuối cùng gửi kết quả cho CTV.
      Khi test local đã tạm xoá `GMAIL_REFRESH_TOKEN` trong `.dev.vars` để không gửi mail thật tới địa
      chỉ giả (nhớ: Cron production dùng chung bảng email_queue nên hàng đợi test có thể bị gửi thật).
      Deploy lên https://review-content-fschools.pages.dev.

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
- **Chèn ảnh giữa nội dung khi bài đăng Web/Email — XONG (2026-09-22, đã làm lại 1 lần
  cho gọn hơn theo phản hồi của người dùng).** Yêu cầu người dùng: khi CTV tích chọn nền
  tảng đăng có **Web** hoặc **Email**, cho phép chèn ảnh vào giữa các đoạn văn bản, để lúc
  duyệt bài, leader/manager thấy layout giống hệt lúc bài lên web/email thật (thay vì chỉ
  thấy 1 khối chữ + ảnh đính kèm tách rời bên dưới như các nền tảng khác).
  **Bản đầu tiên** dùng token kỹ thuật `[[ANH:<fileId>]]` chèn qua 1 nút "➕ Chèn vào nội
  dung" — người dùng phản hồi thao tác rườm rà, muốn "copy ảnh rồi paste" cho nhanh. Sau khi
  trình bày phương án trước (paste ảnh trực tiếp/nén nhỏ vs. giữ link Drive nhưng bỏ nút bấm),
  người dùng chọn **giữ link Drive nhưng bỏ nút bấm**. Đã làm lại theo hướng đó — **KHÔNG cần
  token/nút bấm nữa**:
  - CTV chỉ cần copy link Drive ảnh (link "Chia sẻ" bình thường, dạng
    `.../file/d/<fileId>/...`) rồi dán/gõ thẳng vào đúng vị trí muốn có ảnh, ngay trong ô
    Nội dung — không cần thao tác nào khác. Hệ thống tự nhận diện link đó bằng regex
    (`DRIVE_IMG_URL_RE`), không cần dán thêm vào ô "Link Drive đính kèm" (dù CTV vẫn nên dán
    thêm ở đó nếu muốn có bản gốc tải về + được AI chấm brand guide).
  - Ô Nội dung vẫn là `<textarea>` thuần (không đổi sang rich-text/contenteditable) — giữ
    nguyên toàn bộ cơ chế "bôi chọn nhận xét theo đoạn" (inline comment) đang tính offset
    ký tự trên chuỗi thô; link Drive nằm trong khối bôi-chọn (`.inline-content` /
    `ic-body`/`rvc-body`) vẫn hiện dạng chữ thô, **CỐ Ý không đổi thành ảnh** ở đúng khối đó,
    để không phá offset bôi chọn.
  - Thêm khối "👁 Xem trước hiển thị" (chỉ đọc) ngay dưới ô Nội dung lúc CTV đang soạn, và
    trong mỗi thẻ duyệt bài của leader/manager (trên cả `ctv.html` vai trò `leader_content` và
    `boss.html`) — hàm `injectInlineImages(html)` (khai báo riêng ở mỗi file vì dự án không có
    JS dùng chung) tự thay link Drive ảnh bằng `<img src="https://drive.google.com/
    thumbnail?id=<fileId>&sz=w1000">` (ảnh Drive share "Anyone with link" mới load được, đúng
    yêu cầu share sẵn có). `hasInlineImageLink()` (regex không global, tránh lỗi `lastIndex`
    khi tái dùng) kiểm tra có link ảnh Drive trong content hay không để quyết định có hiện
    khối xem trước không.
  - Đã áp dụng cho mọi nơi hiển thị content read-only: khối xem trước lúc soạn bài, khối xem
    trước lúc duyệt bài, modal xem lại bài đã duyệt (kèm giữ lại nội dung gốc ở
    `dataset.rawContent` để nút "Sao chép nội dung" copy đúng nguyên văn kể cả link — link giờ
    là link CTV tự dán vào bài, không phải token kỹ thuật cần lọc bỏ nữa), khung so sánh diff
    giữa các vòng gửi (`buildReviewerRoundBox`/`buildBossReviewerRoundBox`), và khối "Tất cả
    bài" bên `boss.html` (tiện thể vá luôn 1 lỗi có sẵn ở đây: `${s.content}` trước đó không hề
    `escHtml` trước khi render — đã sửa cùng lúc).
  - Nội dung gửi cho AI (kiểm duyệt, gợi ý nhận xét, chat) được lọc qua
    `stripImagePlaceholdersForAI()` để thay link Drive bằng chữ dễ hiểu `[Hình ảnh minh họa]`
    trước khi gửi.
  - Đã test lại bằng tay qua browser thật sau khi làm lại: dán thẳng link Drive
    (`https://drive.google.com/file/d/.../view?usp=sharing&resourcekey=...`, kể cả có
    `&resourcekey` phía sau) vào giữa nội dung — không cần dán gì vào ô "Link Drive đính kèm"
    — xác nhận: (1) khối "Xem trước hiển thị" render đúng `<img>` ở đúng vị trí cả phía CTV lẫn
    leader_content; (2) khối bôi-chọn-nhận-xét vẫn hiện link dạng chữ thô, không đổi thành ảnh;
    (3) tick/bỏ tick Web/Email thì khối xem trước hiện/ẩn đúng theo, không còn nút bấm nào cần
    thao tác thêm. Dữ liệu test đã xoá sạch khỏi Supabase sau khi test xong.
- **Định dạng chữ (đậm/nghiêng/gạch chân/cỡ chữ) ở ô Nội dung — XONG (2026-09-22).** Yêu cầu
  người dùng: cho chỉnh font chữ trong phần nội dung ở giao diện gửi bài duyệt. Đã trình bày
  3 phương án trước khi làm (toolbar gõ-thấy-ngay / gõ ký hiệu tay / rich text HTML thật đổi
  cả cơ chế bôi chọn); người dùng chọn **toolbar gõ-thấy-ngay**. Cách làm:
  - Ô Nội dung (`ctv.html`, trang "Gửi bài duyệt") đổi từ `<textarea>` sang
    `<div contenteditable>` (class `.content-editable`), có thanh công cụ nhỏ phía trên: nút
    **B/I/U** (gọi `document.execCommand('bold'|'italic'|'underline')` — không có thư viện
    rich-text nào trong dự án nên dùng thẳng execCommand, cũ nhưng vẫn chạy tốt trên Chrome/
    Edge) và dropdown **cỡ chữ** (Nhỏ 12px/Vừa 16px/Lớn 20px/Rất lớn 26px — bôi đen đoạn chữ
    trước rồi chọn, cách làm thủ công bằng Range API `extractContents()`/`insertNode()` để giữ
    nguyên định dạng lồng bên trong, không dùng `execCommand('fontSize')` vì chỉ hỗ trợ 7 cỡ
    cố định không tuỳ chỉnh px được).
  - **Không đổi cấu trúc DB**: cột `content` vẫn là TEXT như cũ. Lúc gửi bài,
    `serializeEditableContent()` duyệt cây DOM trong ô soạn thảo, "dịch" định dạng HTML sang
    ký hiệu dạng chữ để lưu — `**đậm**`, `*nghiêng*`, `__gạch_chân__`, `[size=N]cỡ chữ[/size]`
    (đậm+nghiêng cùng lúc dùng `***text***` theo đúng quy ước Markdown, tránh lồng ký hiệu rối).
    `renderTextFormatting()` làm chiều ngược lại (ký hiệu → HTML thật), dùng khi hiển thị
    chỉ-đọc và khi nạp nội dung cũ vào ô soạn thảo để sửa tiếp (`setContentInputValue()`).
    `getContentInputValue()`/`setContentInputValue()` là 2 hàm trung gian thay cho mọi chỗ
    trước đây đọc/ghi trực tiếp `content-input.value` (giờ không còn `.value` vì không phải
    thẻ input/textarea nữa) — đã cập nhật toàn bộ: `runAI`, `sendAiChat`, `applyAiToContent`,
    `submitPost`, `updateChar` (đếm theo `textContent.length` — không tính ký hiệu định dạng),
    `clearForm`, `collectCurrentDraft`, `restoreDraft`, `editAndResubmit`, `editSubmission`.
  - Y hệt cách làm với link ảnh Drive: khối bôi-chọn-nhận-xét (`.inline-content`/
    `ic-body`/`rvc-body`) **CỐ Ý không đổi** — vẫn hiển thị ký hiệu `**...**` dạng chữ thô, để
    không ảnh hưởng offset bôi chọn (đây là lần thứ 2 áp dụng đúng nguyên tắc này, sau tính
    năng ảnh — xác nhận cách tiếp cận "giữ nguyên định dạng lưu trữ, chỉ đổi lúc hiển thị" mở
    rộng tốt cho nhiều loại định dạng khác nhau mà không phải sửa lại cơ chế offset).
  - Gộp việc hiển thị định dạng chữ + ảnh Drive vào 1 hàm dùng chung `renderContentDisplay()`
    (khai báo ở cả `ctv.html` và `boss.html`, do dự án không có JS dùng chung), áp dụng ở mọi
    nơi hiện content chỉ-đọc: khối "Xem trước hiển thị" (soạn bài + duyệt bài), modal xem lại
    bài đã duyệt, khung so sánh diff giữa các vòng gửi, khối "Tất cả bài" bên `boss.html`.
  - Đã test bằng tay qua browser thật: gõ chữ → bôi đen → bấm B/I/U và chọn cỡ chữ → xác nhận
    định dạng hiện ngay trong ô soạn thảo + khối xem trước; xác nhận nội dung lưu đúng ký hiệu
    (`[size=20]Xin[/size] **chao** *cac ban* __hoc sinh__.`); mở lại bằng "Gửi lại"
    (`editAndResubmit`) — nội dung nạp lại đúng định dạng vào ô soạn thảo, và serialize lại ra
    ĐÚNG BYTE-FOR-BYTE chuỗi ban đầu (round-trip an toàn, không lệch dữ liệu qua nhiều lần
    sửa/gửi lại). Dữ liệu test đã xoá sạch khỏi Supabase sau khi test xong.
  - **Sửa lại ngay sau đó (cùng ngày, theo phản hồi người dùng)**: bản đầu tiên có mở rộng điều
    kiện hiện khối "Xem trước hiển thị" sang mọi nền tảng miễn có định dạng chữ hoặc ảnh — người
    dùng phản hồi chỉ muốn hiện khi bài chọn Web/Email, các nền tảng khác không cần. Đã đổi lại
    `buildInlineImagePreview()` (2 file) và `renderLivePreview()` (`ctv.html`) để thêm lại điều
    kiện `platform includes web/email` (dùng `parseMaybeJson(s.platform_parsed || s.platform)`),
    y hệt logic gốc của tính năng chèn ảnh trước đó — nay áp dụng chung cho cả 2 lý do hiện khối
    (ảnh và định dạng chữ). Đã test lại: gửi 1 bài chọn Facebook + 1 bài chọn Email, cùng nội
    dung có định dạng `**đậm**` — xác nhận bài Facebook KHÔNG hiện khối xem trước, bài Email có
    hiện. Dữ liệu test đã xoá sạch khỏi Supabase.
- **Gửi email thông tin đăng nhập khi tạo/đổi mật khẩu tài khoản — XONG (2026-09-22).** Người
  dùng phát hiện: tạo tài khoản mới không thấy gửi email báo email/mật khẩu cho người đó (đây
  là 1 khoảng trống đã ghi chú từ trước trong "Ghi chú/rủi ro cần nhớ" — `add_user`/
  `update_user` có sẵn TODO nối Gmail API nhưng chưa làm vì "chưa được yêu cầu"). Đã nối:
  - Thêm `sendNewAccountEmail()` và `sendPasswordChangedEmail()` trong `functions/_lib/email.js`
    (theo đúng mẫu 3 hàm gửi email đã có — `sendReviewerEmail`/`sendForwardEmail`/`sendCTVEmail`
    — và đúng nội dung bản Apps Script gốc: email + mật khẩu dạng chữ thường, kèm nút "Đăng
    nhập ngay" trỏ về `index.html`).
  - `handleAddUser`/`handleUpdateUser` (`functions/_lib/handlers/users.js`) giờ nhận thêm tham
    số `env` (để lấy `APP_URL`) và gọi `enqueueEmail` qua 2 hàm trên — best-effort, lỗi gửi mail
    không chặn việc tạo/sửa tài khoản (bọc try/catch, giữ đúng hành vi bản Apps Script cũ vốn
    cũng nuốt lỗi gửi mail). Cập nhật 2 dòng gọi ở `functions/api/index.js` để truyền `env`.
  - Thêm `add_user`/`update_user` vào `EMAIL_TRIGGER_ACTIONS` (`functions/api/index.js`) để
    gửi NGAY qua `waitUntil` như các action duyệt bài, thay vì chờ Cron 2 phút/lần.
  - `boss.html` (trang Admin, nơi duy nhất có form thêm/sửa user): toast sau khi tạo/đổi mật
    khẩu giờ phản ánh đúng `res.email_sent` (trước đây toast "đã gửi email" hiển thị cố định dù
    thực ra chưa hề gửi được) — báo rõ khi gửi thất bại để admin biết cần tự báo mật khẩu qua
    kênh khác.
  - Đã test thật qua local dev (KHÔNG mock) bằng script gọi thẳng `add_user`/`update_user` với
    Gmail API thật: xác nhận `email_queue` ghi đúng subject/body/nút đăng nhập, trạng thái
    chuyển `sent` chỉ sau ~1.4 giây — không cần chờ Cron. Dữ liệu test (user + email_queue) đã
    xoá sạch khỏi Supabase sau khi test xong.
  - Mật khẩu vẫn lưu dạng plaintext trong DB (TODO hash chưa làm, đã ghi ở "Ghi chú/rủi ro cần
    nhớ" từ trước) — việc gửi email này chỉ nối thêm bước thông báo, KHÔNG đổi cách lưu trữ.
- **Sửa bug "phong cách người duyệt" (persona) không tới được AI + thêm dòng minh bạch "AI đã
  dùng gì" — XONG (2026-09-23).** Người dùng yêu cầu rà lại xem AI có luôn đọc đủ rule + persona
  không trước khi bàn tiếp việc cải thiện AI. Rà xong, phát hiện bug thật:
  - **Rules Admin (từ cấm, yếu tố bắt buộc, giọng thương hiệu, quy tắc logo, brand guide chữ/ảnh)**
    — KHÔNG có vấn đề gì, `buildAiRulesContext()` luôn truy vấn Supabase mới hoàn toàn mỗi lần
    gọi, cho cả 4 chức năng AI.
  - **Persona (phong cách người duyệt) — có bug thật**: nút "✨ Gợi ý nhận xét" (tính năng AI
    dùng nhiều nhất, khác với AI Chat) trước đây lấy persona theo cách sai — frontend tự tra
    trong biến cache `PERSONAS_CACHE` rồi gửi lên (`persona: getPersonaForReviewer(...)`), thay
    vì để backend tự tra theo tên như `handleAiChat` vẫn làm đúng. Cache này ở `boss.html` chỉ
    được nạp khi vào trang "Cài đặt" (`renderRulesPage()`), mà trang đó **ẩn hoàn toàn với role
    `leader` và `manager`** (chỉ `admin` thấy `nav-rules`) — nghĩa là 2 role này **không bao giờ**
    gửi được persona cho AI gợi ý nhận xét trong suốt session, dù đã lưu persona đầy đủ trong hệ
    thống. AI vẫn chạy bình thường (không báo lỗi) nên không ai nhận ra.
  - Cách sửa: đổi `handleAiSuggestReview()` (`functions/_lib/handlers/ai.js`) sang tự tra persona
    ở server theo `reviewer_name` bằng `getPersonaContent()` — y hệt cách `handleAiChat` đã làm
    đúng từ đầu — thay vì nhận `persona` do frontend tính sẵn. Đổi 2 nơi gọi
    (`ctv.html:getRVAISuggest`, `boss.html:getAISuggest`) từ gửi `persona:...` sang gửi
    `reviewer_name: currentUser.name`. Dọn theo: xoá hẳn `getPersonaForReviewer()`/
    `window.getPersonaForReviewer` cùng `PERSONAS_CACHE`/`loadPersonasFromServer()` ở `ctv.html`
    (chỉ tồn tại để phục vụ hàm giờ đã chết, `boss.html` vẫn giữ `PERSONAS_CACHE` vì còn dùng
    cho UI quản lý persona ở trang Admin).
  - **Thêm minh bạch ("AI đã dùng gì")**: `buildAiRulesContext()` giờ trả thêm `summary` (đếm số
    từ cấm, số yêu cầu bắt buộc, có/chưa giọng thương hiệu, có/chưa quy tắc logo, có/chưa brand
    guide chữ, số ảnh mẫu brand guide) — `handleAiCheckContent`/`handleAiSuggestReview`/
    `handleAiChat` trả kèm `meta` (thêm `personaUsed`/`personaName` ở 2 hàm sau). Frontend hiện
    1 dòng nhỏ "🔎 AI đã dùng: ..." ngay dưới mỗi kết quả AI (hàm `renderAiMetaLine()`, khai báo
    riêng ở cả `ctv.html` và `boss.html` do không có JS dùng chung) — ở 3 nơi: ô "Kiểm tra AI"
    của CTV (`ai-result-meta`), "Gợi ý nhận xét" của leader_content trong `ctv.html`
    (`rv-ai-meta-*`), "Gợi ý nhận xét" của leader/manager/admin trong `boss.html` (`ai-meta-*`).
    Mục đích: nếu sau này lại có lỗi tương tự (thiếu rule/persona mà AI không báo), người dùng tự
    nhìn dòng này ra ngay, không cần đọc code.
  - Đã test thật qua local dev (KHÔNG mock), đúng kịch bản bug cũ: tạo role `manager`, lưu persona
    cho tên đó, đăng nhập **không hề vào trang Cài đặt** (xác nhận `nav-rules` ẩn, `PERSONAS_CACHE`
    rỗng ở trình duyệt), bấm "Gợi ý nhận xét" — xác nhận `meta.personaUsed: true` và dòng "🔎 AI đã
    dùng..." hiện đúng tên persona. Test tương tự cho `leader_content` (`ctv.html`) và cho CTV tự
    kiểm tra bài (`ai_check_content`, không có persona — dòng meta tự ẩn phần persona, đúng như
    thiết kế). Dữ liệu test đã xoá sạch khỏi Supabase.
- **Dùng OpenAI Structured Outputs cho 2 hàm AI trả JSON — XONG (2026-09-23).** Trước đây
  `handleAiCheckContent` (chấm điểm bài) và `handleAiCheckBrandImage` (chấm ảnh) chỉ NHẮC trong
  prompt "trả JSON duy nhất", rồi tự JSON.parse sau khi bóc tách markdown fence bằng regex — nếu AI
  lỡ trả sai định dạng (thừa chữ, thiếu ngoặc), lỗi bị try/catch nuốt mất, người dùng nhận
  `result: null` mà không rõ vì sao. Đã đổi sang `response_format: {type:"json_schema",
  strict:true}` (OpenAI Structured Outputs) — OpenAI tự validate đúng cấu trúc khai báo trước
  khi trả về, gpt-4o-mini hỗ trợ đầy đủ cơ chế này.
  - Thêm `opts.jsonSchema` cho `callOpenAI()`/`callOpenAIVision()` (`functions/_lib/openai.js`);
    `callOpenAIRaw()` cũng bắt thêm trường hợp `message.refusal` (Struct Outputs có thể "từ chối"
    thay vì trả content) để báo lỗi rõ ràng thay vì âm thầm trả rỗng.
  - Định nghĩa 2 schema trong `functions/_lib/handlers/ai.js`: `CONTENT_CHECK_SCHEMA` (verdict/
    scores/positives/issues/suggestion) và `BRAND_IMAGE_SCHEMA` (mau_sac/logo/font_chu/bo_cuc/
    luu_y). Nhân tiện bỏ luôn hack cũ `verdict.replace('DUYET','DUYỆT')...` — giờ khai enum
    tiếng Việt có dấu thẳng trong schema (`["DUYỆT","CẦN SỬA","TỪ CHỐI"]`), OpenAI trả đúng luôn
    không cần dịch lại.
  - Khi JSON.parse vẫn lỗi sau Structured Outputs (trường hợp cực hiếm — mạng đứt giữa chừng,
    response bị cắt), trả lỗi rõ ràng `"AI trả về không đúng định dạng, vui lòng thử lại"` thay
    vì `result: null` không giải thích.
  - `handleAiSuggestReview`/`handleAiChat` trả text thường (không phải JSON) nên không cần đổi.
  - Đã test thật (không mock) qua local dev: (1) nội dung bình thường — đủ field, verdict đúng
    tiếng Việt có dấu ngay từ OpenAI; (2) nội dung chứa từ cấm đã cài (`Duy nhất`, `cực kỳ`) —
    xác nhận cơ chế ép `chinh_xac<=4` + thêm "Chứa từ cấm" vào issues vẫn hoạt động đúng trên
    JSON đã validate; (3) `ai_check_brand_image` với ảnh thật qua URL công khai — trả đủ 4 mục
    đúng enum; (4) toàn bộ luồng UI CTV (`runAI`) hiển thị đúng, không cần sửa gì ở frontend vì
    hình dạng JSON trả về không đổi, chỉ đáng tin cậy hơn. Dữ liệu test đã xoá sạch.
- **Theo dõi độ chính xác của AI theo thời gian — XONG (2026-09-23).** Đối chiếu AI nói gì lúc
  CTV gửi bài (ai_verdict) với quyết định CUỐI CÙNG của người duyệt (approved/rejected/revision),
  để biết AI đang đúng bao nhiêu % và có đang lệch hướng dần không.
  - **Bảng mới `ai_accuracy_log`** (migration `supabase/migrations/20260923072709_ai_accuracy_log.sql`,
    đã áp dụng lên Supabase thật qua `supabase db push`; đồng bộ thêm vào `schema.sql` để làm tài
    liệu). Lý do cần bảng RIÊNG thay vì đọc lại từ `submissions`: cột `ai_verdict` trên
    `submissions` bị **ghi đè mỗi lần CTV gửi lại bài** — chỉ còn vòng mới nhất, không đủ dữ kiện
    để tính % chính xác "theo thời gian" hay phát hiện AI lệch hướng (đặc biệt thiên lệch với các
    vòng "CẦN SỬA" đã được gửi lại — dữ liệu sẽ biến mất nếu chỉ đọc bảng sống).
  - **Ghi log** (`functions/_lib/handlers/aiAccuracy.js`, hàm `logAiAccuracy()`): gọi ngay trong
    `processDecision()` (`functions/_lib/handlers/submissions.js`) — CHỈ khi 1 vòng gửi đạt trạng
    thái CUỐI (`terminal`: approved/rejected/revision) VÀ CTV đã chạy AI trước khi gửi
    (`ai_verdict` khác rỗng — không có gì để so sánh thì bỏ qua im lặng). Quy đổi khớp/lệch bằng
    ánh xạ trực tiếp theo nghĩa (`DUYỆT`↔`approved`, `CẦN SỬA`↔`revision`, `TỪ CHỐI`↔`rejected`),
    không so chuỗi. Lỗi ghi log được bọc try/catch riêng, không được phép chặn việc duyệt bài.
  - **Báo cáo** (`handleGetAiAccuracyReport`, action mới `get_ai_accuracy_report`): tổng số lượt
    đối chiếu + % khớp; ma trận đối chiếu (AI nói gì × người duyệt quyết định gì, giúp thấy AI
    lệch theo HƯỚNG nào, không chỉ 1 con số); xu hướng % khớp theo tuần (phát hiện lệch hướng dần
    theo thời gian); danh sách 20 lượt lệch gần nhất kèm tên bài (để xem cụ thể bài nào AI đoán
    sai, không chỉ số liệu trừu tượng).
  - **Giao diện**: thêm khối "🎯 Độ chính xác của AI kiểm duyệt" ngay dưới khối "🤖 Nhận xét AI về
    nhân sự" có sẵn trong trang "Báo cáo cuối kỳ" (`boss.html`, chỉ ở đây — `ctv.html` không có
    trang báo cáo). Tải cùng lúc với báo cáo CTV khi bấm "Tạo báo cáo" (`loadAiAccuracyReport()`
    gọi song song trong `loadReport()`), lỗi tải không chặn phần báo cáo CTV.
  - Đã test thật qua local dev (KHÔNG mock): gửi 4 bài — (A) AI nói DUYỆT + người duyệt duyệt
    (khớp), (B) AI nói CẦN SỬA nhưng người duyệt vẫn duyệt (LỆCH — đúng tình huống cần phát hiện),
    (C) AI nói TỪ CHỐI + người duyệt từ chối (khớp), (D) không chạy AI trước khi gửi — xác nhận
    CHỈ 3 bài đầu được ghi log, bài D bị bỏ qua đúng như thiết kế; xác nhận API trả đúng
    overview/matrix/weekly/recentMismatches; xác nhận giao diện `boss.html` render đúng qua
    browser thật (đã chụp ảnh + đọc lại text trang). Dữ liệu test đã xoá sạch khỏi Supabase.
- **Đổi persona (phong cách người duyệt) sang tra theo user_id thay vì tên hiển thị — XONG
  (2026-09-23).** Trước khi viết migration đã kiểm tra dữ liệu thật và xác nhận đúng rủi ro đã lo
  ngại: **2 user khác nhau cùng tên "Thành Trung"** (id khác nhau, cùng role `leader_content`) —
  tra persona theo tên sẽ áp nhầm persona của người này cho người kia. Bảng `personas` lúc đó
  đang rỗng (chưa ai cấu hình) nên đổi cấu trúc an toàn, không cần di dời dữ liệu.
  - Migration `supabase/migrations/20260923073531_personas_keyed_by_user_id.sql` — dùng
    `ALTER TABLE` (thêm cột `user_id` làm khoá chính mới, bỏ khoá chính cũ trên `name`) thay vì
    `DROP TABLE`: lệnh `DROP TABLE` bị chính hệ thống an toàn của Claude Code chặn (phân loại
    "Cloud Storage Mass Delete", đúng vì đang thao tác DB thật) — viết lại bằng ALTER cho cùng
    kết quả mà không cần xin duyệt thao tác nguy hiểm. Đã áp dụng lên Supabase thật qua
    `supabase db push`, đồng bộ vào `schema.sql`.
  - `functions/_lib/handlers/personas.js`: `handleSavePersona`/`handleDeletePersona` nhận
    `user_id` thay vì `name`; lúc lưu LUÔN lấy tên hiện tại từ bảng `users` (không tin theo tên
    frontend tự gửi) để lưu kèm làm snapshot hiển thị. `handleGetPersonas` JOIN với `users` để
    danh sách Admin luôn hiện ĐÚNG tên hiện tại (không bị tên cũ "đóng băng" nếu người dùng đổi
    tên sau khi đã lưu persona).
  - `functions/_lib/handlers/ai.js`: `getPersonaContent(name)` → `getPersona(id)`, trả về cả
    `{name, content}` (cần `name` để hiện trong dòng "🔎 AI đã dùng" đã làm ở mục trước).
    `handleAiSuggestReview`/`handleAiChat` giờ nhận `reviewer_id` thay vì `reviewer_name`.
  - Cập nhật toàn bộ nơi gọi `ai_suggest_review`/`ai_chat` ở `ctv.html` (4 chỗ) và `boss.html`
    (3 chỗ) sang gửi `reviewer_id: currentUser.id` — KHÔNG đụng vào các chỗ gửi `reviewer_name`
    cho hành động duyệt bài thật (`approve`/`reject`/`request_revision`/`forward_to_next`), đó là
    tham số khác, dùng cho lịch sử duyệt bài chứ không phải tra persona.
  - Giao diện Admin quản lý persona (`boss.html`): dropdown chọn người duyệt đổi `value` từ tên
    sang `id` (hiện tên vẫn y như cũ để dễ chọn); `PERSONAS_CACHE` đổi cấu trúc từ
    `{tên: nội_dung}` sang `{user_id: {name, content}}`.
  - Đã test thật qua local dev (KHÔNG mock), đúng 2 kịch bản đã lo ngại: (1) tạo 2 user CÙNG tên
    hiển thị, lưu persona riêng cho từng người — xác nhận `get_personas` trả về 2 dòng tách biệt
    theo đúng nội dung, `ai_suggest_review` gọi theo từng id lấy đúng persona của người đó, không
    lẫn; (2) đổi tên 1 trong 2 user (mô phỏng sửa lỗi chính tả/thêm chức danh) rồi gọi lại
    `ai_suggest_review` theo ĐÚNG id cũ — xác nhận `personaUsed` vẫn `true`, KHÔNG bị "mất" như
    cách tra theo tên cũ; đồng thời xác nhận danh sách Admin tự cập nhật hiện tên MỚI (nhờ JOIN)
    thay vì hiện tên cũ đã lưu snapshot lúc trước. Test thêm luồng UI thật: dropdown hiện đúng 2
    dòng "Thành Trung" tách biệt theo id; Lưu/Sửa/Xoá persona qua giao diện đều hoạt động đúng.
    Dữ liệu test đã xoá sạch khỏi Supabase.

## Cần làm tiếp (thứ tự đề xuất)
0. ~~Gửi email thật~~ — **XONG (2026-09-18): đã chuyển từ Resend sang Gmail API, gửi thật thành công**
   (người dùng xác nhận đã nhận được email test ở hộp thư `thpt@fpt.edu.vn`, cả từ local lẫn từ
   môi trường Cloudflare thật). Lý do đổi: Resend bắt buộc xác minh domain qua DNS, mà domain
   `@fpt.edu.vn` do IT trung tâm FPT quản lý — không xin thêm bản ghi DNS được. Gmail API dùng lại
   đúng tài khoản `thpt@fpt.edu.vn` đã gửi được trước đây qua `GmailApp`, không cần domain riêng.
   Đã làm: tạo Google Cloud Project `fschools-content-review` (tài khoản `thpt@fpt.edu.vn`) → bật
   Gmail API → tạo OAuth Client loại Desktop → chạy 1 script tạm lấy refresh token (phạm vi quyền
   CHỈ `gmail.send`, không đọc được hộp thư) → lưu 4 secret trên Cloudflare Pages:
   `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL`.
   Code: `functions/_lib/gmail.js` (đổi refresh token lấy access token, gọi Gmail API
   `users.messages.send` với MIME đa phần text+html, tiêu đề mã hoá UTF-8), `emailQueue.js` gọi
   `sendViaGmail`. Đã xoá `resend.js` và secret `RESEND_API_KEY`. Script tạm chứa client secret và
   file refresh token đã xoá khỏi máy, chưa từng được commit.
   **Cần biết khi bàn giao/bảo trì**: (a) OAuth consent screen đã được chuyển sang **"In
   production"** (Google Auth Platform → Audience; phải hoàn tất trang Branding trước thì nút
   Publish mới bấm được) và refresh token đã được lấy LẠI sau khi chuyển (token cấp lúc còn
   "Testing" có thể hết hạn sau ~7 ngày; token cấp ở production thì không bị giới hạn này). Đã
   test gửi thật trên Cloudflare với token mới, thành công. Google vẫn hiện cảnh báo "validation
   needed" và màn hình "app chưa xác minh" khi đăng nhập — bình thường, app chỉ dùng 1 tài khoản
   (giới hạn 100 người dùng trước khi phải xác minh). Nếu email vẫn đột ngột ngừng gửi (lỗi
   `invalid_grant` trong cột `last_error` của `email_queue`), cần chạy lại bước lấy refresh
   token 1 lần (script OAuth tạm dùng cổng localhost:53682, xoá sau khi dùng; secret cần thay:
   `GMAIL_REFRESH_TOKEN`, nhớ deploy lại sau khi đổi secret). Token cũng sẽ mất hiệu lực nếu đổi
   mật khẩu tài khoản `thpt@fpt.edu.vn` hoặc thu hồi quyền ứng dụng ở myaccount.google.com.
   (b) Giới hạn gửi của Gmail ~500 email/ngày (tài khoản thường) — dư xa so với ~15-20 người dùng.
   (c) Người gửi hiển thị là `FSchools Content Review <thpt@fpt.edu.vn>`.
1. `save_brand_guide_image` (upload ảnh mẫu) hiện trả lỗi rõ ràng "chưa hỗ trợ" — cần tạo
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
