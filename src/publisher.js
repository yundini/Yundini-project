import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LOG_DIR } from './paths.js';
import { withNaverBrowser } from './browser.js';
import { toSegments } from './format.js';
import { mediaPath } from './imageEdit.js';

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

// 사람이 클릭하듯 요소의 화면 위치를 직접 클릭한다.
// 에디터의 선택 표시 레이어(se-selection)가 글자 위를 덮고 있어도 클릭이 전달된다.
// where: 'center' | 'end'(마지막 줄 끝) | 'bottom'(아래쪽 가장자리) | 'below'(요소 바로 아래 빈 곳)
async function clickAt(page, locator, where = 'center') {
  // 세로로 긴 사진도 클릭할 부분이 화면 안에 들어오도록 스크롤한다
  await locator.evaluate((el, w) => el.scrollIntoView({ block: w === 'center' ? 'center' : 'end' }), where).catch(() => {});
  await pause(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error('에디터에서 클릭할 위치를 찾지 못했어요.');
  const vp = page.viewportSize() || { width: 1200, height: 860 };
  let x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  if (where === 'end') [x, y] = [box.x + box.width - 3, box.y + box.height - 6];
  if (where === 'bottom') y = box.y + box.height - 15;
  if (where === 'below') y = box.y + box.height + 25;
  const clamp = (v, max) => Math.min(Math.max(v, 5), max - 5);
  await page.mouse.click(clamp(x, vp.width), clamp(y, vp.height));
}

const lastComponent = (frame) => frame.locator('.se-components-wrap .se-component').last();
const isTextComponent = (loc) => loc.evaluate((el) => el.classList.contains('se-text')).catch(() => false);

// 사진/동영상 다음 줄로 커서를 옮기는 방법들. 본문이 실제로 들어갈 때까지 차례로 시도한다.
const CURSOR_STRATEGIES = [
  async (page, frame) => {
    const last = lastComponent(frame);
    if (await isTextComponent(last)) {
      await clickAt(page, last.locator('.se-text-paragraph').last(), 'end');
      await page.keyboard.press('End');
    } else {
      await clickAt(page, last, 'bottom'); // 사진 선택
      await page.keyboard.press('Enter'); // 사진 아래에 새 줄
    }
  },
  async (page, frame) => {
    await clickAt(page, lastComponent(frame), 'bottom');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
  },
  async (page, frame) => {
    await clickAt(page, lastComponent(frame), 'below'); // 사진 아래 빈 곳 클릭
  },
];

// 본문을 입력한다. 에디터가 실제 입력으로 인식하도록 진짜 키 입력만 쓴다.
// 1) 실제 클립보드에 서식 HTML을 넣고 command+V  2) 안 되면 키보드로 한 줄씩 타이핑
// 성공하면 true, 글자가 전혀 들어가지 않았으면 false.
async function pasteSegment(page, frame, segment, log) {
  const before = await contentLength(frame);

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
    await pause(1200);
    if ((await contentLength(frame)) > before) return true;
    log('붙여넣기가 적용되지 않아 키보드 입력으로 바꿔요.');
  } catch (e) {
    log(`클립보드를 쓸 수 없어 키보드 입력으로 바꿔요. (${e.message.split('\n')[0]})`);
  }

  const lines = segment.plain.replace(/\n+$/, '').split('\n');
  for (const [i, line] of lines.entries()) {
    if (line) await page.keyboard.type(line, { delay: 5 });
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Enter');
  await pause(500);
  return (await contentLength(frame)) > before;
}

// 본문 한 덩어리를 넣는다. 사진/동영상 바로 뒤라면 커서 옮기는 방법을 바꿔 가며 다시 시도한다.
async function insertTextSegment(page, frame, segment, afterMedia, log) {
  if (!afterMedia) {
    if (await pasteSegment(page, frame, segment, log)) return;
    throw new Error('본문 글자를 에디터에 입력하지 못했어요.');
  }
  for (const [n, moveCursor] of CURSOR_STRATEGIES.entries()) {
    if (n > 0) log(`커서 위치를 다른 방법으로 다시 잡아요. (${n + 1}/${CURSOR_STRATEGIES.length})`);
    await moveCursor(page, frame);
    await pause(400);
    if (await pasteSegment(page, frame, segment, log)) return;
  }
  throw new Error('사진 아래로 커서를 옮기지 못해 본문을 입력하지 못했어요.');
}

// 업로드 전에 사진을 적당한 크기로 줄인다 (Mac 기본 도구 sips 사용).
// 네이버도 어차피 줄여서 저장하므로 화질 차이는 거의 없고, 느린 Mac에서도 업로드가 빨라진다.
const MAX_SIDE = 2000;
async function shrinkImage(media, log) {
  const src = mediaPath(media);
  if (process.platform !== 'darwin') return src;
  const out = path.join(LOG_DIR, `upload-${media.id}-${Date.now()}.jpg`);
  try {
    await promisify(execFile)('sips', ['-Z', String(MAX_SIDE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', src, '--out', out]);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  } catch (e) {
    log(`사진 크기 줄이기를 건너뛰어요. (${e.message.split('\n')[0]})`);
  }
  return src;
}

// 사진이 에디터에 보인 뒤에도 네이버는 뒤에서 업로드를 계속한다.
// 업로드 중인 사진은 아직 내 컴퓨터 주소(blob:)로 보이므로, 서버 주소로 바뀔 때까지 기다린다.
// 화면 밖 사진은 네이버가 임시 그림(data:)으로 바꿔 두므로 업로드 중으로 보지 않는다.
// onlyNew: markExisting() 이후 새로 생긴 사진만 확인한다.
const markExisting = (frame) =>
  frame.evaluate(() => document.querySelectorAll('.se-component').forEach((el) => (el.dataset.bpSeen = '1'))).catch(() => {});

async function waitUploadsDone(frame, log, { onlyNew = false, timeout = 90 * 1000 } = {}) {
  const until = Date.now() + timeout;
  let told = false;
  let calm = 0;
  while (Date.now() < until) {
    const busy = await frame
      .evaluate((onlyNew) => {
        const scope = onlyNew ? '.se-component:not([data-bp-seen])' : '.se-component';
        const pending = [...document.querySelectorAll(`${scope} img`)].some((img) =>
          (img.getAttribute('src') || '').startsWith('blob:'),
        );
        const uploading = /업로드\s*중/.test(document.body.innerText);
        return pending || uploading;
      }, onlyNew)
      .catch(() => false);
    if (!busy) {
      if (++calm >= 2) return; // 두 번 연속 조용하면 끝난 것으로 본다
    } else {
      calm = 0;
      if (!told) log('네이버에 사진이 올라가는 중이라 끝날 때까지 기다려요...');
      told = true;
    }
    await pause(1000);
  }
  log('사진 업로드 완료를 확인하지 못했지만 계속 진행해요.');
}

async function uploadImage(page, frame, media, log) {
  const selector = '.se-component.se-image';
  const before = await componentCount(frame, selector);
  const file = await shrinkImage(media, log);
  await markExisting(frame);
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      frame.locator('button.se-image-toolbar-button, button[data-name="image"]').first().click(),
    ]);
    await chooser.setFiles(file);
    await waitForCount(frame, selector, before + 1, 120000);
    await waitUploadsDone(frame, log, { onlyNew: true });
    await pause(800);
  } finally {
    if (file !== mediaPath(media)) fs.rmSync(file, { force: true });
  }
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
  await waitUploadsDone(frame, () => {});
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
  const segments = toSegments(article.blocks, post.media, article.tags);

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
      await clickAt(page, frame.locator('.se-documentTitle .se-text-paragraph, .se-title-text').first());
      await page.keyboard.type(article.title, { delay: 25 });

      await clickAt(page, frame.locator('.se-component.se-text .se-text-paragraph').first());
      for (const [i, seg] of segments.entries()) {
        // 글을 붙여넣은 뒤에는 커서가 이미 끝에 있고, 사진은 선택된 사진 다음에 들어간다.
        // 사진/동영상 바로 뒤에 글을 넣을 때만 커서를 옮긴다.
        const afterMedia = i > 0 && segments[i - 1].kind !== 'text';
        if (seg.kind === 'text') {
          log(`본문 입력 중... (${i + 1}/${segments.length})`);
          await insertTextSegment(page, frame, seg, afterMedia, log);
        } else if (seg.kind === 'image') {
          log(`사진 업로드 중: ${seg.media.originalName}`);
          await uploadImage(page, frame, seg.media, log);
        } else if (seg.kind === 'video') {
          log(`동영상 업로드 중: ${seg.media.originalName} (길면 몇 분 걸려요)`);
          await uploadVideo(page, frame, seg.media, article.title);
        }
      }
      await pause(1000);
      const shot = `publish-result-${Date.now()}.png`;
      await page.screenshot({ path: path.join(LOG_DIR, shot) }).catch(() => {});
      log(`입력 결과 화면: /api/logs/${shot}`);

      await waitUploadsDone(frame, log);

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
      const reason = err.message.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0];
      err.message = `${reason} (오류 화면: /api/logs/${shot})`;
      throw err;
    }
  });
}
