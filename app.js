const SUPABASE_URL = 'https://dnazztgpzfpcezsadyaz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cuPnQYSO5_hIoNvfLovPPw_VFUnx0u4'; // 공개용 키
const COMPANY_DOMAIN = 'lifegoeson.kr'; // 화면 안내용. 실제 차단은 DB(RLS)에서 한다.
const CHANNEL_DESK = (channelId, chatId) => `https://desk.channel.io/#/channels/${channelId}/user_chats/${chatId}`;
const PAGE = 50;
const UNKNOWN = '세부유형 미지정';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = sb.schema('run24');
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = (iso, opts) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...opts });

// ── 보름 구간: 'YYYY-MM-01' 또는 'YYYY-MM-16' (한국 시간 기준)
function periodOf(date) {
  const [y, m, d] = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).split('-');
  return `${y}-${m}-${+d > 15 ? '16' : '01'}`;
}
function periodsFrom(start) {
  const out = [], end = periodOf(new Date());
  let [y, m, d] = start.split('-').map(Number);
  for (let p = start; p <= end; ) {
    out.push(p);
    if (d === 1) d = 16; else { d = 1; m++; if (m > 12) { m = 1; y++; } }
    p = `${y}-${String(m).padStart(2, '0')}-${d === 1 ? '01' : '16'}`;
  }
  return out;
}
const periodLabel = (p) => `${+p.slice(5, 7)}월 ${p.endsWith('01') ? '1~15일' : '16일~말'}`;
const shortLabel = (p) => `${+p.slice(5, 7)}/${p.endsWith('01') ? '1~15' : '16~'}`;

function change(now, before) {
  const diff = now - before;
  if (!before && !now) return '<span class="chg same">0</span>';
  if (diff === 0) return '<span class="chg same">변화 없음</span>';
  // 기준 건수가 적으면 %가 과장돼 보여서(1→7건 = +600%) 10건 이상일 때만 %를 붙인다.
  const pct = before >= 10 ? ` (${diff > 0 ? '+' : ''}${Math.round((diff / before) * 100)}%)` : '';
  return `<span class="chg ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${pct}</span>`;
}

// ── 화면 상태. URL 해시에 넣어서 링크로 공유할 수 있게 한다.
const S = { periods: [], types: [], byType: new Map(), actions: [], type: null, period: null, store: null, rows: null, shown: PAGE, email: '',
  tab: 'dash', approver: false, sugStatus: 'pending', sugShown: PAGE };
// 일반 페이지(index.html)는 대시보드만, 관리자 페이지(admin.html)는 관리 기능만 보여준다.
const ADMIN_PAGE = window.ADMIN_PAGE === true;
const TABS = ADMIN_PAGE ? { admins: '관리자' } : { dash: '대시보드' };
const DEFAULT_TAB = Object.keys(TABS)[0];
S.tab = DEFAULT_TAB;
const todayKst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

// 가장 최근 조치를 기준으로, 조치한 보름을 빼고 그 전 3구간과 그 후(진행 중인 보름 제외) 최대 3구간의 평균을 비교한다.
function beforeAfter(m, actedOn) {
  const P = S.periods, cur = P.at(-1), ap = periodOf(new Date(actedOn)), i = P.indexOf(ap);
  if (i < 0) return null;
  const avg = (ps) => ps.length ? ps.reduce((s, p) => s + (m[p] || 0), 0) / ps.length : null;
  const before = P.slice(Math.max(0, i - 3), i), after = P.slice(i + 1).filter((p) => p !== cur).slice(0, 3);
  return { before: avg(before), after: avg(after), nBefore: before.length, nAfter: after.length };
}
function readHash() {
  let hash = location.hash;
  try { if (!/type=|tab=/.test(hash)) hash = sessionStorage.getItem('run24-hash') || hash; sessionStorage.removeItem('run24-hash'); } catch {}
  const h = new URLSearchParams(hash.slice(1));
  S.type = h.get('type'); S.period = h.get('period'); S.store = h.get('store');
  S.tab = TABS[h.get('tab')] ? h.get('tab') : DEFAULT_TAB;
}
function writeHash() {
  const h = new URLSearchParams();
  if (S.tab !== DEFAULT_TAB) h.set('tab', S.tab);
  else if (S.type) h.set('type', S.type);
  if (S.tab === 'dash' && S.period) h.set('period', S.period);
  if (S.tab === 'dash' && S.store) h.set('store', S.store);
  history.replaceState(null, '', h.toString() ? '#' + h : location.pathname);
}

