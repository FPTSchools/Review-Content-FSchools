/* ============================================================
 * ĐỊNH DẠNG CHỮ DÙNG CHUNG (ctv.html soạn bài · boss.html + ctv.html xem/duyệt bài)
 *
 * Nội dung bài vẫn lưu trong DB là 1 chuỗi TEXT; định dạng nằm trong chuỗi bằng ký hiệu:
 *   **đậm**  *nghiêng*  ***đậm nghiêng***  __gạch chân__  ~~gạch ngang~~
 *   [size=N]..[/size]   cỡ chữ (px)
 *   [font=Tên]..[/font] font (chỉ các font trong FONT_STACK)
 *   [color=#RRGGBB]..[/color]  màu chữ      [bg=#RRGGBB]..[/bg]  màu nền (tô nổi)
 *   [link=https://...]..[/link]             liên kết
 *   [table=h]\nô | ô | ô\nô | ô | ô\n[/table]   bảng ("=h": hàng đầu là tiêu đề; "|" trong ô viết là "\|")
 *   Danh sách là CHỮ THƯỜNG: dòng bắt đầu bằng "• " hoặc "1. " (dán sang Facebook/Zalo vẫn đẹp).
 *
 * Vì vậy "bôi chọn nhận xét" vẫn tính vị trí trên chuỗi thô như cũ: ô nhận xét giữ nguyên mọi ký tự,
 * chỉ ẩn ký hiệu bằng CSS (xem renderSelectableFormatted).
 *
 * Mọi hàm bên dưới là nguồn DUY NHẤT của ký hiệu — thêm kiểu định dạng mới thì sửa ở đây, 1 chỗ.
 * ============================================================ */
