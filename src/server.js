import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { ROOT, DATA_DIR, UPLOAD_DIR, LOG_DIR } from './paths.js';
import { ensurePlaywright, setupState } from './setup.js';
import { runClaude } from './claude.js';
import * as store from './store.js';
import { startJob, getJob, runningJobFor, anyJobRunning } from './jobs.js';
import { checkUpdate, applyUpdate, RESTART_CODE } from './update.js';
import * as browser from './browser.js';
import { collectSources } from './research.js';
import { suggestTopics, writeArticle } from './writer.js';
import { publishToNaver } from './publisher.js';
import { applyImageEdits, editsFromReview } from './imageEdit.js';

const PORT = Number(process.env.PORT) || 3000;

// ---- 접속 코드: 같은 와이파이의 다른 사람이 대시보드를 쓰지 못하게 막는다 ----
const CODE_FILE = path.join(DATA_DIR, 'access-code.txt');
const ACCESS_CODE =
  process.env.DASHBOARD_CODE ||
  (fs.existsSync(CODE_FILE)
    ? fs.readFileSync(CODE_FILE, 'utf8').trim()
    : (() => {
        const code = String(crypto.randomInt(100000, 1000000));
        fs.writeFileSync(CODE_FILE, code);
        return code;
      })());

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const readCookie = (req, name) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