function login() {
  app.innerHTML = `<div class="center"><h1>기기 오작동 문의 유형</h1>
    <p class="muted">회사 구글 계정(@${COMPANY_DOMAIN})으로 로그인해 주세요.</p>
    <button class="btn primary" id="go">구글로 로그인</button></div>`;
  // 공유받은 링크(#type=…)로 들어왔다면 로그인 후 같은 화면으로 돌아오도록 기억해 둔다.
  try { if (/type=|tab=/.test(location.hash)) sessionStorage.setItem('run24-hash', location.hash); } catch {}
  document.getElementById('go').onclick = () => sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { hd: COMPANY_DOMAIN } },
  });
}

function notCompany(email) {
  app.innerHTML = `<div class="center"><h1>접근 권한이 없어요</h1>
    <p class="muted">${esc(email)} 계정은 볼 수 없어요. 회사 계정(@${COMPANY_DOMAIN})으로 로그인해 주세요.</p>
    <button class="btn" id="out">로그아웃</button></div>`;
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); login(); };
}

async function dashboard(email) {
  S.email = email;
  const [{ data: rows, error }, { data: sync }, { data: actions }] = await Promise.all([
    db.from('type_half_month').select('device_type, period_start, cnt'),
    db.from('sync_state').select('last_synced_at, last_error').maybeSingle(),
    db.from('actions').select('id, device_type, acted_on, note, created_by').order('acted_on'),
  ]);
  S.actions = actions || [];
  if (error) { document.getElementById('view').innerHTML = `<div class="warn">데이터를 불러오지 못했어요: ${esc(error.message)}</div>`; return; }

  const first = rows.reduce((a, r) => (r.period_start < a ? r.period_start : a), periodOf(new Date()));
  S.periods = periodsFrom(first);
  // ponytail: 수집 시작 보름은 일부 날짜만 들어 있어 낮게 보인다. 다음 보름의 30% 미만이면 추이에서 뺀다.
  const tot = (p) => rows.reduce((s, r) => s + (r.period_start === p ? r.cnt : 0), 0);
  if (S.periods.length > 2 && tot(S.periods[0]) < tot(S.periods[1]) * 0.3) S.periods = S.periods.slice(1);
  S.byType = new Map();
  for (const r of rows) {
    if (!S.byType.has(r.device_type)) S.byType.set(r.device_type, {});
    S.byType.get(r.device_type)[r.period_start] = r.cnt;
  }
  const P = S.periods, cur = P.at(-1), last = P.at(-2), prev = P.at(-3), recent = P.slice(-6);
  const sum = (m, ps) => ps.reduce((s, p) => s + (m[p] || 0), 0);
  S.types = [...S.byType.entries()]
    .map(([name, m]) => ({ name, m, total: sum(m, recent), last: m[last] || 0, prev: m[prev] || 0 }))
    .sort((a, b) => (a.name === UNKNOWN) - (b.name === UNKNOWN) || b.total - a.total); // 미지정은 맨 아래
  const all = Object.fromEntries(P.map((p) => [p, S.types.reduce((s, t) => s + (t.m[p] || 0), 0)]));
  const grand = sum(all, recent);

  document.getElementById('view').innerHTML = `
    <p class="muted syncline">마지막 갱신 ${sync?.last_synced_at ? kst(sync.last_synced_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'} (매일 새벽 4시)</p>
    ${sync?.last_error ? `<div class="warn">최근 갱신에 실패했어요. 숫자가 최신이 아닐 수 있어요. (${esc(sync.last_error)})</div>` : ''}
    <section class="kpis">
      <div class="card kpi"><div class="k">최근 3개월 오작동 문의</div><div class="v num">${grand.toLocaleString()}건</div></div>
      <div class="card kpi"><div class="k">지난 보름 (${periodLabel(last ?? cur)})</div>
        <div class="v num">${(all[last] || 0).toLocaleString()}건 ${last && prev ? change(all[last] || 0, all[prev] || 0) : ''}</div></div>
      <div class="card kpi"><div class="k">이번 보름 (${periodLabel(cur)}, 진행 중)</div><div class="v num">${(all[cur] || 0).toLocaleString()}건</div></div>
    </section>
    <div class="layout" id="layout">
      <nav class="card side" aria-label="유형 목록">
        <div class="hint muted">최근 3개월 많은 순 · 증감은 지난 보름과 그 전 보름 비교</div>
        ${S.types.map((t) => {
          const max = Math.max(1, ...P.map((p) => t.m[p] || 0)); // 유형마다 자기 최대값 기준
          return `${t.name === UNKNOWN ? '<div class="muted unk-sep">태그에 세부유형이 없고 내용으로도 알 수 없는 문의</div>' : ''}
          <button class="type ${t.name === UNKNOWN ? 'unk' : ''}" data-type="${esc(t.name)}">
            <span class="name">${esc(t.name)}</span>
            <span class="spark" aria-hidden="true">${P.slice(-12).map((p) =>
              `<i class="${p === cur ? 'cur' : ''}" style="height:${((t.m[p] || 0) / max) * 100}%"></i>`).join('')}</span>
            <span class="total num">${t.total}건</span>
            <span class="meta">${grand ? Math.round((t.total / grand) * 100) : 0}% · ${last && prev ? change(t.last, t.prev) : ''}</span>
          </button>`;
        }).join('')}
      </nav>
      <section class="detail" id="detail"></section>
    </div>`;

  for (const b of app.querySelectorAll('.type')) b.onclick = () => pick(b.dataset.type, true);
  pick(S.byType.has(S.type) ? S.type : S.types[0]?.name, false, true);
}

