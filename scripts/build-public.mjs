// Chuẩn bị thư mục dist/ để deploy lên Cloudflare Pages — CHỈ chép các file giao diện được liệt kê
// dưới đây (danh sách cho phép). Trước đây deploy thẳng thư mục gốc làm lộ công khai .dev.vars/.env
// (khoá Supabase service role, OpenAI, Gmail) vì Pages không đọc .assetsignore. Thêm trang mới thì
// phải thêm tên file vào PUBLIC_FILES. Pages Functions vẫn lấy từ ./functions ở thư mục gốc.
import fs from 'fs';
import path from 'path';

const PUBLIC_FILES = ['index.html', 'ctv.html', 'boss.html', 'plan.html'];
const OUT = 'dist';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of PUBLIC_FILES) fs.copyFileSync(f, path.join(OUT, f));
console.log(`dist/: ${PUBLIC_FILES.join(', ')}`);
