// 글 블록을 네이버 스마트에디터에 붙여넣을 HTML로 변환한다.
// 에디터가 붙여넣기 때 살려주는 서식(굵게, 글자 크기, 색, 정렬) 위주로 만든다.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
// 네이버 에디터는 서식을 적지 않으면 윗줄(예: 회색 가운데 캡션)의 서식을 이어 쓴다.
// 그래서 모든 줄에 정렬·색·굵기·크기를 빠짐없이 적는다.
const BLACK = '#000000';
const GREEN = '#2e7d5b';
const line = (html, { align = 'left', size = 16, color = BLACK, bold = false } = {}) =>
  `<p style="text-align:${align}"><span style="font-size:${size}px;color:${color};font-weight:${bold ? 'bold' : 'normal'}">${html}</span></p>`;
const blank = line('<br>');

export function blockToHtml(block) {
  switch (block.type) {
    case 'heading':
      return `${blank}${line(esc(block.text), { size: 24, bold: true })}${blank}`;
    case 'paragraph':
      return `${line(inline(block.text))}${blank}`;
    case 'quote':
      return `${line(`“ ${inline(block.text)} ”`, { align: 'center', size: 19, color: GREEN, bold: true })}${blank}`;
    case 'list':
      return (block.items || []).map((it) => line(`✔ ${inline(it)}`)).join('') + blank;
    case 'divider':
      return `${line('· · ·', { align: 'center', color: '#bbbbbb' })}${blank}`;
    case 'tags':
      return line(esc(block.text), { size: 15, color: GREEN });
    case 'caption':
      return `${line(esc(block.text), { align: 'center', size: 13, color: '#888888' })}${blank}`;
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
