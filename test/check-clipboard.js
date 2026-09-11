const c = require('electron').clipboard;
const { nativeImage } = require('electron');
const app = require('electron').app;
app.whenReady().then(async () => {
  const buf = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { buf[i*4] = 0; buf[i*4+1] = 255; buf[i*4+2] = 0; buf[i*4+3] = 255; }
  const img = nativeImage.createFromBitmap(buf, { width: 4, height: 4 });

  async function tryCase(name, fn) {
    try {
      const r = await fn();
      console.log('[OK]', name, r === undefined ? '' : String(r).substring(0, 80));
      return true;
    } catch (e) {
      console.log('[FAIL]', name, '->', e.message);
      return false;
    }
  }

  await tryCase('await write({image})', () => c.write({ image: img }));
  await tryCase('write([{image}])', () => c.write([{ image: img }]));
  await tryCase('write({image: toDataURL})', () => c.write({ image: img.toDataURL() }));
  await tryCase('write({image: toPNG buffer})', () => c.write({ image: img.toPNG() }));

  // 尝试 ClipboardItem 数组（主进程可能没有该构造器）
  console.log('typeof ClipboardItem in main:', typeof ClipboardItem);

  app.exit(0);
});
