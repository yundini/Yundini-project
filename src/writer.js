import { askClaudeJson } from './claude.js';
import { UPLOAD_DIR } from './paths.js';

const sourceDigest = (sources, bodyChars) =>
  sources
    .map((s) => `[${s.id}] (${s.type === 'news' ? '뉴스' : '블로그'}) ${s.title}\n${s.body.slice(0, bodyChars)}`)
    .join('\n\n---\n\n');

// 네이버에서 모은 실제 검색어(자동완성·연관검색어)와 상위 블로그 제목
function keywordSection(post) {
  const { autocomplete = [], related = [] } = post.keywords || {};
  const blogTitles = post.sources.filter((s) => s.type === 'blog').map((s) => `- ${s.title}`);
  const lines = [];
  if (autocomplete.length) lines.push(`네이버 자동완성 검색어: ${autocomplete.join(', ')}`);
  if (related.length) lines.push(`네이버 연관검색어: ${related.join(', ')}`);
  if (blogTitles.length) lines.push(`검색 상위 블로그 글 제목:\n${blogTitles.join('\n')}`);
  return lines.length
    ? lines.join('\n')
    : '수집된 검색어 자료가 없어. 관심분야와 글감을 보고 사람들이 실제로 검색창에 칠 만한 말을 직접 추려줘.';
}

// 1단계: 수집한 뉴스·블로그에서 블로그 글감을 3~5개 추천받는다.
export async function suggestTopics(post) {
  const prompt = `너는 네이버 블로그 콘텐츠 기획자야.
관심분야: ${post.interest}
${post.memo ? `블로그 주인의 메모: ${post.memo}\n` : ''}${post.media.length ? `블로그 주인이 직접 찍은 사진/동영상이 ${post.media.length}개 있어. 파일 설명: ${post.media.map((m) => m.note || m.originalName).join(', ')}\n` : ''}
이 블로그는 네이버 **검색 유입**이 대부분이야. 아래 최근 뉴스와 인기 블로그 글, 실제 검색어를 보고
사람들이 지금 검색창에 많이 칠 만한 블로그 글감 3~5개를 추천해줘.
블로그 주인의 메모와 사진이 있다면 그와 잘 어울리는 글감을 우선해줘.

[실제 검색어]
${keywordSection(post)}

[자료]
${sourceDigest(post.sources, 700)}

글감마다 검색 키워드를 정해줘:
- keyword(메인 키워드): 검색창에 실제로 칠 법한 2~4단어 검색어 하나. 너무 넓은 한 단어(예: "여행")보다 구체적인 검색어(예: "제주 가을 여행 코스")가 좋아.
- subKeywords(세부 키워드): 같이 검색될 만한 롱테일 검색어 3~5개 (예: "제주 가을 여행 옷차림", "제주 억새 명소")
- 위 실제 검색어 중 글감과 맞는 것을 우선 활용해.

다른 설명 없이 아래 JSON 형식으로만 답해:
{"topics":[{"title":"글 제목 후보(메인 키워드를 앞쪽에)","keyword":"메인 키워드","subKeywords":["세부 키워드"],"angle":"어떤 관점/내용으로 쓸지 한두 문장","why":"왜 지금 이 글감이 좋은지(검색 수요 포함)","sourceIds":["n1","b2"]}]}`;
  const json = await askClaudeJson(prompt);
  if (!Array.isArray(json.topics) || !json.topics.length) throw new Error('AI가 글감을 추천하지 못했어요.');
  return json.topics;
}

const BLOCK_SCHEMA = `블록 종류:
- {"type":"heading","text":"소제목"}
- {"type":"paragraph","text":"문단. 강조할 부분은 **굵게** 표시 가능. 모바일에서 읽기 좋게 2~3문장마다 문단을 나눠."}
- {"type":"quote","text":"핵심 요약이나 인상적인 한 줄"}
- {"type":"list","items":["항목1","항목2"]}
- {"type":"media","mediaId":"m1","caption":"사진 설명(짧게, 선택)"}
- {"type":"divider"}`;

