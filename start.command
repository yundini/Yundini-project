#!/bin/bash
# Mac에서 더블클릭하면 대시보드가 실행돼요.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없어요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  read -r -p "엔터를 누르면 닫혀요."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "처음 실행이라 필요한 패키지를 설치해요..."
  npm install --no-audit --no-fund || exit 1
fi
npm start
