-- CHỐNG DÒ MẬT KHẨU: đếm số lần đăng nhập sai theo 3 khoá — email, địa chỉ IP, và cặp email+IP — để tạm khoá khi sai nhiều lần.
-- key dạng 'e:<email>' | 'ip:<ip>' | 'ei:<email>|<ip>'. Bảng chỉ backend (service role) đọc/ghi, không chứa mật khẩu.
CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
