#!/usr/bin/env node

/**
 * quiz-gen.js
 * Notion Vocabulary Bank → 주간 퀴즈 HTML 생성 + GitHub Pages 자동 배포
 *
 * 사용법:
 *   node quiz-gen.js          ← 이번 주 (ISO 주차 자동 감지)
 *   node quiz-gen.js --all    ← 전체 주차 누적 (GitHub Actions 기본값)
 *   node quiz-gen.js W23      ← 특정 주차 지정
 *   node quiz-gen.js W23 W24  ← 여러 주차 합산
 *
 * 필요 환경변수 (.env 파일):
 *   NOTION_TOKEN=secret_xxxx
 *   GITHUB_TOKEN=ghp_xxxx
 *   GITHUB_USER=Hyokeum97     (기본값 설정됨)
 *   GITHUB_REPO=vocab-quiz    (기본값 설정됨)
 */

import { Client } from '@notionhq/client';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA_SOURCE_ID = '9b1915599143471987e4113b6738d795';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  });
}

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER  = process.env.GITHUB_USER || 'Hyokeum97';
const GITHUB_REPO  = process.env.GITHUB_REPO || 'vocab-quiz';

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN이 없어. .env 파일을 확인해줘.');
  process.exit(1);
}

const CAT_EMOJI = {
  Politics:'🏛️', Economy:'💹', Media:'📰', Society:'🌐',
  Science:'🔬', Health:'🌿', Crime:'⚖️', War:'🪖',
  Opinion:'💬', British:'🇬🇧', Emotion:'😤', Mystery:'🕵️',
  Character:'🎭', Nature:'🌿', Speech:'💬', Action:'⚔️',
  Thought:'🧠', Physical:'🏥', Literary:'📜',
};

function getCurrentISOWeek() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `W${String(week).padStart(2, '0')}`;
}

