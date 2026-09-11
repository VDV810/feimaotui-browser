const c = require('electron').clipboard;
const app = require('electron').app;
app.whenReady().then(() => {
  try {
    const { nativeImage } = require('electron');
    // 4x4 绿色图
    const buf = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < 16; i++) { buf[i*4] = 0; buf[i*4+1] = 255; buf[i*4+2] = 0; buf[i*4+3] = 255; }
    const img = nativeImage.createFromBitmap(buf, { width: 4, height: 4 });
    c.write({ image: img });
    console.log('clipboard.write({image}) call OK');
    console.log('has image/png:', c.has('image/png'));
    const back = c.read('image/png');
    console.log('read back size:', JSON.stringify(back.getSize()));
    app.exit(0);
  } catch (e) {
    console.log('FAILED:', e.message);
    app.exit(1);
  }
});
