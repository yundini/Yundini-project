#!/bin/bash
# Mac에서 더블클릭하면 필요한 것을 알아서 준비하고 대시보드를 실행해요.
#  1) Node.js가 없으면 이 폴더 안(.runtime)에 받아서 사용 (Mac 전체에는 설치하지 않음)
#  2) Claude Code가 없으면 설치하고, 로그인이 안 되어 있으면 로그인 화면을 띄움
#  3) 패키지 설치 후 대시보드 실행 (Playwright/Chromium은 앱이 자동 설치)
set -e
cd "$(dirname "$0")"

RUNTIME_DIR="$PWD/.runtime"
NODE_DIR="$RUNTIME_DIR/node"
export PATH="$NODE_DIR/bin:$HOME/.local/bin:$PATH"

fail() {
  echo ""
  echo "❌ $1"
  read -r -p "엔터를 누르면 닫혀요."
  exit 1
}

# ---- 1. Node.js ----
if ! command -v node >/dev/null 2>&1; then
  echo "▶ Node.js가 없어서 이 폴더 안에 받아요. (처음 한 번, 1분 정도)"
  case "$(uname -m)" in
    arm64) ARCH="darwin-arm64" ;;
    x86_64) ARCH="darwin-x64" ;;
    *) fail "지원하지 않는 Mac이에요: $(uname -m)" ;;
  esac
  BASE="https://nodejs.org/dist/latest-v22.x"
  LINE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E "node-v[0-9.]+-$ARCH\.tar\.gz$" | head -n 1)" ||
    fail "Node.js 다운로드 목록을 받지 못했어요. 인터넷 연결을 확인해 주세요."
  SUM="${LINE%% *}"
  FILE="${LINE##* }"
  [ -n "$FILE" ] || fail "Node.js 파일을 찾지 못했어요."

  mkdir -p "$RUNTIME_DIR"
  curl -fL --progress-bar "$BASE/$FILE" -o "$RUNTIME_DIR/$FILE" || fail "Node.js 다운로드에 실패했어요."
  echo "$SUM  $RUNTIME_DIR/$FILE" | shasum -a 256 -c - >/dev/null || fail "받은 Node.js 파일이 손상됐어요. 다시 실행해 주세요."

  rm -rf "$NODE_DIR"
  tar -xzf "$RUNTIME_DIR/$FILE" -C "$RUNTIME_DIR"
  mv "$RUNTIME_DIR/${FILE%.tar.gz}" "$NODE_DIR"
  rm -f "$RUNTIME_DIR/$FILE"
fi
echo "✔ Node.js $(node -v)"

# ---- 2. Claude Code ----
if ! command -v claude >/dev/null 2>&1; then
  echo "▶ Claude Code를 설치해요..."
  curl -fsSL https://claude.ai/install.sh | bash || fail "Claude Code 설치에 실패했어요."
  hash -r
  command -v claude >/dev/null 2>&1 || fail "Claude Code를 설치했지만 찾지 못했어요. 터미널을 닫고 다시 실행해 주세요."
fi
echo "✔ Claude Code $(claude --version 2>/dev/null | head -n 1)"

# 구독 요금제로 쓰기 위해 API 키 대신 로그인 계정을 사용한다
unset ANTHROPIC_API_KEY
if ! claude -p "ok" --output-format json 2>/dev/null | grep -q '"subtype":"success"'; then
  echo ""
  echo "▶ Claude 로그인이 필요해요."
  echo "  곧 Claude Code가 열리면 안내에 따라 구독 계정(Pro/Max)으로 로그인하세요."
  echo "  로그인이 끝나면 /exit 를 입력해서 나오면 돼요. 그러면 대시보드가 이어서 실행돼요."
  read -r -p "  준비되면 엔터를 누르세요."
  claude || true
  claude -p "ok" --output-format json 2>/dev/null | grep -q '"subtype":"success"' ||
    fail "Claude 로그인이 확인되지 않았어요. start.command를 다시 실행해 주세요."
fi
echo "✔ Claude 로그인 확인"

# ---- 3. 패키지 설치 & 실행 ----
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "▶ 필요한 패키지를 설치해요..."
  npm install --no-audit --no-fund || fail "패키지 설치에 실패했어요."
  touch node_modules
fi

# 작업하는 동안 Mac이 잠자기에 들어가지 않게 한다 (창을 닫으면 해제)
exec caffeinate -i npm start