function mediaSection(post) {
  if (!post.media.length) return '블로그 주인이 첨부한 사진/동영상은 없어. media 블록은 쓰지 마.';
  const lines = post.media.map((m) => {
    const note = m.note ? ` / 주인 메모: ${m.note}` : '';
    return m.kind === 'image'
      ? `- ${m.id}: 사진 파일 ${m.path}${note}`
      : `- ${m.id}: 동영상 (${m.originalName})${note} — 동영상은 네가 볼 수 없으니 메모와 파일명을 참고해 배치해`;
  });
  return `블로그 주인이 직접 찍은 사진/동영상 (가장 우선해서 사용해야 해):
${lines.join('\n')}

사진은 Read 도구로 파일을 직접 열어서 보고,
1) 글 주제와 어울리는지 판단하고 (흐리거나, 개인정보가 보이거나, 주제와 무관하면 제외)
2) 어울리는 사진은 내용에 맞는 위치에 media 블록으로 배치해.
   순서는 항상 **사진(media 블록) 먼저 → 그 사진을 설명하는 문단은 바로 뒤에**.
   독자가 사진을 먼저 보고 아래 설명을 읽도록, 사진 내용을 말하는 문단을 사진보다 앞에 두지 마.
   "아래 사진처럼", "다음 사진을 보면" 같은 말 대신 "사진처럼", "보시는 것처럼"으로 써.
3) 블로그 주인은 가로 사진을 선호해. 세로 사진은 가로(4:3)로 잘라 쓸지 판단해서 mediaReview에 적어:
   - "orientation": "landscape" = 가로로 자르기, "keep" = 그대로 (이미 가로 사진이면 "keep")
   - 세로 사진은 기본적으로 "landscape". 단, 잘랐을 때 사람 전신·제품 전체처럼 꼭 필요한 부분이 잘리면 "keep"
   - "focusY": 가로로 자를 때 남길 부분의 세로 중심 (0 = 맨 위, 0.5 = 가운데, 1 = 맨 아래). 주인공(사람 얼굴, 제품, 간판 등)이 가운데 오도록
   - "rotate": 사진이 옆으로 눕거나 뒤집혀 보이면 바로 서도록 시계 방향으로 돌릴 각도 (90, 180, 270). 정상이면 0
동영상은 블로그 주인이 올린 것이므로 제외하지 말고 적절한 위치에 배치해.`;
}

