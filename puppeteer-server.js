/**
 * Naver Blog Auto Posting Server
 */

const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;

const NAVER_ID = process.env.NAVER_ID || 'giocall';
const NAVER_PW = process.env.NAVER_PW || 'qpqp0045';

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,900'
      ]
    });
  }
  return browser;
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadImage(url, tmpPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
}

async function naverLogin(page) {
  await page.goto('https://nid.naver.com/nidlogin.login', {
    waitUntil: 'networkidle2',
    timeout: 20000
  });
  await delay(2000);

  // 아이디 입력
  await page.waitForSelector('#id', { timeout: 10000 });
  await page.click('#id');
  await delay(300);
  await page.keyboard.type(NAVER_ID, { delay: 100 });
  await delay(500);

  // 비밀번호 입력
  await page.click('#pw');
  await delay(300);
  await page.keyboard.type(NAVER_PW, { delay: 100 });
  await delay(500);

  // 로그인 버튼 클릭
  await page.click('#log\\.login');
  await delay(4000);

  const url = page.url();
  console.log(`로그인 후 URL: ${url}`);

  if (url.includes('nidlogin') || url.includes('login')) {
    throw new Error('로그인 실패 - 캡차 또는 인증 필요');
  }
  console.log('✅ 로그인 성공');
}

async function findInFrames(page, selector, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of [page, ...page.frames()]) {
      try {
        const el = await frame.$(selector);
        if (el) return frame;
      } catch(e) {}
    }
    await delay(500);
  }
  throw new Error(`셀렉터 못 찾음: ${selector}`);
}

app.post('/naver-post', async (req, res) => {
  const { title, sections } = req.body;

  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ── 1. 네이버 로그인 ──
    await naverLogin(page);

    // ── 2. 글쓰기 페이지 이동 ──
    await page.goto('https://blog.naver.com/giocall?Redirect=Write&', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(5000);
    console.log(`글쓰기 URL: ${page.url()}`);
    page.frames().forEach((f, i) => console.log(`frame[${i}]: ${f.url()}`));

    // ── 3. 제목 입력 ──
    const titleFrame = await findInFrames(page, '.se-title-input', 25000);
    await titleFrame.click('.se-title-input');
    await delay(500);
    await titleFrame.type('.se-title-input', title, { delay: 50 });
    await delay(1000);
    console.log('✅ 제목 입력 완료');

    // ── 4. 섹션별 본문 + 이미지 ──
    const bodyFrame = await findInFrames(page, '.se-main-container', 10000);
    await bodyFrame.click('.se-main-container');
    await delay(500);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      await bodyFrame.keyboard.type(section.heading, { delay: 30 });
      await bodyFrame.keyboard.press('Enter');
      await delay(300);

      await bodyFrame.keyboard.type(section.body, { delay: 10 });
      await bodyFrame.keyboard.press('Enter');
      await delay(500);

      if (section.image_url) {
        try {
          const tmpPath = `/tmp/img_${i}.png`;
          await downloadImage(section.image_url, tmpPath);

          const imgFrame = await findInFrames(page, 'button[data-name="image"]', 5000);
          await imgFrame.click('button[data-name="image"]');
          await delay(2000);

          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(tmpPath);
            await delay(4000);
          }
          console.log(`✅ 섹션${i+1} 이미지 업로드 완료`);
        } catch (imgErr) {
          console.error(`이미지 업로드 오류 (섹션${i+1}):`, imgErr.message);
        }
      }

      await bodyFrame.keyboard.press('Enter');
      await delay(500);
    }

    // ── 5. 발행 ──
    try {
      const pubFrame = await findInFrames(page, '.se-publish-button', 5000);
      await pubFrame.click('.se-publish-button');
    } catch(e) {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.trim().includes('발행'));
        if (btn) btn.click();
      });
    }
    await delay(3000);

    try {
      await page.waitForSelector('.confirm-btn, .btn-confirm', { timeout: 3000 });
      await page.click('.confirm-btn, .btn-confirm');
      await delay(3000);
    } catch(e) {}

    const currentUrl = page.url();
    console.log(`✅ 포스팅 완료: ${title} | ${currentUrl}`);

    await page.close();
    res.json({ success: true, url: currentUrl, title });

  } catch (err) {
    console.error('포스팅 오류:', err.message);
    try { await page.screenshot({ path: '/tmp/error.png' }); } catch(e) {}
    await page.close();
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', browser: !!browser }));

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Naver Blog Puppeteer Server :${PORT}`);
  console.log('   POST /naver-post');
  console.log('   GET  /health');
});
