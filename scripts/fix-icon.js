const rcedit = require('rcedit');
const path = require('path');
const fs = require('fs');

module.exports = async function(context) {
  const exeName = '飞毛腿浏览器.exe';
  const exePath = path.join(context.appOutDir, exeName);
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.log('EXE not found at', exePath, '- skipping icon fix');
    return;
  }
  if (!fs.existsSync(icoPath)) {
    console.log('ICO not found at', icoPath, '- skipping icon fix');
    return;
  }

  console.log('Embedding icon into exe...');
  try {
    await rcedit.rcedit(exePath, { icon: icoPath });
    console.log('Icon embedded successfully!');
  } catch (err) {
    console.error('Icon embed failed:', err.message || err);
    // Don't fail the build
  }
};
