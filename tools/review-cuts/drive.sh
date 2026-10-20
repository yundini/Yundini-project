#!/bin/bash
# Google 드라이브 공유 링크(파일 또는 폴더)에서 영상을 받는다.
# 공유가 "링크가 있는 모든 사용자"여야 한다. 아니면 로그인 화면(HTML)이 받아진다.
# 사용: bash drive.sh "드라이브링크" 저장폴더
set -euo pipefail
link="$1"; dir="$2"; mkdir -p "$dir"
get() {  # $1=파일ID $2=저장이름
  curl -sSL --max-time 1800 -o "$dir/$2" "https://drive.usercontent.google.com/download?id=$1&export=download&confirm=t"
  if file "$dir/$2" | grep -q HTML; then
    echo "실패: $2 — 공유가 '링크가 있는 모든 사용자'로 되어 있는지 확인" >&2; rm -f "$dir/$2"; return 1
  fi
  echo "받음: $dir/$2"
}
if [[ "$link" == *"/folders/"* ]]; then
  fid=$(sed -E 's|.*/folders/([A-Za-z0-9_-]+).*|\1|' <<<"$link")
  page=$(curl -sSL "https://drive.google.com/embeddedfolderview?id=$fid")
  python3 -c '
import re,sys
h=sys.stdin.read()
for m in re.finditer(r"file/d/([A-Za-z0-9_-]+).*?flip-entry-title\">([^<]+)",h,re.S): print(m.group(1),m.group(2))' <<<"$page" | sort -u |
  while read -r id name; do get "$id" "$name"; done
else
  id=$(sed -E 's|.*/d/([A-Za-z0-9_-]+).*|\1|; s|.*[?&]id=([A-Za-z0-9_-]+).*|\1|' <<<"$link")
  get "$id" "$id.mov"
fi
