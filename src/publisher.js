import path from 'node:path';
import { LOG_DIR } from './paths.js';
import { withNaverBrowser } from './browser.js';
import { toSegments } from './format.js';

const WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';
const PASTE_KEY = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// 스마트에디터는 mainFrame iframe 안에 있거나(구 주소) 페이지 자체에 있다(새 주소).
async function findEditorFrame(page, timeout = 40000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const frame of page.frames()) {
      if (await frame.$('.se-content').catch(() => null)) return frame;
    }
    await pause(500);
  }
  throw new Error('네이버 블로그 에디터를 찾지 못했어요. 로그인 상태를 확인해 주세요.');
}

async function clickIfVisible(frame, selector) {
  const el = frame.locator(selector).first();
  if (await el.isVisible().catch(() => false)) {
    await el.click().catch(() => {});
    await pause(500);
    return true;
  }
  return false;
}

async function dismissPopups(frame) {
  // "작성 중인 글이 있습니다" → 취소(새로 쓰기), 도움말 패널 닫기
  await clickIfVisible(frame, '.se-popup-button-cancel');
  await clickIfVisible(frame, '.se-help-panel-close-button');
}

const contentLength = (frame) =>
  frame.$eval('.se-content', (el) => el.innerText.replace(/\s/g, '').length).catch(() => 0);

const componentCount = (frame, selector) => frame.locator(selector).count();

async function waitForCount(frame, selector, min, timeout) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if ((await componentCount(frame, selector)) >= min) return;
    await pause(1000);
  }
  throw new Error('업로드가 끝나지 않았어요.');
}

// 커서를 본문 맨 끝으로 옮긴다.
async function moveCursorToEnd(page, frame) {
  const last = frame.locator('.se-components-wrap .se-component').last();
  const isText = await last.evaluate((el) => el.classList.contains('se-text')).catch(() => false);
  if (isText) {
    await last.locator('.se-text-paragraph').last().click();
    await page.keyboard.press('End');
  } else {
    // 사진/동영상 뒤에 새 문단을 만든다
    await last.click();
    await page.keyboard.press('Enter');
  }
  await pause(300);
}

// 서식 있는 HTML을 붙여넣는다. 1) 가상 붙여넣기 이벤트 2) 실제 클립보드 3) 일반 텍스트 순으로 시도.
async function pasteSegment(page, frame, segment, log) {
  const before = await contentLength(frame);

  await frame.evaluate(({ html, plain }) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', plain);
    const target = document.activeElement || document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, segment);
  await pause(800);
  if ((await contentLength(frame)) > before) return;

  log('가상 붙여넣기가 적용되지 않아 클립보드 붙여넣기로 다시 시도해요.');
  try {
    await frame.evaluate(async ({ html, plain }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
    }, segment);
    await page.keyboard.press(PASTE_KEY);
    await pause(800);
    if ((await contentLength(frame)) > before) return;
  } catch (e) {
    log(`클립보드 붙여넣기 실패: ${e.message}`);
  }

  log('서식 없이 텍스트로 입력해요.');
  await page.keyboard.insertText(segment.plain);
}

async function uploadImage(page, frame, media) {
  const selector = '.se-component.se-image';
  const before = await componentCount(frame, selector);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    frame.locator('button.se-image-toolbar-button, button[data-name="image"]').first().click(),
  ]);
  await chooser.setFiles(media.path);
  await waitForCount(frame, selector, before + 1, 90000);
  await pause(1000);
}

async function uploadVideo(page, frame, media, title) {
  const selector = '.se-component.se-video';
  const before = await componentCount(frame, selector);
  await frame.locator('button.se-video-toolbar-button, button[data-name="video"]').first().click();
  await pause(1500);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    frame.locator('.nvu_btn_append, button:has-text("동영상 추가")').first().click(),
  ]);
  await chooser.setFiles(media.path);

  const titleInput = frame.locator('.nvu_inp_title, input[placeholder*="제목"]').first();
  if (await titleInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await titleInput.fill((media.note || title).slice(0, 60));
  }
  // 업로드/인코딩이 끝나야 "완료" 버튼이 활성화된다
  const done = frame.locator('.nvu_btn_submit, button:has-text("완료")').last();
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    if (await done.isEnabled().catch(() => false)) break;
    await pause(2000);
  }
  await done.click();
  await waitForCount(frame, selector, before + 1, 60000);
  await pause(1000);
}

