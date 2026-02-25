const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;

const NAVER_ID = process.env.NAVER_ID || 'giocall';
const NAVER_PW = process.env.NAVER_PW || 'qpqp0045';
const TMP_DIR = '/tmp';

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
    waitUntil: 'networkidle2', timeout: 20000
  });
  await delay(2000);
  await page.waitForSelector('#id', { timeout: 10000 });
  await page.click('#id');
  await delay(300);
  await page.keyboard.type(NAVER_ID, { delay: 100 });
  await delay(500);
  await page.click('#pw');
  await delay(300);
  await page.keyboard.type(NAVER_PW, { delay: 100 });
  await delay(500);
  await page.click('#log\\.login');
  await delay(4000);
  const url = page.url();
  console.log(`로그인 후 URL: ${url}`);
  if (url.includes('nidlogin') || url.includes('login')) {
    throw new Error('로그인 실패 - 캡차 또는 인증 필요');
  }
  console.log('✅ 로그인 성공');
}

async function getMainFrame(page) {
  await delay(5000);
  const mainFrame = page.frames().find(f => f.url().includes('PostWriteForm'));
  if (mainFrame) { console.log('✅ mainFrame 찾음'); return mainFrame; }
  throw new Error('mainFrame을 찾을 수 없음');
}

async function waitForEl(frame, selector, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const el = await frame.$(selector);
      if (el) return el;
    } catch(e) {}
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

    await naverLogin(page);

    await page.goto('https://blog.naver.com/giocall?Redirect=Write&', {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await delay(4000);

    const mainFrame = await getMainFrame(page);
    await delay(3000);

    const titleEl = await waitForEl(mainFrame, '.se-documentTitle', 25000);
    await titleEl.click();
    await delay(1000);
    await page.keyboard.type(title, { delay: 50 });
    await delay(500);
    await page.keyboard.press('Enter');
    await delay(1500);
    console.log('✅ 제목 입력 완료');

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      await page.keyboard.type(section.heading, { delay: 30 });
      await page.keyboard.press('Enter');
      await delay(300);
      await page.keyboard.type(section.body, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await delay(500);
      console.log(`✅ 섹션${i+1} 텍스트 완료`);

      if (section.image_url) {
        try {
          const tmpPath = path.join(TMP_DIR, `tmp_img_${i}.png`);
          await downloadImage(section.image_url, tmpPath);

          const imgBtn = await waitForEl(mainFrame, 'button[data-name="image"]', 5000);
          await imgBtn.click();
          await delay(1000);

          let fileInput = null;
          for (let t = 0; t < 10; t++) {
            fileInput = await mainFrame.$('input[type="file"]') ||
                        await page.$('input[type="file"]');
            if (fileInput) break;
            await delay(300);
          }

          if (fileInput) {
            await fileInput.uploadFile(tmpPath);
            await delay(4000);
            await page.keyboard.press('Escape');
            await delay(500);
            console.log(`✅ 섹션${i+1} 이미지 완료`);
          }
        } catch (imgErr) {
          console.error(`이미지 오류 (섹션${i+1}):`, imgErr.message);
        }
      }
    }

    const pub1 = await waitForEl(mainFrame, 'button[data-click-area="tpb.publish"]', 5000);
    await pub1.click();
    console.log('✅ 발행 패널 열기');
    await delay(3000);

    const pub2 = await waitForEl(mainFrame, 'button[data-click-area="tpb*i.publish"]', 5000);
    await pub2.click();
    console.log('✅ 최종 발행 클릭');
    await delay(3000);

    const currentUrl = page.url();
    console.log(`✅ 포스팅 완료: ${title} | ${currentUrl}`);

    await page.close();
    res.json({ success: true, url: currentUrl, title });

  } catch (err) {
    console.error('포스팅 오류:', err.message);
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
});
