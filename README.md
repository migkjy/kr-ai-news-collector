# kr-ai-news-collector

매일 아침 AI 뉴스 훑는 시간을 없애는 수집기. 한국 IT 언론·커뮤니티 RSS 6곳에서 **AI 관련 기사만 걸러** 마크다운 다이제스트로 만들어 줍니다.

- **의존성 0** — `npm install` 없음. Node 18 이상만 있으면 됩니다.
- **API 키·계정·DB 불필요** — 전부 공개 RSS.
- **비용 0** — 크레딧 쓰는 곳이 없습니다.

실제로 [aihubkorea.kr](https://aihubkorea.kr)의 콘텐츠 파이프라인에서 매일 돌고 있는 수집 로직을 단독 실행형으로 분리한 것입니다.

## 시작하기 (30초)

먼저 Node 18 이상이 필요합니다. `node -v`로 확인하고, 없거나 낮으면 [nodejs.org](https://nodejs.org)에서 LTS를 설치하세요.

```bash
git clone https://github.com/migkjy/kr-ai-news-collector.git
cd kr-ai-news-collector
node collect.mjs
```

끝입니다. 실행하면 이런 식으로 나옵니다(수치는 실행 시점마다 다릅니다):

```
GeekNews: 전체 50 · 매칭 13 · 신규 13
AI타임스: 전체 50 · 매칭 21 · 신규 21
ZDNet Korea: 전체 30 · 매칭 14 · 신규 14
...
신규 72건 → output/digest-2026-08-25.md
```

| 파일 | 내용 |
|---|---|
| `output/digest-YYYY-MM-DD.md` | 사람이 읽는 일별 다이제스트 (제목·링크·출처) |
| `data/items.jsonl` | 기계가 읽는 누적 데이터 (한 줄 = 기사 한 건) |
| `data/seen-urls.json` | 중복 방지 상태 — 같은 기사는 두 번 안 잡힙니다 |

두 번째 실행부터는 **새로 올라온 기사만** 다이제스트에 추가됩니다.

## 수집 대상

| 피드 | 성격 |
|---|---|
| GeekNews | 개발자 커뮤니티 — 신규 도구 조기 포착 |
| AI타임스 | AI 전문지 |
| ZDNet Korea | IT 전문지 |
| 블로터 | IT 전문지 |
| 플래텀 | 스타트업 미디어 |
| 벤처스퀘어 | 스타트업 미디어 |

전부 공개 RSS이고, robots.txt에서 일반 크롤러(`*`)에 허용된 곳만 실었습니다(2026-08 확인). 피드 간 1초 간격으로 요청하고, **제목·링크·발행시각만** 수집합니다(본문 미수집).

참고: 일부 매체는 AI 학습용 크롤러(GPTBot 등)를 별도로 차단하고 있습니다. 이 도구는 RSS 리더로서 `*` 규칙을 따르지만, **수집한 데이터를 AI 학습이나 본문 재가공에 쓰려면 각 매체의 정책을 직접 확인하세요.**

## 매일 자동으로 돌리기

**Linux/macOS (cron)** — 매일 08:00 실행:

```bash
crontab -e
# 아래 한 줄 추가 (경로는 자신의 클론 위치로)
0 8 * * * cd $HOME/kr-ai-news-collector && node collect.mjs >> cron.log 2>&1
```

nvm으로 Node를 설치했다면 cron에서는 `node`를 못 찾을 수 있습니다 — `which node`로 나온 전체 경로(예: `~/.nvm/versions/node/v20.x.x/bin/node`)를 대신 쓰세요.

**Windows** — 작업 스케줄러에서 "프로그램 시작" 동작으로 `node.exe` 전체 경로, 인수 `collect.mjs`, 시작 위치를 클론 폴더로 지정. 콘솔에서 한글이 깨지면 `chcp 65001`(UTF-8) 후 실행하세요(출력 파일 자체는 항상 UTF-8로 정상 저장됩니다).

## 입맛대로 고치기

설정은 전부 `collect.mjs` 맨 위 `CONFIG` 블록에 있습니다.

### 필터 바꾸기

```js
preset: "ai",            // 넓게 — AI 관련 뉴스 전반 (기본값)
preset: "skill-launch",  // 좁게 — 서비스의 AI 연동·스킬·MCP 출시 발표만
```

소스를 고치지 않고 실행 시점에 바꿀 수도 있습니다:

```bash
node collect.mjs --preset skill-launch
```

`skill-launch`는 오탐을 줄이려고 2단으로 거릅니다: 강신호(MCP·스킬·플러그인·커넥터)는 단독 통과, 약신호(에이전트·모델명)는 출시성 동사(출시·오픈·공개…)가 함께 있어야 통과. 실운영에서 전체기사 170건 스캔에 오탐 0으로 검증된 설정입니다.

키워드 자체를 바꾸려면 `PRESETS` 객체의 정규식을 수정하면 됩니다.

### 피드 추가

```js
feeds: [
  // ...기존 피드...
  { name: "새 피드", url: "https://example.com/rss" },
],
```

RSS 2.0(`<item>`)과 Atom(`<entry>`) 형식 모두 동작합니다. **추가 전에 해당 사이트의 robots.txt와 이용약관을 직접 확인하세요.**

## 자주 묻는 것

**Q. 실행했는데 "신규 없음"만 나옵니다.**
이미 한 번 수집한 기사는 다시 잡지 않습니다. 처음부터 다시 모으려면 `data/seen-urls.json`을 지우세요 — 단, 이 경우 기존 `data/items.jsonl`과 다이제스트에 같은 기사가 중복으로 다시 쌓입니다. 완전히 새로 시작하려면 `data/`와 `output/`을 함께 지우는 것을 권합니다.

**Q. 특정 피드가 "실패"로 나옵니다.**
해당 언론사 서버 문제거나 RSS 주소가 바뀐 것입니다. 피드 하나가 죽어도 나머지는 정상 수집됩니다.

**Q. 본문도 수집되나요?**
아닙니다. 제목·링크·발행시각만 수집합니다(저작권 안전 범위). 본문은 링크로 읽으세요.

## 라이선스

MIT
