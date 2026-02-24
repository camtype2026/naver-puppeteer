/**
 * Naver Blog Auto Posting Server
 * POST /naver-post  — 네이버 블로그 자동 포스팅
 * GET  /health      — 상태 확인
 */

const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;

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

// 네이버 쿠키
const NAVER_COOKIES = [
  { name: 'BUC',       value: 'LNUIndPgi0_JUClhIo3VDIakxtK6uvCPh8IgpITxi00=', domain: '.naver.com' },
  { name: 'NAC',       value: 'x7mrB4AvRXY0',   domain: '.naver.com' },
  { name: 'NACT',      value: '1',               domain: '.naver.com' },
  { name: 'NID_AUT',   value: 'o4l3bRmp5WMSER3fjPmRW4+3TMkocT6lsm/CCJPlTaGQU9qIfpjJRE4nc0p1qn1g', domain: '.naver.com' },
  { name: 'nid_inf',   value: '1202421075',       domain: '.naver.com' },
  { name: 'NID_SES',   value: 'AAABiyjVeNCJf72xTwgMoyuvs3huCSaxEZV9P4UyAmFzzdd3NGkQ7otc3A2k/CH8YnDiiyLQQj1RQZyPVr8sZw33+PW677l0XHbaezsNXEMjNbiuMbOdHMZfFPXZjgv+YaN07VRtZVUSjiSjG+JNe/YDlBg4yUAT8F9KR+dFq4+Oqf83A29JEHjt/iApx5N5poqg2ljbRnuuJ6zlvcymD78aQv/DKdYitSweLp/ooYVc3/B3DyaOsm2VEju9HZbDflPZtsrGj7T7Yckn0tPTXtg5Vu7y/+W7Z+gzsjYdV+UF57VlGKm8q7PkkCSXEsNDWWeXGZy+9KNoNUrtKxR3qTAXI9wkfIGVziF9SmeT12+Vkz70jo7NnO4X1dtNBl9JvKTrDnFD4Y9cyAfvGjD10Cho0Lo83z704MKfBc5mjCWYpnDpp6be+iXPwiM2On+CnRymr7tnN9T/hy7Y2czbQcwqQiaAVAtcfOhIlrnKwoiA4cURNlZ0vmwwbU8aZhS1vJGYAUpaXMnFNp2MbF4akpiI4gw=', domain: '.naver.com' },
  { name: 'NNB',       value: 'Q5IWSOHM25LWS',   domain: '.naver.com' },
  { name: 'JSESSIONID',value: 'FCB07263F9F8FCD5D39CE1A5B8C68BCE.jvm1', domain: 'section.blog.naver.com' },
];

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadImage(url, tmpPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
}

app.post('/naver-post', async (req, res) => {
  const { title, sections } = req.body;
  // sections: [{ heading, body, image_url }, ...]

  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport({ width: 1280, height: 900 });

    // ── 1. 쿠키 주입 ──
    await page.goto('https://naver.com', { waitUntil: 'domcontentloaded' });
    for (const cookie of NAVER_COOKIES) {
      await page.setCookie(cookie).catch(() => {});
    }

    // ── 2. 블로그 글쓰기 이동 ──
    await page.goto('https://blog.naver.com/BlogPost.nhn?Redirect=Write&', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(4000);

    // ── 3. 제목 입력 ──
    await page.waitForSelector('.se-title-input', { timeout: 15000 });
    await page.click('.se-title-input');
    await page.keyboard.type(title, { delay: 50 });
    await delay(1000);

    // ── 4. 섹션별 본문 + 이미지 입력 ──
    await page.click('.se-main-container');
    await delay(500);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      // 소제목 입력
      await page.keyboard.type(section.heading, { delay: 30 });
      await page.keyboard.press('Enter');
      await delay(300);

      // 본문 입력
      await page.keyboard.type(section.body, { delay: 10 });
      await page.keyboard.press('Enter');
      await delay(500);

      // 이미지 업로드
      if (section.image_url) {
        try {
          const tmpPath = `/tmp/img_${i}.png`;
          await downloadImage(section.image_url, tmpPath);

          // 이미지 버튼 클릭
          await page.click('button[data-name="image"]');
          await delay(2000);

          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(tmpPath);
            await delay(4000);
          }
        } catch (imgErr) {
          console.error(`이미지 업로드 오류 (섹션${i+1}):`, imgErr.message);
        }
      }

      await page.keyboard.press('Enter');
      await delay(500);
    }

    // ── 5. 발행 클릭 ──
    await page.click('.se-publish-button, .publish-btn, button[aria-label="발행"]');
    await delay(3000);

    // 발행 확인 팝업
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
    try {
      await page.screenshot({ path: '/tmp/error.png' });
    } catch(e) {}
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
  console.log('🚀 Naver Blog Puppeteer Server :3000');
  console.log('   POST /naver-post');
  console.log('   GET  /health');
});
