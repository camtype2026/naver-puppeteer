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

const NAVER_COOKIES = [
  { name: 'BUC',        value: 'YPPYOE3BR8Zs0cB91vnPMYX5Dz8pHDvHzc7PnxjW44o=', domain: '.naver.com', path: '/' },
  { name: 'NAC',        value: 'x7mrB4AvRXY0',    domain: '.naver.com', path: '/' },
  { name: 'NACT',       value: '1',                domain: '.naver.com', path: '/' },
  { name: 'NID_AUT',    value: '5PSgzS9XniTkRmeRknTCTAGgw4/fWIiFHPl0zoHITlIHX6/Lo8W9gfu9OxKeAutY', domain: '.naver.com', path: '/' },
  { name: 'nid_inf',    value: '1202548228',        domain: '.naver.com', path: '/' },
  { name: 'NID_SES',    value: 'AAABjCYdk7lA0ZH6zWzKm/hqWj1eFLKJD9Sy9fIIhVmYsv/2jzXlh9IY233+b4vks4/RdX+uYiz+1u2g7U/UxfUjLsvr01fAc4vyyH3qKfmGOfDoGvXRgPAw8UVFCAWmrSBq/YpQKnOggn7/Yue4xnufZ35PqU2ynsEszerWLlc9adW3zuwW1cWdQbV70CJ4mKFf9eHkvJ3jqUC9ErAft6RiC67UZp4YEET5wtAtHGkm0YEQPBNCd2/bDNVdqY6vY4yfA9JVZQpXcAp+LGlND2WPgdvOD/aO0st4OfcQXwjiOzVaV8IoZsnO9mDbQPVsuHzsEk6Wi3bMkcLU3Xxja0NI5sXhINHZqJ+keDgXXSE0b888ixGbyWX9eQ/OO12rwNqoorDy65JY9dp3zFPpZQx09ib/uuFmAfxGVv7rr7v7dw7jfeDUhoxCHAutEBsUSj1UYkUWvFLxyeaPza0pxKzZLPaI3OIcjDJLnKuHOFuNxaA2v9VYQ1kJepv+LzyP9NH5AFFits9knowC0rCKrOnj0EI=', domain: '.naver.com', path: '/' },
  { name: 'NNB',        value: 'Q5IWSOHM25LWS',    domain: '.naver.com', path: '/' },
  { name: 'JSESSIONID', value: '54997D116FA58F7ADDA6979AF14CA405.jvm1', domain: 'section.blog.naver.com', path: '/' },
];

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadImage(url, tmpPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
}

// iframe 또는 메인 페이지에서 셀렉터 찾기
async function findFrame(page, selector, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // 메인 페이지에서 먼저 시도
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`셀렉터 발견 (메인): ${selector}`);
        return { frame: page, el };
      }
    } catch(e) {}

    // 모든 iframe에서 시도
    for (const frame of page.frames()) {
      try {
        const el = await frame.$(selector);
        if (el) {
          console.log(`셀렉터 발견 (iframe: ${frame.url()}): ${selector}`);
          return { frame, el };
        }
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

    // ── 1. 쿠키 주입 ──
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1000);
    for (const cookie of NAVER_COOKIES) {
      try { await page.setCookie(cookie); } catch(e) {}
    }
    await delay(1000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(2000);
    console.log('로그인 상태: ✅ 성공');

    // ── 2. 글쓰기 페이지 이동 ──
    await page.goto('https://blog.naver.com/BlogPost.nhn?Redirect=Write&', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(5000);
    console.log(`현재 URL: ${page.url()}`);

    // 모든 frame URL 로그
    page.frames().forEach((f, i) => console.log(`frame[${i}]: ${f.url()}`));

    // ── 3. 제목 입력 (iframe 포함 탐색) ──
    const { frame: titleFrame } = await findFrame(page, '.se-title-input', 25000);
    await titleFrame.click('.se-title-input');
    await delay(500);
    await titleFrame.type('.se-title-input', title, { delay: 50 });
    await delay(1000);

    // ── 4. 섹션별 본문 + 이미지 ──
    const { frame: bodyFrame } = await findFrame(page, '.se-main-container', 10000);
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

      // 이미지 업로드
      if (section.image_url) {
        try {
          const tmpPath = `/tmp/img_${i}.png`;
          await downloadImage(section.image_url, tmpPath);

          // 이미지 버튼 찾기
          const { frame: imgFrame } = await findFrame(page, 'button[data-name="image"]', 5000);
          await imgFrame.click('button[data-name="image"]');
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

      await bodyFrame.keyboard.press('Enter');
      await delay(500);
    }

    // ── 5. 발행 ──
    try {
      const { frame: pubFrame } = await findFrame(page, '.se-publish-button', 5000);
      await pubFrame.click('.se-publish-button');
      await delay(3000);
    } catch(e) {
      console.log('발행 버튼 못 찾음, 다른 셀렉터 시도');
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.includes('발행')) { btn.click(); break; }
        }
      });
      await delay(3000);
    }

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
