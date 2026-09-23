import { askClaudeJson } from './claude.js';
import { UPLOAD_DIR } from './paths.js';

const sourceDigest = (sources, bodyChars) =>
  sources
    .map((s) => `[${s.id}] (${s.type === 'news' ? '뉴스' : '블로그'}) ${s.title}\n${s.body.slice(0, bodyChars)}`)
    .join('\n\n---\n\n');

// 1단계: 수집한 뉴스·블로그에서 블로그 글감을 3~5개 추천받는다.
export async function suggestTopics(post) {
  const prompt = `너는 네이버 블로그 콘텐츠 기획자야.
관심분야: ${post.interest}
${post.memo ? `블로그 주인의 메모: ${post.memo}\n` : ''}${post.media.length ? `블로그 주인이 직접 찍은 사진/동영상이 ${post.media.length}개 있어. 파일 설명: ${post.media.map((m) => m.note || m.originalName).join(', ')}\n` : ''}
아래는 최근 뉴스와 인기 블로그 글이야. 지금 사람들이 관심을 가질 만한 블로그 글감 3~5개를 추천해줘.
블로그 주인의 메모와 사진이 있다면 그와 잘 어울리는 글감을 우선해줘.

${sourceDigest(post.sources, 700)}

다른 설명 없이 아래 JSON 형식으로만 답해:
{"topics":[{"title":"글 제목 후보","angle":"어떤 관점/내용으로 쓸지 한두 문장","why":"왜 지금 이 글감이 좋은지","sourceIds":["n1","b2"]}]}`;
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

  const prompt = `너는 네이버 블로그를 운영하는 친근하고 믿음직한 블로거야.
아래 글감과 참고 자료를 바탕으로 **완전히 새로운** 블로그 글을 써줘.

[글감]
제목 후보: ${topic.title}
방향: ${topic.angle}
관심분야: ${post.interest}
${post.memo ? `블로그 주인의 메모(경험/의견, 적극 반영): ${post.memo}\n` : ''}
[참고 자료] — 사실 확인용이야. 문장을 그대로 베끼지 말고, 여러 자료를 종합해 내 말로 다시 써.
${sourceDigest(refs, 2500)}

[사진/동영상]
${mediaSection(post)}

[글쓰기 규칙]
- 분량: 공백 포함 1,500~2,500자
- 말투: 편안한 존댓말(~해요체), 블로그 주인이 직접 경험하고 쓴 것처럼 자연스럽게
- 구성: 도입(공감/궁금증 유발) → 소제목 3~5개로 나눈 본문 → 마무리(요약 + 한마디)
- 가독성: 문단은 짧게, 핵심은 **굵게**, 필요하면 목록과 인용구 사용
- 참고 자료에 없는 수치나 사실을 지어내지 마
- 제목은 검색에 잘 걸리도록 핵심 키워드를 앞쪽에, 30자 안팎
- 태그 5~10개 (# 없이)
${previous}
${BLOCK_SCHEMA}

다른 설명 없이 아래 JSON 형식으로만 답해:
{"title":"...","tags":["..."],"mediaReview":[{"id":"m1","use":true,"reason":"판단 이유"}],"blocks":[...]}`;

  const json = await askClaudeJson(prompt, {
    allowedTools: post.media.some((m) => m.kind === 'image') ? ['Read'] : [],
    addDirs: [UPLOAD_DIR],
  });

  if (!json.title || !Array.isArray(json.blocks) || !json.blocks.length) {
    throw new Error('AI가 쓴 글의 형식이 올바르지 않아요.');
  }
  const mediaIds = new Set(post.media.map((m) => m.id));
  json.blocks = json.blocks.filter((b) => b.type !== 'media' || mediaIds.has(b.mediaId));
  json.tags = (json.tags || []).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  json.mediaReview = json.mediaReview || [];
  return json;
}
