/* GitHub Pages SPA — pattern chuẩn rafgraph/spa-github-pages
   404.html: chuyển path → query string rồi redirect về index.html
   index.html: nhận query string → khôi phục path trước khi React Router mount */
const fs   = require('fs');
const path = require('path');

const dist         = path.join(__dirname, '..', 'dist');
const indexHtml    = path.join(dist, 'index.html');
const notFoundHtml = path.join(dist, '404.html');
const BASE         = '/ERP_XM-';          // phải khớp vite --base

if (!fs.existsSync(indexHtml)) {
  console.error('Thiếu dist/index.html — chạy vite build trước.');
  process.exit(1);
}

// ── 404.html: script redirect path → ?p=/path&q=query#hash ─────────────────
const redirect404 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>VinFast XMĐ Nam Thắng</title>
  <script>
    // SPA redirect — github.com/rafgraph/spa-github-pages
    var base  = '${BASE}';
    var loc   = window.location;
    var path  = loc.pathname.slice(base.length) || '/';
    var query = loc.search.slice(1);
    var hash  = loc.hash;
    var url   = base + '/?p=' + encodeURIComponent(path)
              + (query ? '&q=' + encodeURIComponent(query) : '')
              + hash;
    loc.replace(url);
  </script>
</head>
<body></body>
</html>
`;

// ── Đoạn script khôi phục path, chèn vào <head> của index.html ──────────────
const restoreScript = `
  <script>
    // SPA restore — nhận ?p= từ 404.html redirect
    (function() {
      var qs = window.location.search;
      if (!qs) return;
      var params = {};
      qs.slice(1).split('&').forEach(function(p) {
        var kv = p.split('=');
        params[kv[0]] = decodeURIComponent(kv.slice(1).join('='));
      });
      if (!params.p) return;
      var url = window.location.pathname.replace(/\\/$/, '')
              + params.p
              + (params.q ? '?' + params.q : '')
              + window.location.hash;
      window.history.replaceState(null, null, url);
    })();
  </script>`;

// Chèn restore script vào index.html ngay sau <head>
let indexContent = fs.readFileSync(indexHtml, 'utf8');
if (!indexContent.includes('SPA restore')) {
  indexContent = indexContent.replace('<head>', '<head>' + restoreScript);
  fs.writeFileSync(indexHtml, indexContent);
  console.log('SPA: đã chèn restore script vào index.html');
}

// Ghi 404.html mới
fs.writeFileSync(notFoundHtml, redirect404);
console.log('SPA: đã tạo 404.html redirect (rafgraph pattern)');