app.post('/api/auth', (req, res) => {
  if (String(req.body?.code || '') !== ACCESS_CODE) return res.status(401).json({ error: '접속 코드가 맞지 않아요.' });
  res.setHeader('Set-Cookie', `bp_auth=${ACCESS_CODE}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  res.json({ ok: true });
});

app.use(['/api', '/media'], (req, res, next) => {
  if (readCookie(req, 'bp_auth') === ACCESS_CODE) return next();
  res.status(401).json({ error: 'auth' });
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(400).json({ error: err.message }));

// ---- 상태 ----
app.get('/api/status', wrap(async (req, res) => {
  res.json({ setup: setupState, naver: await browser.loginStatus() });
}));

app.post('/api/setup/retry', wrap(async (req, res) => {
  if (setupState.status !== 'ready') ensurePlaywright();
  res.json({ setup: setupState });
}));

// ---- 업데이트 ----
let updating = false;

app.get('/api/update/check', wrap(async (req, res) => res.json(await checkUpdate())));

app.post('/api/update', wrap(async (req, res) => {
  if (updating) throw new Error('이미 업데이트 중이에요.');
  if (anyJobRunning()) throw new Error('진행 중인 작업이 끝난 뒤에 업데이트해 주세요.');
  updating = true;
  try {
    const latest = await applyUpdate((m) => console.log(`[update] ${m}`));
    res.json({ ok: true, latest });
    // 응답을 보낸 뒤 종료하면 start.command가 새 코드로 다시 실행한다
    setTimeout(async () => {
      await browser.closeNaverContext();
      process.exit(RESTART_CODE);
    }, 500);
  } catch (err) {
    updating = false;
    throw err;
  }
}));

app.post('/api/claude/check', wrap(async (req, res) => {
  const reply = await runClaude('연결 확인이야. "연결 완료" 라고만 답해.');
  res.json({ ok: true, reply: reply.trim() });
}));

// ---- 네이버 로그인 ----
app.post('/api/login/check', wrap(async (req, res) => res.json(await browser.checkLogin())));
app.post('/api/login/start', wrap(async (req, res) => res.json(await browser.startLogin())));
app.get('/api/login/screen', wrap(async (req, res) => {
  res.type('image/jpeg').set('Cache-Control', 'no-store').send(await browser.loginScreenshot());
}));
app.post('/api/login/click', wrap(async (req, res) => {
  await browser.loginClick(Number(req.body.x), Number(req.body.y));
  res.json({ ok: true });
}));
app.post('/api/login/type', wrap(async (req, res) => {
  await browser.loginType(String(req.body.text || ''));
  res.json({ ok: true });
}));
app.post('/api/login/key', wrap(async (req, res) => {
  await browser.loginKey(String(req.body.key));
  res.json({ ok: true });
}));
app.post('/api/login/finish', wrap(async (req, res) => res.json(await browser.finishLogin())));
app.post('/api/login/logout', wrap(async (req, res) => res.json(await browser.logout())));

// ---- 사진/동영상 업로드 ----
const upload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 60 }, // 파일당 최대 2GB, 한 번에 60개
});

function attachFiles(post, files, notes) {
  const dir = path.join(UPLOAD_DIR, post.id);
  fs.mkdirSync(dir, { recursive: true });
  const media = [...post.media];
  let next = media.reduce((n, m) => Math.max(n, Number(m.id.slice(1))), 0) + 1;
  files.forEach((f, i) => {
    const kind = f.mimetype.startsWith('video/') ? 'video' : f.mimetype.startsWith('image/') ? 'image' : null;
    if (!kind) {
      fs.rmSync(f.path, { force: true });
      return;
    }
    const id = `m${next++}`;
    const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8'); // multer는 파일명을 latin1로 읽는다
    const ext = path.extname(originalName).toLowerCase() || (kind === 'video' ? '.mp4' : '.jpg');
    const dest = path.join(dir, id + ext);
    fs.renameSync(f.path, dest);
    media.push({ id, kind, path: dest, file: id + ext, originalName, note: notes[i] || '' });
  });
  return media;
}

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// ---- 글 ----
app.get('/api/posts', (req, res) => res.json(store.listPosts()));

app.post('/api/posts', upload.array('files'), wrap(async (req, res) => {
  const interest = String(req.body.interest || '').trim();
  if (!interest) throw new Error('관심분야를 입력해 주세요.');
  const post = store.createPost({ interest, memo: String(req.body.memo || '').trim() });
  const media = attachFiles(post, req.files || [], asArray(req.body.notes));
  res.json(store.updatePost(post.id, { media }));
}));

function requirePost(id) {
  const post = store.getPost(id);
  if (!post) throw new Error('글을 찾을 수 없어요.');
  return post;
}

app.get('/api/posts/:id', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  const job = runningJobFor(post.id);
  res.json({ ...post, runningJobId: job?.id || null });
}));

app.patch('/api/posts/:id', wrap(async (req, res) => {
  requirePost(req.params.id);
  const patch = {};
  for (const key of ['memo', 'interest', 'article']) if (key in req.body) patch[key] = req.body[key];
  res.json(store.updatePost(req.params.id, patch));
}));

app.delete('/api/posts/:id', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  if (runningJobFor(post.id)) throw new Error('작업이 진행 중이라 지울 수 없어요.');
  store.deletePost(post.id);
  fs.rmSync(path.join(UPLOAD_DIR, post.id), { recursive: true, force: true });
  res.json({ ok: true });
}));

app.post('/api/posts/:id/media', upload.array('files'), wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  res.json(store.updatePost(post.id, { media: attachFiles(post, req.files || [], asArray(req.body.notes)) }));
}));

app.delete('/api/posts/:id/media/:mediaId', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  const target = post.media.find((m) => m.id === req.params.mediaId);
  if (target) fs.rmSync(target.path, { force: true });
  if (target?.editedPath) fs.rmSync(target.editedPath, { force: true });
  const patch = { media: post.media.filter((m) => m.id !== req.params.mediaId) };
  if (post.article) patch.article = { ...post.article, blocks: post.article.blocks.filter((b) => b.mediaId !== req.params.mediaId) };
  res.json(store.updatePost(post.id, patch));
}));

// 사진 하나를 원본으로 되돌리거나, 가로로 자르거나, 돌린다.
app.post('/api/posts/:id/media/:mediaId/edit', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  const m = post.media.find((x) => x.id === req.params.mediaId);
  if (!m || m.kind !== 'image') throw new Error('사진을 찾을 수 없어요.');
  if (runningJobFor(post.id)) throw new Error('작업이 진행 중이에요. 끝난 뒤에 다시 시도해 주세요.');
  const { landscape = false, focusY = m.edit?.focusY ?? 0.5, rotate = 0 } = req.body || {};
  const media = await applyImageEdits(post, { [m.id]: { landscape, focusY, rotate } });
  const updated = store.updatePost(post.id, { media });
  const after = updated.media.find((x) => x.id === m.id);
  if (landscape && !after.edit?.landscape && !rotate) throw new Error('이미 가로 사진이라 자를 필요가 없어요.');
  res.json(updated);
}));

app.get('/media/:postId/:file', (req, res) => {
  const file = path.join(UPLOAD_DIR, path.basename(req.params.postId), path.basename(req.params.file));
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.sendFile(file);
});

app.get('/api/logs/:file', (req, res) => {
  const file = path.join(LOG_DIR, path.basename(req.params.file));
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.sendFile(file);
});

// ---- 작업: 글감 수집 → 글쓰기 → 발행 ----
function startPostJob(post, kind, fn) {
  const running = runningJobFor(post.id);
  if (running) throw new Error('이 글은 이미 작업이 진행 중이에요.');
  return startJob(kind, post.id, fn);
}

app.post('/api/posts/:id/research', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  const job = startPostJob(post, 'research', async (log) => {
    const sources = await collectSources(post.interest, log);
    store.updatePost(post.id, { sources });
    log(`자료 ${sources.length}개 수집 완료. AI가 글감을 고르는 중...`);
    const topics = await suggestTopics(store.getPost(post.id));
    store.updatePost(post.id, { topics, status: 'researched' });
    log(`글감 ${topics.length}개 추천 완료`);
  });
  res.json({ jobId: job.id });
}));

app.post('/api/posts/:id/write', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  const { topicIndex, customTopic, feedback } = req.body || {};
  let topic = post.topic;
  if (customTopic) topic = { title: String(customTopic), angle: String(customTopic), sourceIds: [] };
  else if (topicIndex !== undefined) topic = post.topics[Number(topicIndex)];
  if (!topic) throw new Error('글감을 먼저 골라 주세요.');
  if (!post.sources.length && !post.memo) throw new Error('참고할 자료가 없어요. 글감 수집을 먼저 하거나 메모를 적어 주세요.');
  store.updatePost(post.id, { topic });

  const job = startPostJob(post, 'write', async (log) => {
    log(feedback ? 'AI가 수정 요청을 반영해 다시 쓰는 중...' : 'AI가 사진을 검토하고 글을 쓰는 중... (1~3분)');
    const article = await writeArticle(store.getPost(post.id), { feedback });
    store.updatePost(post.id, { article, status: 'written' });
    const edits = editsFromReview(article.mediaReview);
    if (Object.keys(edits).length) {
      log('AI 판단에 따라 사진을 가로로 자르거나 바로 세우는 중...');
      store.updatePost(post.id, { media: await applyImageEdits(store.getPost(post.id), edits, log) });
    }
    log('글 작성 완료! 미리보기에서 확인해 주세요.');
  });
  res.json({ jobId: job.id });
}));

app.post('/api/posts/:id/publish', wrap(async (req, res) => {
  const post = requirePost(req.params.id);
  if (!post.article) throw new Error('발행할 글이 없어요.');
  const mode = req.body?.mode === 'draft' ? 'draft' : 'publish';
  const job = startPostJob(post, 'publish', async (log) => {
    const result = await publishToNaver(store.getPost(post.id), { mode }, log);
    store.updatePost(post.id, mode === 'publish'
      ? { status: 'published', publishedUrl: result.url, publishedAt: new Date().toISOString() }
      : { status: 'drafted' });
    return result;
  });
  res.json({ jobId: job.id });
}));

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없어요.' });
  res.json(job);
});

// ---- 오류를 알아보기 쉬운 한국어 메시지(JSON)로 돌려준다 ----
const UPLOAD_ERRORS = {
  LIMIT_FILE_COUNT: '사진·동영상은 한 번에 60개까지 올릴 수 있어요. 나눠서 올려 주세요. (글을 만든 뒤 사진 칸의 "추가"로 더 넣을 수 있어요)',
  LIMIT_FILE_SIZE: '파일 하나가 너무 커요 (최대 2GB). 동영상은 길이를 줄여서 올려 주세요.',
};
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  const message =
    UPLOAD_ERRORS[err.code] ||
    (err.type === 'entity.too.large' ? '보내는 내용이 너무 커요.' : null) ||
    (err.code === 'ENOSPC' ? 'Mac 저장 공간이 부족해요. 필요 없는 파일을 지우고 다시 시도해 주세요.' : null) ||
    `처리 중 오류가 났어요: ${err.message}`;
  res.status(400).json({ error: message });
});

// ---- 시작 ----
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const urls = [`http://localhost:${PORT}`, ...lanAddresses().map((ip) => `http://${ip}:${PORT}`)];
  console.log('\n==============================================');
  console.log(' 네이버 블로그 오토파일럿 대시보드');
  console.log(` 접속 주소: ${urls.join('\n            ')}`);
  console.log(` 접속 코드: ${ACCESS_CODE}`);
  console.log(' (아이패드는 같은 와이파이에서 위 주소 중 192.168... 로 접속)');
  console.log('==============================================\n');
  ensurePlaywright();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ${PORT}번 포트를 다른 프로그램이 쓰고 있어요. 이미 켜 둔 앱이 있는지 확인해 주세요.`);
    console.error(`   끄려면 터미널에 입력: lsof -ti tcp:${PORT} | xargs kill\n`);
    process.exit(1);
  }
  throw err;
});
