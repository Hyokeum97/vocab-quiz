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
  const vocabArray  = buildVocabArray(words);
  const generatedAt = new Date().toLocaleString('ko-KR');

  const CSS = `
:root{--ink:#1a1209;--paper:#f5f0e8;--aged:#e8dfc8;--rule:#c4b89a;--accent:#8b1a1a;--accent2:#1a4a6b;--muted:#6b5e4a;--ok:#1a5c1a;--no:#8b1a1a;--gold:#c79a3a}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:Georgia,serif;min-height:100vh;padding:16px}
.wrap{max-width:720px;margin:0 auto}
.head{text-align:center;padding:18px 0 12px;border-bottom:3px double var(--rule);margin-bottom:14px}
.head h1{font-size:25px;letter-spacing:-0.5px}
.head .sub{font-size:12px;color:var(--muted);margin-top:6px;font-style:italic}
.viewtabs{display:flex;gap:8px;justify-content:center;margin-bottom:16px}
.vtab{flex:1;max-width:180px;padding:12px;font-size:15px;font-weight:bold;border:2px solid var(--ink);background:transparent;color:var(--ink);border-radius:5px;cursor:pointer;font-family:inherit;transition:.15s}
.vtab.on{background:var(--ink);color:var(--paper)}
.bar{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:12px}
.barlabel{width:100%;text-align:center;font-size:11px;color:var(--muted);font-family:monospace;letter-spacing:1px;margin-bottom:2px}
.chip{background:transparent;border:1px solid var(--rule);color:var(--muted);padding:5px 11px;font-size:12px;border-radius:3px;cursor:pointer;font-family:inherit;transition:.15s}
.chip.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.modes{display:flex;gap:6px;justify-content:center;margin-bottom:14px}
.mode{flex:1;max-width:140px;background:transparent;border:1px solid var(--rule);color:var(--muted);padding:9px;font-size:13px;border-radius:3px;cursor:pointer;font-family:inherit;transition:.15s}
.mode.on{background:var(--accent);color:var(--paper);border-color:var(--accent)}
.stats{display:flex;justify-content:space-around;font-size:12px;color:var(--muted);padding:10px 0;border-top:1px solid var(--aged);border-bottom:1px solid var(--aged);margin-bottom:6px}
.stats b{color:var(--ink);font-size:15px;display:block;text-align:center}
.prog{height:4px;background:var(--aged);border-radius:2px;margin-bottom:18px;overflow:hidden}
.prog>div{height:100%;background:var(--accent);width:0;transition:width .3s}
.card{background:#fff;border:1px solid var(--rule);border-radius:6px;padding:34px 24px;min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.wk{position:absolute;top:10px;left:12px;font-size:10px;color:var(--muted);font-family:monospace;letter-spacing:1px}
.star{position:absolute;top:8px;right:10px;font-size:22px;cursor:pointer;color:var(--rule);background:none;border:none;line-height:1}
.star.on{color:var(--gold)}
.tts{position:absolute;bottom:10px;right:12px;background:none;border:1px solid var(--rule);border-radius:20px;padding:4px 12px;font-size:12px;cursor:pointer;color:var(--muted);font-family:inherit}
.tts:disabled{opacity:.4;cursor:default}
.word{font-size:30px;font-weight:bold;text-align:center;margin-bottom:8px}
.syn{font-size:13px;color:var(--muted);font-style:italic;text-align:center}
.mean{font-size:22px;text-align:center;color:var(--accent2)}
.cat{font-size:13px;color:var(--muted);margin-top:10px}
.opts{display:flex;flex-direction:column;gap:8px;width:100%;margin-top:18px}
.opt{background:#fff;border:1px solid var(--rule);border-radius:4px;padding:12px;font-size:15px;cursor:pointer;text-align:left;font-family:inherit;transition:.12s}
.opt:hover{border-color:var(--ink)}
.opt.correct{background:#e3f0e3;border-color:var(--ok);color:var(--ok)}
.opt.wrong{background:#f3e0e0;border-color:var(--no);color:var(--no)}
.inp{width:100%;padding:12px;font-size:16px;border:1px solid var(--rule);border-radius:4px;margin-top:16px;font-family:inherit;text-align:center}
.inp:focus{outline:none;border-color:var(--accent)}
.btns{display:flex;gap:8px;margin-top:16px;width:100%}
.btn{flex:1;padding:13px;font-size:15px;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:bold}
.btn-ok{background:var(--ok);color:#fff}
.btn-no{background:var(--no);color:#fff}
.btn-nx{background:var(--ink);color:var(--paper)}
.btn-gh{background:transparent;border:1px solid var(--rule);color:var(--muted)}
.quick{display:flex;gap:6px;justify-content:center;margin-bottom:14px}
.q{background:transparent;border:1px solid var(--rule);color:var(--muted);padding:6px 12px;font-size:12px;border-radius:3px;cursor:pointer;font-family:inherit}
.q.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.save{text-align:center;font-size:11px;color:var(--muted);margin-top:12px;font-family:monospace}
.end{text-align:center;padding:30px 20px}
.end .score{font-size:48px;font-weight:bold;color:var(--accent)}
.end .quote{font-style:italic;color:var(--muted);margin:16px 0;font-size:15px;line-height:1.6}
.listcount{text-align:center;font-size:12px;color:var(--muted);margin-bottom:12px;font-family:monospace}
.listtable{width:100%;border-collapse:collapse;font-size:14px}
.listtable thead tr{border-bottom:2px solid var(--ink)}
.listtable th{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);padding:8px 10px;text-align:left}
.listtable tbody tr{border-bottom:1px solid var(--aged)}
.listtable td{padding:10px;vertical-align:top;line-height:1.5}
.lw{font-weight:bold;font-size:15px;min-width:130px}
.lw .lwk{font-family:monospace;font-size:9px;color:var(--muted);display:block;margin-top:2px}
.lm{color:var(--accent2);min-width:160px}
.ls{color:var(--muted);font-style:italic;font-size:12px}
.lcat{white-space:nowrap;font-size:12px}
.lspk{background:none;border:1px solid var(--rule);border-radius:14px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--muted);font-family:inherit}
.lstar{background:none;border:none;font-size:17px;cursor:pointer;color:var(--rule);line-height:1}
.lstar.on{color:var(--gold)}
.listempty{text-align:center;padding:40px;color:var(--muted);font-style:italic}
.stat-tap{cursor:pointer;border-radius:4px;transition:.12s;padding:0 6px}
.panel-overlay{position:fixed;inset:0;background:rgba(26,18,9,.45);display:flex;align-items:flex-end;justify-content:center;z-index:50}
.panel{background:var(--paper);border:1px solid var(--rule);border-radius:10px 10px 0 0;width:100%;max-width:720px;max-height:75vh;display:flex;flex-direction:column;box-shadow:0 -4px 22px rgba(0,0,0,.22)}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:2px double var(--rule);font-size:16px;font-weight:bold}
.panel-x{background:none;border:none;font-size:21px;cursor:pointer;color:var(--muted);line-height:1}
.panel-body{overflow-y:auto;padding:10px 16px 26px}
.panel-item{border-bottom:1px solid var(--aged);padding:11px 0}
.pi-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pi-w{font-weight:bold;font-size:16px}
.pi-cat{font-size:11px;color:var(--muted);white-space:nowrap}
.pi-m{color:var(--accent2);font-size:14px;margin-top:3px}
.pi-s{color:var(--muted);font-style:italic;font-size:12px;margin-top:2px}
.panel-empty{text-align:center;color:var(--muted);font-style:italic;padding:34px}
.hidden{display:none!important}
@media(max-width:560px){.ls{display:none}.listtable th:nth-child(3){display:none}}
`;

  const HTML_BODY = `
  <div class="head">
    <h1>📰 주간 단어 학습 &amp; 복습</h1>
    <div class="sub">WEEK_LABEL · WORD_COUNT개 단어 · GENERATED_AT</div>
  </div>
  <div class="viewtabs">
    <button class="vtab on" id="tabList">📋 단어장</button>
    <button class="vtab" id="tabQuiz">🎯 퀴즈</button>
  </div>
  <div class="barlabel">— 주차 —</div><div class="bar" id="weekBar"></div>
  <div class="barlabel">— 카테고리 —</div><div class="bar" id="catBar"></div>
  <div id="listView">
    <div class="listcount" id="listCount"></div>
    <table class="listtable">
      <thead><tr><th>Word</th><th>한국어 뜻</th><th>Synonyms</th><th>Cat</th><th></th><th></th></tr></thead>
      <tbody id="listBody"></tbody>
    </table>
    <div class="listempty hidden" id="listEmpty">선택한 조건에 맞는 단어가 없어요 😅</div>
  </div>
  <div id="quizView" class="hidden">
    <div class="modes">
      <button class="mode on" data-m="flash">🃏 플래시카드</button>
      <button class="mode" data-m="mc">📝 객관식</button>
      <button class="mode" data-m="type">⌨️ 입력</button>
    </div>
    <div class="quick">
      <button class="q" id="qWrong">🔴 틀린 단어만</button>
      <button class="q" id="qStar">⭐ 별표만</button>
    </div>
    <div class="stats">
      <div><b id="sTotal">0</b>전체</div>
      <div id="statCorrect" class="stat-tap"><b id="sCorrect">0</b>정답 🔍</div>
      <div id="statWrong" class="stat-tap"><b id="sWrong">0</b>오답 🔍</div>
      <div><b id="sStreak">0</b>연속</div>
    </div>
    <div class="prog"><div id="progFill"></div></div>
    <div id="stage"></div>
  </div>
  <div class="panel-overlay hidden" id="panelOverlay">
    <div class="panel">
      <div class="panel-head"><span id="panelTitle">🔴 틀린 단어</span><button class="panel-x" id="panelClose">✕</button></div>
      <div class="panel-body" id="panelBody"></div>
    </div>
  </div>
  <div class="save" id="saveBadge">💾 새 세션 시작</div>
`
    .replace('WEEK_LABEL', weekLabel)
    .replace('WORD_COUNT', words.length)
    .replace('GENERATED_AT', generatedAt);

  // JS는 별도 문자열로 — 백틱 이스케이프 문제 원천 차단
  const JS = [
    "const VOCAB=[",
    vocabArray,
    "];",
    "const CATS={'🏛️':'Politics','💹':'Economy','📰':'Media','🌐':'Society','🔬':'Science','🌿':'Health','⚖️':'Crime','🪖':'War','💬':'Opinion','🇬🇧':'British','😤':'Emotion','🕵️':'Mystery','🎭':'Character','⚔️':'Action','🧠':'Thought','🏥':'Physical','📜':'Literary'};",
    "const STORAGE_KEY='weekly_vocab_quiz_v1';",
    "const ttsOk='speechSynthesis' in window;",
    "let gbVoice=null;",
    "function initVoice(){if(!ttsOk)return;const vs=speechSynthesis.getVoices();if(!vs.length)return;gbVoice=vs.find(v=>v.lang==='en-GB')||vs.find(v=>v.lang==='en-AU')||vs.find(v=>v.lang.startsWith('en'))||vs[0];}",
    "if(ttsOk){initVoice();speechSynthesis.onvoiceschanged=initVoice;}",
    "function speak(t){if(!ttsOk)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);if(gbVoice)u.voice=gbVoice;u.rate=0.85;speechSynthesis.speak(u);}",
    "let view='list',mode='flash',deck=[],idx=0,correct=0,wrong=0,streak=0;",
    "let results={},starred=new Set(),activeWeeks=new Set(),activeCats=new Set(Object.keys(CATS));",
    "let quickMode=null,flipped=false,answered=false,savedMain=null;",
    "function loadState(){try{const r=localStorage.getItem(STORAGE_KEY);if(!r){badge('💾 새 세션 시작');return;}const d=JSON.parse(r);results=d.results||{};starred=new Set(d.starred||[]);if(d.quiz&&d.quiz.deck&&d.quiz.deck.length&&d.quiz.idx<d.quiz.deck.length){deck=d.quiz.deck;idx=d.quiz.idx;correct=d.quiz.correct||0;wrong=d.quiz.wrong||0;streak=d.quiz.streak||0;mode=d.quiz.mode||'flash';quickMode=d.quiz.quickMode||null;document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('on',b.dataset.m===mode));}badge('💾 기록 불러옴 · '+(d.savedAt?new Date(d.savedAt).toLocaleString('ko-KR'):'')+' 저장본');}catch(e){badge('💾 새 세션 시작');}}",
    "function saveState(){try{const qs=(deck.length&&idx<deck.length)?{deck,idx,correct,wrong,streak,mode,quickMode}:null;localStorage.setItem(STORAGE_KEY,JSON.stringify({results,starred:[...starred],savedAt:new Date().toISOString(),quiz:qs}));badge('💾 자동 저장됨 · '+new Date().toLocaleTimeString('ko-KR'));}catch(e){}}",
    "function clearState(){try{localStorage.removeItem(STORAGE_KEY);}catch(e){}results={};starred=new Set();}",
    "function badge(t){document.getElementById('saveBadge').textContent=t;}",
    "function esc(s){return s.replace(/'/g,\"\\\\'\");}",
    "function allWeeks(){return [...new Set(VOCAB.map(v=>v[4]))].sort();}",
    "function buildBars(){",
    "  const wks=allWeeks();activeWeeks=new Set(wks);",
    "  const wb=document.getElementById('weekBar');",
    "  wb.innerHTML='<button class=\"chip on\" data-w=\"ALL\">전체 주차</button>'+wks.map(w=>'<button class=\"chip on\" data-w=\"'+w+'\">'+w+'</button>').join('');",
    "  wb.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>toggleWeek(c)));",
    "  const cb=document.getElementById('catBar');",
    "  cb.innerHTML='<button class=\"chip on\" data-c=\"ALLC\">전체</button>'+Object.entries(CATS).map(([e,n])=>'<button class=\"chip on\" data-c=\"'+e+'\">'+e+n+'</button>').join('');",
    "  cb.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>toggleCat(c)));",
    "}",
    "function toggleWeek(c){const w=c.dataset.w;if(w==='ALL'){const on=c.classList.contains('on');document.querySelectorAll('#weekBar .chip').forEach(x=>x.classList.toggle('on',!on));activeWeeks=on?new Set():new Set(allWeeks());}else{c.classList.toggle('on');if(c.classList.contains('on'))activeWeeks.add(w);else activeWeeks.delete(w);const a=document.querySelector('#weekBar .chip[data-w=\"ALL\"]');if(a)a.classList.toggle('on',activeWeeks.size===allWeeks().length);}if(activeWeeks.size===0){c.classList.add('on');activeWeeks.add(w);}refresh();}",
    "function toggleCat(c){const e=c.dataset.c;if(e==='ALLC'){const on=c.classList.contains('on');document.querySelectorAll('#catBar .chip').forEach(x=>x.classList.toggle('on',!on));activeCats=on?new Set():new Set(Object.keys(CATS));}else{c.classList.toggle('on');if(c.classList.contains('on'))activeCats.add(e);else activeCats.delete(e);const a=document.querySelector('#catBar .chip[data-c=\"ALLC\"]');if(a)a.classList.toggle('on',activeCats.size===Object.keys(CATS).length);}if(activeCats.size===0){c.classList.add('on');activeCats.add(e);}refresh();}",
    "function syncQuick(){document.getElementById('qWrong').classList.toggle('on',quickMode==='wrong');document.getElementById('qStar').classList.toggle('on',quickMode==='star');}",
    "function filtered(){return VOCAB.filter(v=>activeWeeks.has(v[4])&&activeCats.has(v[3]));}",
    "function refresh(){if(view==='list')renderList();else{quickMode=null;savedMain=null;syncQuick();buildDeck();}}",
    "function renderList(){const rows=filtered(),body=document.getElementById('listBody'),empty=document.getElementById('listEmpty');document.getElementById('listCount').textContent=rows.length+'개 단어';if(!rows.length){body.innerHTML='';empty.classList.remove('hidden');return;}empty.classList.add('hidden');body.innerHTML=rows.map(r=>{const sp='<button class=\"lspk\" '+(ttsOk?'':'disabled')+' onclick=\"speak(\\''+esc(r[0])+'\\')\">🔊</button>';const sr='<button class=\"lstar '+(starred.has(r[0])?'on':'')+'\" onclick=\"toggleStar(\\''+esc(r[0])+'\\')\">★</button>';return '<tr><td class=\"lw\">'+r[0]+'<span class=\"lwk\">'+r[4]+'</span></td><td class=\"lm\">'+r[1]+'</td><td class=\"ls\">'+r[2]+'</td><td class=\"lcat\">'+r[3]+'</td><td>'+sp+'</td><td>'+sr+'</td></tr>';}).join('');}",
    "function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}",
    "function buildDeck(){let pool=filtered();if(quickMode==='wrong')pool=pool.filter(v=>results[v[0]]==='wrong');if(quickMode==='star')pool=pool.filter(v=>starred.has(v[0]));deck=shuffle(pool);idx=0;correct=0;wrong=0;streak=0;answered=false;flipped=false;renderQuiz();}",
    "function renderQuiz(){",
    "  const st=document.getElementById('stage');",
    "  document.getElementById('sTotal').textContent=deck.length;",
    "  document.getElementById('sCorrect').textContent=correct;",
    "  document.getElementById('sWrong').textContent=wrong;",
    "  document.getElementById('sStreak').textContent=streak;",
    "  document.getElementById('progFill').style.width=deck.length?(idx/deck.length*100)+'%':'0%';",
    "  if(!deck.length){st.innerHTML='<div class=\"card\"><div class=\"mean\">선택한 조건에 맞는 단어가 없어요 😅</div></div>';return;}",
    "  if(idx>=deck.length){endScreen();return;}",
    "  const row=deck[idx],w=row[0],m=row[1],s=row[2],cat=row[3],wk=row[4];",
    "  const starOn=starred.has(w)?'on':'';",
    "  const ttsBtn='<button class=\"tts\" '+(ttsOk?'':'disabled')+' onclick=\"event.stopPropagation();speak(\\''+esc(w)+'\\')\">🔊</button>';",
    "  const starBtn='<button class=\"star '+starOn+'\" onclick=\"event.stopPropagation();toggleStar(\\''+esc(w)+'\\')\">★</button>';",
    "  if(mode==='flash'){",
    "    const front='<div class=\"word\">'+w+'</div>';",
    "    const back='<div class=\"mean\">'+m+'</div><div class=\"syn\">'+s+'</div><div class=\"cat\">'+cat+' '+(CATS[cat]||'')+'</div>';",
    "    st.innerHTML='<div class=\"card\"><span class=\"wk\">'+wk+'</span>'+starBtn+ttsBtn+(flipped?back:front)+'</div>'+(flipped?'<div class=\"btns\"><button class=\"btn btn-no\" onclick=\"mark(false)\">❌ 몰랐어</button><button class=\"btn btn-ok\" onclick=\"mark(true)\">✅ 알았어</button></div>':'<div class=\"btns\"><button class=\"btn btn-nx\" onclick=\"flip()\">뒤집기 🔄</button></div>');",
    "  } else if(mode==='mc'){",
    "    const others=shuffle(VOCAB.filter(v=>v[0]!==w)).slice(0,3).map(v=>v[1]);",
    "    const opts=shuffle([m].concat(others));",
    "    st.innerHTML='<div class=\"card\"><span class=\"wk\">'+wk+'</span>'+starBtn+ttsBtn+'<div class=\"word\">'+w+'</div></div><div class=\"opts\">'+opts.map((o,i)=>'<button class=\"opt\" data-i=\"'+i+'\">'+o+'</button>').join('')+'</div>';",
    "    st.querySelectorAll('.opt').forEach(b=>b.addEventListener('click',()=>{if(answered)return;answered=true;const chosen=opts[+b.dataset.i];st.querySelectorAll('.opt').forEach(x=>{if(opts[+x.dataset.i]===m)x.classList.add('correct');else if(x===b)x.classList.add('wrong');});setTimeout(()=>mark(chosen===m),750);}));",
    "  } else {",
    "    st.innerHTML='<div class=\"card\"><span class=\"wk\">'+wk+'</span>'+starBtn+ttsBtn+'<div class=\"word\">'+w+'</div></div><input class=\"inp\" id=\"typeInp\" placeholder=\"한국어 뜻 입력...\" autocomplete=\"off\"><div class=\"btns\"><button class=\"btn btn-nx\" onclick=\"checkType()\">확인</button></div>';",
    "    const inp=document.getElementById('typeInp');inp.focus();",
    "    inp.addEventListener('keydown',e=>{if(e.key==='Enter')checkType();});",
    "  }",
    "}",
    "function flip(){flipped=true;renderQuiz();}",
    "function checkType(){if(answered)return;const m=deck[idx][1],v=document.getElementById('typeInp').value.trim();answered=true;mark(v.length>=2&&m.replace(/\\s/g,'').includes(v.replace(/\\s/g,'').slice(0,3)));}",
    "function mark(ok){results[deck[idx][0]]=ok?'correct':'wrong';if(ok){correct++;streak++;}else{wrong++;streak=0;}idx++;saveState();answered=false;flipped=false;if(ttsOk)speechSynthesis.cancel();renderQuiz();}",
    "function toggleStar(w){if(starred.has(w))starred.delete(w);else starred.add(w);saveState();if(view==='list')renderList();else renderQuiz();}",
    "function endScreen(){const pct=deck.length?Math.round(correct/deck.length*100):0;const wc=deck.filter(v=>results[v[0]]==='wrong').length;const q=pct>=90?'\"단어가 쌓이면 세계가 넓어진다.\" 🎉':pct>=70?'\"꾸준함이 재능을 이긴다.\"':pct>=50?'\"반복은 학습의 어머니.\"':'\"실수는 배움의 첫걸음.\"';document.getElementById('stage').innerHTML='<div class=\"end\"><div class=\"score\">'+pct+'%</div><div>'+correct+' / '+deck.length+' 정답</div><div class=\"quote\">'+q+'</div><div class=\"btns\">'+(wc?'<button class=\"btn btn-no\" onclick=\"reviewWrong()\">🔴 틀린 단어 다시 ('+wc+')</button>':'')+'<button class=\"btn btn-nx\" onclick=\"buildDeck()\">🔄 다시 시작</button></div><div class=\"btns\"><button class=\"btn btn-gh\" onclick=\"if(confirm(\\'모든 기록을 지울까요?\\')){ clearAll();}\">기록 초기화</button></div></div>';document.getElementById('progFill').style.width='100%';}",
    "function reviewWrong(){savedMain=null;quickMode='wrong';syncQuick();buildDeck();}",
    "function enterQuick(qm){if(quickMode===null)savedMain={deck:[...deck],idx,correct,wrong,streak};quickMode=qm;syncQuick();buildDeck();}",
    "function exitQuick(){quickMode=null;syncQuick();if(ttsOk)speechSynthesis.cancel();if(savedMain){deck=savedMain.deck;idx=savedMain.idx;correct=savedMain.correct;wrong=savedMain.wrong;streak=savedMain.streak;savedMain=null;answered=false;flipped=false;renderQuiz();}else buildDeck();}",
    "function showWrongPanel(){const wrongs=deck.slice(0,idx).filter(v=>results[v[0]]==='wrong');document.getElementById('panelTitle').textContent='🔴 지금까지 틀린 단어 ('+wrongs.length+')';const body=document.getElementById('panelBody');body.innerHTML=wrongs.length?wrongs.map(r=>'<div class=\"panel-item\"><div class=\"pi-top\"><span class=\"pi-w\">'+r[0]+'</span><span class=\"pi-cat\">'+r[3]+'</span></div><div class=\"pi-m\">'+r[1]+'</div><div class=\"pi-s\">'+r[2]+'</div></div>').join(''):'<div class=\"panel-empty\">아직 틀린 단어가 없어요 👍</div>';document.getElementById('panelOverlay').classList.remove('hidden');}",
    "function showCorrectPanel(){const corrects=deck.slice(0,idx).filter(v=>results[v[0]]==='correct');document.getElementById('panelTitle').textContent='🟢 지금까지 맞힌 단어 ('+corrects.length+')';const body=document.getElementById('panelBody');body.innerHTML=corrects.length?corrects.map(r=>'<div class=\"panel-item\"><div class=\"pi-top\"><span class=\"pi-w\">'+r[0]+'</span><span class=\"pi-cat\">'+r[3]+'</span></div><div class=\"pi-m\">'+r[1]+'</div><div class=\"pi-s\">'+r[2]+'</div></div>').join(''):'<div class=\"panel-empty\">아직 맞힌 단어가 없어요 😅</div>';document.getElementById('panelOverlay').classList.remove('hidden');}",
    "function closePanel(){document.getElementById('panelOverlay').classList.add('hidden');}",
    "function clearAll(){clearState();badge('💾 기록 초기화됨');refresh();}",
    "function switchView(v){view=v;document.getElementById('tabList').classList.toggle('on',v==='list');document.getElementById('tabQuiz').classList.toggle('on',v==='quiz');document.getElementById('listView').classList.toggle('hidden',v!=='list');document.getElementById('quizView').classList.toggle('hidden',v!=='quiz');if(ttsOk)speechSynthesis.cancel();if(v==='list')renderList();else if(deck.length&&idx<deck.length){syncQuick();renderQuiz();}else{quickMode=null;savedMain=null;syncQuick();buildDeck();}}",
    "document.getElementById('tabList').addEventListener('click',()=>switchView('list'));",
    "document.getElementById('tabQuiz').addEventListener('click',()=>switchView('quiz'));",
    "document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(x=>x.classList.remove('on'));b.classList.add('on');mode=b.dataset.m;if(deck.length&&idx<deck.length){answered=false;flipped=false;if(ttsOk)speechSynthesis.cancel();renderQuiz();}else buildDeck();}));",
    "document.getElementById('qWrong').addEventListener('click',()=>{if(quickMode==='wrong')exitQuick();else enterQuick('wrong');});",
    "document.getElementById('qStar').addEventListener('click',()=>{if(quickMode==='star')exitQuick();else enterQuick('star');});",
    "document.getElementById('statCorrect').addEventListener('click',showCorrectPanel);",
    "document.getElementById('statWrong').addEventListener('click',showWrongPanel);",
    "document.getElementById('panelClose').addEventListener('click',closePanel);",
    "document.getElementById('panelOverlay').addEventListener('click',e=>{if(e.target.id==='panelOverlay')closePanel();});",
    "loadState();buildBars();switchView('list');"
  ].join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>📰 주간 단어 학습 & 복습 — ' + weekLabel + '</title>',
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
