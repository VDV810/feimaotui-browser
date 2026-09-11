// compositeNativeImages 合成逻辑单元验证（主进程运行，无需窗口）
const { nativeImage, app } = require('electron');

function compositeNativeImages(base, overlay, dx, dy) {
  const baseSize = base.getSize();
  const overSize = overlay.getSize();
  const baseBuf = base.toBitmap();
  const overBuf = overlay.toBitmap();
  const out = Buffer.from(baseBuf);
  const bw = baseSize.width, bh = baseSize.height;
  const ow = overSize.width, oh = overSize.height;
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
  const x1 = Math.min(bw, dx + ow), y1 = Math.min(bh, dy + oh);
  for (let y = y0; y < y1; y++) {
    const sRow = (y - dy) * ow;
    const dRow = y * bw;
    for (let x = x0; x < x1; x++) {
      const si = (sRow + (x - dx)) * 4;
      const a = overBuf[si + 3];
      if (a === 0) continue;
      const di = (dRow + x) * 4;
      if (a === 255) {
        out[di] = overBuf[si];
        out[di + 1] = overBuf[si + 1];
        out[di + 2] = overBuf[si + 2];
        out[di + 3] = 255;
      } else {
        const al = a / 255, ia = 1 - al;
        out[di] = Math.round(out[di] * ia + overBuf[si] * al);
        out[di + 1] = Math.round(out[di + 1] * ia + overBuf[si + 1] * al);
        out[di + 2] = Math.round(out[di + 2] * ia + overBuf[si + 2] * al);
        out[di + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(out, { width: bw, height: bh });
}

app.whenReady().then(() => {
  // base: 10x10 红色 (BGRA: B=0,G=0,R=255,A=255)
  const W = 10, H = 10;
  const baseBuf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { baseBuf[i*4] = 0; baseBuf[i*4+1] = 0; baseBuf[i*4+2] = 255; baseBuf[i*4+3] = 255; }
  const base = nativeImage.createFromBitmap(baseBuf, { width: W, height: H });

  // overlay: 4x4 绿色不透明 (B=0,G=255,R=0)
  const OW = 4, OH = 4;
  const overBuf = Buffer.alloc(OW * OH * 4);
  for (let i = 0; i < OW * OH; i++) { overBuf[i*4] = 0; overBuf[i*4+1] = 255; overBuf[i*4+2] = 0; overBuf[i*4+3] = 255; }
  const overlay = nativeImage.createFromBitmap(overBuf, { width: OW, height: OH });

  // 放到 (6,3)：右边缘会越界(6+4=10 恰好)，测 (3,3)
  const result = compositeNativeImages(base, overlay, 3, 3);
  const size = result.getSize();
  const bmp = result.toBitmap();

  function px(x, y) { const i = (y * size.width + x) * 4; return [bmp[i], bmp[i+1], bmp[i+2], bmp[i+3]]; }

  const [b1,g1,r1,a1] = px(1, 1);
  const [b2,g2,r2,a2] = px(5, 5);   // overlay 中心
  const [b3,g3,r3,a3] = px(9, 9);   // 不属于 overlay 区域 (overlay覆盖3..6,3..6)
  console.log('base像素(1,1) 应为红(0,0,255,255):', b1, g1, r1, a1);
  console.log('overlay像素(5,5) 应为绿(0,255,0,255):', b2, g2, r2, a2);
  console.log('base像素(9,9) 应为红(0,0,255,255):', b3, g3, r3, a3);
  const ok = (g1===0&&r1===255) && (g2===255&&r2===0) && (g3===0&&r3===255);
  console.log(ok ? 'COMPOSITE TEST PASS' : 'COMPOSITE TEST FAIL');
  app.exit(ok ? 0 : 1);
});
