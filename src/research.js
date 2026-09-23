import { playwright, launchExtras } from './setup.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAX_NEWS = 6;
const MAX_BLOGS = 6;
const MAX_CHARS = 3000;

const clean = (s) => (s || '').replace(/​/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function collectLinks(page, url, pattern) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  const seen = new Set();
  const out = [];
  for (const href of hrefs) {
    const m = href.match(pattern);
    if (!m) continue;
    const key = m[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

async function readNews(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page.evaluate(() => {
    const pick = (...sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.innerText.trim()) return el.innerText;
      }
      return '';
    };
    return {
      title: pick('#title_area', 'h2.media_end_head_headline', 'h2#title_area', 'h1') || document.title,
      body: pick('#dic_area', '#newsct_article', 'article'),
      press: document.querySelector('meta[property="og:article:author"]')?.content || '',
      date: document.querySelector('.media_end_head_info_datestamp_time')?.getAttribute('data-date-time') || '',
    };
  });
}

async function readBlog(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const pick = (...sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.innerText.trim()) return el.innerText;
      }
      return '';
    };
    return {
      title: pick('.se-title-text', '.se_title', 'h3.tit_h3', '.pcol1') || document.title,
      body: pick('.se-main-container', '#viewTypeSelector', '.post_ct', '#postViewArea'),
      author: pick('.blog_author', '.nick', '.writer'),
    };
  });
}

// 관심분야 키워드로 네이버 뉴스(최근 1주)와 블로그(최근 1개월, 관련도순)를 모은다.
export async function collectSources(interest, log) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({ headless: true, ...launchExtras });
  const context = await browser.newContext({ userAgent: UA, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const q = encodeURIComponent(interest);
  const sources = [];

  try {
    log(`네이버 뉴스에서 "${interest}" 검색 중...`);
    const newsLinks = await collectLinks(
      page,
      `https://search.naver.com/search.naver?where=news&query=${q}&sort=0&nso=so:r,p:1w`,
      /https:\/\/n\.news\.naver\.com\/(?:mnews\/)?article\/\d+\/\d+/,
    );
    for (const [url] of newsLinks.slice(0, MAX_NEWS)) {
      try {
        const a = await readNews(page, url);
        if (!a.body) continue;
        sources.push({ id: `n${sources.length + 1}`, type: 'news', url, title: clean(a.title), meta: clean(a.press), body: clean(a.body).slice(0, MAX_CHARS) });
        log(`뉴스 수집: ${clean(a.title).slice(0, 40)}`);
      } catch (e) {
        log(`뉴스 읽기 실패(건너뜀): ${url}`);
      }
    }

    log(`네이버 블로그에서 "${interest}" 인기 글 검색 중...`);
    const blogLinks = await collectLinks(
      page,
      `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${q}&nso=so:r,p:1m`,
      /https?:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/,
    );
    for (const [, blogId, logNo] of blogLinks.slice(0, MAX_BLOGS)) {
      const url = `https://m.blog.naver.com/${blogId}/${logNo}`;
      try {
        const b = await readBlog(page, url);
        if (!b.body) continue;
        sources.push({ id: `b${sources.length + 1}`, type: 'blog', url, title: clean(b.title), meta: clean(b.author), body: clean(b.body).slice(0, MAX_CHARS) });
        log(`블로그 수집: ${clean(b.title).slice(0, 40)}`);
      } catch (e) {
        log(`블로그 읽기 실패(건너뜀): ${url}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (!sources.length) throw new Error('수집된 자료가 없어요. 키워드를 바꿔서 다시 시도해 주세요.');
  return sources;
}
