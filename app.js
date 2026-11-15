// 런24 상담 유형 대시보드 (index.html) + 관리자 페이지 (admin.html)
const SUPABASE_URL = 'https://dnazztgpzfpcezsadyaz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cuPnQYSO5_hIoNvfLovPPw_VFUnx0u4'; // 공개용 키
const COMPANY_DOMAIN = 'lifegoeson.kr'; // 화면 안내용. 실제 차단은 DB(RLS)에서 한다.
const CHANNEL_DESK = (channelId, chatId) => `https://desk.channel.io/#/channels/${channelId}/user_chats/${chatId}`;
const PAGE = 40;
const NO_STORE = '매장 미지정';
const ADMIN_PAGE = window.ADMIN_PAGE === true;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = sb.schema('run24');
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = (iso, opts) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...opts });
const n = (v) => Number(v || 0).toLocaleString('ko-KR');

// ── 날짜 (모두 한국 시간)
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const WD_LABEL = ['월', '화', '수', '목', '금', '토', '일'];
function kparts(date) {
  const p = Object.fromEntries(PARTS.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: +p.day, wd: WD[p.weekday], h: +p.hour };
}
const periodOfParts = ({ y, m, d }) => `${y}-${m}-${d > 15 ? '16' : '01'}`;
const periodOf = (date) => periodOfParts(kparts(date));
function periodsBetween(start, end) {
  const out = [];
  let [y, m, d] = start.split('-').map(Number);
  for (let p = start; p <= end; ) {
    out.push(p);
    if (d === 1) d = 16; else { d = 1; m++; if (m > 12) { m = 1; y++; } }
    p = `${y}-${String(m).padStart(2, '0')}-${d === 1 ? '01' : '16'}`;
  }
  return out;
}
const periodLabel = (p) => `${+p.slice(5, 7)}월 ${p.endsWith('01') ? '1~15일' : '16일~말일'}`;
const shortLabel = (p) => `${+p.slice(5, 7)}월 ${p.endsWith('01') ? '상' : '하'}`;
const todayKst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

// ── 요약 문장에서 증상·처리 방식 뽑기
// ponytail: 단순 키워드 규칙. 잘 안 맞는 표현이 보이면 여기에 추가한다.
const SYMPTOMS = [
  ['결제 후 작동 안 함', /결제.{0,12}(미작동|작동\s?안|작동하지|안\s?돌|시작\s?안)|미작동/],
  ['도중에 멈춤', /멈|중단|정지/],
  ['문이 안 열림·안 닫힘', /문.{0,6}(안\s?열|열리지|잠|안\s?닫|닫히지)/],
  ['돈·카드를 먹음', /(동전|지폐|돈|코인|카드).{0,8}(먹|투입.{0,4}(안|오류)|인식\s?(안|불가|오류))/],
  ['건조가 덜 됨', /건조.{0,6}(덜|안\s?됨|불량|미흡)|덜\s?마|젖/],
  ['탈수·배수·급수 문제', /탈수|배수|급수|물이/],
  ['세제·유연제 문제', /세제|유연제|거품/],
  ['화면·키오스크 오류', /(화면|키오스크|터치).{0,10}(오류|멈|먹통|안\s?됨|반응|꺼|안\s?나)/],
  ['접수증·영수증 안 나옴', /(접수증|영수증).{0,6}(미출력|안\s?나|출력\s?안|나오지)/],
  ['소음·냄새·오염', /소음|냄새|악취|오염|얼룩|녹/],
];
const RESOLUTIONS = [
  ['환불·결제 취소', /환불|결제\s?취소|취소\s?처리|입금/],
  ['포인트·쿠폰 보상', /포인트|쿠폰|적립/],
  ['원격 조치', /원격|재부팅|재시작|리셋|초기화|코인\s?투입/],
  ['현장 점검·수리', /방문|기사|수리|점검|AS|교체/],
  ['안내로 마무리', /./], // 위 처리가 하나도 없으면 여기로
];
const textOf = (c) => c.summary || c.first_message || '';
// 증상은 한 문의에 여러 개를 셀 수 있다.
const tally = (rules, chats) => rules.map(([label, re]) => [label, chats.filter((c) => re.test(textOf(c))).length])
  .filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
// 처리 방식은 문의 하나당 먼저 맞는 하나만 센다 (요약 문장 대부분이 '~안내함'으로 끝나서).
const tallyFirst = (rules, chats) => Object.entries(countBy(chats.filter((c) => textOf(c)), (c) => rules.find(([, re]) => re.test(textOf(c)))[0]));

// ── 유형 묶음: 태그 이름 앞부분으로 비슷한 유형끼리 묶는다 (결제_환불문의/…, 결제문의_포인트 → 결제)
const GROUPS = { 기기오작동: '기기 오작동', 결제: '결제·환불', 세탁: '세탁·수선', 수거: '수거·배송', 매장이용: '매장 이용', 주차등록: '주차', 매장관리: '매장 관리', 기타: '기타 서비스', OB유형: '먼저 연락한 상담' };
const MAL_GROUP = '기기오작동';
// 흑백 단계: 많은 순으로 진한 회색부터
const SHADES = ['#1F1F1F', '#4A4A4A', '#727272', '#9A9A9A', '#BDBDBD', '#D6D6D6', '#E6E6E6', '#EFEFEF'];
const groupOf = (tag) => tag.split(/[/_]/)[0].replace(/문의$/, '');
// 2026-11-15 이전에 저장된 오작동 세부유형('건조기오류', '세부유형 미지정')을 새 형식으로 읽는다.
const LEGACY_MAL = /^(.+오류|.+미출력|이불함|AS안내|의류확인문의|세탁기오류_.+)$/;
const normalizeTag = (t) => (t === '세부유형 미지정' ? '기기오작동문의' : !t.includes('/') && LEGACY_MAL.test(t) ? `기기오작동문의/${t}` : t);
const groupLabel = (g) => GROUPS[g] || g;
const groupColor = (g) => S.groupShade[g] || '#CFCFCF';
const isParent = (t) => S.parents.has(t);
const tagLabel = (t) => (t.includes('/') ? t.slice(t.indexOf('/') + 1) : isParent(t) ? `${t} (세부 없음)` : t);

