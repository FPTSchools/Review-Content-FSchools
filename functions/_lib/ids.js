// Giữ đúng kiểu ID chuỗi mà backend cũ (Apps Script) đang dùng, để tương thích ngược
// với dữ liệu/ logic hiện có (id dạng PREFIX_<timestamp>).
export function newId(prefix) {
  return `${prefix}_${Date.now()}`;
}