(function (global) {
  'use strict';

  // ---------- Bảng lựa chọn dùng cho thanh công cụ ----------
  var FONT_STACK = {
    'Arial': "Arial, Helvetica, sans-serif",
    'Tahoma': "Tahoma, Geneva, sans-serif",
    'Verdana': "Verdana, Geneva, sans-serif",
    'Times New Roman': "'Times New Roman', Times, serif",
    'Georgia': "Georgia, serif",
    'Courier New': "'Courier New', Courier, monospace"
  };
  var FONT_NAMES = Object.keys(FONT_STACK);
  var SIZE_PRESETS = ['12', '16', '20', '26'];
  var DEFAULT_TEXT_COLOR = '#1A1C2E';
  var TEXT_COLORS = ['#C0392B', '#F26522', '#C47A00', '#00843D', '#003DA5', '#6B21A8', '#5A5F7A', '#000000'];
  var BG_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA', '#E5E7EB'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // '#abc' | '#aabbcc' | 'rgb(1,2,3)' | 'rgba(1,2,3,.5)' → '#AABBCC'; không đọc được / trong suốt → ''
  function normalizeHex(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return '';
    var m = v.match(/^#([0-9a-f]{3})$/);
    if (m) return ('#' + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]).toUpperCase();
    m = v.match(/^#([0-9a-f]{6})$/);
    if (m) return ('#' + m[1]).toUpperCase();
    m = v.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
      var h = function (n) { return ('0' + Math.min(255, +n).toString(16)).slice(-2); };
      return ('#' + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
    }
    return '';
  }
  function isNearBlack(hex) { return /^#[0-3][0-9A-F][0-3][0-9A-F][0-3][0-9A-F]$/.test(hex); }
  function isNearWhite(hex) { return /^#F[0-9A-F]F[0-9A-F]F[0-9A-F]$/.test(hex); }

  // ---------- Ký hiệu → HTML (chỉ đọc + nạp lại vào ô soạn) ----------
  // Chạy SAU escHtml (escHtml không đụng tới * _ ~ [ ] | \ nên ký hiệu còn nguyên).
  // Thứ tự quan trọng: bảng → cỡ chữ → font → màu → màu nền → liên kết → gạch chân → đậm+nghiêng → đậm → nghiêng → gạch ngang.
  function splitCells(row) {
    var out = [], cur = '';
    for (var i = 0; i < row.length; i++) {
      var ch = row[i];
      if (ch === '\\' && row[i + 1] === '|') { cur += '|'; i++; }
      else if (ch === '|') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function renderTables(s, eatNewline) {
    var re = eatNewline ? /\[table(=h)?\]\n?([\s\S]*?)\n?\[\/table\]\n?/g : /\[table(=h)?\]\n?([\s\S]*?)\n?\[\/table\]/g;
    return s.replace(re, function (m, h, body) {
      var rows = body.split('\n').filter(function (r) { return r.trim() !== ''; });
      if (!rows.length) return '';
      var html = rows.map(function (r, i) {
        var tag = (h && i === 0) ? 'th' : 'td';
        return '<tr>' + splitCells(r).map(function (c) { return '<' + tag + '>' + c + '</' + tag + '>'; }).join('') + '</tr>';
      }).join('');
      return '<table class="rt-table"><tbody>' + html + '</tbody></table>';
    });
  }

  // opts.editor = true khi nạp vào ô soạn: không "ăn" dấu xuống dòng sau bảng (mỗi dòng sẽ thành 1 <div>).
  function renderTextFormatting(html, opts) {
    if (!html) return html;
    opts = opts || {};
    html = renderTables(html, !opts.editor);
    html = html.replace(/\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/g, '<span style="font-size:$1px">$2</span>');
    html = html.replace(/\[font=([A-Za-z ]{2,30})\]([\s\S]*?)\[\/font\]/g, function (m, name, inner) {
      var st = FONT_STACK[name];
      return st ? '<span style="font-family:' + st + '">' + inner + '</span>' : inner;
    });
    html = html.replace(/\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/g, '<span style="color:$1">$2</span>');
    html = html.replace(/\[bg=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/bg\]/g, '<span style="background:$1;border-radius:2px">$2</span>');
    html = html.replace(/\[link=((?:https?:\/\/|mailto:)[^\]\s]+)\]([\s\S]*?)\[\/link\]/g, function (m, url, inner) {
      // url đã qua escHtml (an toàn trong thuộc tính). Mã hoá _ * ~ để các bước đậm/nghiêng bên dưới không đụng vào đường dẫn.
      var safe = url.replace(/_/g, '%5F').replace(/\*/g, '%2A').replace(/~/g, '%7E');
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>';
    });
    html = html.replace(/__([\s\S]+?)__/g, '<u>$1</u>');
    html = html.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<b><i>$1</i></b>');
    html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*([\s\S]+?)\*/g, '<i>$1</i>');
    html = html.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
    return html;
  }

  function hasFormattingMarkup(text) {
    return /\*|__|~~|\[(?:size|font|color|bg|link|table)[=\]]/.test(String(text || ''));
  }

  // Chuỗi thô → HTML để nạp vào ô soạn thảo (mỗi dòng 1 <div>).
  function rawToEditorHtml(raw) {
    var formatted = renderTextFormatting(esc(String(raw || '')), { editor: true });
    return formatted.split('\n').map(function (line) { return '<div>' + (line || '<br>') + '</div>'; }).join('');
  }

  // ---------- Ô nhận xét: hiện định dạng nhưng KHÔNG đổi chuỗi chữ ----------
  // Ký hiệu được giữ trong <span class="ic-mk"> ẩn bằng CSS; Range.toString() vẫn đếm cả chữ ẩn
  // nên vị trí nhận xét (đo trên chuỗi thô) vẫn khớp. Cách ghép cặp giống hệt renderTextFormatting().
  var MAP_RULES = [
    { re: /\[table(?:=h)?\][\s\S]*?\[\/table\]/g, kind: 'table', close: 8 },
    { re: /\[size=(\d{1,3})\][\s\S]*?\[\/size\]/g, kind: 'size', close: 7 },
    { re: /\[font=([A-Za-z ]{2,30})\][\s\S]*?\[\/font\]/g, kind: 'font', close: 7 },
    { re: /\[color=(#[0-9a-fA-F]{6})\][\s\S]*?\[\/color\]/g, kind: 'color', close: 8 },
    { re: /\[bg=(#[0-9a-fA-F]{6})\][\s\S]*?\[\/bg\]/g, kind: 'bg', close: 5 },
    { re: /\[link=((?:https?:\/\/|mailto:)[^\]\s]+)\][\s\S]*?\[\/link\]/g, kind: 'link', close: 7 },
    { re: /__([\s\S]+?)__/g, kind: 'u', open: 2, close: 2 },
    { re: /\*\*\*([\s\S]+?)\*\*\*/g, kind: 'bi', open: 3, close: 3 },
    { re: /\*\*([\s\S]+?)\*\*/g, kind: 'b', open: 2, close: 2 },
    { re: /\*([\s\S]+?)\*/g, kind: 'i', open: 1, close: 1 },
    { re: /~~([\s\S]+?)~~/g, kind: 'st', open: 2, close: 2 }
  ];

  function formatMapOf(raw) {
    var n = raw.length;
    var f = {
      mk: new Uint8Array(n), b: new Uint8Array(n), it: new Uint8Array(n), u: new Uint8Array(n), st: new Uint8Array(n),
      size: new Array(n).fill(''), font: new Array(n).fill(''), color: new Array(n).fill(''), bg: new Array(n).fill(''), link: new Array(n).fill('')
    };
    var masked = raw.split('');
    MAP_RULES.forEach(function (r) {
      var src = masked.join('');
      r.re.lastIndex = 0;
      var m;
      while ((m = r.re.exec(src))) {
        var open = r.open || (m[0].indexOf(']') + 1);
        var s = m.index, e = m.index + m[0].length, i;
        for (i = s; i < s + open; i++) { f.mk[i] = 1; masked[i] = '\u0000'; }
        for (i = e - r.close; i < e; i++) { f.mk[i] = 1; masked[i] = '\u0000'; }
        if (r.kind === 'table') continue;
        for (i = s + open; i < e - r.close; i++) {
          if (r.kind === 'size') { if (!f.size[i]) f.size[i] = m[1]; }
          else if (r.kind === 'font') { if (!f.font[i] && FONT_STACK[m[1]]) f.font[i] = m[1]; }
          else if (r.kind === 'color') { if (!f.color[i]) f.color[i] = m[1].toUpperCase(); }
          else if (r.kind === 'bg') { if (!f.bg[i]) f.bg[i] = m[1].toUpperCase(); }
          else if (r.kind === 'link') { if (!f.link[i]) f.link[i] = '1'; }
          else if (r.kind === 'u') f.u[i] = 1;
          else if (r.kind === 'b') f.b[i] = 1;
          else if (r.kind === 'i') f.it[i] = 1;
          else if (r.kind === 'st') f.st[i] = 1;
          else if (r.kind === 'bi') { f.b[i] = 1; f.it[i] = 1; }
        }
      }
    });
    return f;
  }

  // Chữ người đọc thực sự nhìn thấy (bỏ ký hiệu định dạng) trong đoạn [start, end) của raw.
  function visibleTextOf(raw, start, end) {
    raw = String(raw || '');
    var f = formatMapOf(raw);
    var a = Math.max(0, start == null ? 0 : start), b = Math.min(raw.length, end == null ? raw.length : end);
    var out = '';
    for (var i = a; i < b; i++) if (!f.mk[i]) out += raw[i];
    return out;
  }

  // Dựng HTML cho ô bôi chọn: định dạng thật + ký hiệu ẩn + tô vàng các đoạn đã nhận xét.
  // opts.images = true: link ảnh Google Drive trong bài hiện thành ẢNH thật ngay tại chỗ (không cần khối xem trước riêng).
  // Bảng cũng hiện thành bảng thật. Quy tắc bất di bất dịch: mọi ký tự của chuỗi thô vẫn nằm trong DOM đúng thứ tự
  // (ký hiệu, link ảnh, dấu "|", xuống dòng được ẩn bằng CSS chứ không xoá) và ảnh chỉ là phần tử không có chữ,
  // nên vị trí nhận xét đo bằng Range.toString() vẫn khớp với chuỗi thô.
  var DRIVE_IMG_RE = /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)(?:\/[^\s<>"']*)?/g;

  function imgTag(id) {
    return '<img class="ic-img" loading="lazy" alt="Ảnh minh họa" src="https://drive.google.com/thumbnail?id=' + id + '&amp;sz=w1000"' +
      ' onclick="event.stopPropagation();window.open(\'https://drive.google.com/file/d/' + id + '/view\',\'_blank\')">';
  }

  function renderSelectableFormatted(raw, comments, notePrefix, opts) {
    raw = String(raw || '');
    comments = comments || [];
    opts = opts || {};
    var n = raw.length, i, m;
    var f = formatMapOf(raw);

    // Link ảnh Drive → ẩn chữ link (vẫn giữ trong DOM) + thêm thẻ <img> ngay sau link
    var imgAt = new Int32Array(n).fill(-1), imgs = [];
    if (opts.images) {
      DRIVE_IMG_RE.lastIndex = 0;
      while ((m = DRIVE_IMG_RE.exec(raw))) {
        var s0 = m.index, e0 = s0 + m[0].length;
        if (f.mk[s0]) continue;   // link nằm trong ký hiệu khác (vd đích của [link=...]) thì bỏ qua
        imgs.push({ id: m[1], e: e0 });
        for (i = s0; i < e0; i++) { imgAt[i] = imgs.length - 1; f.mk[i] = 1; }
      }
    }

    var hl = new Int32Array(n).fill(-1);
    comments.forEach(function (c, ci) { for (var k = Math.max(0, c.start); k < Math.min(n, c.end); k++) hl[k] = ci; });

    function hidden(a, b) { return b > a ? '<span class="ic-mk">' + esc(raw.slice(a, b)).replace(/\r/g, '&#13;') + '</span>' : ''; }

    // HTML cho đoạn [a, b) của chuỗi thô (chia thành các "đoạn" cùng định dạng)
    function runsHtml(a, b) {
      var html = '';
      for (var p = a; p < b;) {
        var j = p + 1;
        while (j < b && f.mk[j] === f.mk[p] && f.b[j] === f.b[p] && f.it[j] === f.it[p] && f.u[j] === f.u[p] && f.st[j] === f.st[p] &&
          f.size[j] === f.size[p] && f.font[j] === f.font[p] && f.color[j] === f.color[p] && f.bg[j] === f.bg[p] && f.link[j] === f.link[p] &&
          imgAt[j] === imgAt[p] && hl[j] === hl[p]) j++;
        var txt = esc(raw.slice(p, j)).replace(/\r/g, '<span class="ic-mk">&#13;</span>');
        var piece;
        if (f.mk[p]) {
          piece = '<span class="ic-mk">' + txt + '</span>';
          if (imgAt[p] >= 0 && j === imgs[imgAt[p]].e) piece += imgTag(imgs[imgAt[p]].id);
        } else {
          var st = [];
          if (f.b[p]) st.push('font-weight:700');
          if (f.it[p]) st.push('font-style:italic');
          var deco = [];
          if (f.u[p] || f.link[p]) deco.push('underline');
          if (f.st[p]) deco.push('line-through');
          if (deco.length) st.push('text-decoration:' + deco.join(' '));
          if (f.size[p]) st.push('font-size:' + f.size[p] + 'px');
          if (f.font[p]) st.push('font-family:' + FONT_STACK[f.font[p]]);
          if (f.color[p]) st.push('color:' + f.color[p]);
          else if (f.link[p]) st.push('color:#003DA5');
          if (f.bg[p]) st.push('background:' + f.bg[p]);
          piece = st.length ? '<span style="' + st.join(';') + '">' + txt + '</span>' : txt;
        }
        if (hl[p] >= 0) {
          var c = comments[hl[p]];
          piece = '<span class="ic-highlight" onclick="document.getElementById(\'' + notePrefix + c.id + '\').scrollIntoView({behavior:\'smooth\',block:\'nearest\'})">' + piece + '</span>';
        }
        html += piece;
        p = j;
      }
      return html;
    }

    // Bảng thật: mỗi ô chứa đúng đoạn chữ của nó; dấu "|" ngăn cách, khoảng trắng đầu/cuối ô, xuống dòng giữa các hàng,
    // ký hiệu [table]..[/table] đều nằm trong <span class="ic-mk"> ẩn, đặt đúng thứ tự như trong chuỗi thô.
    function tableHtml(t) {
      var html = hidden(t.s, t.s + t.open);
      var bs = t.s + t.open, be = t.e - 8;   // 8 = độ dài "[/table]"
      var rows = [], pending = [], p = bs, k;
      for (k = bs; k <= be; k++) {
        if (k === be || raw[k] === '\n') {
          if (raw.slice(p, k).trim() === '') pending.push([p, Math.min(k + 1, be)]);
          else { rows.push({ a: p, b: k, pend: pending, nl: k < be ? [k, k + 1] : null }); pending = []; }
          p = k + 1;
        }
      }
      var out = '<table class="rt-table"><tbody>';
      rows.forEach(function (row, ri) {
        var cells = [], cs = row.a, q;
        for (q = row.a; q < row.b; q++) {
          if (raw[q] === '\\' && raw[q + 1] === '|') { f.mk[q] = 1; q++; }     // "\|" trong ô: ẩn dấu gạch ngược, hiện dấu |
          else if (raw[q] === '|') { cells.push([cs, q]); cs = q + 1; }
        }
        cells.push([cs, row.b]);
        var tag = (t.h && ri === 0) ? 'th' : 'td';
        out += '<tr>';
        cells.forEach(function (c, ci) {
          var ts = c[0], te = c[1];
          while (ts < te && /\s/.test(raw[ts])) ts++;
          while (te > ts && /\s/.test(raw[te - 1])) te--;
          var cell = '';
          if (ci === 0) row.pend.forEach(function (pr) { cell += hidden(pr[0], pr[1]); });
          if (ci > 0) cell += hidden(c[0] - 1, c[0]);                    // dấu | ngăn cách ô
          cell += hidden(c[0], ts) + runsHtml(ts, te) + hidden(te, c[1]);
          if (ci === cells.length - 1 && row.nl) cell += hidden(row.nl[0], row.nl[1]);
          out += '<' + tag + '>' + cell + '</' + tag + '>';
        });
        out += '</tr>';
      });
      out += '</tbody></table>';
      pending.forEach(function (pr) { out += hidden(pr[0], pr[1]); });
      return html + out + hidden(be, t.e);
    }

    var regions = [], re = /\[table(=h)?\][\s\S]*?\[\/table\]/g;
    while ((m = re.exec(raw))) regions.push({ s: m.index, e: m.index + m[0].length, h: !!m[1], open: m[0].indexOf(']') + 1 });
    var html = '', pos = 0;
    regions.forEach(function (t) { html += runsHtml(pos, t.s) + tableHtml(t); pos = t.e; });
    html += runsHtml(pos, n);
    return html;
  }

  // ---------- HTML của ô soạn thảo → ký hiệu ----------
  var BLOCK_RE = /^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER)$/;
  var SKIP_RE = /^(SCRIPT|STYLE|META|TITLE|HEAD|LINK|IMG|SVG|VIDEO|AUDIO|IFRAME|OBJECT|NOSCRIPT|CANVAS)$/;

  function canonicalFont(family) {
    var first = String(family || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    for (var i = 0; i < FONT_NAMES.length; i++) if (FONT_NAMES[i].toLowerCase() === first) return FONT_NAMES[i];
    return null;
  }

  function wrapRun(t, f) {
    if (!t) return '';
    if (f.bold && f.italic) t = '***' + t + '***';
    else if (f.bold) t = '**' + t + '**';
    else if (f.italic) t = '*' + t + '*';
    if (f.strike) t = '~~' + t + '~~';
    if (f.underline) t = '__' + t + '__';
    if (f.bg) t = '[bg=' + f.bg + ']' + t + '[/bg]';
    if (f.color) t = '[color=' + f.color + ']' + t + '[/color]';
    if (f.font) t = '[font=' + f.font + ']' + t + '[/font]';
    if (f.size) t = '[size=' + f.size + ']' + t + '[/size]';
    if (f.link) t = '[link=' + f.link + ']' + t + '[/link]';
    return t;
  }

  // Định dạng của 1 thẻ = định dạng kế thừa từ thẻ cha + những gì thẻ này tự thêm/ghi đè.
  // opts.paste = true (nội dung dán từ Word/Google Docs/web): chỉ nhận cỡ chữ có sẵn trong thanh công cụ,
  // bỏ màu đen/nền trắng mặc định, và bỏ font đang chiếm đa số (opts.baseFont) để khỏi chèn ký hiệu khắp bài.
  function readFormat(node, fmt, opts) {
    var tag = node.tagName, st = node.style || {};
    var next = { bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, strike: fmt.strike, size: fmt.size, font: fmt.font, color: fmt.color, bg: fmt.bg, link: fmt.link };
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM') next.italic = true;
    if (tag === 'U') next.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
    if (/^H[1-6]$/.test(tag)) { next.bold = true; if (tag === 'H1') next.size = '26'; else if (tag === 'H2') next.size = '20'; }
    var fw = st.fontWeight;
    if (fw) {
      var wn = parseInt(fw, 10);
      if (fw === 'bold' || fw === 'bolder' || wn >= 600) next.bold = true;
      else if (fw === 'normal' || wn < 600) next.bold = false;
    }
    if (st.fontStyle === 'italic') next.italic = true;
    else if (st.fontStyle === 'normal') next.italic = false;
    var linkDefaults = opts.paste && tag === 'A';
    var deco = linkDefaults ? '' : (st.textDecorationLine || st.textDecoration || '');
    if (/underline/.test(deco)) next.underline = true;
    if (/line-through/.test(deco)) next.strike = true;
    if (st.fontSize) {
      var m = /^(\d+)px$/.exec(st.fontSize);
      if (m && (!opts.paste || SIZE_PRESETS.indexOf(m[1]) >= 0)) next.size = m[1];
    }
    var color = '';
    if (st.color && !linkDefaults) color = normalizeHex(st.color);
    else if (tag === 'FONT' && node.getAttribute) color = normalizeHex(node.getAttribute('color'));
    if ((st.color && !linkDefaults) || (tag === 'FONT' && color)) {
      next.color = (color && color !== DEFAULT_TEXT_COLOR && !(opts.paste && isNearBlack(color))) ? color : null;
    }
    if (st.backgroundColor) {
      var bg = normalizeHex(st.backgroundColor);
      next.bg = (bg && !(opts.paste && isNearWhite(bg))) ? bg : null;
    }
    var family = st.fontFamily || (tag === 'FONT' && node.getAttribute ? node.getAttribute('face') : '');
    if (family) {
      var canon = canonicalFont(family);
      next.font = (canon && !(opts.paste && canon === opts.baseFont)) ? canon : null;
    }
    if (tag === 'A' && node.getAttribute) {
      var href = node.getAttribute('href') || '';
      if (/^(https?:\/\/|mailto:)[^\]\s]+$/i.test(href)) next.link = href;
    }
    return next;
  }

  function serializeTable(table, opts) {
    var rows = Array.prototype.slice.call(table.rows || []);
    if (!rows.length) return '';
    var cols = 0;
    rows.forEach(function (r) { cols = Math.max(cols, r.cells.length); });
    var header = rows[0].cells.length > 0 && Array.prototype.every.call(rows[0].cells, function (c) { return c.tagName === 'TH'; });
    var lines = rows.map(function (r) {
      var cells = Array.prototype.map.call(r.cells, function (c) {
        return serializeEditableContent(c, opts).replace(/\s*\n+\s*/g, ' ').trim().replace(/\|/g, '\\|');
      });
      while (cells.length < cols) cells.push('');
      return cells.join(' | ');
    });
    return (header ? '[table=h]' : '[table]') + '\n' + lines.join('\n') + '\n[/table]\n';
  }

  function listPrefix(li) {
    var parent = li.parentElement;
    if (parent && parent.tagName === 'OL') {
      var idx = 1, p = li.previousElementSibling;
      while (p) { if (p.tagName === 'LI') idx++; p = p.previousElementSibling; }
      return idx + '. ';
    }
    return '• ';
  }

  // Duyệt cây DOM của ô contenteditable, dịch từng đoạn chữ + định dạng đang bọc nó sang ký hiệu.
  function serializeEditableContent(root, opts) {
    if (!root) return '';
    opts = opts || {};
    var out = '', run = '', runFmt = null;
    var base = { bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null, link: null };
    var sameFmt = function (a, b) {
      return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike &&
        a.size === b.size && a.font === b.font && a.color === b.color && a.bg === b.bg && a.link === b.link;
    };
    // Gom các đoạn chữ liền nhau cùng định dạng thành 1 cặp ký hiệu; khoảng trắng thuần thì không bọc ký hiệu.
    function flush() {
      if (run) out += /^\s*$/.test(run) ? run : wrapRun(run, runFmt);
      run = ''; runFmt = null;
    }
    function newline() { if (out && !out.endsWith('\n')) out += '\n'; }
    function walk(node, fmt) {
      if (node.nodeType === 3) {
        var t = node.nodeValue;
        if (opts.paste) t = t.replace(/[\s ]+/g, ' ');
        if (!t) return;
        if (runFmt && !sameFmt(runFmt, fmt)) flush();
        run += t; runFmt = fmt;
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (SKIP_RE.test(tag)) return;
      if (tag === 'BR') { flush(); out += '\n'; return; }
      if (tag === 'TABLE') { flush(); newline(); out += serializeTable(node, opts); return; }
      var isBlock = BLOCK_RE.test(tag);
      if (isBlock) { flush(); newline(); }
      if (tag === 'LI') out += listPrefix(node);
      var next = readFormat(node, fmt, opts);
      Array.prototype.forEach.call(node.childNodes, function (c) { walk(c, next); });
      if (isBlock) { flush(); newline(); }
    }
    Array.prototype.forEach.call(root.childNodes, function (c) { walk(c, base); });
    flush();
    return out.replace(/\n+$/, '');
  }

  // Dán từ Word / Google Docs / web: giữ lại phần ô soạn hiểu được (đậm, nghiêng, gạch chân, màu, font có sẵn,
  // liên kết, bảng, danh sách → chữ "• "), bỏ mọi thứ khác. Trả '' nếu không có gì để dán.
  function pastedHtmlToEditorHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    // font chiếm đa số trong nội dung dán = font "nền" → không chèn ký hiệu cho nó
    var tally = {};
    Array.prototype.forEach.call(doc.body.querySelectorAll('[style]'), function (el) {
      var c = canonicalFont(el.style.fontFamily);
      if (c) tally[c] = (tally[c] || 0) + (el.textContent || '').length;
    });
    var baseFont = null, best = 0;
    Object.keys(tally).forEach(function (k) { if (tally[k] > best) { best = tally[k]; baseFont = k; } });
    var raw = serializeEditableContent(doc.body, { paste: true, baseFont: baseFont });
    raw = raw.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
    return raw ? rawToEditorHtml(raw) : '';
  }

  // ---------- CSS dùng chung (bảng + liên kết trong vùng hiển thị và ô soạn) ----------
  if (typeof document !== 'undefined' && document.head && !document.getElementById('rt-shared-style')) {
    var style = document.createElement('style');
    style.id = 'rt-shared-style';
    style.textContent =
      '.rt-table,.content-editable table{border-collapse:collapse;margin:6px 0;max-width:100%;font-size:inherit;}' +
      '.rt-table td,.rt-table th,.content-editable table td,.content-editable table th{border:1px solid #C8CDE0;padding:5px 10px;vertical-align:top;min-width:56px;text-align:left;}' +
      '.rt-table th,.content-editable table th{background:#F0F2F8;font-weight:600;text-transform:none;letter-spacing:normal;font-size:inherit;color:inherit;}' +
      '.rt-table td,.content-editable table td{font-size:inherit;color:inherit;}' +
      '.content-editable a,.content-block a{color:#003DA5;text-decoration:underline;}' +
      '.ic-img{display:block;max-width:100%;max-height:420px;border-radius:8px;margin:8px 0;cursor:zoom-in;background:#F0F2F8;}' +
      '.inline-content .rt-table{white-space:normal;}';
    document.head.appendChild(style);
  }

  var RT = {
    FONT_STACK: FONT_STACK, FONT_NAMES: FONT_NAMES, SIZE_PRESETS: SIZE_PRESETS, TEXT_COLORS: TEXT_COLORS, BG_COLORS: BG_COLORS,
    DEFAULT_TEXT_COLOR: DEFAULT_TEXT_COLOR, normalizeHex: normalizeHex, splitCells: splitCells
  };
  global.RT = RT;
  global.renderTextFormatting = renderTextFormatting;
  global.hasFormattingMarkup = hasFormattingMarkup;
  global.rawToEditorHtml = rawToEditorHtml;
  global.formatMapOf = formatMapOf;
  global.visibleTextOf = visibleTextOf;
  global.renderSelectableFormatted = renderSelectableFormatted;
  global.serializeEditableContent = serializeEditableContent;
  global.pastedHtmlToEditorHtml = pastedHtmlToEditorHtml;
  if (typeof module !== 'undefined' && module.exports) module.exports = global;
})(typeof window !== 'undefined' ? window : globalThis);