// ── 상태. 보는 화면과 필터는 URL 해시에 넣어 링크로 공유할 수 있게 한다.
const S = {
  email: '', approver: false, chats: [], actions: [], sync: null, periods: [], parents: new Set(), groupShade: {}, groupOrder: [],
  view: 'home', key: '', range: '90', period: '', store: '', type: '', q: '', shown: PAGE, actOpen: false, allStores: false,
};
const RANGES = { 30: '최근 1개월', 90: '최근 3개월', all: '전체 기간' };
const VIEWS = ['group', 'type', 'store', 'all'];

function readHash() {
  let hash = location.hash;
  try { if (!/v=/.test(hash)) hash = sessionStorage.getItem('run24-hash') || hash; sessionStorage.removeItem('run24-hash'); } catch {}
  const h = new URLSearchParams(hash.slice(1));
  S.view = VIEWS.includes(h.get('v')) ? h.get('v') : 'home';
  S.key = h.get('k') || '';
  S.range = RANGES[h.get('r')] ? h.get('r') : '90';
  S.period = h.get('p') || ''; S.store = h.get('s') || ''; S.type = h.get('t') || ''; S.q = h.get('q') || '';
}
function writeHash() {
  const h = new URLSearchParams();
  if (S.view !== 'home') h.set('v', S.view);
  if (S.key) h.set('k', S.key);
  if (S.range !== '90') h.set('r', S.range);
  if (S.period) h.set('p', S.period);
  if (S.store) h.set('s', S.store);
  if (S.type) h.set('t', S.type);
  if (S.q) h.set('q', S.q);
  history.replaceState(null, '', h.toString() ? '#' + h : location.pathname);
}

// ── 로그인
function login() {
  app.innerHTML = `<div class="gate"><p class="gate-brand">런24 상담 유형</p><h1>로그인</h1>
    <p>회사 구글 계정(@${COMPANY_DOMAIN})으로 로그인해 주세요.</p>
    <button class="btn primary" id="go">구글로 로그인</button></div>`;
  try { if (/v=/.test(location.hash)) sessionStorage.setItem('run24-hash', location.hash); } catch {}
  document.getElementById('go').onclick = () => sb.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { hd: COMPANY_DOMAIN } },
  });
}
function notCompany(email) {
  app.innerHTML = `<div class="gate"><p class="gate-brand">런24 상담 유형</p><h1>볼 수 없는 계정이에요</h1>
    <p>${esc(email)} 계정은 볼 수 없어요. 회사 계정(@${COMPANY_DOMAIN})으로 다시 로그인해 주세요.</p>
    <button class="btn" id="out">로그아웃</button></div>`;
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); login(); };
}

// ── 화면 틀: 왼쪽 사이드바 + 오른쪽 본문
async function shell(email) {
  S.email = email;
  readHash();
  const { data: ok } = await db.rpc('is_approver');
  S.approver = ok === true;
  if (ADMIN_PAGE && !S.approver) {
    app.innerHTML = `<div class="gate"><p class="gate-brand">런24 상담 유형</p><h1>관리자만 들어올 수 있어요</h1>
      <p>${esc(email)} 계정은 관리자로 등록되어 있지 않아요. 관리자에게 등록을 요청해 주세요.</p>
      <a class="btn" href="./">대시보드로 가기</a></div>`;
    return;
  }
  app.innerHTML = `
    <div class="frame">
      <aside class="side" aria-label="메뉴">
        <a class="side-brand" href="./">런24 상담 유형</a>
        <nav id="nav"></nav>
        <div class="side-foot"><span>${esc(email)}</span><a href="#" id="out">로그아웃</a></div>
      </aside>
      <main class="main"><div id="view" class="view"><p class="loading">불러오는 중…</p></div></main>
    </div>`;
  document.getElementById('out').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ''; login(); };
  if (ADMIN_PAGE) { renderNav(); return admins(); }
  await loadData();
  render();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const item = (label, attrs, on, extra = '') => `<button class="nav-item ${on ? 'on' : ''}" ${attrs}>${label}${extra}</button>`;
  const here = (v, k = '') => !ADMIN_PAGE && S.view === v && (!k || S.key === k);
  nav.innerHTML = ADMIN_PAGE
    ? `<a class="nav-item" href="./">대시보드</a><span class="nav-item on">관리자</span>`
    : `${item('대시보드', 'data-nav="home"', here('home'))}
       ${item('전체 상담', 'data-nav="all"', here('all'))}
       <p class="nav-head">유형 묶음</p>
       ${S.groupOrder.map((g) => item(`<i class="dot" style="background:${groupColor(g)}"></i>${esc(groupLabel(g))}`, `data-group="${esc(g)}"`,
         here('group', g) || (S.view === 'type' && groupOf(S.key) === g))).join('')}
       ${S.approver ? '<p class="nav-head">설정</p><a class="nav-item" href="admin.html">관리자</a>' : ''}`;
  for (const b of nav.querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
  for (const b of nav.querySelectorAll('[data-group]')) b.onclick = () => go('group', b.dataset.group);
}

