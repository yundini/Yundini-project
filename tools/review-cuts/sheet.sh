#!/bin/bash
# 영상 한 개를 훑어볼 수 있게 시간이 찍힌 썸네일 한 장으로 만든다.
# 사용: bash sheet.sh 영상파일 결과.jpg [가로칸수] [세로칸수]
set -euo pipefail
video="$1"; out="$2"; cols="${3:-8}"; rows="${4:-3}"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
step=$(python3 -c "print(max(0.5, $dur / ($cols * $rows)))")
ffmpeg -v error -y -i "$video" \
  -vf "fps=1/$step,scale=240:-2,drawtext=text='%{pts\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black,tile=${cols}x${rows}" \
  -frames:v 1 "$out"
echo "$out (영상 ${dur}초, ${step}초 간격)"