async function pick(type, userClick, keepFilters) {
  if (!type) return;
  if (!keepFilters) { S.period = null; S.store = null; S.q = ''; S.allStores = false; S.actOpen = false; }
  S.type = type; S.rows = null; S.shown = PAGE;
  writeHash();
  for (const b of app.querySelectorAll('.type')) b.setAttribute('aria-current', String(b.dataset.type === type));
  const layout = document.getElementById('layout');
  if (userClick) layout.classList.add('picked');
  renderDetail();
  if (userClick && innerWidth <= 900) scrollTo({ top: layout.offsetTop - 8 });

  // 이 유형의 문의를 모두 가져와서 매장·기간 필터는 화면에서 처리한다 (유형당 수백 건 수준).
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('chat_list')
      .select('chat_id, channel_id, opened_at, store, first_message, estimated, summary')
      .eq('device_type', type).order('opened_at', { ascending: false }).range(from, from + 999);
    if (S.type !== type) return;
    if (error) { S.rows = { error: error.message }; return renderDetail(); }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  for (const r of rows) r.period = periodOf(new Date(r.opened_at));
  S.rows = rows;
  renderDetail();
}

function renderDetail() {
  const el = document.getElementById('detail');
  const t = S.types.find((x) => x.name === S.type);
  if (!t) { el.innerHTML = ''; return; }
  const P = S.periods, cur = P.at(-1);
  const max = Math.max(1, ...P.map((p) => t.m[p] || 0));
  const loaded = Array.isArray(S.rows);

  // 개선 조치: 추이에 표시하고, 가장 최근 조치 기준으로 전후 평균을 비교한다.
  const acts = S.actions.filter((a) => a.device_type === t.name).sort((a, b) => (a.acted_on < b.acted_on ? -1 : a.acted_on > b.acted_on ? 1 : 0));
  const actPeriods = new Set(acts.map((a) => periodOf(new Date(a.acted_on))));
  const latest = acts.at(-1);
  let compare = '';
  if (latest) {
    const ba = beforeAfter(t.m, latest.acted_on);
    const fmt = (v) => (v === null ? '-' : `${Math.round(v * 10) / 10}건`);
    if (!ba) compare = '<p class="muted">조치일이 데이터 기간 밖이라 비교할 수 없어요.</p>';
    else if (!ba.nAfter) compare = `<p class="muted">${esc(latest.acted_on)} 조치 이후 끝난 보름이 아직 없어요. 다음 보름이 끝나면 비교가 보여요.</p>`;
    else {
      const d = ba.before ? Math.round(((ba.after - ba.before) / ba.before) * 100) : null;
      compare = `<p class="compare">최근 조치(${esc(latest.acted_on)}) 전 보름 평균 <b class="num">${fmt(ba.before)}</b> → 이후 <b class="num">${fmt(ba.after)}</b>
        ${d === null ? '' : `<span class="chg ${d < 0 ? 'down' : d > 0 ? 'up' : 'same'}">${d > 0 ? '+' : ''}${d}%</span>`}
        <span class="muted">(전 ${ba.nBefore}구간, 후 ${ba.nAfter}구간 · 조치한 보름은 제외)</span></p>`;
    }
  }
  const actionsHtml = !acts.length && !S.actOpen
    ? `<div class="act-empty"><button class="link strong" id="act-open">+ 개선 조치 기록하기</button>
       <span class="muted">조치한 날을 남기면 추이에 표시되고 조치 전후를 비교해 줘요.</span></div>`
    : `
    ${compare}
    ${acts.length ? `<ul class="acts">${acts.slice().reverse().map((a) => `<li>
      <span class="num">${esc(a.acted_on)}</span> <span>${esc(a.note) || '<span class="muted">(메모 없음)</span>'}</span>
      <span class="muted">${esc(a.created_by.split('@')[0])}</span>
      ${a.created_by === S.email ? `<button class="link" data-del="${a.id}" aria-label="조치 기록 삭제">삭제</button>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">아직 기록이 없어요. 이 유형에 개선 조치를 했다면 날짜를 남겨 주세요. 추이 그래프에 표시돼요.</p>'}
    <form class="act-form" id="act-form">
      <input type="date" name="d" value="${todayKst()}" max="${todayKst()}" required aria-label="조치일">
      <input type="text" name="n" maxlength="200" placeholder="무엇을 했나요? (예: 건조기 필터 전 매장 교체)" aria-label="조치 내용">
      <button class="btn primary" type="submit">기록</button>
    </form>`;

  // 매장별 건수: 선택한 기간이 있으면 그 기간 기준
  let storeChips = '<p class="muted">불러오는 중…</p>';
  if (loaded) {
    const counts = {};
    for (const r of S.rows) if (!S.period || r.period === S.period) counts[r.store] = (counts[r.store] || 0) + 1;
    const NO_STORE = '매장 미지정';
    const top = Object.entries(counts).sort((a, b) => (a[0] === NO_STORE) - (b[0] === NO_STORE) || b[1] - a[1]);
    const shownStores = S.allStores ? top : top.slice(0, 15);
    if (S.store && !shownStores.some(([s]) => s === S.store)) shownStores.push(top.find(([s]) => s === S.store) || [S.store, 0]);
    storeChips = top.length ? `<div class="chips">${shownStores.map(([s, n]) =>
      `<button class="chip ${S.store === s ? 'on' : ''} ${s === NO_STORE ? 'dim' : ''}" data-store="${esc(s)}">${esc(s)}<b class="num">${n}</b></button>`).join('')}
      ${top.length > 15 ? `<button class="link" id="all-stores">${S.allStores ? '접기' : `모두 보기 (${top.length}곳)`}</button>` : ''}</div>` : '<p class="muted">없음</p>';
  }

  let listHtml = '<p class="muted">불러오는 중…</p>';
  if (S.rows?.error) listHtml = `<div class="warn">목록을 불러오지 못했어요: ${esc(S.rows.error)}</div>`;
  else if (loaded) {
    const q = (S.q || '').trim();
    const rows = S.rows.filter((r) => (!S.period || r.period === S.period) && (!S.store || r.store === S.store)
      && (!q || `${r.summary || ''} ${r.first_message || ''} ${r.store}`.includes(q)));
    const est = rows.filter((r) => r.estimated).length;
    listHtml = `
      <div class="filters">
        <input type="search" id="listq" class="search" value="${esc(q)}" placeholder="내용 검색 (예: 탈수, 문 안 열림)" aria-label="문의 내용 검색">
        <span class="muted">${rows.length.toLocaleString()}건${est ? ` · 그중 ${est}건은 메시지로 추정한 유형` : ''}</span>
        ${S.period ? `<span class="filter">${periodLabel(S.period)}<button data-clear="period" aria-label="기간 필터 해제">✕</button></span>` : ''}
        ${S.store ? `<span class="filter">${esc(S.store)}<button data-clear="store" aria-label="매장 필터 해제">✕</button></span>` : ''}
      </div>
      ${rows.length ? `<table class="list"><thead><tr><th>날짜</th><th class="s">매장</th><th>상담 내용</th><th></th></tr></thead><tbody>
      ${rows.slice(0, S.shown).map((r) => `<tr>
        <td class="d num">${kst(r.opened_at, { month: 'numeric', day: 'numeric' })}<br><span class="muted">${kst(r.opened_at, { hour: '2-digit', minute: '2-digit' })}</span></td>
        <td class="s">${esc(r.store)}</td>
        <td class="m"><span class="store">${esc(r.store)}</span>${r.summary
          ? `<span class="sum">${esc(r.summary)}</span>`
          : esc(r.first_message) || '<span class="muted">(메시지 없음)</span>'}${r.estimated ? '<span class="badge" title="태그에 세부유형이 없어 메시지 내용으로 추정했어요">추정</span>' : ''}</td>
        <td class="go"><a href="${CHANNEL_DESK(encodeURIComponent(r.channel_id), encodeURIComponent(r.chat_id))}" target="_blank" rel="noopener">채널톡 ↗</a></td>
      </tr>`).join('')}</tbody></table>
      ${rows.length > S.shown ? `<button class="btn more" id="more">더 보기 (${(rows.length - S.shown).toLocaleString()}건 남음)</button>` : ''}`
      : '<p class="muted">조건에 맞는 문의가 없어요.</p>'}`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="detail-head">
        <button class="btn back" id="back">← 유형 목록</button>
        <h2>${esc(t.name)}</h2>
        <span class="muted">최근 3개월 ${t.total}건 · 지난 보름 ${t.last}건 ${change(t.last, t.prev)}</span>
      </div>
      <p class="muted" style="margin:6px 0 0">막대를 누르면 그 기간 문의만 볼 수 있어요. 연한 막대는 아직 진행 중인 보름이에요.</p>
      <div class="trend">${P.map((p) => `<button class="${p === cur ? 'cur' : ''} ${S.period === p ? 'on' : ''} ${actPeriods.has(p) ? 'act' : ''}" data-period="${p}" title="${periodLabel(p)}: ${t.m[p] || 0}건${actPeriods.has(p) ? ' · 개선 조치' : ''}">
        ${actPeriods.has(p) ? '<span class="flag">조치</span>' : ''}<span class="v num">${t.m[p] || 0}</span><span class="bar" style="height:${((t.m[p] || 0) / max) * 100}%"></span>
        <span class="l">${shortLabel(p)}</span></button>`).join('')}</div>
    </div>
    <div class="card"><h3>개선 조치</h3>${actionsHtml}</div>
    <div class="card"><h3>매장별 ${S.period ? `(${periodLabel(S.period)})` : '(전체 기간)'}</h3>${storeChips}</div>
    <div class="card"><h3>문의 목록</h3>${listHtml}</div>`;

  el.querySelector('#back').onclick = () => { document.getElementById('layout').classList.remove('picked'); scrollTo({ top: 0 }); };
  for (const b of el.querySelectorAll('[data-period]')) b.onclick = () => { S.period = S.period === b.dataset.period ? null : b.dataset.period; S.shown = PAGE; writeHash(); renderDetail(); };
  for (const b of el.querySelectorAll('[data-store]')) b.onclick = () => { S.store = S.store === b.dataset.store ? null : b.dataset.store; S.shown = PAGE; writeHash(); renderDetail(); };
  for (const b of el.querySelectorAll('[data-clear]')) b.onclick = () => { S[b.dataset.clear] = null; S.shown = PAGE; writeHash(); renderDetail(); };
  el.querySelector('#more')?.addEventListener('click', () => { S.shown += PAGE; renderDetail(); });
  el.querySelector('#all-stores')?.addEventListener('click', () => { S.allStores = !S.allStores; renderDetail(); });
  el.querySelector('#act-open')?.addEventListener('click', () => { S.actOpen = true; renderDetail(); el.querySelector('#act-form input[name=n]')?.focus(); });
  const listq = el.querySelector('#listq');
  if (listq) {
    let timer;
    listq.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { S.q = listq.value; S.shown = PAGE; S.qFocus = true; renderDetail(); }, 250); };
    if (S.qFocus) { S.qFocus = false; listq.focus(); listq.setSelectionRange(listq.value.length, listq.value.length); }
  }
  el.querySelector('#act-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true;
    const { error } = await db.from('actions').insert({ device_type: t.name, acted_on: f.d.value, note: f.n.value.trim() });
    if (error) { btn.disabled = false; alert('기록하지 못했어요: ' + error.message); return; }
    await reloadActions();
  });
  for (const b of el.querySelectorAll('[data-del]')) b.onclick = async () => {
    if (!confirm('이 조치 기록을 삭제할까요?')) return;
    const { error } = await db.from('actions').delete().eq('id', Number(b.dataset.del));
    if (error) { alert('삭제하지 못했어요: ' + error.message); return; }
    await reloadActions();
  };
  const trend = el.querySelector('.trend'); trend.scrollLeft = trend.scrollWidth; // 최근 구간이 보이게
}

