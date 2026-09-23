const $app = document.getElementById('app');
const $chips = document.getElementById('chips');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const STATUS_LABEL = {
  draft: '자료 준비',
  researched: '글감 선택',
  written: '미리보기',
  drafted: '임시저장됨',
  published: '발행 완료',
};

async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && data?.error === 'auth') {
    renderAuth();
    throw new Error('접속 코드가 필요해요.');
  }
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data;
}

// ---------------- 접속 코드 ----------------
function renderAuth() {
  $chips.innerHTML = '';
  $app.innerHTML = `
    <div class="card">
      <h1>접속 코드 입력</h1>
      <p class="hint">Mac 터미널에 표시된 6자리 접속 코드를 입력하세요. 한 번 입력하면 이 기기에서는 기억돼요.</p>
      <form id="authForm" class="row">
        <input type="text" inputmode="numeric" id="code" placeholder="123456" />
        <button class="primary">확인</button>
      </form>
      <p id="authMsg" class="error"></p>
    </div>`;
  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth', { method: 'POST', body: { code: document.getElementById('code').value.trim() } });
      route();
    } catch (err) {
      document.getElementById('authMsg').textContent = err.message;
    }
  };
}

// ---------------- 상단 상태 ----------------
let naverLoggedIn = null;

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    if (s.naver.loggedIn !== null) naverLoggedIn = s.naver.loggedIn;
    const setupClass = s.setup.status === 'ready' ? 'ok' : s.setup.status === 'error' ? 'bad' : 'wait';
    const naverClass = naverLoggedIn === true ? 'ok' : naverLoggedIn === false ? 'bad' : '';
    const naverText = naverLoggedIn === true ? '네이버 로그인됨' : naverLoggedIn === false ? '네이버 로그인 필요' : '네이버 로그인 확인';
    $chips.innerHTML = `
      <span class="chip ${setupClass}" title="${esc(s.setup.message)}"><span class="dot"></span>${s.setup.status === 'ready' ? 'Playwright 준비됨' : esc(s.setup.message)}</span>
      <button class="chip ${naverClass}" id="naverChip"><span class="dot"></span>${naverText}</button>
      <button class="chip" id="aiChip"><span class="dot"></span>AI 연결 테스트</button>`;
    document.getElementById('naverChip').onclick = onNaverChip;
    document.getElementById('aiChip').onclick = onAiChip;
    return s;
  } catch {
    return null;
  }
}

async function onNaverChip(e) {
  const chip = e.currentTarget;
  chip.disabled = true;
  try {
    const s = await api('/api/login/check', { method: 'POST' });
    naverLoggedIn = s.loggedIn;
    if (s.loggedIn) {
      if (confirm('네이버에 로그인되어 있어요. 로그아웃할까요?')) {
        await api('/api/login/logout', { method: 'POST' });
        naverLoggedIn = false;
      }
    } else {
      openLogin();
    }
  } catch (err) {
    alert(err.message);
  } finally {
    refreshStatus();
  }
}

async function onAiChip(e) {
  const chip = e.currentTarget;
  chip.classList.add('wait');
  chip.lastChild.textContent = 'AI 확인 중...';
  try {
    const r = await api('/api/claude/check', { method: 'POST' });
    chip.className = 'chip ok';
    chip.lastChild.textContent = `AI: ${r.reply.slice(0, 20)}`;
  } catch (err) {
    chip.className = 'chip bad';
    chip.lastChild.textContent = 'AI 연결 실패';
    alert(err.message);
  }
}

// ---------------- 원격 로그인 ----------------
const $dialog = document.getElementById('loginDialog');
const $screen = document.getElementById('loginScreen');
const $loginMsg = document.getElementById('loginMsg');
let screenTimer = null;
let viewport = { width: 1200, height: 860 };

async function openLogin() {
  $loginMsg.textContent = 'Mac에서 로그인 화면을 여는 중...';
  $dialog.showModal();
  try {
    const r = await api('/api/login/start', { method: 'POST' });
    viewport = r.viewport;
    $loginMsg.textContent = '';
    refreshScreen();
  } catch (err) {
    $loginMsg.textContent = err.message;
  }
}

