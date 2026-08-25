#!/usr/bin/env node
// kr-ai-news-collector — 한국 IT 언론·커뮤니티 RSS에서 AI 뉴스만 걸러 모으는 수집기.
// 외부 의존성 0 (Node 18+ 내장 fetch/fs만 사용). API 키·DB·계정 불필요.
//
// 실행:  node collect.mjs
// 결과:  output/digest-YYYY-MM-DD.md (사람이 읽는 다이제스트)
//        data/items.jsonl            (기계가 읽는 누적 데이터)
//        data/seen-urls.json         (중복 방지 상태 — 지우면 처음부터 다시 수집)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────
// 설정 — 이 블록만 고치면 됩니다.
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // 필터 프리셋: "ai"(넓게 — AI 관련 뉴스 전반) | "skill-launch"(좁게 — 서비스의 AI 연동/스킬 출시 발표만)
  preset: "ai",

  // 수집할 RSS 피드. 전부 공개 RSS이고 robots.txt에서 일반 크롤러(`*`)에 허용된 곳만 실었습니다(2026-08 확인).
  // 피드를 추가할 때는 해당 사이트의 robots.txt와 이용약관을 직접 확인하세요.
  feeds: [
    { name: "GeekNews",     url: "https://news.hada.io/rss/news" },
    { name: "AI타임스",     url: "https://www.aitimes.com/rss/allArticle.xml" },
    { name: "ZDNet Korea",  url: "https://feeds.feedburner.com/zdkorea" },
    { name: "블로터",       url: "https://www.bloter.net/rss/allArticle.xml" },
    { name: "플래텀",       url: "https://platum.kr/feed" },
    { name: "벤처스퀘어",   url: "https://www.venturesquare.net/feed" },
  ],

  feedDelayMs: 1000, // 피드 간 간격 (crawl-delay 존중 — 줄이지 않기를 권합니다)
  maxSeenUrls: 5000, // 중복 방지 목록 최대 크기 (오래된 것부터 잘림)
};

// 필터 프리셋 정의.
// "ai": 제목에 AI 관련어가 하나라도 있으면 수집.
// "skill-launch": 전체기사 피드에서 오탐을 줄이려고 2단으로 거릅니다 —
//   강신호(MCP·스킬·플러그인·커넥터)는 단독 통과, 약신호(에이전트·모델명 등)는
//   출시성 동사(출시·오픈·공개…)가 같이 있어야 통과. (aihubkorea.kr 운영에서 검증된 설정:
//   전체 170건 스캔 → 매칭 1건, 오탐 0)
const PRESETS = {
  ai: (title) =>
    /(AI|인공지능|LLM|GPT|챗GPT|ChatGPT|클로드|Claude|제미나이|Gemini|생성형|오픈AI|OpenAI|딥러닝|머신러닝|에이전트|MCP)/i.test(title),
  "skill-launch": (title) =>
    /(MCP|스킬|플러그인|커넥터|Skills?)/i.test(title) ||
    (/(에이전트|연동|클로드|Claude|챗GPT|ChatGPT|GPT)/i.test(title) &&
      /(출시|오픈|공개|선보|도입|지원|런칭)/.test(title)),
};

// ─────────────────────────────────────────────────────────────
// 이하 구현 — 보통은 손댈 필요 없습니다.
// ─────────────────────────────────────────────────────────────

// HTTP 헤더 값은 ASCII만 허용됩니다 — 한글을 넣으면 fetch가 ByteString 오류로 죽습니다.
const UA = { "user-agent": "kr-ai-news-collector/1.0 (open-source rss reader; +https://github.com/migkjy/kr-ai-news-collector)" };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "output");
const SEEN_FILE = path.join(DATA_DIR, "seen-urls.json");
const ITEMS_FILE = path.join(DATA_DIR, "items.jsonl");

const match = PRESETS[CONFIG.preset];
if (!match) {
  console.error(`알 수 없는 preset: "${CONFIG.preset}" — "ai" 또는 "skill-launch" 중 하나여야 합니다.`);
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function parseFeed(xml) {
  // RSS 2.0(<item>)과 Atom(<entry>) 모두 처리. CDATA 유무 모두 처리.
  // (GeekNews는 Atom이라 RSS만 파싱하면 조용히 0건이 됩니다 — 실측 2026-08-25)
  const items = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1]?.trim();
    const link = (block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) ?? [])[1]?.trim();
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1]?.trim() ?? "";
    if (title && link) items.push({ title: decodeEntities(title), link, pub });
  }
  if (items.length) return items;
  for (const m of xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1]?.trim();
    const link = (block.match(/<link[^>]*href=['"]([^'"]+)['"]/) ?? [])[1]?.trim();
    const pub = (block.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/) ?? [])[1]?.trim() ?? "";
    if (title && link) items.push({ title: decodeEntities(title), link, pub });
  }
  return items;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))); }
  catch { return new Set(); }
}

function saveSeen(seen) {
  const arr = [...seen].slice(-CONFIG.maxSeenUrls);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(arr, null, 0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 수집 ──
const seen = loadSeen();
const collected = []; // 이번 실행에서 새로 발견한 것
const now = new Date();
const today = now.toISOString().slice(0, 10);
const hhmm = now.toTimeString().slice(0, 5);

for (const feed of CONFIG.feeds) {
  try {
    const res = await fetch(feed.url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text());
    let matched = 0, added = 0;
    for (const it of items) {
      if (!match(it.title)) continue;
      matched++;
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      collected.push({ feed: feed.name, ...it });
      added++;
    }
    console.log(`${feed.name}: 전체 ${items.length} · 매칭 ${matched} · 신규 ${added}`);
  } catch (e) {
    // 피드 하나가 죽어도 나머지는 계속 — 실패는 표시만 하고 넘어갑니다.
    console.error(`${feed.name} 실패: ${e.message}`);
  }
  await sleep(CONFIG.feedDelayMs);
}

// ── 저장 ──
if (collected.length) {
  const lines = collected.map((c) =>
    JSON.stringify({ collected_at: now.toISOString(), feed: c.feed, title: c.title, url: c.link, pub: c.pub })
  );
  fs.appendFileSync(ITEMS_FILE, lines.join("\n") + "\n");

  const digestFile = path.join(OUT_DIR, `digest-${today}.md`);
  let md = "";
  if (!fs.existsSync(digestFile)) md += `# AI 뉴스 다이제스트 — ${today}\n`;
  md += `\n## ${hhmm} 실행 — 신규 ${collected.length}건\n\n`;
  for (const c of collected) {
    md += `- [${c.title}](${c.link}) — ${c.feed}${c.pub ? ` · ${c.pub}` : ""}\n`;
  }
  fs.appendFileSync(digestFile, md);
  console.log(`\n신규 ${collected.length}건 → ${path.relative(ROOT, digestFile)}`);
} else {
  console.log("\n신규 없음 (전부 이미 수집됐거나 매칭 0건)");
}
saveSeen(seen);