// ── 데이터: 유형/ 태그가 붙은 상담 전체를 한 번에 불러와 화면에서 집계한다 (수만 건 수준).
async function loadData() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('chat_list')
      .select('chat_id, channel_id, opened_at, store, first_message, estimated, summary, device_type')
      .order('opened_at', { ascending: false }).range(from, from + 999);
    if (error) { document.getElementById('view').innerHTML = `<p class="warn">데이터를 불러오지 못했어요. 새로고침해 주세요. (${esc(error.message)})</p>`; throw error; }
    rows.push(...data);
    const el = document.querySelector('.loading'); if (el) el.textContent = `불러오는 중… ${n(rows.length)}건`;
    if (data.length < 1000) break;
  }
  const [{ data: sync }, { data: actions }] = await Promise.all([
    db.from('sync_state').select('last_synced_at, last_error').maybeSingle(),
    db.from('actions').select('id, device_type, acted_on, note, created_by').order('acted_on'),
  ]);
  S.sync = sync; S.actions = actions || [];

  const byId = new Map(), tags = new Set();
  for (const r of rows) {
    let c = byId.get(r.chat_id);
    if (!c) {
      const p = kparts(new Date(r.opened_at));
      c = { id: r.chat_id, channel_id: r.channel_id, opened_at: r.opened_at, ms: Date.parse(r.opened_at), store: r.store || NO_STORE,
        summary: r.summary, first_message: r.first_message, types: [], groups: [], estimated: false, period: periodOfParts(p), wd: p.wd, h: p.h };
      byId.set(r.chat_id, c);
    }
    const tag = normalizeTag(r.device_type);
    if (!c.types.includes(tag)) c.types.push(tag);
    tags.add(tag);
    const g = groupOf(tag); if (!c.groups.includes(g)) c.groups.push(g);
    if (r.estimated) c.estimated = true;
  }
  S.chats = [...byId.values()].sort((a, b) => b.ms - a.ms);
  S.parents = new Set([...tags].filter((t) => !t.includes('/') && [...tags].some((o) => o.startsWith(t + '/'))));
  S.groupOrder = sortGroups(Object.entries(countBy(S.chats, (c) => c.groups))).map(([g]) => g);
  S.groupOrder.forEach((g, i) => (S.groupShade[g] = SHADES[Math.min(i, SHADES.length - 1)]));

  // 보름 구간: 수집 시작 보름은 일부 날짜만 있어 낮게 보이므로, 다음 보름의 30% 미만이면 뺀다.
  const now = periodOf(new Date());
  const first = S.chats.reduce((a, c) => (c.period < a ? c.period : a), now);
  let P = periodsBetween(first, now);
  const cnt = (p) => S.chats.filter((c) => c.period === p).length;
  if (P.length > 2 && cnt(P[0]) < cnt(P[1]) * 0.3) P = P.slice(1);
  S.periods = P;
}