// ── 공통 머리말 + 탭
async function shell(email) {
  S.email = email;
  readHash();
  const { data: ok } = await db.rpc('is_approver');
  S.approver = ok === true;
  if (ADMIN_PAGE && !S.approver) {
    app.innerHTML = `<div class="center"><h1>관리자만 들어올 수 있어요</h1>
      <p class="muted">${esc(email)} 계정은 관리자로 등록되어 있지 않아요. 관리자에게 등록을 요청해 주세요.</p>
      <a class="btn" href="./">대시보드로 가기</a></div>`;
    return;
  }
  const otherPage = ADMIN_PAGE ? '<a href="./">← 대시보드</a>' : S.approver ? '<a href="admin.html">관리자 페이지 →</a>' : '';
  app.innerHTML = `
    <header>
      <h1>${ADMIN_PAGE ? '관리자' : '기기 오작동 문의 유형'}</h1>
      <span class="muted">${otherPage ? otherPage + ' · ' : ''}${esc(email)} · <a href="#" id="out">로그아웃</a></span>
    </header>
    ${Object.keys(TABS).length > 1 ? `<nav class="tabs" role="tablist">${Object.entries(TABS).map(([k, v]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${v}<span class="cnt" id="cnt-${k}"></span></button>`).join('')}</nav>` : ''}
    <div id="view"></div>`;
  document.getElementById('out').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ''; login(); };
  for (const b of app.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
  showTab(S.tab);
}

function showTab(tab) {
  S.tab = tab;
  for (const b of app.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  writeHash();
  document.getElementById('view').innerHTML = '<p class="center muted">불러오는 중…</p>';
  ({ dash: () => dashboard(S.email), admins })[tab]();
}

// ── 관리자 탭 (관리자 추가·삭제)
async function admins() {
  const view = document.getElementById('view');
  const { data: rows, error } = await db.from('approvers').select('email, added_by, added_at').order('email');
  if (S.tab !== 'admins') return;
  if (error) { view.innerHTML = `<div class="warn">관리자 목록을 불러오지 못했어요: ${esc(error.message)}</div>`; return; }
  view.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">관리자는 관리자 페이지에 들어올 수 있고, 다른 관리자를 등록하거나 뺄 수 있어요.
        회사 계정(@${COMPANY_DOMAIN})만 등록할 수 있고, 등록된 사람은 회사 구글 계정으로 로그인하면 바로 관리자 페이지에 들어올 수 있어요.</p>
      <form class="act-form" id="admin-form">
        <input type="email" name="e" required placeholder="이름@${COMPANY_DOMAIN}" aria-label="추가할 관리자 이메일">
        <button class="btn primary" type="submit">관리자 추가</button>
      </form>
    </div>
    <div class="card"><table class="list"><thead><tr><th>이메일</th><th>추가한 사람</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.email)}${r.email === S.email.toLowerCase() ? ' <span class="muted">(나)</span>' : ''}</td>
        <td class="muted">${r.added_by ? `${esc(r.added_by.split('@')[0])} · ${kst(r.added_at, { month: 'numeric', day: 'numeric' })}` : '처음 설정'}</td>
        <td class="go">${r.email === S.email.toLowerCase() ? '' : `<button class="link" data-rm="${esc(r.email)}">빼기</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
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

async function reloadActions() {
  const { data } = await db.from('actions').select('id, device_type, acted_on, note, created_by').order('acted_on');
  S.actions = data || [];
  renderDetail();
}

async function route(session) {
  if (!session) return login();
  const email = session.user.email || '';
  if (email.toLowerCase().split('@')[1] !== COMPANY_DOMAIN) return notCompany(email);
  shell(email);
}

let shown = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    if (event === 'SIGNED_IN' && shown) return; // 토큰 갱신 등으로 다시 그리지 않는다
    shown = true;
    route(session);
  }
});
