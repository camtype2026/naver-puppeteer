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
  const frames = page.frames();
  const mainFrame = frames.find(f => f.url().includes('PostWriteForm'));
  if (mainFrame) {
    console.log(`✅ mainFrame 찾음`);
    return mainFrame;
  }
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

    // ── 1. 로그인 ──
    await naverLogin(page);

    // ── 2. 글쓰기 페이지 ──
    await page.goto('https://blog.naver.com/giocall?Redirect=Write&', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(4000);
    console.log(`글쓰기 URL: ${page.url()}`);

    // ── 3. 작성중인 글 팝업 처리 ──
    try {
      const frames = page.frames();
      for (const frame of frames) {
        const cancelBtn = await frame.$('.se-popup-button-cancel, .btn_cancel');
        if (cancelBtn) {
          await cancelBtn.click();
          console.log('✅ 팝업 취소 클릭');
          await delay(2000);
          break;
        }
      }
    } catch(e) {}

    // ── 4. mainFrame 접근 ──
    const mainFrame = await getMainFrame(page);
    await delay(3000);

    // ── 5. 제목 입력 ──
    const titleEl = await waitForEl(mainFrame, '.se-documentTitle', 25000);
    await titleEl.click();
    await delay(1000);
    await page.keyboard.type(title, { delay: 50 });
    await delay(500);
    await page.keyboard.press('Enter');
    await delay(1500);
    console.log('✅ 제목 입력 완료');

    // ── 6. 섹션별 본문 입력 (텍스트 전용) ──
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      // 소제목 입력
      if (section.heading) {
        await page.keyboard.type(section.heading, { delay: 30 });
        await page.keyboard.press('Enter');
        await delay(300);
      }

      // 본문 입력
      if (section.body) {
        await page.keyboard.type(section.body, { delay: 10 });
        await page.keyboard.press('Enter');
        await delay(500);
      }

      // 이미지 업로드 부분은 테스트를 위해 비활성화 처리함
      /*
      if (section.image_url) {
        try {
          const tmpPath = `/tmp/img_${i}.png`;
          await downloadImage(section.image_url, tmpPath);

          const imgBtn = await waitForEl(mainFrame, 'button[data-name="image"]', 5000);
          await imgBtn.click();
          await delay(2000);

          const fileInput = await page.$('input[type="file"]') ||
                            await mainFrame.$('input[type="file"]');
          if (fileInput) {
            await fileInput.uploadFile(tmpPath);
            await delay(4000);
          }
          console.log(`✅ 섹션${i+1} 이미지 완료`);
        } catch (imgErr) {
          console.error(`이미지 오류 (섹션${i+1}):`, imgErr.message);
        }
      }
      */

      await page.keyboard.press('Enter');
      await delay(500);
    }

    // ── 7. 발행 버튼 클릭 ──
    try {
      // 상단 발행 버튼 찾기
      const pubBtn = await waitForEl(mainFrame, '.se-help-panel-close-button, .se-publish-button', 10000);
      await pubBtn.click();
      console.log('✅ 발행 버튼(1단계) 클릭');
      await delay(2000);
    } catch(e) {
      console.log('발행 버튼 클릭 재시도(evaluate)');
      await mainFrame.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.trim().includes('발행'));
        if (btn) btn.click();
      });
    }

    // ── 8. 최종 발행 확인 클릭 ──
    try {
      // 발행 레이어에서 실제 '발행' 버튼 클릭
      await delay(2000);
      const finalPubBtn = await waitForEl(mainFrame, '.se-popup-button-publish, .btn_confirm', 10000);
      await finalPubBtn.click();
      console.log('✅ 최종 발행 완료 클릭');
      await delay(5000); // 포스팅 완료 후 페이지 전환 대기
    } catch(e) {
      console.error('최종 발행 버튼 클릭 실패:', e.message);
    }

    const currentUrl = page.url();
    console.log(`✅ 프로세스 종료: ${title} | ${currentUrl}`);

    await page.close();
    res.json({ success: true, url: currentUrl, title });

  } catch (err) {
    console.error('포스팅 오류:', err.message);
    if (page) await page.close();
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
