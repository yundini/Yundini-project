# 블로그 오토파일럿 — Claude 안내

사용자는 Mac에서 이 앱을 실행하고, 아이패드 Safari로 대시보드에 접속해 네이버 블로그 글을 작성한다.
사용자는 한국어로 대화하며 터미널에 익숙하지 않으니, 쉬운 말과 복사해서 쓸 수 있는 명령어로 안내한다.

## "블로그 작업 시작할게"라고 하면

사용자가 **"블로그 작업 시작할게"**(또는 비슷한 말)라고 하면, 아래 실행 명령어와 순서를 바로 보여준다.

1. Mac에서 **command + 스페이스** → `터미널` 입력 → 엔터
2. 아래 명령어를 붙여넣고 엔터 (맨 앞이 `bash`로 시작하는지 확인)
   ```
   bash ~/Downloads/Yundini-project-claude-git-installation-question-ccpzl1/start.command
   ```
3. 터미널에 나온 **접속 주소**(`http://192.168.219.○○:3000`)를 아이패드 Safari에 입력
4. 터미널 창은 닫지 말고 그대로 둔다 (닫으면 앱도 꺼짐)
5. 대시보드 위쪽 버튼 확인: 브라우저 준비됨 / 네이버 로그인됨 / 새 버전 있으면 업데이트

## 사용자 환경

- Mac: macOS 12 (Monterey). Playwright의 Chromium을 지원하지 않아 **Google Chrome**으로 동작한다.
- 앱 폴더: `~/Downloads/Yundini-project-claude-git-installation-question-ccpzl1`
- 새 버전은 대시보드의 **업데이트 버튼**으로 받는다 (GitHub 저장소는 공개, 기본 브랜치에서 받아 옴).
- 이 클라우드 세션에서는 네이버에 접속할 수 없고 사용자의 Mac에도 접근할 수 없다. 실제 동작 확인은 사용자가 Mac/아이패드에서 하고, 오류는 진행 기록과 오류 화면 스크린샷으로 받는다.

## 자주 있었던 문제

| 증상 | 해결 |
| --- | --- |
| 아이패드에서 "페이지를 열 수 없음" | Mac 터미널에서 앱이 켜져 있는지, 접속 주소가 바뀌었는지 확인 |
| `address already in use` | `lsof -ti tcp:3000 \| xargs kill` 후 다시 실행 (최신 start.command는 자동 처리) |
| AI 연결 실패 `Not logged in` | 새 터미널 창에서 `~/Downloads/Yundini-project-claude-git-installation-question-ccpzl1/node_modules/.bin/claude` 실행 → `/login` → `/exit` |
| 붙여넣은 명령어 앞에 `^[[200~`, `~` 같은 글자가 붙음 | 지우고 다시 엔터, 또는 짧은 명령어로 나눠서 안내 |