// 2단계: 선택한 글감으로 사진을 검토하고 블로그 글을 쓴다.
export async function writeArticle(post, { feedback } = {}) {
  const topic = post.topic;
  const related = topic.sourceIds?.length ? post.sources.filter((s) => topic.sourceIds.includes(s.id)) : [];
  const refs = related.length ? related : post.sources;

  const previous = feedback && post.article
    ? `\n이전에 쓴 글(JSON):\n${JSON.stringify({ title: post.article.title, blocks: post.article.blocks })}\n\n블로그 주인의 수정 요청: ${feedback}\n위 요청을 반영해서 글을 다시 써줘.\n`
    : '';

  const keywordPlan = topic.keyword
    ? `메인 키워드: ${topic.keyword}\n세부 키워드: ${(topic.subKeywords || []).join(', ') || '(직접 골라줘)'}`
    : '메인 키워드와 세부 키워드는 아직 없어. 아래 실제 검색어와 글감을 보고 네가 정해줘.';

  const prompt = `너는 네이버 블로그를 운영하는 친근하고 믿음직한 블로거야.
아래 글감과 참고 자료를 바탕으로 **완전히 새로운** 블로그 글을 써줘.
이 블로그는 네이버 **검색 유입**이 대부분이라, 검색에 잘 걸리도록 단어를 고르는 게 중요해.

[글감]
제목 후보: ${topic.title}
방향: ${topic.angle}
관심분야: ${post.interest}

[검색 키워드]
${keywordPlan}

[실제 검색어 자료]
${keywordSection(post)}
${post.memo ? `블로그 주인의 메모(경험/의견, 적극 반영): ${post.memo}\n` : ''}
[참고 자료] — 사실 확인용이야. 문장을 그대로 베끼지 말고, 여러 자료를 종합해 내 말로 다시 써.
${sourceDigest(refs, 2500)}

[사진/동영상]
${mediaSection(post)}

[글쓰기 규칙]
- 분량: 공백 포함 1,500~2,500자
- 말투: 편안한 존댓말(~해요체), 블로그 주인이 직접 경험하고 쓴 것처럼 자연스럽게
- 구성: 후킹 멘트(hook) → 도입(공감/궁금증 유발) → 소제목 3~5개로 나눈 본문 → 마무리(요약 + 한마디)

[후킹 멘트(hook) 규칙] — 글 맨 처음, 제목 바로 아래에 크게 들어가는 **짧은 한 문장**이야
- 이 블로그는 **리뷰·후기** 블로그야. 직접 써 본 사람만 말할 수 있는 **반응·변화·결과 하나**만 콕 집어서
  "이거 진짜 좋은가 보다" 하고 바로 끌리게 써
- **한 문장, 공백 포함 15~30자.** 설명을 덧붙이지 말고 포인트 하나만. 쉼표로 이어 붙이지 마
- 무엇에 대한 글인지 드러나게 제품·주제 이름을 짧게 넣기
- 좋은 예: "오리 사료에 얼굴을 파묻었어요", "한 봉지가 사흘 만에 끝났어요", "충전하면서 USB까지 한 번에"
  나쁜 예(너무 김): "닭고기만 먹던 아이들이 처음 먹는 오리 생육사료에 얼굴을 파묻고 정신없이 먹었어요"
- "정말 좋아요", "강력 추천" 같은 뻔한 말만으로 끝내지 마
- 블로그 주인의 메모·사진에 근거가 있는 내용만. 없는 경험이나 효과를 지어내지 마
- 이모지·물음표 금지
- hook은 JSON의 "hook"에만 적고, blocks에는 다시 넣지 마 (앱이 자동으로 맨 위에 넣어)
- 가독성: 문단은 짧게, 핵심은 **굵게**, 필요하면 목록과 인용구 사용
- 사진·동영상은 설명하는 문단보다 **먼저** 배치: [소제목] → [사진] → [그 사진 설명 문단] 순서
- 참고 자료에 없는 수치나 사실을 지어내지 마

[검색 유입 규칙]
- 제목: 메인 키워드를 **맨 앞쪽에** 그대로 넣고, 세부 키워드 하나를 자연스럽게 덧붙여 25~35자. 특수문자·이모지 남발 금지
- 첫 문단(도입 2~3문장 안)에 메인 키워드를 그대로 한 번 넣기
- 본문 전체에 메인 키워드를 띄어쓰기까지 똑같이 4~6번, 세부 키워드는 각각 1~2번. 같은 문단에 반복하지 말고 고르게, 읽을 때 어색하지 않게
- 소제목 3~5개 중 2개 이상에 메인/세부 키워드를 넣기 (사람들이 궁금해하는 질문형도 좋아, 예: "○○ 가격은 얼마?")
- 검색하는 사람이 바로 찾는 정보(가격, 위치, 장단점, 방법, 추천 대상 등)를 구체적인 단어로 적기. "이것", "여기"처럼 흐릿한 말보다 이름을 직접 쓰기
- 사진 설명(caption)에도 키워드를 자연스럽게 섞기
- 마무리 문단에 메인 키워드를 한 번 더 넣어 요약
- 태그(해시태그) 10~15개, # 없이, 띄어쓰기 없이 붙여서:
  메인 키워드 → 세부 키워드(롱테일) → 연관 검색어 → 지역·상황·대상 키워드 순서로.
  "일상", "소통", "맞팔"처럼 글과 무관한 태그나 같은 말 반복은 빼
- seo.tip: 이 글이 검색에 더 잘 걸리려면 블로그 주인이 해 볼 만한 것 한두 문장 (예: 직접 찍은 사진 추가, 가격 정보 보완)
${previous}
${BLOCK_SCHEMA}

다른 설명 없이 아래 JSON 형식으로만 답해:
{"title":"...","hook":"후킹 멘트","seo":{"mainKeyword":"메인 키워드","subKeywords":["세부 키워드"],"tip":"..."},"tags":["..."],"mediaReview":[{"id":"m1","use":true,"reason":"판단 이유","orientation":"landscape","focusY":0.4,"rotate":0}],"blocks":[...]}`;

  const json = await askClaudeJson(prompt, {
    allowedTools: post.media.some((m) => m.kind === 'image') ? ['Read'] : [],
    addDirs: [UPLOAD_DIR],
  });

  if (!json.title || !Array.isArray(json.blocks) || !json.blocks.length) {
    throw new Error('AI가 쓴 글의 형식이 올바르지 않아요.');
  }
  const mediaIds = new Set(post.media.map((m) => m.id));
  json.blocks = json.blocks.filter((b) => b.type !== 'media' || mediaIds.has(b.mediaId));
  json.tags = [...new Set((json.tags || []).map((t) => String(t).replace(/^#/, '').replace(/\s+/g, '').trim()).filter(Boolean))].slice(0, 15);
  const seo = json.seo || {};
  json.seo = {
    mainKeyword: String(seo.mainKeyword || topic.keyword || '').trim(),
    subKeywords: (Array.isArray(seo.subKeywords) ? seo.subKeywords : topic.subKeywords || []).map((k) => String(k).trim()).filter(Boolean),
    tip: String(seo.tip || '').trim(),
  };
  json.mediaReview = json.mediaReview || [];
  // 후킹 멘트는 항상 글 맨 처음(제목 바로 아래)에 인용구로 넣는다
  const hook = String(json.hook || '').trim();
  if (hook) {
    const same = (t) => String(t || '').replace(/[\s“”"*]/g, '') === hook.replace(/[\s“”"*]/g, '');
    json.blocks = [{ type: 'quote', text: hook }, ...json.blocks.filter((b) => !(b.type === 'quote' && same(b.text)))];
  }
  return json;
}