function sanitize(str) {
  return str.replace(/~/g, '').replace(/·/g, ', ').replace(/[`]/g, '').trim();
}

async function fetchWords(notion, weeks) {
  const words = [];
  let cursor;
  const label = weeks.length ? weeks.join(', ') : '전체 주차';
  console.log(`📡 Notion에서 ${label} 단어 가져오는 중...`);
  const filterProp = weeks.length === 0 ? {} : {
    filter: weeks.length === 1
      ? { property: 'Week', rich_text: { equals: weeks[0] } }
      : { or: weeks.map(w => ({ property: 'Week', rich_text: { equals: w } })) },
  };
  while (true) {
    const res = await notion.databases.query({
      database_id: DATA_SOURCE_ID,
      ...filterProp,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const p = page.properties;
      const word     = p.Word?.title?.[0]?.plain_text || '';
      const meaning  = p.Meaning?.rich_text?.[0]?.plain_text || '';
      const synonyms = p.Synonyms?.rich_text?.[0]?.plain_text || '';
      const category = p.Category?.select?.name || '';
      const week     = p.Week?.rich_text?.[0]?.plain_text || '';
      if (word && meaning)
        words.push({ word, meaning: sanitize(meaning), synonyms: sanitize(synonyms),
                     emoji: CAT_EMOJI[category] || '📖', week });
    }
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return words;
}

function buildVocabArray(words) {
  return words.map(w => {
    const e = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, ' ');
    return `['${e(w.word)}','${e(w.meaning)}','${e(w.synonyms)}','${w.emoji}','${w.week}']`;
  }).join(',\n');
}

function buildHTML(words, weeks) {
  const allWeeksInData = [...new Set(words.map(w => w.week))].sort();
  const weekLabel = weeks.length
    ? weeks.join('+')
    : (allWeeksInData.length <= 6
        ? allWeeksInData.join('+')
        : `${allWeeksInData[0]}–${allWeeksInData[allWeeksInData.length - 1]}`);
  const vocabArray = buildVocabArray(words);

  // ── 디자인: Claude Design "Vocabulary page redesign" 기반 (에디토리얼 / 세이지 그린) ──
  const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --paper:#F4F2EC;--surface:#FFFFFF;--surface2:#FBFAF7;--ink:#252320;--ink2:#4C473F;
  --muted:#938B7C;--faint:#BBB3A3;--line:#E9E4DA;--line2:#EFEBE2;
  --accent:#3C6E5A;--accent-ink:#2C5544;--accent-soft:#E7EFE9;
  --wrong:#BB5740;--wrong-soft:#F5E5DF;--gold:#C0922E;--gold-soft:#F4ECD7;
  --sans:'Pretendard Variable',Pretendard,system-ui,-apple-system,sans-serif;
  --serif:'Newsreader',Georgia,serif;
}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;padding:26px 16px 64px}
.wrap{max-width:780px;margin:0 auto}
input{outline:none}
button{font-family:inherit}
::placeholder{color:var(--faint)}
.hidden{display:none!important}
@keyframes vfadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:18px}
.head h1{font-family:var(--serif);font-size:28px;font-weight:600;letter-spacing:-.4px;line-height:1.05}
.head .sub{font-size:12.5px;color:var(--muted);margin-top:7px;letter-spacing:.2px}
.mastery{min-width:172px;flex:1;max-width:230px}
.mastery-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px}
.mastery-label{font-size:10.5px;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;font-weight:600}
.mastery-pct{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--accent-ink);line-height:1}
.mastery-bar{height:7px;background:var(--line);border-radius:99px;overflow:hidden;display:flex}
.mastery-bar .m1{height:100%;background:var(--accent);transition:width .4s}
.mastery-bar .m2{height:100%;background:var(--accent-soft);transition:width .4s}
.mastery-sub{font-size:10.5px;color:var(--faint);margin-top:7px}

.viewtabs{display:flex;gap:4px;background:var(--line2);padding:4px;border-radius:13px;margin-bottom:18px}
.vtab{flex:1;border:none;border-radius:9px;padding:9px 6px;font-size:13.5px;cursor:pointer;transition:.15s;white-space:nowrap;background:transparent;color:var(--muted);font-weight:500}
.vtab.on{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(45,38,25,.1)}

.filtercard{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:15px 17px;margin-bottom:18px}
.filterlabel{font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.9px;text-transform:uppercase;margin-bottom:9px}
.bar{display:flex;flex-wrap:wrap;gap:7px}
.bar.wk{margin-bottom:15px}
.chip{font-family:inherit;font-size:12.5px;padding:6px 12px;border-radius:99px;border:1px solid var(--line);cursor:pointer;transition:.13s;line-height:1.2;white-space:nowrap;background:transparent;color:var(--ink2)}
.chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}

.listtools{display:flex;gap:8px;margin-bottom:14px}
.searchwrap{flex:1;position:relative;display:flex;align-items:center}
.searchwrap .si{position:absolute;left:14px;font-size:13px;color:var(--faint);pointer-events:none}
.search{width:100%;padding:11px 14px 11px 38px;font-size:14px;font-family:inherit;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink)}
.searchx{position:absolute;right:8px;border:none;background:var(--line2);color:var(--muted);width:26px;height:26px;border-radius:8px;cursor:pointer;font-size:13px}
.staronly{font-family:inherit;font-size:12.5px;padding:7px 13px;border-radius:99px;border:1px solid var(--line);cursor:pointer;transition:.13s;white-space:nowrap;background:transparent;color:var(--gold)}
.staronly.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.listcount{font-size:12px;color:var(--muted);margin-bottom:12px;letter-spacing:.2px}
.listwrap{display:flex;flex-direction:column;gap:8px}
.lrow{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:13px 15px;display:flex;align-items:flex-start;gap:14px}
.lrow-main{flex:1;min-width:0}
.lrow-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.lw{font-family:var(--serif);font-size:17.5px;font-weight:600;color:var(--ink);word-break:break-word}
.lwk{font-size:9.5px;color:var(--faint);letter-spacing:.5px}
.lm{font-size:14.5px;color:var(--ink2);margin-top:4px;line-height:1.45}
.ls{font-size:12px;color:var(--muted);font-style:italic;margin-top:3px;line-height:1.4}
.lrow-side{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}
.lrow-btns{display:flex;gap:6px}
.iconbtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surface);cursor:pointer;font-size:13px;color:var(--muted)}
.iconbtn:disabled{opacity:.4;cursor:default}
.starbtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surface);cursor:pointer;font-size:15px;line-height:1;color:var(--faint)}
.starbtn.on{border-color:var(--gold);background:var(--gold-soft);color:var(--gold)}
.lcat{font-size:10.5px;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:99px;padding:2px 9px;white-space:nowrap}
.dots{display:flex;gap:3px}
.dot{width:13px;height:4px;border-radius:2px;background:var(--line)}
.dot.on{background:var(--accent)}
.listempty{text-align:center;padding:48px;color:var(--muted);font-style:italic}

.modes{display:flex;gap:4px;background:var(--line2);padding:4px;border-radius:12px;margin-bottom:13px}
.mode{flex:1;border:none;border-radius:9px;padding:9px 6px;font-family:inherit;font-size:13.5px;cursor:pointer;transition:.15s;white-space:nowrap;background:transparent;color:var(--muted);font-weight:500}
.mode.on{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(45,38,25,.1)}
.quick{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.q{font-family:inherit;font-size:12.5px;padding:7px 13px;border-radius:99px;border:1px solid var(--line);cursor:pointer;transition:.13s;line-height:1.2;white-space:nowrap;background:transparent}
.q.qwrong{color:var(--wrong)}
.q.qwrong.on{background:var(--wrong);color:#fff;border-color:var(--wrong)}
.q.qstar{color:var(--gold)}
.q.qstar.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.q.qsmart{color:var(--accent)}
.q.qsmart.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.spacer{flex:1;min-width:6px}

.stats{display:flex;gap:8px;margin-bottom:14px}
.stat{flex:1;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 6px;text-align:center}
.stat.tap{cursor:pointer}
.stat b{font-family:var(--serif);font-size:21px;font-weight:600;line-height:1;display:block;color:var(--ink)}
.stat.c b{color:var(--accent)}
.stat.w b{color:var(--wrong)}
.stat.s b{color:var(--gold)}
.stat span{font-size:10.5px;color:var(--muted);margin-top:4px;display:block}
.prog{height:6px;background:var(--line);border-radius:99px;overflow:hidden;margin-bottom:20px}
.prog>div{height:100%;background:var(--accent);border-radius:99px;width:0;transition:width .35s}

.flipwrap{perspective:1500px;margin-bottom:13px}
.flipinner{position:relative;transform-style:preserve-3d;transition:transform .55s cubic-bezier(.4,.05,.2,1);min-height:288px}
.flipinner.flipped{transform:rotateY(180deg)}
.face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 6px 26px rgba(45,38,25,.06);padding:34px 26px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.face.front{cursor:pointer}
.face.back{transform:rotateY(180deg)}
.cardwk{position:absolute;top:13px;left:15px;font-size:10px;color:var(--faint);letter-spacing:.6px}
.cardstar{position:absolute;top:10px;right:12px}
.cardtts{position:absolute;bottom:13px;right:12px}
.carddots{position:absolute;bottom:18px;left:15px;display:flex;gap:3px}
.cardword{font-family:var(--serif);font-size:clamp(26px,6.5vw,40px);font-weight:600;text-align:center;line-height:1.1;word-break:break-word}
.cardhint{font-size:12px;color:var(--faint);margin-top:16px}
.cardmean{font-size:23px;color:var(--accent-ink);text-align:center;line-height:1.4;font-weight:500}
.cardsyn{font-size:13.5px;color:var(--muted);font-style:italic;margin-top:13px;text-align:center;line-height:1.5}
.cardcat{font-size:11.5px;color:var(--faint);margin-top:16px}

.scard{background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 6px 26px rgba(45,38,25,.06);padding:30px 26px;min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;margin-bottom:13px;animation:vfadein .3s ease}
.scard .cardword{font-size:clamp(24px,5.5vw,34px)}

.btns{display:flex;gap:8px}
.btn{flex:1;padding:14px;font-size:14.5px;font-weight:600;border-radius:12px;cursor:pointer;border:none;font-family:inherit}
.btn-no{border:1px solid var(--wrong);background:var(--wrong-soft);color:var(--wrong)}
.btn-ok{background:var(--accent);color:#fff}
.btn-flip{width:100%;background:var(--ink);color:var(--paper)}

.opts{display:flex;flex-direction:column;gap:9px}
.opt{width:100%;text-align:left;font-family:inherit;font-size:14.5px;line-height:1.4;padding:13px 16px;border-radius:12px;border:1px solid var(--line);background:var(--surface);cursor:pointer;transition:.13s;color:var(--ink2)}
.opt.correct{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.opt.wrong{background:var(--wrong-soft);border-color:var(--wrong);color:var(--wrong)}
.opt.dim{opacity:.45}

.tinp{width:100%;padding:13px 15px;font-size:16px;font-family:inherit;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);text-align:center}
.tfeedback{margin-top:12px;padding:14px 16px;border-radius:12px;text-align:center;border:1px solid var(--line)}
.tfeedback.ok{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)}
.tfeedback.no{border-color:var(--wrong);background:var(--wrong-soft);color:var(--wrong)}
.tfeedback .tlabel{font-size:13px;font-weight:600;margin-bottom:6px}
.tfeedback .tmean{font-size:15px;color:var(--ink2);line-height:1.4}
.tfeedback .tsyn{font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;line-height:1.4}
.btn-next{width:100%;background:var(--accent);color:#fff;margin-top:10px}
.btn-check{width:100%;background:var(--ink);color:var(--paper);margin-top:10px}

.end{background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 6px 26px rgba(45,38,25,.06);padding:38px 26px;text-align:center;animation:vfadein .35s ease}
.endring{width:128px;height:128px;border-radius:50%;margin:0 auto 18px;display:flex;align-items:center;justify-content:center}
.endring-in{width:96px;height:96px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center}
.endpct{font-family:var(--serif);font-size:32px;font-weight:600;color:var(--accent-ink);line-height:1}
.endscore{font-size:14px;color:var(--ink2)}
.endquote{font-family:var(--serif);font-style:italic;color:var(--muted);margin:16px auto 22px;font-size:15.5px;line-height:1.6;max-width:340px}
.endbtns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.endbtns .btn{flex:none;padding:12px 20px;font-size:14px;border-radius:11px}
.btn-restart{background:var(--ink);color:var(--paper)}
.btn-reset{margin-top:16px;padding:8px 14px;font-size:12px;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:9px;cursor:pointer}

.qutil{display:flex;justify-content:center;margin-top:18px}
.empty{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:54px 24px;text-align:center;color:var(--muted);font-style:italic;line-height:1.6}
.save{text-align:center;font-size:11px;color:var(--faint);margin-top:22px;letter-spacing:.2px}

.panel-overlay{position:fixed;inset:0;background:rgba(35,30,20,.42);display:flex;align-items:flex-end;justify-content:center;z-index:50;animation:vfadein .2s ease}
.panel{background:var(--surface);border-radius:18px 18px 0 0;width:100%;max-width:780px;max-height:74vh;display:flex;flex-direction:column;box-shadow:0 -8px 34px rgba(0,0,0,.2)}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);font-size:15.5px;font-weight:600}
.panel-x{border:none;background:var(--line2);color:var(--muted);width:30px;height:30px;border-radius:9px;font-size:15px;cursor:pointer}
.panel-body{overflow-y:auto;padding:8px 20px 26px}
.panel-body::-webkit-scrollbar{width:8px}
.panel-body::-webkit-scrollbar-thumb{background:#E0DACE;border-radius:8px}
.panel-item{border-bottom:1px solid var(--line2);padding:12px 0}
.pi-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pi-w{font-family:var(--serif);font-size:16px;font-weight:600}
.pi-cat{font-size:11px;color:var(--muted);white-space:nowrap}
.pi-m{color:var(--accent-ink);font-size:14px;margin-top:3px;line-height:1.4}
.pi-s{color:var(--muted);font-style:italic;font-size:12px;margin-top:2px;line-height:1.4}
.panel-empty{text-align:center;color:var(--muted);font-style:italic;padding:34px}
`;

  const HTML_BODY = `
  <div class="head">
    <div>
      <h1>주간 단어 학습</h1>
      <div class="sub" id="headerSub">불러오는 중…</div>
    </div>
    <div class="mastery">
      <div class="mastery-top">
        <span class="mastery-label">마스터 진행률</span>
        <span class="mastery-pct" id="masteryPct">0%</span>
      </div>
      <div class="mastery-bar"><div class="m1" id="masteryM1"></div><div class="m2" id="masteryM2"></div></div>
      <div class="mastery-sub" id="masterySub">마스터 0 · 학습중 0 · 미학습 0</div>
    </div>
  </div>
  <div class="viewtabs">
    <button class="vtab on" id="tabList">📋 단어장</button>
    <button class="vtab" id="tabQuiz">🎯 퀴즈</button>
  </div>
  <div class="filtercard">
    <div class="filterlabel">주차</div>
    <div class="bar wk" id="weekBar"></div>
    <div class="filterlabel">카테고리</div>
    <div class="bar" id="catBar"></div>
  </div>
  <div id="listView">
    <div class="listtools">
      <div class="searchwrap">
        <span class="si">🔍</span>
        <input class="search" id="searchInp" placeholder="단어 · 뜻 · 유의어 검색" autocomplete="off">
        <button class="searchx hidden" id="searchClear">✕</button>
      </div>
      <button class="staronly" id="listStar">⭐ 별표</button>
    </div>
    <div class="listcount" id="listCount"></div>
    <div class="listwrap" id="listBody"></div>
    <div class="listempty hidden" id="listEmpty">조건에 맞는 단어가 없어요 😅</div>
  </div>
  <div id="quizView" class="hidden">
    <div class="modes">
      <button class="mode on" data-m="flash">🃏 플래시카드</button>
      <button class="mode" data-m="mc">📝 객관식</button>
      <button class="mode" data-m="type">⌨️ 입력</button>
    </div>
    <div class="quick">
      <button class="q qwrong" id="qWrong">🔴 틀린 단어</button>
      <button class="q qstar" id="qStar">⭐ 별표</button>
      <div class="spacer"></div>
      <button class="q qsmart on" id="qSmart" title="약하거나 틀린 단어를 먼저 보여줍니다">🧠 스마트 복습</button>
    </div>
    <div class="stats">
      <div class="stat"><b id="sTotal">0</b><span>전체</span></div>
      <div class="stat c tap" id="statCorrect"><b id="sCorrect">0</b><span>정답 🔍</span></div>
      <div class="stat w tap" id="statWrong"><b id="sWrong">0</b><span>오답 🔍</span></div>
      <div class="stat s"><b id="sStreak">0</b><span>연속</span></div>
    </div>
    <div class="prog"><div id="progFill"></div></div>
    <div id="stage"></div>
    <div class="qutil"><button class="btn-reset" id="resetBtn">🗑️ 학습 기록 초기화</button></div>
  </div>
  <div class="panel-overlay hidden" id="panelOverlay">
    <div class="panel">
      <div class="panel-head"><span id="panelTitle">🔴 틀린 단어</span><button class="panel-x" id="panelClose">✕</button></div>
      <div class="panel-body" id="panelBody"></div>
    </div>
  </div>
  <div class="save" id="saveBadge">💾 새 세션 시작</div>
`;

  const JS = `const VOCAB=[
${vocabArray}
];
const CATS={'🏛️':'Politics','💹':'Economy','📰':'Media','🌐':'Society','🔬':'Science','🌿':'Health','⚖️':'Crime','🪖':'War','💬':'Opinion','🇬🇧':'British','😤':'Emotion','🕵️':'Mystery','🎭':'Character','⚔️':'Action','🧠':'Thought','🏥':'Physical','📜':'Literary'};
const STORAGE_KEY='weekly_vocab_quiz_v2';
const OLD_KEY='weekly_vocab_quiz_v1';
const byWord={};VOCAB.forEach(r=>{if(!(r[0] in byWord))byWord[r[0]]=r;});
const uniqueTotal=new Set(VOCAB.map(r=>r[0])).size;
const showSyn=true;
const ttsOk='speechSynthesis' in window;
let gbVoice=null;
function initVoice(){if(!ttsOk)return;const vs=speechSynthesis.getVoices();if(!vs.length)return;gbVoice=vs.find(v=>v.lang==='en-GB')||vs.find(v=>v.lang==='en-AU')||vs.find(v=>v.lang&&v.lang.indexOf('en')===0)||vs[0];}
if(ttsOk){initVoice();speechSynthesis.onvoiceschanged=initVoice;}
function speak(t){if(!ttsOk)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);if(gbVoice)u.voice=gbVoice;u.rate=0.85;speechSynthesis.speak(u);}
let view='list',mode='flash',deck=[],idx=0,correct=0,wrong=0,streak=0;
let results={},levels={},starred=new Set(),activeWeeks=new Set(),activeCats=new Set();
let quickMode=null,smart=true,flipped=false,answered=false,lastPick=null,typeValue='',typeOk=null;
let listSearch='',listStarOnly=false,_mc=null;
function badge(t){document.getElementById('saveBadge').textContent=t;}
function escAttr(s){return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
function allWeeks(){return [...new Set(VOCAB.map(v=>v[4]))].sort();}
function filtered(){return VOCAB.filter(v=>activeWeeks.has(v[4])&&activeCats.has(v[3]));}
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
function dotsHTML(lvl){let s='';for(let i=0;i<5;i++)s+='<span class="dot'+(i<lvl?' on':'')+'"></span>';return s;}

function loadState(){
  let msg='💾 새 세션 시작';
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw){
      const old=localStorage.getItem(OLD_KEY);
      if(old){const d=JSON.parse(old);results=d.results||{};starred=new Set(d.starred||[]);msg='💾 이전 기록을 가져왔어요';}
    }else{
      const d=JSON.parse(raw);
      results=d.results||{};levels=d.levels||{};starred=new Set(d.starred||[]);
      if(typeof d.smart==='boolean')smart=d.smart;
      if(d.mode)mode=d.mode;
      if(d.quiz&&d.quiz.words&&d.quiz.words.length&&d.quiz.idx<d.quiz.words.length){
        const dk=d.quiz.words.map(w=>byWord[w]).filter(Boolean);
        if(dk.length){deck=dk;idx=d.quiz.idx||0;correct=d.quiz.correct||0;wrong=d.quiz.wrong||0;streak=d.quiz.streak||0;quickMode=d.quiz.quickMode||null;}
      }
      msg=d.savedAt?('💾 기록 불러옴 · '+new Date(d.savedAt).toLocaleString('ko-KR')):'💾 기록 불러옴';
    }
  }catch(e){}
  badge(msg);
}
function saveState(){
  try{
    const quiz=(deck.length&&idx<deck.length)?{words:deck.map(r=>r[0]),idx,correct,wrong,streak,mode,quickMode}:null;
    localStorage.setItem(STORAGE_KEY,JSON.stringify({results,levels,starred:[...starred],smart,mode,savedAt:new Date().toISOString(),quiz}));
    badge('💾 자동 저장됨 · '+new Date().toLocaleTimeString('ko-KR'));
  }catch(e){}
}
function resetAll(){
  if(!confirm('모든 학습 기록(정답·오답·레벨·별표)을 초기화할까요?'))return;
  try{localStorage.removeItem(STORAGE_KEY);}catch(e){}
  results={};levels={};starred=new Set();quickMode=null;
  badge('💾 기록 초기화됨');
  renderHeader();syncQuick();
  if(view==='list')renderList();else buildDeck();
}

function renderHeader(){
  let mastered=0,seen=0;
  Object.keys(levels).forEach(k=>{seen++;if(levels[k]>=5)mastered++;});
  const learning=seen-mastered,newc=Math.max(0,uniqueTotal-seen);
  const pct=uniqueTotal?Math.round(mastered/uniqueTotal*100):0;
  document.getElementById('masteryPct').textContent=pct+'%';
  document.getElementById('masteryM1').style.width=(uniqueTotal?mastered/uniqueTotal*100:0)+'%';
  document.getElementById('masteryM2').style.width=(uniqueTotal?learning/uniqueTotal*100:0)+'%';
  document.getElementById('masterySub').textContent='마스터 '+mastered+' · 학습중 '+learning+' · 미학습 '+newc;
  document.getElementById('headerSub').textContent=allWeeks().join(' · ')+' · '+uniqueTotal+' 단어';
}

function renderBars(){
  const weeks=allWeeks();
  document.getElementById('weekBar').innerHTML='<button class="chip'+(activeWeeks.size===weeks.length?' on':'')+'" data-w="ALL">전체</button>'+weeks.map(w=>'<button class="chip'+(activeWeeks.has(w)?' on':'')+'" data-w="'+w+'">'+w+'</button>').join('');
  const keys=Object.keys(CATS);
  document.getElementById('catBar').innerHTML='<button class="chip'+(activeCats.size===keys.length?' on':'')+'" data-c="ALL">전체</button>'+keys.map(k=>'<button class="chip'+(activeCats.has(k)?' on':'')+'" data-c="'+k+'">'+k+' '+CATS[k]+'</button>').join('');
}
function toggleWeek(w){
  const weeks=allWeeks();
  if(w==='ALL')activeWeeks=new Set(weeks);
  else if(activeWeeks.size===weeks.length)activeWeeks=new Set([w]);
  else{if(activeWeeks.has(w))activeWeeks.delete(w);else activeWeeks.add(w);if(!activeWeeks.size)activeWeeks=new Set([w]);}
  renderBars();refresh();
}
function toggleCat(c){
  const keys=Object.keys(CATS);
  if(c==='ALL')activeCats=new Set(keys);
  else if(activeCats.size===keys.length)activeCats=new Set([c]);
  else{if(activeCats.has(c))activeCats.delete(c);else activeCats.add(c);if(!activeCats.size)activeCats=new Set([c]);}
  renderBars();refresh();
}
function refresh(){if(view==='list')renderList();else buildDeck();}

function renderList(){
  let rows=filtered();
  if(listStarOnly)rows=rows.filter(r=>starred.has(r[0]));
  if(listSearch){const q=listSearch.toLowerCase();rows=rows.filter(r=>(r[0]+' '+r[1]+' '+r[2]).toLowerCase().indexOf(q)>=0);}
  const body=document.getElementById('listBody'),empty=document.getElementById('listEmpty');
  document.getElementById('listCount').textContent=rows.length+'개 단어';
  if(!rows.length){body.innerHTML='';empty.classList.remove('hidden');return;}
  empty.classList.add('hidden');
  body.innerHTML=rows.map(r=>{
    const w=r[0],on=starred.has(w)?' on':'';
    return '<div class="lrow"><div class="lrow-main"><div class="lrow-head"><span class="lw">'+r[0]+'</span><span class="lwk">'+r[4]+'</span></div><div class="lm">'+r[1]+'</div>'+(showSyn&&r[2]?'<div class="ls">'+r[2]+'</div>':'')+'</div><div class="lrow-side"><div class="lrow-btns"><button class="iconbtn" data-act="speak" data-w="'+escAttr(w)+'" '+(ttsOk?'':'disabled')+'>🔊</button><button class="starbtn'+on+'" data-act="star" data-w="'+escAttr(w)+'">★</button></div><span class="lcat">'+r[3]+' '+(CATS[r[3]]||'')+'</span><div class="dots">'+dotsHTML(levels[w]||0)+'</div></div></div>';
  }).join('');
}

function buildDeck(){
  let pool=filtered();
  if(quickMode==='wrong')pool=pool.filter(v=>results[v[0]]==='wrong');
  else if(quickMode==='star')pool=pool.filter(v=>starred.has(v[0]));
  deck=smart?smartOrder(pool):shuffle(pool);
  idx=0;correct=0;wrong=0;streak=0;flipped=false;answered=false;lastPick=null;typeValue='';typeOk=null;_mc=null;
  saveState();renderQuiz();
}
function smartOrder(pool){
  const t=[[],[],[],[],[]];
  pool.forEach(v=>{const lvl=levels[v[0]];if(results[v[0]]==='wrong')t[0].push(v);else if(lvl===undefined)t[1].push(v);else if(lvl<=2)t[2].push(v);else if(lvl<=4)t[3].push(v);else t[4].push(v);});
  return [].concat.apply([],t.map(a=>shuffle(a)));
}
function syncQuick(){
  document.getElementById('qWrong').classList.toggle('on',quickMode==='wrong');
  document.getElementById('qStar').classList.toggle('on',quickMode==='star');
  document.getElementById('qSmart').classList.toggle('on',smart);
}
function getMcOptions(r){
  const key=idx+'|'+deck.length+'|'+r[0];
  if(_mc&&_mc.key===key)return _mc.opts;
  const m=r[1];
  const others=shuffle(VOCAB.filter(v=>v[1]!==m)).slice(0,3).map(v=>({label:v[1],isCorrect:false}));
  const opts=shuffle([{label:m,isCorrect:true}].concat(others));
  _mc={key,opts};return opts;
}
function cardCorner(r){
  const w=r[0],on=starred.has(w)?' on':'';
  return '<span class="cardwk">'+r[4]+'</span><button class="starbtn cardstar'+on+'" data-act="star" data-w="'+escAttr(w)+'">★</button><button class="iconbtn cardtts" data-act="speak" data-w="'+escAttr(w)+'" '+(ttsOk?'':'disabled')+'>🔊</button><div class="carddots">'+dotsHTML(levels[w]||0)+'</div>';
}
function flashBtns(){
  if(flipped)return '<div class="btns"><button class="btn btn-no" data-act="dont">아직 몰라요</button><button class="btn btn-ok" data-act="know">알아요 ✓</button></div>';
  return '<button class="btn btn-flip" data-act="flipbtn">뜻 확인하기 🔄</button>';
}
function typeBtns(){
  if(answered){
    const r=deck[idx];
    return '<div class="tfeedback '+(typeOk?'ok':'no')+'"><div class="tlabel">'+(typeOk?'✓ 정답이에요!':'✗ 다시 확인해요')+'</div><div class="tmean">'+r[1]+'</div><div class="tsyn">'+r[2]+'</div></div><button class="btn btn-next" data-act="next">다음 →</button>';
  }
  return '<button class="btn btn-check" data-act="check">확인</button>';
}
function renderQuiz(){
  document.getElementById('sTotal').textContent=deck.length;
  document.getElementById('sCorrect').textContent=correct;
  document.getElementById('sWrong').textContent=wrong;
  document.getElementById('sStreak').textContent=streak;
  document.getElementById('progFill').style.width=(deck.length?idx/deck.length*100:0)+'%';
  syncQuick();
  const st=document.getElementById('stage');
  if(!deck.length){st.innerHTML='<div class="empty">조건에 맞는 단어가 없어요 😅<br>주차·카테고리 필터를 확인해 주세요.</div>';return;}
  if(idx>=deck.length){endScreen();return;}
  const r=deck[idx],w=r[0],corner=cardCorner(r);
  if(mode==='flash'){
    st.innerHTML='<div class="flipwrap"><div class="flipinner'+(flipped?' flipped':'')+'" id="flipinner"><div class="face front">'+corner+'<div class="cardword">'+w+'</div><div class="cardhint">탭하여 뜻 보기</div></div><div class="face back"><div class="cardmean">'+r[1]+'</div><div class="cardsyn">'+r[2]+'</div><div class="cardcat">'+r[3]+' '+(CATS[r[3]]||'')+'</div></div></div></div><div id="qbtns">'+flashBtns()+'</div>';
  }else if(mode==='mc'){
    const opts=getMcOptions(r);
    st.innerHTML='<div class="scard">'+corner+'<div class="cardword">'+w+'</div></div><div class="opts">'+opts.map((o,i)=>'<button class="opt" data-act="opt" data-i="'+i+'">'+o.label+'</button>').join('')+'</div>';
  }else{
    st.innerHTML='<div class="scard">'+corner+'<div class="cardword">'+w+'</div></div><input class="tinp" id="typeInp" placeholder="한국어 뜻 입력…" autocomplete="off" value="'+escAttr(typeValue)+'"><div id="qbtns">'+typeBtns()+'</div>';
    const inp=document.getElementById('typeInp');
    inp.addEventListener('input',e=>{typeValue=e.target.value;});
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'){if(answered)mark(typeOk);else checkType();}});
    if(!answered){try{inp.focus();}catch(e){}}
  }
}
function flip(){
  if(flipped)return;
  flipped=true;
  const fi=document.getElementById('flipinner');if(fi)fi.classList.add('flipped');
  const qb=document.getElementById('qbtns');if(qb)qb.innerHTML=flashBtns();
}
function pickMc(i){
  if(answered||!_mc)return;
  answered=true;lastPick=i;
  const opts=_mc.opts;
  document.querySelectorAll('#stage .opt').forEach((el,j)=>{if(opts[j].isCorrect)el.classList.add('correct');else if(j===i)el.classList.add('wrong');else el.classList.add('dim');});
  const ok=opts[i].isCorrect;
  setTimeout(()=>mark(ok),780);
}
function checkType(){
  if(answered)return;
  const r=deck[idx],m=r[1],v=typeValue.trim();
  typeOk=v.length>=2&&m.replace(/ /g,'').indexOf(v.replace(/ /g,'').slice(0,3))>=0;
  answered=true;
  const qb=document.getElementById('qbtns');if(qb)qb.innerHTML=typeBtns();
  const inp=document.getElementById('typeInp');if(inp)inp.blur();
}
function mark(ok){
  const r=deck[idx];if(!r)return;
  const w=r[0];
  results[w]=ok?'correct':'wrong';
  const lvl=levels[w]||0;levels[w]=ok?Math.min(5,lvl+1):Math.max(0,lvl-1);
  if(ttsOk)speechSynthesis.cancel();
  _mc=null;
  correct+=ok?1:0;wrong+=ok?0:1;streak=ok?streak+1:0;idx++;
  flipped=false;answered=false;lastPick=null;typeValue='';typeOk=null;
  saveState();renderHeader();renderQuiz();
}
function toggleStar(w){
  const had=starred.has(w);
  if(had)starred.delete(w);else starred.add(w);
  saveState();
  if(view==='list')renderList();
  else document.querySelectorAll('#stage .cardstar').forEach(b=>b.classList.toggle('on',!had));
}
function endScreen(){
  const endTotal=deck.length,pct=endTotal?Math.round(correct/endTotal*100):0;
  const wc=deck.slice(0,idx).filter(r=>results[r[0]]==='wrong').length;
  const ring='conic-gradient(var(--accent) '+(pct*3.6)+'deg, var(--line) 0)';
  const quote=pct>=90?'단어가 쌓이면 세계가 넓어집니다.':pct>=70?'꾸준함이 재능을 이깁니다.':pct>=50?'반복은 학습의 어머니입니다.':'실수는 배움의 첫걸음입니다.';
  document.getElementById('stage').innerHTML='<div class="end"><div class="endring" style="background:'+ring+'"><div class="endring-in"><div class="endpct">'+pct+'%</div></div></div><div class="endscore">'+correct+' / '+endTotal+' 정답</div><div class="endquote">'+quote+'</div><div class="endbtns">'+(wc?'<button class="btn btn-no" data-act="review">🔴 틀린 단어 다시 ('+wc+')</button>':'')+'<button class="btn btn-restart" data-act="restart">🔄 다시 시작</button></div><button class="btn-reset" data-act="reset">기록 초기화</button></div>';
  document.getElementById('progFill').style.width='100%';
}
function reviewWrong(){quickMode='wrong';buildDeck();}
function toggleQuick(qm){quickMode=quickMode===qm?null:qm;buildDeck();}
function toggleSmart(){smart=!smart;buildDeck();}
function showPanel(kind){
  const seen=deck.slice(0,idx);
  const items=seen.filter(r=>kind==='wrong'?results[r[0]]==='wrong':results[r[0]]==='correct');
  document.getElementById('panelTitle').textContent=(kind==='wrong'?'🔴 틀린 단어':'🟢 맞힌 단어')+' ('+items.length+')';
  document.getElementById('panelBody').innerHTML=items.length?items.map(r=>'<div class="panel-item"><div class="pi-top"><span class="pi-w">'+r[0]+'</span><span class="pi-cat">'+r[3]+' '+(CATS[r[3]]||'')+'</span></div><div class="pi-m">'+r[1]+'</div><div class="pi-s">'+r[2]+'</div></div>').join(''):'<div class="panel-empty">'+(kind==='wrong'?'아직 틀린 단어가 없어요 👍':'아직 맞힌 단어가 없어요 😅')+'</div>';
  document.getElementById('panelOverlay').classList.remove('hidden');
}
function closePanel(){document.getElementById('panelOverlay').classList.add('hidden');}
function switchView(v){
  view=v;
  document.getElementById('tabList').classList.toggle('on',v==='list');
  document.getElementById('tabQuiz').classList.toggle('on',v==='quiz');
  document.getElementById('listView').classList.toggle('hidden',v!=='list');
  document.getElementById('quizView').classList.toggle('hidden',v!=='quiz');
  if(ttsOk)speechSynthesis.cancel();
  if(v==='list')renderList();
  else{if(deck.length&&idx<deck.length)renderQuiz();else buildDeck();}
}
function setMode(m){
  if(ttsOk)speechSynthesis.cancel();
  mode=m;flipped=false;answered=false;lastPick=null;typeValue='';typeOk=null;_mc=null;
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('on',x.dataset.m===m));
  if(deck.length&&idx<deck.length){saveState();renderQuiz();}else buildDeck();
}
document.getElementById('tabList').addEventListener('click',()=>switchView('list'));
document.getElementById('tabQuiz').addEventListener('click',()=>switchView('quiz'));
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.m)));
document.getElementById('qWrong').addEventListener('click',()=>toggleQuick('wrong'));
document.getElementById('qStar').addEventListener('click',()=>toggleQuick('star'));
document.getElementById('qSmart').addEventListener('click',toggleSmart);
document.getElementById('statCorrect').addEventListener('click',()=>showPanel('correct'));
document.getElementById('statWrong').addEventListener('click',()=>showPanel('wrong'));
document.getElementById('panelClose').addEventListener('click',closePanel);
document.getElementById('panelOverlay').addEventListener('click',e=>{if(e.target.id==='panelOverlay')closePanel();});
document.getElementById('resetBtn').addEventListener('click',resetAll);
document.getElementById('weekBar').addEventListener('click',e=>{const b=e.target.closest('.chip');if(b)toggleWeek(b.dataset.w);});
document.getElementById('catBar').addEventListener('click',e=>{const b=e.target.closest('.chip');if(b)toggleCat(b.dataset.c);});
document.getElementById('searchInp').addEventListener('input',e=>{listSearch=e.target.value.trim();document.getElementById('searchClear').classList.toggle('hidden',!listSearch);renderList();});
document.getElementById('searchClear').addEventListener('click',()=>{listSearch='';const si=document.getElementById('searchInp');si.value='';document.getElementById('searchClear').classList.add('hidden');si.focus();renderList();});
document.getElementById('listStar').addEventListener('click',()=>{listStarOnly=!listStarOnly;document.getElementById('listStar').classList.toggle('on',listStarOnly);renderList();});
document.getElementById('listBody').addEventListener('click',e=>{const b=e.target.closest('button[data-act]');if(!b)return;const w=b.dataset.w;if(b.dataset.act==='speak')speak(w);else if(b.dataset.act==='star')toggleStar(w);});
document.getElementById('stage').addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]');
  if(b){const a=b.dataset.act;
    if(a==='speak')speak(b.dataset.w);
    else if(a==='star')toggleStar(b.dataset.w);
    else if(a==='flipbtn')flip();
    else if(a==='know')mark(true);
    else if(a==='dont')mark(false);
    else if(a==='check')checkType();
    else if(a==='next')mark(typeOk);
    else if(a==='opt')pickMc(+b.dataset.i);
    else if(a==='restart')buildDeck();
    else if(a==='review')reviewWrong();
    else if(a==='reset')resetAll();
    return;}
  if(e.target.closest('.face.front'))flip();
});
loadState();
activeWeeks=new Set(allWeeks());
activeCats=new Set(Object.keys(CATS));
document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('on',x.dataset.m===mode));
renderBars();renderHeader();syncQuick();switchView('list');`;

  return [
    '<!DOCTYPE html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>📰 주간 단어 학습 & 복습 — ' + weekLabel + '</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">',
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">',
    '<style>' + CSS + '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    HTML_BODY,
    '</div>',
    '<script>',
    JS,
    '<\/script>',
    '</body>',
    '</html>'
  ].join('\n');
}


async function deployToGitHub(html, weeks) {
  if (!GITHUB_TOKEN) {
    console.log('⚠️  GITHUB_TOKEN 없음 — 로컬 저장만 완료, GitHub 배포 건너뜀');
    return null;
  }
  const weekLabel = weeks.join('-');
  const apiBase   = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;
  const headers   = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  console.log(`\n🚀 GitHub Pages 배포 중...`);
  let sha = null;
  try {
    const res = await fetch(`${apiBase}/contents/index.html`, { headers });
    if (res.ok) sha = (await res.json()).sha;
  } catch {}
  const body = {
    message: `quiz: ${weekLabel} (${new Date().toISOString().slice(0, 10)})`,
    content: Buffer.from(html, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const uploadRes = await fetch(`${apiBase}/contents/index.html`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  if (!uploadRes.ok) throw new Error(`GitHub 업로드 실패: ${await uploadRes.text()}`);
  const pageUrl = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}`;
  console.log(`✅ 배포 완료!`);
  console.log(`🌐 URL: ${pageUrl}\n`);
  return pageUrl;
}

async function main() {
  const weekArgs = process.argv.slice(2).filter(a => /^W\d+$/i.test(a));
  const fetchAll = process.argv.includes('--all');
  const weeks = fetchAll ? [] : (weekArgs.length > 0 ? weekArgs.map(w => w.toUpperCase()) : [getCurrentISOWeek()]);
  const modeLabel = fetchAll ? '전체 (누적)' : weeks.join(', ');
  console.log(`\n📚 Vocab Quiz Generator`);
  console.log(`📅 대상 주차: ${modeLabel}\n`);
  const notion = new Client({ auth: NOTION_TOKEN });
  const words  = await fetchWords(notion, weeks);
  if (words.length === 0) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Actions: 이번 주 단어가 없으면 조용히 정상 종료 (워크플로우 실패 X)
      console.log(`ℹ️  ${weeks.join(', ')}에 단어가 없어 — 이번 주는 건너뜀.`);
      process.exit(0);
    }
    console.error(`❌ ${weeks.join(', ')}에 해당하는 단어가 없어.`); process.exit(1);
  }
  console.log(`✅ ${words.length}개 단어 가져옴`);
  const html = buildHTML(words, weeks);
  const fileLabel = weeks.length ? weeks.join('-') : 'all';
  writeFileSync(join(__dir, `quiz-${fileLabel}.html`), html, 'utf8');
  console.log(`📄 로컬 저장: quiz-${fileLabel}.html`);

  if (process.env.GITHUB_ACTIONS === 'true') {
    // GitHub Actions 환경: index.html만 생성, push는 워크플로우가 처리
    writeFileSync(join(__dir, 'index.html'), html, 'utf8');
    console.log('🤖 GitHub Actions — index.html 생성 완료 (push는 워크플로우가 처리)');
  } else {
    // 로컬 환경: GitHub API로 직접 배포
    await deployToGitHub(html, weeks);
  }
}

main().catch(err => { console.error('❌ 오류:', err.message); process.exit(1); });
