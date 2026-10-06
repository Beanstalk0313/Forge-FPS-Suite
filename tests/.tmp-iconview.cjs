const fs = require('fs');
const b64 = fs.readFileSync('build/icon-preview.png').toString('base64');
const html = `<!doctype html><meta charset=utf-8><title>icon</title>
<style>
 body{margin:0;font:13px system-ui;background:#1a1f24;color:#cfe}
 .row{display:flex;gap:28px;align-items:flex-end;padding:28px 32px}
 .light{background:#e9eef2;color:#123}
 .cell{text-align:center}
 img{image-rendering:auto;display:block;margin:0 auto 8px}
</style>
<div class="row">
 <div class="cell"><img src="data:image/png;base64,${b64}" width="256" height="256"><span>256</span></div>
 <div class="cell"><img src="data:image/png;base64,${b64}" width="64" height="64"><span>64</span></div>
 <div class="cell"><img src="data:image/png;base64,${b64}" width="48" height="48"><span>48</span></div>
 <div class="cell"><img src="data:image/png;base64,${b64}" width="32" height="32"><span>32</span></div>
 <div class="cell"><img src="data:image/png;base64,${b64}" width="16" height="16"><span>16</span></div>
</div>
<div class="row light">
 <div class="cell"><img src="data:image/png;base64,${b64}" width="128" height="128"><span>on light</span></div>
 <div class="cell"><img src="data:image/png;base64,${b64}" width="32" height="32"><span>on light</span></div>
</div>`;
fs.writeFileSync('tests/.tmp/icon-view.html', html);
console.log('written');
