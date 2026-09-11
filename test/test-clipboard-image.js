// 端到端验证: PowerShell STA SetImage 写剪贴板位图
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

app.whenReady().then(async () => {
  // 1. 生成 4x4 绿色 PNG
  const buf = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { buf[i*4] = 0; buf[i*4+1] = 255; buf[i*4+2] = 0; buf[i*4+3] = 255; }
  const img = nativeImage.createFromBitmap(buf, { width: 4, height: 4 });
  const tmpPng = path.join(os.tmpdir(), 'feimaotui-test-clip.png');
  fs.writeFileSync(tmpPng, img.toPNG());

  // 2. PowerShell SetImage
  const escaped = tmpPng.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `$img = [System.Drawing.Image]::FromFile('${escaped}')`,
    '[System.Windows.Forms.Clipboard]::SetImage($img)',
    '$img.Dispose()'
  ].join('; ');

  await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 8000 }, (e) => e ? rej(e) : res()));
  console.log('[OK] SetImage done');

  // 3. 用 PowerShell 读回剪贴板图像存盘验证
  const outPng = path.join(os.tmpdir(), 'feimaotui-test-clip-out.png');
  const script2 = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `$img2 = [System.Windows.Forms.Clipboard]::GetImage()`,
    "if ($img2 -eq $null) { throw 'clipboard image is null' }",
    `$img2.Save('${outPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`
  ].join('; ');
  await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script2], { windowsHide: true, timeout: 8000 }, (e) => e ? rej(e) : res()));

  // 4. 读回验证尺寸
  const back = nativeImage.createFromPath(outPng);
  console.log('[OK] read back size:', JSON.stringify(back.getSize()), '(期望 4x4)');
  fs.unlinkSync(tmpPng);
  fs.unlinkSync(outPng);
  console.log(back.getSize().width === 4 ? 'CLIPBOARD IMAGE TEST PASS' : 'CLIPBOARD IMAGE TEST FAIL');
  app.exit(0);
}).catch(e => { console.log('[FAIL]', e.message); app.exit(1); });