function refreshScreen() {
  clearTimeout(screenTimer);
  if (!$dialog.open) return;
  const img = new Image();
  img.onload = () => {
    $screen.src = img.src;
    screenTimer = setTimeout(refreshScreen, 700);
  };
  img.onerror = () => (screenTimer = setTimeout(refreshScreen, 1500));
  img.src = `/api/login/screen?t=${Date.now()}`;
}

$screen.addEventListener('click', async (e) => {
  const rect = $screen.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * viewport.width;
  const y = ((e.clientY - rect.top) / rect.height) * viewport.height;
  await api('/api/login/click', { method: 'POST', body: { x, y } }).catch((err) => ($loginMsg.textContent = err.message));
});

document.getElementById('loginTypeForm').onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById('loginText');
  if (!input.value) return;
  await api('/api/login/type', { method: 'POST', body: { text: input.value } }).catch((err) => ($loginMsg.textContent = err.message));
  input.value = '';
};

$dialog.querySelectorAll('[data-key]').forEach((b) => {
  b.onclick = () => api('/api/login/key', { method: 'POST', body: { key: b.dataset.key } }).catch(() => {});
});

document.getElementById('loginFinish').onclick = async () => {
  const r = await api('/api/login/finish', { method: 'POST' }).catch((err) => ({ error: err.message }));
  if (r.loggedIn) {
    naverLoggedIn = true;
    $dialog.close();
    refreshStatus();
  } else {
    $loginMsg.textContent = r.error || '아직 로그인이 확인되지 않았어요. 로그인을 끝까지 마쳐 주세요.';
  }
};

$dialog.querySelector('[data-close]').onclick = () => $dialog.close();
$dialog.addEventListener('close', () => clearTimeout(screenTimer));

