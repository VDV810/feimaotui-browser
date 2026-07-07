// 翻译功能测试
const axios = require('axios');

async function translateText(text, targetLang = 'zh') {
  try {
    const response = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: {
        client: 'gtx',
        sl: 'auto',
        tl: targetLang,
        dt: 't',
        q: text
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data && response.data[0]) {
      const translatedText = response.data[0].map(item => item[0]).join('');
      const sourceLang = response.data[2] || 'auto';
      return {
        success: true,
        text: translatedText,
        sourceLang: sourceLang,
        targetLang: targetLang
      };
    }
    return { success: false, error: '翻译结果为空' };
  } catch (error) {
    console.error('翻译失败:', error.message);
    return { success: false, error: error.message };
  }
}

// 测试用例
async function runTests() {
  console.log('=== 翻译功能测试 ===\n');

  // 测试1: 英文翻译成中文
  console.log('测试1: 英文 → 中文');
  const result1 = await translateText('Hello, how are you?', 'zh');
  console.log('原文: Hello, how are you?');
  console.log('结果:', result1.success ? result1.text : result1.error);
  console.log('');

  // 测试2: 中文翻译成英文
  console.log('测试2: 中文 → 英文');
  const result2 = await translateText('你好，世界！', 'en');
  console.log('原文: 你好，世界！');
  console.log('结果:', result2.success ? result2.text : result2.error);
  console.log('');

  // 测试3: 日文翻译成中文
  console.log('测试3: 日文 → 中文');
  const result3 = await translateText('こんにちは', 'zh');
  console.log('原文: こんにちは');
  console.log('结果:', result3.success ? result3.text : result3.error);
  console.log('');

  // 测试4: 长文本翻译
  console.log('测试4: 长文本翻译');
  const longText = 'This is a test of the translation feature. It should be able to handle longer text passages.';
  const result4 = await translateText(longText, 'zh');
  console.log('原文:', longText);
  console.log('结果:', result4.success ? result4.text : result4.error);
  console.log('');

  console.log('=== 测试完成 ===');
}

runTests().catch(console.error);
