"""뽑은 사진 폴더로 '한 번에 받기' 버튼이 있는 사진 모음 페이지(Artifact)를 만든다.

사용: python3 gallery.py 사진폴더 페이지폴더 "페이지 제목" ["설명 한 줄"]
- 사진폴더의 01_장면이름.jpg 파일들을 페이지폴더/photos/p01.jpg로 복사하고 index.html을 만든다.
- 마지막 줄에 Artifact 게시용 files 목록(JSON)을 출력한다.
  Artifact 게시: file_path=페이지폴더/index.html, files=그 JSON, capabilities={"downloads": true}
"""
import glob, json, os, shutil, sys

src, page, title = sys.argv[1], sys.argv[2], sys.argv[3]
meta = sys.argv[4] if len(sys.argv) > 4 else "영상 원본 프레임 · 원본 화질"
os.makedirs(os.path.join(page, "photos"), exist_ok=True)
photos, files = [], {}
for f in sorted(glob.glob(os.path.join(src, "*.jpg"))):
    stem = os.path.splitext(os.path.basename(f))[0]
    n, _, slug = stem.partition("_")
    dst = os.path.join(page, "photos", f"p{n}.jpg")
    shutil.copyfile(f, dst)
    files[f"photos/p{n}.jpg"] = os.path.abspath(dst)
    photos.append([n, slug, slug.replace("_", " ")])
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gallery.html"), encoding="utf-8").read()
html = (tpl.replace("__PHOTOS__", json.dumps(photos, ensure_ascii=False))
           .replace("__TITLE__", title).replace("__META__", meta)
           .replace("__COUNT__", str(len(photos)))
           .replace("__ZIPNAME__", title.replace(" ", "_") + ".zip"))
open(os.path.join(page, "index.html"), "w", encoding="utf-8").write(html)
print(f"{len(photos)}장 → {os.path.abspath(page)}/index.html")
print(json.dumps(files, ensure_ascii=False))