// ---------------- 작업 폴링 ----------------
async function watchJob(jobId, $log) {
  for (;;) {
    const job = await api(`/api/jobs/${jobId}`);
    if ($log) {
      $log.hidden = false;
      $log.innerHTML = job.logs.map((l) => esc(l.msg)).join('\n') + (job.error ? `\n<span class="error">${esc(job.error)}</span>` : '');
      $log.scrollTop = $log.scrollHeight;
    }
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const linkifyLogs = (text) => text.replace(/\/api\/logs\/[\w.-]+\.png/g, (m) => `<a href="${m}" target="_blank">${m}</a>`);

// ---------------- 홈 ----------------
async function renderHome() {
  const posts = await api('/api/posts');
  $app.innerHTML = `
    <form class="card" id="newForm">
      <h1>새 글 만들기</h1>
      <label for="interest">관심분야 / 키워드</label>
      <input type="text" id="interest" placeholder="예: 가을 캠핑, 제주 여행, 홈카페" required />
      <label for="memo">메모 (선택)</label>
      <textarea id="memo" placeholder="직접 경험한 내용, 꼭 넣고 싶은 이야기, 원하는 분위기 등을 적어 주세요. AI가 글에 반영해요."></textarea>
      <label>내가 찍은 사진·동영상 (선택, 최우선으로 사용)</label>
      <input type="file" id="files" accept="image/*,video/*" multiple />
      <div class="media-grid" id="picked"></div>
      <div class="row"><span class="spacer"></span><button class="primary" id="createBtn">글감 찾기 시작</button></div>
      <p id="newMsg" class="error"></p>
    </form>
    <div class="card">
      <h2>내 글</h2>
      <div class="list">
        ${posts.length ? posts.map((p) => `
          <a class="post-item" href="#/post/${p.id}">
            <span><strong>${esc(p.article?.title || p.topic?.title || p.interest)}</strong><br>
              <span class="hint">${esc(p.interest)} · 사진/동영상 ${p.media.length}개 · ${new Date(p.createdAt).toLocaleString('ko-KR')}</span></span>
            <span class="badge ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
          </a>`).join('') : '<p class="hint">아직 만든 글이 없어요.</p>'}
      </div>
    </div>`;

  const $files = document.getElementById('files');
  const $picked = document.getElementById('picked');
  $files.onchange = () => {
    $picked.innerHTML = [...$files.files].map((f, i) => {
      const url = URL.createObjectURL(f);
      const view = f.type.startsWith('video/') ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt="">`;
      return `<div class="media-tile">${view}<div class="body"><input type="text" data-note="${i}" placeholder="설명 (선택)" /></div></div>`;
    }).join('');
  };

  document.getElementById('newForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createBtn');
    btn.disabled = true;
    btn.textContent = '업로드 중...';
    try {
      const form = new FormData();
      form.append('interest', document.getElementById('interest').value);
      form.append('memo', document.getElementById('memo').value);
      [...$files.files].forEach((f, i) => {
        form.append('files', f);
        form.append('notes', $picked.querySelector(`[data-note="${i}"]`)?.value || '');
      });
      const post = await api('/api/posts', { method: 'POST', form });
      const { jobId } = await api(`/api/posts/${post.id}/research`, { method: 'POST' });
      location.hash = `#/post/${post.id}?job=${jobId}`;
    } catch (err) {
      document.getElementById('newMsg').textContent = err.message;
      btn.disabled = false;
      btn.textContent = '글감 찾기 시작';
    }
  };
}

// ---------------- 글 상세 ----------------
function mediaTag(post, m, attrs = '') {
  const src = `/media/${post.id}/${m.file}`;
  return m.kind === 'video' ? `<video src="${src}" controls playsinline ${attrs}></video>` : `<img src="${src}" alt="" ${attrs}>`;
}

function renderPreview(post) {
  const a = post.article;
  const byId = Object.fromEntries(post.media.map((m) => [m.id, m]));
  const body = a.blocks.map((b) => {
    switch (b.type) {
      case 'heading': return `<h3>${esc(b.text)}</h3>`;
      case 'paragraph': return `<p>${inline(b.text)}</p>`;
      case 'quote': return `<blockquote>“ ${inline(b.text)} ”</blockquote>`;
      case 'list': return `<ul>${(b.items || []).map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
      case 'divider': return '<hr>';
      case 'media': {
        const m = byId[b.mediaId];
        return m ? `<figure>${mediaTag(post, m)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
      }
      default: return '';
    }
  }).join('');
  return `<div class="preview"><div class="p-title">${esc(a.title)}</div>${body}<p class="tags">${(a.tags || []).map((t) => `#${esc(t)}`).join(' ')}</p></div>`;
}

function renderEditor(post) {
  const a = post.article;
  const blocks = a.blocks.map((b, i) => {
    if (b.type === 'divider') return '';
    const kind = { heading: '소제목', paragraph: '문단', quote: '인용구', list: '목록 (줄마다 한 항목)', media: '사진/동영상 설명' }[b.type] || b.type;
    const value = b.type === 'list' ? (b.items || []).join('\n') : b.type === 'media' ? b.caption || '' : b.text;
    return `<div class="edit-block"><div class="kind">${kind}${b.type === 'media' ? ` (${esc(b.mediaId)})` : ''}</div>
      <textarea data-block="${i}" rows="${b.type === 'paragraph' ? 4 : 2}">${esc(value)}</textarea></div>`;
  }).join('');
  return `
    <label>제목</label><input type="text" id="editTitle" value="${esc(a.title)}" />
    <label>태그 (쉼표로 구분)</label><input type="text" id="editTags" value="${esc((a.tags || []).join(', '))}" />
    <label>본문</label>${blocks}
    <div class="row"><span class="spacer"></span><button class="ghost" id="cancelEdit">취소</button><button class="primary" id="saveEdit">저장</button></div>`;
}

async function renderPost(id, jobFromUrl) {
  let post = await api(`/api/posts/${id}`);
  const jobId = jobFromUrl || post.runningJobId;
  const excluded = new Set((post.article?.mediaReview || []).filter((r) => !r.use).map((r) => r.id));
  const reviewById = Object.fromEntries((post.article?.mediaReview || []).map((r) => [r.id, r]));

  $app.innerHTML = `
    <div class="card">
      <div class="row" style="margin-top:0">
        <h1 style="margin:0">${esc(post.interest)}</h1>
        <span class="badge ${post.status}">${STATUS_LABEL[post.status] || post.status}</span>
        <span class="spacer"></span>
        <button class="danger ghost" id="deletePost">삭제</button>
      </div>
      ${post.memo ? `<p class="hint">메모: ${esc(post.memo)}</p>` : ''}
      <pre class="log" id="jobLog" hidden></pre>
    </div>

    <div class="card">
      <h2>내 사진·동영상 (${post.media.length})</h2>
      <div class="media-grid">
        ${post.media.map((m) => `
          <div class="media-tile ${excluded.has(m.id) ? 'excluded' : ''}">
            ${mediaTag(post, m, 'preload="metadata"')}
            <div class="body">${esc(m.note || m.originalName)}
              ${reviewById[m.id] ? `<br><span class="hint">${reviewById[m.id].use ? '✅ 사용' : '⛔ 제외'}: ${esc(reviewById[m.id].reason)}</span>` : ''}
              <br><button class="ghost danger" data-del-media="${m.id}" style="min-height:32px;padding:4px 10px;margin-top:4px">빼기</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="row"><input type="file" id="addFiles" accept="image/*,video/*" multiple /><button id="addBtn">추가</button></div>
    </div>

    ${post.sources.length ? `
    <div class="card">
      <details><summary>수집한 자료 ${post.sources.length}개</summary>
        <ul class="sources">${post.sources.map((s) => `<li>[${s.type === 'news' ? '뉴스' : '블로그'}] <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>
      </details>
    </div>` : ''}

    <div class="card">
      <h2>1. 글감 고르기</h2>
      ${post.topics.length ? post.topics.map((t, i) => `
        <button class="topic" data-topic="${i}">
          <strong>${post.topic?.title === t.title ? '✅ ' : ''}${esc(t.title)}</strong>
          <span>${esc(t.angle)}</span><span>💡 ${esc(t.why || '')}</span>
        </button>`).join('') : `<p class="hint">아직 글감이 없어요.</p>`}
      <div class="row"><input type="text" id="customTopic" placeholder="직접 글감 입력하기" /><button id="customBtn">이걸로 쓰기</button></div>
      <div class="row"><span class="spacer"></span><button id="researchBtn">${post.topics.length ? '글감 다시 찾기' : '글감 찾기'}</button></div>
    </div>

    ${post.article ? `
    <div class="card">
      <div class="row" style="margin-top:0"><h2 style="margin:0">2. 미리보기</h2><span class="spacer"></span><button id="editBtn">직접 수정</button></div>
      <div id="previewArea">${renderPreview(post)}</div>
      <label for="feedback">AI에게 수정 요청</label>
      <div class="row" style="margin-top:0"><input type="text" id="feedback" placeholder="예: 더 짧게, 도입부를 재밌게, 가격 정보 강조" /><button id="rewriteBtn">다시 쓰기</button></div>
    </div>

    <div class="card">
      <h2>3. 발행</h2>
      ${post.publishedUrl ? `<p>✅ 발행된 글: <a href="${esc(post.publishedUrl)}" target="_blank" rel="noopener">${esc(post.publishedUrl)}</a></p>` : ''}
      <p class="hint">발행하면 Mac에서 브라우저가 열리고 네이버 블로그 에디터에 글, 사진, 동영상, 서식이 자동으로 입력돼요.</p>
      <div class="row wrap">
        <button id="draftBtn">임시저장만 하기</button>
        <span class="spacer"></span>
        <button class="primary" id="publishBtn">네이버 블로그에 발행</button>
      </div>
    </div>` : ''}`;

  const $log = document.getElementById('jobLog');
  const runJob = async (promise) => {
    document.querySelectorAll('main button').forEach((b) => (b.disabled = true));
    try {
      const { jobId } = await promise;
      const job = await watchJob(jobId, $log);
      if (job.status === 'error') {
        $log.innerHTML = linkifyLogs($log.innerHTML);
        document.querySelectorAll('main button').forEach((b) => (b.disabled = false));
        return;
      }
      renderPost(id);
      refreshStatus();
    } catch (err) {
      $log.hidden = false;
      $log.innerHTML += `\n<span class="error">${esc(err.message)}</span>`;
      document.querySelectorAll('main button').forEach((b) => (b.disabled = false));
    }
  };

  if (jobId) {
    history.replaceState(null, '', `#/post/${id}`);
    runJob(Promise.resolve({ jobId }));
  }

  document.getElementById('deletePost').onclick = async () => {
    if (!confirm('이 글과 첨부한 사진·동영상을 삭제할까요?')) return;
    await api(`/api/posts/${id}`, { method: 'DELETE' }).then(() => (location.hash = '#/')).catch((e) => alert(e.message));
  };

  document.querySelectorAll('[data-del-media]').forEach((b) => {
    b.onclick = async () => {
      await api(`/api/posts/${id}/media/${b.dataset.delMedia}`, { method: 'DELETE' }).catch((e) => alert(e.message));
      renderPost(id);
    };
  });

  document.getElementById('addBtn').onclick = async () => {
    const files = document.getElementById('addFiles').files;
    if (!files.length) return;
    const form = new FormData();
    [...files].forEach((f) => {
      form.append('files', f);
      form.append('notes', '');
    });
    await api(`/api/posts/${id}/media`, { method: 'POST', form }).catch((e) => alert(e.message));
    renderPost(id);
  };

  document.getElementById('researchBtn').onclick = () => runJob(api(`/api/posts/${id}/research`, { method: 'POST' }));
  document.querySelectorAll('[data-topic]').forEach((b) => {
    b.onclick = () => runJob(api(`/api/posts/${id}/write`, { method: 'POST', body: { topicIndex: Number(b.dataset.topic) } }));
  });
  document.getElementById('customBtn').onclick = () => {
    const customTopic = document.getElementById('customTopic').value.trim();
    if (customTopic) runJob(api(`/api/posts/${id}/write`, { method: 'POST', body: { customTopic } }));
  };

  if (!post.article) return;

  document.getElementById('rewriteBtn').onclick = () => {
    const feedback = document.getElementById('feedback').value.trim();
    if (!feedback) return alert('어떻게 고칠지 적어 주세요.');
    runJob(api(`/api/posts/${id}/write`, { method: 'POST', body: { feedback } }));
  };

  document.getElementById('editBtn').onclick = () => {
    const area = document.getElementById('previewArea');
    area.innerHTML = renderEditor(post);
    document.getElementById('cancelEdit').onclick = () => renderPost(id);
    document.getElementById('saveEdit').onclick = async () => {
      const article = structuredClone(post.article);
      article.title = document.getElementById('editTitle').value.trim();
      article.tags = document.getElementById('editTags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
      area.querySelectorAll('[data-block]').forEach((ta) => {
        const b = article.blocks[Number(ta.dataset.block)];
        if (b.type === 'list') b.items = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else if (b.type === 'media') b.caption = ta.value.trim();
        else b.text = ta.value.trim();
      });
      article.blocks = article.blocks.filter((b) => b.type === 'media' || b.type === 'divider' || (b.type === 'list' ? b.items.length : b.text));
      await api(`/api/posts/${id}`, { method: 'PATCH', body: { article } }).catch((e) => alert(e.message));
      renderPost(id);
    };
  };

  document.getElementById('draftBtn').onclick = () => runJob(api(`/api/posts/${id}/publish`, { method: 'POST', body: { mode: 'draft' } }));
  document.getElementById('publishBtn').onclick = () => {
    if (!confirm('미리보기 내용 그대로 네이버 블로그에 발행할까요?')) return;
    runJob(api(`/api/posts/${id}/publish`, { method: 'POST', body: { mode: 'publish' } }));
  };
}

// ---------------- 라우팅 ----------------
async function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/post\/([\w-]+)(?:\?job=([\w-]+))?/);
  try {
    const status = await refreshStatus();
    if (!status) {
      // 401이면 api()가 인증 화면을 그렸다
      await api('/api/status');
    }
    if (m) await renderPost(m[1], m[2]);
    else await renderHome();
  } catch (err) {
    if (err.message !== '접속 코드가 필요해요.') $app.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
setInterval(() => document.visibilityState === 'visible' && refreshStatus(), 15000);
route();
