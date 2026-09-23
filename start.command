#!/bin/bash
# Mac에서 더블클릭하면 대시보드를 실행해요.
#  - Node.js(22 이상)는 https://nodejs.org 에서 직접 설치해 주세요.
#  - Claude Code는 이 폴더 안에 자동으로 설치돼요 (Claude 앱은 필요 없어요).
cd "$(dirname "$0")"

fail() {
  echo ""
  echo "❌ $1"
  read -r -p "엔터를 누르면 닫혀요."
  exit 1
}

# ---- 1. Node.js 확인 ----
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  if [ -z "$NODE_MAJOR" ]; then
    echo "Node.js가 설치되어 있지 않아요."
  else
    echo "Node.js 버전이 낮아요 (현재 $(node -v), 22 이상 필요)."
  fi
  echo ""
  echo "  1) 곧 열리는 nodejs.org 페이지에서 LTS 버전(macOS 설치 프로그램 .pkg)을 받아 설치하세요."
  echo "  2) 설치가 끝나면 이 창을 닫고 start.command를 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download" 2>/dev/null
  fail "Node.js 설치 후 다시 실행해 주세요."
fi
echo "✔ Node.js $(node -v)"

# ---- 2. 패키지 설치 (Claude Code, Playwright 포함) ----
if [ ! -x node_modules/.bin/claude ] || [ package.json -nt node_modules ]; then
  echo "▶ 필요한 패키지를 설치해요... (처음 한 번, 몇 분 걸릴 수 있어요)"
  npm install --no-audit --no-fund || fail "패키지 설치에 실패했어요. 화면을 캡처해서 알려주세요."
  touch node_modules
fi
CLAUDE="$PWD/node_modules/.bin/claude"
echo "✔ Claude Code $("$CLAUDE" --version 2>/dev/null | head -n 1)"

# ---- 3. Claude 로그인 확인 (구독 요금제 사용을 위해 API 키는 쓰지 않음) ----
unset ANTHROPIC_API_KEY
# 응답이 성공이고 오류 표시(is_error)가 없어야 로그인된 것으로 본다
claude_ok() {
  "$CLAUDE" -p "ok" --output-format json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s); process.exit(j.subtype === "success" && !j.is_error ? 0 : 1); }
      catch { process.exit(1); }
    });'
}
if ! claude_ok; then
  echo ""
  echo "▶ Claude 로그인이 필요해요."
  echo "  곧 Claude Code가 열려요. 로그인 화면이 안 나오면 /login 을 입력하세요."
  echo "  로그인 방식에서 구독 계정(Claude account with subscription)을 고르고,"
  echo "  브라우저에서 평소 쓰는 Claude 계정으로 로그인하세요."
  echo "  로그인이 끝나면 /exit 를 입력해서 나오면 대시보드가 이어서 실행돼요."
  read -r -p "  준비되면 엔터를 누르세요."
  "$CLAUDE" || true
  claude_ok ||
    fail "Claude 로그인이 확인되지 않았어요. start.command를 다시 실행해 주세요."
fi
echo "✔ Claude 로그인 확인"

# ---- 4. 실행 (실행 중에는 Mac 잠자기 방지, 창을 닫으면 해제) ----
exec caffeinate -i npm start
