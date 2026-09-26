import fs from 'node:fs';
import path from 'node:path';
import { playwright, launchExtras } from './setup.js';
import { UPLOAD_DIR } from './paths.js';

// 사진 편집(세로 → 가로 자르기, 누운 사진 바로 세우기)은 Mac에 있는 Chrome의 캔버스로 한다.
// 원본은 그대로 두고 편집본을 따로 저장하므로 언제든 원본으로 되돌릴 수 있다.

const LANDSCAPE_RATIO = 3 / 4; // 가로 4 : 세로 3
const MAX_WIDTH = 2400;

export const mediaPath = (m) => m.editedPath || m.path;
export const mediaFile = (m) => m.editedFile || m.file;

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic' };

// 브라우저 안에서 실행: 사진을 돌리고 가로로 잘라 JPEG(base64)로 돌려준다.
async function renderInPage({ dataUrl, rotate, landscape, focusY, ratio, maxWidth }) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); // 휴대폰 사진의 회전 정보 반영
  const turned = rotate === 90 || rotate === 270;
  let w = turned ? bmp.height : bmp.width;
  let h = turned ? bmp.width : bmp.height;

  const upright = document.createElement('canvas');
  upright.width = w;
  upright.height = h;
  const u = upright.getContext('2d');
  u.translate(w / 2, h / 2);
  u.rotate((rotate * Math.PI) / 180);
  u.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);

  let sy = 0;
  let sh = h;
  let cropped = false;
  if (landscape && h > w * ratio) {
    sh = Math.round(w * ratio);
    sy = Math.round(Math.min(Math.max(focusY * h - sh / 2, 0), h - sh));
    cropped = true;
  }
  const scale = Math.min(1, maxWidth / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(sh * scale);
  out.getContext('2d').drawImage(upright, 0, sy, w, sh, 0, 0, out.width, out.height);
  const jpeg = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9));
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), cropped, width: out.width, height: out.height, origWidth: w, origHeight: h };
}

function removeEdited(m) {
  if (m.editedPath) fs.rmSync(m.editedPath, { force: true });
  delete m.editedPath;
  delete m.editedFile;
  delete m.edit;
}

// edits: { [mediaId]: { landscape: boolean, focusY: 0~1, rotate: 0|90|180|270 } }
// 바뀐 media 배열을 돌려준다. 편집할 게 없는 사진은 원본을 쓴다.
export async function applyImageEdits(post, edits, log = () => {}) {
  const media = post.media.map((m) => ({ ...m }));
  const targets = media.filter((m) => m.kind === 'image' && edits[m.id]);
  if (!targets.length) return media;

  const { chromium } = await playwright();
  const browser = await chromium.launch({ headless: true, ...launchExtras() });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const m of targets) {
      const e = edits[m.id];
      const rotate = [90, 180, 270].includes(Number(e.rotate)) ? Number(e.rotate) : 0;
      const landscape = !!e.landscape;
      removeEdited(m);
      if (!rotate && !landscape) continue;
      try {
        const mime = MIME[path.extname(m.path).toLowerCase()] || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${fs.readFileSync(m.path).toString('base64')}`;
        const focusY = Math.min(Math.max(Number(e.focusY ?? 0.5), 0), 1);
        const r = await page.evaluate(renderInPage, { dataUrl, rotate, landscape, focusY, ratio: LANDSCAPE_RATIO, maxWidth: MAX_WIDTH });
        if (!r.cropped && !rotate) continue; // 이미 가로 사진이면 원본 그대로
        const file = `${m.id}-edit-${Date.now()}.jpg`;
        const dest = path.join(UPLOAD_DIR, post.id, file);
        fs.writeFileSync(dest, Buffer.from(r.base64, 'base64'));
        m.editedPath = dest;
        m.editedFile = file;
        m.edit = { landscape: r.cropped, focusY, rotate };
        log(`사진 편집: ${m.note || m.originalName} → ${[rotate && '바로 세우기', r.cropped && '가로로 자르기'].filter(Boolean).join(' + ')}`);
      } catch (err) {
        log(`사진 편집을 건너뛰어요 (${m.originalName}): ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  return media;
}

// AI의 사진 검토 결과(mediaReview)를 편집 지시로 바꾼다.
export function editsFromReview(review = []) {
  const edits = {};
  for (const r of review) {
    if (!r || !r.id) continue;
    edits[r.id] = { landscape: r.orientation === 'landscape', focusY: r.focusY, rotate: r.rotate };
  }
  return edits;
}
