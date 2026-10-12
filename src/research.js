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

const cleanKeywords = (list, interest) => {
  const seen = new Set([interest.replace(/\s+/g, '')]);
  const out = [];
  for (const k of list) {
    const word = clean(String(k || ''));
    const key = word.replace(/\s+/g, '');
    if (word.length < 2 || word.length > 30 || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
};

// 네이버 검색창 자동완성 = 사람들이 실제로 많이 치는 검색어
async function autocomplete(page, interest) {
  const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(interest)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&q_enc=UTF-8&st=100`;
  const res = await page.request.get(url, { headers: { Referer: 'https://www.naver.com/' }, timeout: 15000 });
  const json = await res.json();
  return (json.items || []).flat(1).map((item) => (Array.isArray(item) ? item[0] : item)).filter((k) => typeof k === 'string');
}

// 통합검색 결과의 연관검색어
async function relatedSearches(page, interest) {
  await page.goto(`https://search.naver.com/search.naver?query=${encodeURIComponent(interest)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  return page.$$eval('[class*="related_srch"] a, [class*="lst_related"] a', (as) =>
    as.map((a) => (a.querySelector('.tit') || a).innerText.trim()),
  );
}

// 검색 유입용 키워드 재료(자동완성·연관검색어)를 모은다. 실패해도 글쓰기는 계속한다.
async function collectKeywords(page, interest, log) {
  const keywords = { autocomplete: [], related: [] };
  try {
    keywords.autocomplete = cleanKeywords(await autocomplete(page, interest), interest).slice(0, 10);
  } catch {
    log('자동완성 검색어를 가져오지 못했어요(건너뜀).');
  }
  try {
    keywords.related = cleanKeywords(await relatedSearches(page, interest), interest).slice(0, 15);
  } catch {
    log('연관검색어를 가져오지 못했어요(건너뜀).');
  }
  const found = [...keywords.autocomplete, ...keywords.related];
  if (found.length) log(`검색 키워드 ${found.length}개 수집: ${found.slice(0, 6).join(', ')}${found.length > 6 ? ' ...' : ''}`);
  return keywords;
}

// 관심분야 키워드로 네이버 뉴스(최근 1주)와 블로그(최근 1개월, 관련도순)를 모은다.
// 함께 사람들이 실제로 검색하는 키워드(자동완성·연관검색어)도 모은다.
export async function collectSources(interest, log) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({ headless: true, ...launchExtras() });
  const context = await browser.newContext({ userAgent: UA, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const q = encodeURIComponent(interest);
  const sources = [];
  let keywords = { autocomplete: [], related: [] };

  try {
    log(`"${interest}" 관련 검색 키워드 찾는 중...`);
    keywords = await collectKeywords(page, interest, log);

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
  return { sources, keywords };
}