function countBy(list, keyFn) {
  const m = {};
  for (const x of list) for (const k of [].concat(keyFn(x))) m[k] = (m[k] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
const inRange = (c) => S.range === 'all' || c.ms >= Date.now() - Number(S.range) * 86_400_000;
const isMal = (c) => c.groups.includes(MAL_GROUP);
const sortGroups = (entries) => entries.sort((a, b) => (a[0] === 'OB유형') - (b[0] === 'OB유형') || b[1] - a[1]);
function halves() { const P = S.periods; return { cur: P.at(-1), last: P.at(-2), prev: P.at(-3) }; }

// 증감 배지: 상담은 줄어드는 게 좋아서 늘면 빨강, 줄면 초록
function delta(now, before, { words = false } = {}) {
  const d = now - before;
  if (!before && !now) return '';
  if (d === 0) return `<span class="delta flat">${words ? '그 전과 같아요' : '0'}</span>`;
  const pct = before ? Math.round((Math.abs(d) / before) * 100) : null;
  const txt = words ? `${n(Math.abs(d))}건 ${d > 0 ? '늘었어요' : '줄었어요'}` : `${d > 0 ? '+' : '−'}${n(Math.abs(d))}${pct !== null && before >= 10 ? ` (${pct}%)` : ''}`;
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '↗' : '↘'} ${txt}</span>`;
}

function go(view, key = '') {
  Object.assign(S, { view, key, period: '', store: '', type: '', q: '', shown: PAGE, actOpen: false, allStores: false });
  render(); scrollTo({ top: 0 });
}
function render() {
  writeHash();
  renderNav();
  if (S.view === 'home') renderHome(); else renderDetail();
}

// ── 차트와 조각 (흑백)
const rangeSelect = () => `<label class="select"><span class="sr">기간</span><select id="range">${Object.entries(RANGES).map(([k, v]) =>
  `<option value="${k}" ${S.range === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
const card = (title, sub, body, { cls = '', tools = '' } = {}) => `<section class="card ${cls}">
  <div class="card-head"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${tools}</div>${body}</section>`;

function hbars(entries, { onKey, color, label = (k) => k, dim, title } = {}) {
  const top = Math.max(1, ...entries.map(([, v]) => v));
  return `<ul class="hbars">${entries.map(([k, v]) => `<li>
    ${onKey ? `<button class="hbar" data-${onKey}="${esc(k)}" ${title ? `title="${esc(title(k))}"` : ''}>` : '<div class="hbar">'}
      <span class="hbar-label ${dim && dim(k) ? 'dim' : ''}">${esc(label(k))}</span>
      <span class="hbar-track"><span style="width:${(v / top) * 100}%;background:${color ? color(k) : 'var(--ink)'}"></span></span>
      <span class="hbar-val">${n(v)}</span>
    ${onKey ? '</button>' : '</div>'}</li>`).join('')}</ul>`;
}

// 요일별 막대: 가장 많은 요일만 진하게
function weekdayBars(chats) {
  const m = Array(7).fill(0); for (const c of chats) m[c.wd]++;
  const max = Math.max(1, ...m), best = m.indexOf(Math.max(...m));
  return `<div class="vbars">${m.map((v, i) => `<div class="vbar ${i === best ? 'top' : ''}" title="${WD_LABEL[i]}요일 ${n(v)}건">
    <span class="vbar-v">${n(v)}</span><span class="vbar-b" style="height:${(v / max) * 100}%"></span><span class="vbar-l">${WD_LABEL[i]}</span></div>`).join('')}</div>`;
}

// 상위 N개만 남기고 나머지는 '그 외'로 합친다
const OTHER = '__other';
const topN = (entries, k) => entries.length <= k + 1 ? entries : [...entries.slice(0, k), [OTHER, entries.slice(k).reduce((s, [, v]) => s + v, 0)]];
const withOther = (fn, other) => (k) => (k === OTHER ? other : fn(k));

// 도넛: 조각 사이에 틈을 둔 흑백 도넛
function donut(all, { color, label, onKey } = {}) {
  const entries = topN(all, 6);
  color = withOther(color, '#E8E8E8'); label = withOther(label, '그 외');
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const R = 52, C = 2 * Math.PI * R, gap = 3;
  let off = 0;
  const arcs = entries.map(([k, v]) => {
    const len = Math.max(0, (v / total) * C - gap);
    const a = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${color(k)}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(label(k))} ${n(v)}건</title></circle>`;
    off += (v / total) * C; return a;
  }).join('');
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 140 140" role="img" aria-label="유형 묶음 비중"><g transform="rotate(-90 70 70)">${arcs}</g>
      <text x="70" y="66" text-anchor="middle" class="donut-n">${n(total)}</text><text x="70" y="84" text-anchor="middle" class="donut-l">건</text></svg>
    <ul class="legend">${entries.map(([k, v]) => `<li>${onKey && k !== OTHER ? `<button data-${onKey}="${esc(k)}">` : '<span>'}
      <i style="background:${color(k)}"></i><span class="lg-l">${esc(label(k))}</span><span class="lg-v">${n(v)}</span><span class="lg-p">${Math.round((v / total) * 100)}%</span>
      ${onKey && k !== OTHER ? '</button>' : '</span>'}</li>`).join('')}</ul></div>`;
}

// 보름별 누적 막대: 유형 묶음(또는 세부 유형)별 흑백 단계
function stackedTrend(chats, { keyFn = (c) => c.groups, color = groupColor, label = groupLabel, actPeriods = new Set(), keys } = {}) {
  const P = S.periods, cur = P.at(-1);
  const all = keys || Object.keys(countBy(chats, keyFn));
  const order = all.length > 6 ? [...all.slice(0, 5), OTHER] : all;
  const top = new Set(order);
  const kf = (c) => [].concat(keyFn(c)).map((k) => (top.has(k) ? k : OTHER));
  color = withOther(color, '#E8E8E8'); label = withOther(label, '그 외');
  const per = Object.fromEntries(P.map((p) => [p, countBy(chats.filter((c) => c.period === p), kf)]));
  const tot = (p) => chats.filter((c) => c.period === p).length;
  const max = Math.max(1, ...P.map((p) => Object.values(per[p]).reduce((s, v) => s + v, 0)));
  return `<div class="stack-trend">${P.map((p) => {
    const sum = Object.values(per[p]).reduce((s, v) => s + v, 0);
    return `<button class="st-col ${p === cur ? 'cur' : ''} ${S.period === p ? 'on' : ''}" data-period="${p}" title="${periodLabel(p)}${p === cur ? ' (진행 중)' : ''}: ${tot(p)}건">
      <span class="st-v">${n(tot(p))}</span>
      <span class="st-bar" style="height:${(sum / max) * 100}%">${order.filter((k) => per[p][k]).map((k) =>
        `<i style="flex:${per[p][k]};background:${color(k)}" title="${esc(label(k))} ${per[p][k]}건"></i>`).join('')}</span>
      <span class="st-l">${shortLabel(p)}${actPeriods.has(p) ? '<b class="st-flag" aria-label="개선 조치">●</b>' : ''}</span></button>`;
  }).join('')}</div>`;
}

function heatmap(chats) {
  const grid = Array.from({ length: 7 }, () => Array(12).fill(0));
  for (const c of chats) grid[c.wd][Math.floor(c.h / 2)]++;
  const max = Math.max(1, ...grid.flat());
  let best = [0, 0, 0];
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best[0]) best = [v, d, h]; }));
  const nz = grid.flat().filter((v) => v).sort((a, b) => a - b);
  const q = (f) => nz[Math.floor((nz.length - 1) * f)] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (v) => (v === 0 ? 0 : 1 + cuts.filter((c) => v > c).length);
  return `<div class="heat" role="img" aria-label="요일과 시간대별 상담 수. 가장 많은 때는 ${WD_LABEL[best[1]]}요일 ${best[2] * 2}~${best[2] * 2 + 2}시">
    <div class="heat-grid">
      ${grid.map((row, d) => `<span class="heat-d">${WD_LABEL[d]}</span>${row.map((v, h) =>
        `<span class="tile l${level(v)}" title="${WD_LABEL[d]}요일 ${h * 2}~${h * 2 + 2}시: ${v}건"></span>`).join('')}`).join('')}
      <span></span>${Array.from({ length: 12 }, (_, i) => `<span class="heat-h">${i % 2 === 0 ? `${i * 2}시` : ''}</span>`).join('')}
    </div>
    <div class="heat-foot">${best[0] ? `<span>가장 많은 때는 <b>${WD_LABEL[best[1]]}요일 ${best[2] * 2}~${best[2] * 2 + 2}시</b></span>` : '<span></span>'}
      <span class="heat-legend">적음 <i class="tile l0"></i><i class="tile l1"></i><i class="tile l2"></i><i class="tile l3"></i><i class="tile l4"></i> 많음</span></div>
  </div>`;
}

const tagChip = (t) => `<button class="tag" data-type="${esc(t)}" title="${esc(t)}"><i style="background:${groupColor(groupOf(t))}"></i>${esc(tagLabel(t))}</button>`;
function chatRow(c) {
  return `<li class="chat">
    <div class="chat-meta"><span>${kst(c.opened_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <button class="linkish" data-store="${esc(c.store)}">${esc(c.store)}</button>
      <a class="open" href="${CHANNEL_DESK(encodeURIComponent(c.channel_id), encodeURIComponent(c.id))}" target="_blank" rel="noopener">채널톡</a></div>
    <p class="chat-text">${esc(c.summary || c.first_message) || '<span class="muted">(고객이 남긴 내용 없음)</span>'}</p>
    <div class="chat-foot">${c.types.map(tagChip).join('')}${c.estimated ? '<span class="est" title="상담원 태그에 세부유형이 없어 내용으로 추정했어요">추정</span>' : ''}</div></li>`;
}

// 기기 오작동 문의만 골라 증상과 처리 방식 (규칙이 오작동 상담에 맞춰져 있어서)
function malCard(chats, title = '기기 오작동 증상과 처리') {
  const mal = chats.filter(isMal);
  if (!mal.length) return '';
  const sym = tally(SYMPTOMS, mal).slice(0, 6), res = tallyFirst(RESOLUTIONS, mal);
  return card(title, `오작동 상담 ${n(mal.length)}건의 요약에서 찾았어요`, `
    <div class="stacked">
      <div><h3>증상</h3>${sym.length ? hbars(sym) : '<p class="muted">찾은 증상이 없어요.</p>'}</div>
      <div><h3>처리</h3>${res.length ? hbars(res, { color: () => 'var(--mid)' }) : ''}</div>
    </div>`);
}

function bindCommon(root) {
  root.querySelector('#range')?.addEventListener('change', (e) => { S.range = e.target.value; S.shown = PAGE; render(); });
  for (const b of root.querySelectorAll('[data-group]')) b.onclick = () => go('group', b.dataset.group);
  for (const b of root.querySelectorAll('[data-type]')) b.onclick = () => go('type', b.dataset.type);
  for (const b of root.querySelectorAll('[data-store]')) b.onclick = () => go('store', b.dataset.store);
}

function movers(listA, listB) {
  const a = countBy(listA, (c) => c.types), b = countBy(listB, (c) => c.types);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => !isParent(t))
    .map((t) => [t, (a[t] || 0) - (b[t] || 0)]).sort((x, y) => y[1] - x[1]);
}

function pageHead(title, sub, { crumb = '' } = {}) {
  const updated = S.sync?.last_synced_at ? kst(S.sync.last_synced_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  return `<div class="page-head">
    <div>${crumb ? `<nav class="crumb">${crumb}</nav>` : ''}<h1>${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
    <div class="page-tools"><span class="updated">${updated} 갱신</span>${rangeSelect()}</div></div>
    ${S.sync?.last_error ? `<p class="warn">최근 갱신에 실패해서 숫자가 최신이 아닐 수 있어요. (${esc(S.sync.last_error)})</p>` : ''}`;
}

// ── 대시보드 (첫 화면)
function renderHome() {
  const view = document.getElementById('view');
  const { cur, last, prev } = halves();
  const all = S.chats, ranged = all.filter(inRange);
  const byP = (p) => all.filter((c) => c.period === p);
  const curN = byP(cur).length, lastN = byP(last).length, prevN = byP(prev).length;
  const mv = movers(byP(last), byP(prev)), rose = mv[0];
  const groupTotals = sortGroups(Object.entries(countBy(ranged, (c) => c.groups)));
  const storeTotals = countBy(ranged.filter((c) => c.store !== NO_STORE), (c) => c.store);
  const storeEntries = Object.entries(storeTotals).slice(0, 8);
  const malShare = ranged.length ? Math.round((ranged.filter(isMal).length / ranged.length) * 100) : 0;

  view.innerHTML = `
    ${pageHead('대시보드', `${periodLabel(cur)} 기준 · ${RANGES[S.range]} ${n(ranged.length)}건`)}
    <section class="kpis">
      <div class="kpi"><p>이번 보름 상담</p><b>${n(curN)}</b><span class="kpi-note">${periodLabel(cur)}, 진행 중</span></div>
      <div class="kpi"><p>지난 보름 상담</p><b>${n(lastN)}</b>${delta(lastN, prevN)}<span class="kpi-note">그 전 보름 대비</span></div>
      <div class="kpi"><p>가장 많이 늘어난 유형</p><b class="kpi-text">${rose && rose[1] > 0 ? `<button class="linkish" data-type="${esc(rose[0])}">${esc(tagLabel(rose[0]))}</button>` : '-'}</b>
        ${rose && rose[1] > 0 ? delta(rose[1], 0, { words: true }) : ''}<span class="kpi-note">${rose ? esc(groupLabel(groupOf(rose[0]))) : ''}</span></div>
      <div class="kpi"><p>기기 오작동 비중</p><b>${malShare}<small>%</small></b><span class="kpi-note">${RANGES[S.range]} 전체 상담 중</span></div>
    </section>

    <div class="cards">
      ${card('유형 묶음 비중', `${RANGES[S.range]} · 묶음을 누르면 자세히 볼 수 있어요`, donut(groupTotals, { color: groupColor, label: groupLabel, onKey: 'group' }), { cls: 'span-2' })}
      ${card('요일별 상담', RANGES[S.range], weekdayBars(ranged))}
      ${card('보름별 상담', '막대 안의 회색 단계는 유형 묶음이에요', stackedTrend(all, { keys: S.groupOrder }), { cls: 'span-3' })}
      ${card('매장 TOP 8', '상담이 많은 매장이에요. 막대는 유형 묶음 구성이에요', `<ul class="stores">${storeEntries.map(([s, v]) => {
        const comp = sortGroups(Object.entries(countBy(ranged.filter((c) => c.store === s), (c) => c.groups)));
        return `<li><button class="store-row" data-store="${esc(s)}"><span class="hbar-label">${esc(s)}</span>
          <span class="stack" style="width:${(v / storeEntries[0][1]) * 100}%">${comp.map(([g, k]) => `<i style="flex:${k};background:${groupColor(g)}" title="${esc(groupLabel(g))} ${k}건"></i>`).join('')}</span>
          <span class="hbar-val">${n(v)}</span></button></li>`;
      }).join('')}</ul>`)}
      ${card('시간대별 상담', '요일과 시간대별로 진할수록 많아요', heatmap(ranged))}
      ${malCard(ranged)}
      ${card('최근 상담', '', `<ul class="chats compact">${all.slice(0, 5).map(chatRow).join('')}</ul><button class="btn ghost" id="more-chats">전체 상담 보기</button>`, { cls: 'span-3' })}
    </div>`;

  bindCommon(view);
  view.querySelector('#more-chats').onclick = () => go('all');
  for (const b of view.querySelectorAll('[data-period]')) b.onclick = () => { go('all'); S.period = b.dataset.period; render(); };
}

// ── 상세: 묶음 하나 / 세부 유형 하나 / 매장 하나 / 전체 상담
function renderDetail() {
  const view = document.getElementById('view');
  const V = S.view, K = S.key;
  const base = S.chats.filter((c) => (V === 'group' ? c.groups.includes(K) : V === 'type' ? c.types.includes(K) : V === 'store' ? c.store === K : true));
  const ranged = base.filter(inRange);
  const { cur, last, prev } = halves();
  const cntP = (p) => base.filter((c) => c.period === p).length;
  const title = V === 'group' ? groupLabel(K) : V === 'type' ? tagLabel(K) : V === 'store' ? K : '전체 상담';
  const crumb = `<button class="linkish" id="back">대시보드</button>${V === 'type' ? ` / <button class="linkish" data-group="${esc(groupOf(K))}">${esc(groupLabel(groupOf(K)))}</button>` : ''}`;
  const allRanged = S.chats.filter(inRange).length;

  const acts = V === 'type' ? S.actions.filter((a) => a.device_type === K).sort((a, b) => (a.acted_on < b.acted_on ? -1 : 1)) : [];
  const actPeriods = new Set(acts.map((a) => periodOf(new Date(a.acted_on))));

  const q = S.q.trim();
  const listed = (S.period ? base.filter((c) => c.period === S.period) : ranged)
    .filter((c) => (!S.store || c.store === S.store) && (!S.type || c.types.includes(S.type))
      && (!q || `${c.summary || ''} ${c.first_message || ''} ${c.store}`.includes(q)));

  // 무엇으로 나눠 볼지: 묶음 → 세부 유형, 매장·전체 → 유형 묶음
  const subKey = V === 'group' ? (c) => c.types.filter((t) => groupOf(t) === K) : (c) => c.groups;
  const subEntries = V === 'type' ? [] : (V === 'group' ? Object.entries(countBy(ranged, subKey)) : sortGroups(Object.entries(countBy(ranged, subKey))));
  const subShade = Object.fromEntries(subEntries.map(([k], i) => [k, SHADES[Math.min(i, SHADES.length - 1)]]));
  const subColor = V === 'group' ? (k) => subShade[k] || '#CFCFCF' : groupColor;
  const subLabel = V === 'group' ? tagLabel : groupLabel;

  const st = Object.entries(countBy(ranged, (c) => c.store)).sort((a, b) => (a[0] === NO_STORE) - (b[0] === NO_STORE) || b[1] - a[1]);
  const storeCard = V === 'store' ? '' : card('매장 순위', '누르면 아래 목록을 그 매장으로 거를 수 있어요',
    `${hbars(S.allStores ? st : st.slice(0, 10), { onKey: 'filter-store', dim: (k) => k === NO_STORE })}
     ${st.length > 10 ? `<button class="linkish more-link" id="all-stores">${S.allStores ? '접기' : `${n(st.length)}곳 모두 보기`}</button>` : ''}`);

  const kpi = (label, val, extra = '', note = '') => `<div class="kpi"><p>${label}</p><b>${val}</b>${extra}<span class="kpi-note">${note}</span></div>`;

  view.innerHTML = `
    ${pageHead(esc(title), V === 'type' ? esc(K) : '', { crumb })}
    <section class="kpis">
      ${kpi(RANGES[S.range], n(ranged.length), '', V !== 'all' ? `전체 상담의 ${Math.round((ranged.length / Math.max(1, allRanged)) * 100)}%` : '')}
      ${kpi('지난 보름', n(cntP(last)), delta(cntP(last), cntP(prev)), periodLabel(last))}
      ${kpi('이번 보름', n(cntP(cur)), '', `${periodLabel(cur)}, 진행 중`)}
      ${kpi('상담이 많은 매장', st.find(([s]) => s !== NO_STORE) ? `<span class="kpi-text">${esc(st.find(([s]) => s !== NO_STORE)[0])}</span>` : '-', '', st.find(([s]) => s !== NO_STORE) ? `${n(st.find(([s]) => s !== NO_STORE)[1])}건` : '')}
    </section>

    <div class="cards">
      ${card('보름별 추이', `막대를 누르면 그 보름의 상담만 아래에 보여요. 빗금은 진행 중인 보름이에요.${actPeriods.size ? ' 점은 개선 조치를 한 보름이에요.' : ''}`,
        `${V === 'type' ? stackedTrend(base, { keyFn: () => ['x'], color: () => 'var(--ink)', label: () => title, actPeriods })
          : stackedTrend(base, { keyFn: subKey, color: subColor, label: subLabel, keys: subEntries.map(([k]) => k) })}
         ${V === 'type' ? actionsBlock(base, acts) : ''}`, { cls: 'span-3' })}
      ${subEntries.length ? card(V === 'group' ? '세부 유형' : '유형 묶음', V === 'group' ? '누르면 그 유형만 자세히 볼 수 있어요' : '',
        donut(subEntries, { color: subColor, label: subLabel, onKey: V === 'group' ? 'type' : 'group' }), { cls: 'span-2' }) : ''}
      ${V === 'store' ? card('이 매장의 세부 유형', '누르면 아래 목록을 거를 수 있어요',
        hbars(Object.entries(countBy(ranged, (c) => c.types)).slice(0, 10), { onKey: 'filter-type', color: (k) => groupColor(groupOf(k)), label: tagLabel, dim: isParent, title: (k) => k })) : ''}
      ${card('요일별 상담', RANGES[S.range], weekdayBars(ranged))}
      ${storeCard}
      ${card('시간대별 상담', '진할수록 많아요', heatmap(ranged))}
      ${malCard(ranged, V === 'group' && K === MAL_GROUP || V === 'type' && groupOf(K) === MAL_GROUP ? '증상과 처리' : '기기 오작동 증상과 처리')}
    </div>

    <section class="card list-card" id="list">
      <div class="card-head"><div><h2>상담 ${n(listed.length)}건</h2><p class="card-sub">요약을 읽고, 자세한 대화는 채널톡에서 확인하세요</p></div></div>
      <div class="filters">
        <input type="search" id="q" value="${esc(q)}" placeholder="내용으로 찾기 (예: 탈수, 환불, 입고)" aria-label="상담 내용으로 찾기">
        ${S.period ? `<button class="pill" data-clear="period">${periodLabel(S.period)} ✕</button>` : ''}
        ${S.store ? `<button class="pill" data-clear="store">${esc(S.store)} ✕</button>` : ''}
        ${S.type ? `<button class="pill" data-clear="type">${esc(tagLabel(S.type))} ✕</button>` : ''}
      </div>
      ${listed.length ? `<ul class="chats">${listed.slice(0, S.shown).map(chatRow).join('')}</ul>
        ${listed.length > S.shown ? `<button class="btn ghost" id="more">${n(listed.length - S.shown)}건 더 보기</button>` : ''}`
        : '<p class="muted empty">조건에 맞는 상담이 없어요. 필터를 지우거나 다른 말로 찾아보세요.</p>'}
    </section>`;

  bindCommon(view);
  view.querySelector('#back').onclick = () => go('home');
  const relist = (scroll) => { S.shown = PAGE; render(); if (scroll) document.getElementById('list')?.scrollIntoView({ behavior: 'smooth' }); };
  for (const b of view.querySelectorAll('[data-period]')) b.onclick = () => { S.period = S.period === b.dataset.period ? '' : b.dataset.period; relist(true); };
  for (const b of view.querySelectorAll('[data-filter-store]')) b.onclick = () => { S.store = S.store === b.dataset.filterStore ? '' : b.dataset.filterStore; relist(true); };
  for (const b of view.querySelectorAll('[data-filter-type]')) b.onclick = () => { S.type = S.type === b.dataset.filterType ? '' : b.dataset.filterType; relist(true); };
  for (const b of view.querySelectorAll('[data-clear]')) b.onclick = () => { S[b.dataset.clear] = ''; relist(); };
  view.querySelector('#more')?.addEventListener('click', () => { S.shown += PAGE; render(); });
  view.querySelector('#all-stores')?.addEventListener('click', () => { S.allStores = !S.allStores; render(); });
  const qi = view.querySelector('#q');
  let timer;
  qi.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { S.q = qi.value; S.shown = PAGE; S.qFocus = true; render(); }, 250); };
  if (S.qFocus) { S.qFocus = false; const el = document.getElementById('q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  for (const tr of view.querySelectorAll('.stack-trend')) tr.scrollLeft = tr.scrollWidth;
  if (V === 'type') bindActions(view);
}

// ── 개선 조치 (유형 화면)
function actionsBlock(base, acts) {
  const latest = acts.at(-1);
  let compare = '';
  if (latest) {
    const P = S.periods, cur = P.at(-1), i = P.indexOf(periodOf(new Date(latest.acted_on)));
    const cnt = (p) => base.filter((c) => c.period === p).length;
    const avg = (ps) => (ps.length ? ps.reduce((s, p) => s + cnt(p), 0) / ps.length : null);
    const before = i < 0 ? [] : P.slice(Math.max(0, i - 3), i), after = i < 0 ? [] : P.slice(i + 1).filter((p) => p !== cur).slice(0, 3);
    const b = avg(before), a = avg(after), r1 = (v) => Math.round(v * 10) / 10;
    compare = i < 0 ? '<p class="note">조치일이 데이터 기간 밖이라 비교할 수 없어요.</p>'
      : !after.length ? `<p class="note">${esc(latest.acted_on)} 조치 이후 끝난 보름이 아직 없어요. 다음 보름이 끝나면 전후 비교가 보여요.</p>`
      : `<p class="compare">최근 조치(${esc(latest.acted_on)}) 전에는 보름에 평균 <b>${r1(b)}건</b>, 이후에는 <b>${r1(a)}건</b>이에요.
          ${b ? `<span class="chg ${a < b ? 'down' : a > b ? 'up' : 'flat'}">${a < b ? `${Math.round((1 - a / b) * 100)}% 줄었어요` : a > b ? `${Math.round((a / b - 1) * 100)}% 늘었어요` : '그대로예요'}</span>` : ''}
          <span class="muted">(전 ${before.length}개 보름, 후 ${after.length}개 보름 비교, 조치한 보름은 뺐어요)</span></p>`;
  }
  return `<div class="actions">
    <h3>개선 조치</h3>
    ${compare}
    ${acts.length ? `<ul class="act-list">${acts.slice().reverse().map((a) => `<li><span class="act-date">${esc(a.acted_on)}</span>
      <span>${esc(a.note) || '<span class="muted">(메모 없음)</span>'}</span><span class="muted">${esc(a.created_by.split('@')[0])}</span>
      ${a.created_by === S.email ? `<button class="linkish" data-del="${a.id}">삭제</button>` : ''}</li>`).join('')}</ul>` : ''}
    ${acts.length || S.actOpen ? `<form class="act-form" id="act-form">
      <input type="date" name="d" value="${todayKst()}" max="${todayKst()}" required aria-label="조치한 날">
      <input type="text" name="n" maxlength="200" placeholder="무엇을 했나요? (예: 건조기 필터 전 매장 교체)" aria-label="조치 내용">
      <button class="btn primary" type="submit">조치 기록</button></form>`
      : '<p class="note">이 유형에 개선 조치를 했다면 <button class="linkish strong" id="act-open">날짜를 기록해 두세요</button>. 추이에 표시되고 조치 전후를 비교해 줘요.</p>'}
  </div>`;
}

function bindActions(view) {
  view.querySelector('#act-open')?.addEventListener('click', () => { S.actOpen = true; render(); document.querySelector('#act-form input[name=n]')?.focus(); });
  view.querySelector('#act-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; f.querySelector('button').disabled = true;
    const { error } = await db.from('actions').insert({ device_type: S.key, acted_on: f.d.value, note: f.n.value.trim() });
    if (error) { f.querySelector('button').disabled = false; alert('기록하지 못했어요: ' + error.message); return; }
    await reloadActions();
  });
  for (const b of view.querySelectorAll('[data-del]')) b.onclick = async () => {
    if (!confirm('이 조치 기록을 삭제할까요?')) return;
    const { error } = await db.from('actions').delete().eq('id', Number(b.dataset.del));
    if (error) { alert('삭제하지 못했어요: ' + error.message); return; }
    await reloadActions();
  };
}
async function reloadActions() {
  const { data } = await db.from('actions').select('id, device_type, acted_on, note, created_by').order('acted_on');
  S.actions = data || [];
  render();
}

// ── 관리자 페이지: 관리자 추가·삭제
async function admins() {
  const view = document.getElementById('view');
  const { data: rows, error } = await db.from('approvers').select('email, added_by, added_at').order('email');
  if (error) { view.innerHTML = `<p class="warn">관리자 목록을 불러오지 못했어요: ${esc(error.message)}</p>`; return; }
  const me = S.email.toLowerCase();
  view.innerHTML = `
    <div class="page-head"><div><h1>관리자</h1><p class="page-sub">관리자는 이 페이지에서 다른 관리자를 등록하거나 뺄 수 있어요. 회사 계정(@${COMPANY_DOMAIN})만 등록할 수 있어요.</p></div></div>
    <section class="card">
      <form class="act-form" id="admin-form">
        <input type="email" name="e" required placeholder="이름@${COMPANY_DOMAIN}" aria-label="추가할 관리자 이메일">
        <button class="btn primary" type="submit">관리자 추가</button>
      </form>
      <ul class="admins">${rows.map((r) => `<li><span>${esc(r.email)}${r.email === me ? ' <span class="muted">(나)</span>' : ''}</span>
        <span class="muted">${r.added_by ? `${esc(r.added_by.split('@')[0])}님이 ${kst(r.added_at, { month: 'numeric', day: 'numeric' })}에 추가` : '처음 설정'}</span>
        ${r.email === me ? '' : `<button class="linkish" data-rm="${esc(r.email)}">관리자에서 빼기</button>`}</li>`).join('')}</ul>
    </section>`;
  view.querySelector('#admin-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = e.target.e.value.trim().toLowerCase();
    if (!email.endsWith('@' + COMPANY_DOMAIN)) { alert(`회사 계정(@${COMPANY_DOMAIN})만 등록할 수 있어요.`); return; }
    const { error } = await db.from('approvers').insert({ email });
    if (error) { alert(error.code === '23505' ? '이미 관리자예요.' : '추가하지 못했어요: ' + error.message); return; }
    admins();
  };
  for (const b of view.querySelectorAll('[data-rm]')) b.onclick = async () => {
    if (!confirm(`${b.dataset.rm} 님을 관리자에서 뺄까요?`)) return;
    const { error } = await db.from('approvers').delete().eq('email', b.dataset.rm);
    if (error) { alert('빼지 못했어요: ' + error.message); return; }
    admins();
  };
}

// ── 시작
async function route(session) {
  if (!session) return login();
  const email = session.user.email || '';
  if (email.toLowerCase().split('@')[1] !== COMPANY_DOMAIN) return notCompany(email);
  shell(email);
}
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    if (event === 'SIGNED_IN' && started) return; // 토큰 갱신 등으로 다시 그리지 않는다
    started = true;
    route(session);
  }
});
