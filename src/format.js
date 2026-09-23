// 글 블록을 네이버 스마트에디터에 붙여넣을 HTML로 변환한다.
// 에디터가 붙여넣기 때 살려주는 서식(굵게, 글자 크기, 색, 정렬) 위주로 만든다.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const blank = '<p><br></p>';

export function blockToHtml(block) {
  switch (block.type) {
    case 'heading':
      return `${blank}<p><span style="font-size:24px;color:#1a1a1a"><b>${esc(block.text)}</b></span></p>${blank}`;
    case 'paragraph':
      return `<p><span style="font-size:16px">${inline(block.text)}</span></p>${blank}`;
    case 'quote':
      return `<p style="text-align:center"><span style="font-size:19px;color:#2e7d5b"><b>“ ${inline(block.text)} ”</b></span></p>${blank}`;
    case 'list':
      return (block.items || []).map((it) => `<p><span style="font-size:16px">✔ ${inline(it)}</span></p>`).join('') + blank;
    case 'divider':
      return `<p style="text-align:center"><span style="color:#bbbbbb">· · ·</span></p>${blank}`;
    case 'tags':
      return `<p><span style="font-size:15px;color:#2e7d5b">${esc(block.text)}</span></p>`;
    case 'caption':
      return `<p style="text-align:center"><span style="font-size:13px;color:#888888">${esc(block.text)}</span></p>${blank}`;
    default:
      return '';
  }
}

export function blockToText(block) {
  if (block.type === 'list') return (block.items || []).map((i) => `✔ ${i}`).join('\n') + '\n\n';
  if (block.type === 'divider') return '· · ·\n\n';
  return String(block.text ?? '').replace(/\*\*(.+?)\*\*/g, '$1') + '\n\n';
}

// 연속된 텍스트 블록은 한 번에 붙여넣고, 사진/동영상에서 끊는다.
export const hashtagLine = (tags = []) =>
  tags.map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1).join(' ');

// tags를 주면 본문 맨 마지막 줄에 해시태그로 붙인다 (미리보기와 같은 모양).
export function toSegments(blocks, media, tags = []) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const segments = [];
  let text = [];
  const flush = () => {
    if (!text.length) return;
    segments.push({ kind: 'text', html: text.map(blockToHtml).join(''), plain: text.map(blockToText).join('') });
    text = [];
  };
  for (const block of blocks) {
    if (block.type === 'media') {
      const m = byId.get(block.mediaId);
      if (!m) continue;
      flush();
      segments.push({ kind: m.kind, media: m });
      if (block.caption) text.push({ type: 'caption', text: block.caption });
    } else {
      text.push(block);
    }
  }
  const line = hashtagLine(tags);
  if (line) text.push({ type: 'tags', text: line });
  flush();
  return segments;
}