async function addTags(page, frame, tags, log) {
  const input = frame.locator('#tag-input, input[placeholder*="태그"]').first();
  if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
    log('태그 입력칸을 찾지 못해 태그는 건너뛰어요.');
    return;
  }
  for (const tag of tags) {
    await input.click();
    await page.keyboard.type(tag, { delay: 30 });
    await page.keyboard.press('Enter');
    await pause(200);
  }
}

async function waitForPostUrl(page, frame, timeout = 60000) {
  const pattern = /blog\.naver\.com\/(?:[A-Za-z0-9_-]+\/\d{6,}|PostView\.naver\?[^ ]*logNo=\d+)/;
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const url of [page.url(), ...page.frames().map((f) => f.url())]) {
      if (pattern.test(url)) return url;
    }
    await pause(1000);
  }
  return null;
}

// mode: 'publish' = 바로 발행, 'draft' = 임시저장 (네이버 앱에서 확인 후 직접 발행)
export async function publishToNaver(post, { mode = 'publish' } = {}, log) {
  const article = post.article;
  const segments = toSegments(article.blocks, post.media);

  return withNaverBrowser('발행', async (ctx) => {
    const page = await ctx.newPage();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://blog.naver.com' }).catch(() => {});
    try {
      log('네이버 블로그 글쓰기 화면을 여는 중...');
      await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded' });
      if (/nid\.naver\.com/.test(page.url())) throw new Error('네이버 로그인이 필요해요. 대시보드에서 먼저 로그인해 주세요.');
      const frame = await findEditorFrame(page);
      await pause(1500);
      await dismissPopups(frame);

      log('제목 입력 중...');
      await frame.locator('.se-documentTitle .se-text-paragraph, .se-title-text').first().click();
      await page.keyboard.type(article.title, { delay: 25 });

      await frame.locator('.se-component.se-text .se-text-paragraph').first().click();
      for (const [i, seg] of segments.entries()) {
        if (i > 0) await moveCursorToEnd(page, frame);
        if (seg.kind === 'text') {
          log(`본문 입력 중... (${i + 1}/${segments.length})`);
          await pasteSegment(page, frame, seg, log);
        } else if (seg.kind === 'image') {
          log(`사진 업로드 중: ${seg.media.originalName}`);
          await uploadImage(page, frame, seg.media);
        } else if (seg.kind === 'video') {
          log(`동영상 업로드 중: ${seg.media.originalName} (길면 몇 분 걸려요)`);
          await uploadVideo(page, frame, seg.media, article.title);
        }
      }
      await pause(1000);

      if (mode === 'draft') {
        log('임시저장 중...');
        await frame.locator('button[class*="save_btn"], button:has-text("저장")').first().click();
        await pause(3000);
        await page.close();
        return { mode, url: null };
      }

      log('발행 설정 여는 중...');
      await frame.locator('button[class*="publish_btn"]').or(frame.getByRole('button', { name: '발행', exact: true })).first().click();
      await pause(1500);
      await addTags(page, frame, article.tags || [], log);

      log('발행 버튼 클릭!');
      const confirm = frame.locator('button[class*="confirm_btn"]').first();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      else await frame.locator('[class*="layer_publish"] button:has-text("발행")').last().click();

      const url = await waitForPostUrl(page, frame);
      log(url ? `발행 완료: ${url}` : '발행 버튼은 눌렀지만 글 주소를 확인하지 못했어요. 블로그에서 확인해 주세요.');
      await pause(1500);
      await page.close();
      return { mode, url };
    } catch (err) {
      const shot = `publish-error-${Date.now()}.png`;
      await page.screenshot({ path: path.join(LOG_DIR, shot), fullPage: false }).catch(() => {});
      await page.close().catch(() => {});
      err.message += ` (오류 화면: /api/logs/${shot})`;
      throw err;
    }
  });
}
