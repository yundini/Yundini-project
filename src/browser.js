import { PROFILE_DIR } from './paths.js';
import { playwright, launchExtras } from './setup.js';

const VIEWPORT = { width: 1200, height: 860 };
const LOGIN_URL = 'https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fblog.naver.com';

let context = null;
let loginPage = null;
let busy = null; // 동시에 두 작업이 같은 브라우저를 쓰지 않게 막는다

// 네이버 로그인 세션을 저장하는 영구 브라우저 프로필.
// 쿠키가 data/naver-profile에 남아서 다음 실행 때도 로그인이 유지된다.
export async function getNaverContext() {
  if (context) return context;
  const { chromium } = await playwright();
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // 네이버는 헤드리스 브라우저를 잘 차단하므로 실제 창을 띄운다 (Mac 화면에 나타남)
    viewport: VIEWPORT,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    args: ['--disable-blink-features=AutomationControlled'],
    ...launchExtras(),
  });
  context.on('close', () => {
    context = null;
    loginPage = null;
  });
  return context;
}

export async function closeNaverContext() {
  if (context) await context.close().catch(() => {});
  context = null;
  loginPage = null;
}

export async function withNaverBrowser(label, fn) {
  if (busy) throw new Error(`브라우저가 다른 작업(${busy}) 중이에요. 끝난 뒤 다시 시도해 주세요.`);
  busy = label;
  try {
    return await fn(await getNaverContext());
  } finally {
    busy = null;
  }
}

async function hasSessionCookies(ctx) {
  const cookies = await ctx.cookies('https://www.naver.com');
  const names = new Set(cookies.map((c) => c.name));
  return names.has('NID_AUT') && names.has('NID_SES');
}

export async function loginStatus() {
  if (!context) {
    // 브라우저를 띄우지 않고 저장된 프로필만으로는 확인이 어려우므로, 필요할 때만 연다.
    return { browserOpen: false, loggedIn: null, loginInProgress: false };
  }
  return {
    browserOpen: true,
    loggedIn: await hasSessionCookies(context),
    loginInProgress: !!loginPage && !loginPage.isClosed(),
  };
}

export async function checkLogin() {
  if (busy) return { ...(await loginStatus()), busy };
  const ctx = await getNaverContext();
  return { browserOpen: true, loggedIn: await hasSessionCookies(ctx), loginInProgress: !!loginPage };
}

// ---- 원격 로그인: 아이패드에서 Mac의 브라우저 화면을 보며 로그인 ----

export async function startLogin() {
  if (busy) throw new Error(`브라우저가 다른 작업(${busy}) 중이에요.`);
  const ctx = await getNaverContext();
  if (!loginPage || loginPage.isClosed()) {
    loginPage = await ctx.newPage();
    await loginPage.setViewportSize(VIEWPORT);
  }
  await loginPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await loginPage.bringToFront();
  return { viewport: VIEWPORT };
}

function requireLoginPage() {
  if (!loginPage || loginPage.isClosed()) throw new Error('로그인 화면이 열려 있지 않아요.');
  return loginPage;
}

export async function loginScreenshot() {
  return requireLoginPage().screenshot({ type: 'jpeg', quality: 60 });
}

export async function loginClick(x, y) {
  await requireLoginPage().mouse.click(x, y);
}

export async function loginType(text) {
  await requireLoginPage().keyboard.type(text, { delay: 60 });
}

const ALLOWED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export async function loginKey(key) {
  if (!ALLOWED_KEYS.has(key)) throw new Error('지원하지 않는 키예요.');
  await requireLoginPage().keyboard.press(key);
}

export async function finishLogin() {
  const ctx = await getNaverContext();
  const loggedIn = await hasSessionCookies(ctx);
  if (loggedIn && loginPage && !loginPage.isClosed()) {
    await loginPage.close();
    loginPage = null;
  }
  return { loggedIn };
}

export async function logout() {
  const ctx = await getNaverContext();
  await ctx.clearCookies();
  return { loggedIn: false };
}
