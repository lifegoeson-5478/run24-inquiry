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
// 묶음별 '무슨 문의였나'(여러 개 셀 수 있음)와 '어떻게 처리했나'(먼저 맞는 하나). 마지막 처리 규칙은 나머지 전부.
// ponytail: 단순 키워드 규칙. 2026-11-16 묶음별 요약 60건씩 읽고 만듦. 안 맞는 표현이 보이면 여기에 추가한다.
const DONE = ['안내로 마무리', /./];
const INSIGHTS = {
  기기오작동: { title: '증상과 처리', a: '증상', b: '처리', issues: SYMPTOMS, res: RESOLUTIONS },
  세탁: {
    title: '세탁 문제와 처리', a: '문제', b: '처리',
    issues: [
      ['오염이 안 지워짐', /오염|얼룩|이염|황변|찌든|때\b|때가/],
      ['손상·변형', /손상|찢|늘어|줄어|줄임|변형|변색|올풀|터짐|눌림|탈색/],
      ['세탁물 못 찾음·바뀜', /타인|오매칭|오수령|미수령|분실|누락|미출고|빈 옷걸이/],
      ['접수증·바코드 오류', /접수증|바코드|출력/],
      ['수선 문의', /수선|기장|단추|지퍼/],
      ['가격·수량', /금액|가격|비용|수량|차액/],
    ],
    res: [
      ['재세탁·재케어', /재세탁|재케어|재접수/],
      ['보상·심의·A/S', /보상|심의|A\/S|AS/],
      ['포인트·환불', /포인트|환불/],
      ['찾아서 출고', /출고|매칭|회수/],
      DONE,
    ],
  },
  수거: {
    title: '배송 문의와 처리', a: '문의 내용', b: '처리',
    issues: [
      ['도착 일정 문의', /도착|일정|언제|수령\s?일|당일/],
      ['입고 지연', /지연|늦|물량|공간|랙|적치/],
      ['누락·분실', /누락|분실|미도착|미입고|미수령/],
      ['오배송·타인 세탁물', /오배송|오출고|오입고|타인|오매칭/],
      ['부속품', /부속|허리끈|모자|버클/],
    ],
    res: [
      ['보상', /보상/],
      ['우선 입고·재배송', /우선|재배송|재출고|배송 완료|출고/],
      ['원격 개방', /원격/],
      ['일정 안내로 마무리', /./],
    ],
  },
  결제: {
    title: '결제 문제와 처리', a: '문제', b: '처리',
    issues: [
      ['결제 후 기기 미작동', /미작동|작동\s?안|오작동|오류|미건조|건조 불량/],
      ['현금·동전 인식', /현금|동전|지폐|미인식|오투입/],
      ['중복·과다 결제', /중복|이중|과청구|불일치|전액/],
      ['기기 잘못 선택', /오선택|잘못\s?(눌|선택|결제|투입)|혼동|타\s?기기|다른\s?기기|위치/],
      ['런드리페이·포인트', /론디페이|런드리페이|포인트|캐시|충전/],
      ['품목 오등록', /품목|오등록/],
      ['자판기', /자판기/],
      ['영수증', /영수증/],
    ],
    res: [
      ['환불 불가 안내', /불가/],
      ['포인트로 환불', /포인트(로|\s?(재)?지급|\s?환불)/],
      ['카드·계좌 환불', /승인\s?취소|카드사|계좌|환불\s?(처리|완료|접수)/],
      ['점주에게 전달', /점주|경영주/],
      DONE,
    ],
  },
  매장이용: {
    title: '매장 이용 불편과 처리', a: '불편', b: '처리',
    issues: [
      ['기기 미작동·멈춤', /미작동|작동\s?안|작동하지|중단|멈|오작동|사용 중/],
      ['세탁물 오염·이물질', /오염|이물질|얼룩/],
      ['탈수·건조 미흡', /탈수\s?(미흡|안|불량|부족)|재탈수|덜\s?마|미건조|건조\s?(가\s?)?(안|덜|불량|미흡)|젖|배기/],
      ['이전 사용자 세탁물', /방치|미수거|이전 이용자/],
      ['꺼내거나 넣기 전에 문이 닫힘', /(투입구|문)[이가]?\s?(먼저\s?)?(닫혀|닫혔|닫힘|닫혀버)|못\s?(꺼내|넣|집)[^.]{0,20}닫|회수\s?(를\s?)?못|나오기\s?전에/],
      ['기기 문이 안 열림', /(세탁기|건조기|기기|투입구|^)\s?문이?\s?(안\s?열|열리지|안열)|문이\s?안\s?열/],
      ['쿠폰·이벤트', /쿠폰|이벤트/],
      ['접수증 누락', /접수증/],
      ['매장 시설', /출입문|봉투|화장실|조명|청소|카트/],
    ],
    res: [
      ['원격 조치', /원격|초기화|제어|재작동|드럼세척/],
      ['환불·포인트', /환불|포인트|차액/],
      ['점주·담당 부서 전달', /점주|담당 부서|전달/],
      DONE,
    ],
  },
  주차등록: {
    title: '주차 문의와 처리', a: '문의 내용', b: '처리',
    issues: [
      ['무료 주차 등록 요청', /등록\s?(을\s?)?(완료|처리|요청)|시간\s?등록|\d시간|주차\s?(등록|부탁|요청)|등록\s?(부탁|해\s?주)|차량\s?번호|\d{2,3}[가-힣]\s?\d{4}/],
      ['등록 실패·오류', /실패|오류|누락|접속|초기화|입차 내역/],
      ['주차 가능 여부', /가능|유상|지원 문의|공간/],
      ['주차비 환불', /환불|자비/],
    ],
    res: [
      ['주차비 환불', /환불/],
      ['상담원이 대신 등록', /등록\s?(을\s?)?(완료|처리)|등록했|지원함/],
      ['등록 방법 안내', /QR|방법|직접 등록|사전 등록|주차권/],
      DONE,
    ],
  },
  기타: {
    title: '문의 내용과 처리', a: '문의 내용', b: '처리',
    issues: [
      ['알림톡 오발송·미발송', /알림/],
      ['회원정보·번호 변경', /전화번호|번호 변경|회원 번호|아이디|정보 (조회|변경)/],
      ['탈퇴·개인정보 삭제', /탈퇴|개인정보/],
      ['인증번호', /인증/],
      ['외부 기관·업체 연락', /관리사무소|경제총조사|지자체|조사|창업/],
    ],
    res: [
      ['탈퇴·재가입 안내', /탈퇴|재가입/],
      ['전산 처리·발송 중단', /전산|중단|차단|수정|조치/],
      ['담당 부서 전달', /부서|이관|전달/],
      DONE,
    ],
  },
  매장관리: {
    title: '문의 내용과 처리', a: '문의 내용', b: '처리',
    issues: [
      ['시설·환경', /간판|청소|시설|조명|냉난방|에어컨|누수/],
      ['민원·항의', /민원|항의|소음/],
    ],
    res: [['점주에게 전달', /점주|전달/], DONE],
  },
  OB유형: {
    title: '연락한 이유와 결과', a: '연락한 이유', b: '결과',
    issues: [
      ['기기 오류 환불 안내', /환불|과청구|오결제|이중결제/],
      ['세탁 사고 안내', /손상|사고|A\/S/],
      ['세탁물 미수령·타인 수령', /미수령|타인/],
      ['고객 의사 확인', /동의|합의|의사/],
    ],
    res: [
      ['부재로 다시 연락 예정', /부재|재시도|재통화|재인입/],
      ['보상·A/S 진행', /보상|A\/S/],
      ['환불 처리', /환불\s?(처리|완료|접수)|포인트/],
      DONE,
    ],
  },
};
INSIGHTS.셀프장비 = INSIGHTS.기기오작동; // 셀프장비 태그는 기기 문의라 오작동 기준을 쓴다
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
  view: 'home', key: '', animateNext: false, revealFrom: null, range: '90', period: '', store: '', type: '', q: '', shown: PAGE, actOpen: false, allStores: false,
};
const RANGES = { 7: '최근 7일', 30: '최근 1개월', 90: '최근 3개월', 180: '최근 6개월', 365: '최근 1년', tm: '이번 달', lm: '지난 달', all: '전체 기간' };
const PRESET_ORDER = ['7', '30', '90', '180', '365', 'tm', 'lm', 'all'];
const KST_MS = 9 * 3600_000;
const kymd = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10); // 한국 날짜 'YYYY-MM-DD'
const kstMidnight = (d) => Date.parse(`${d}T00:00:00+09:00`);
const validRange = (r) => !!RANGES[r] || /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(r || '');
// 기간 → [시작, 끝) 시각(ms)
function rangeSpan(r = S.range) {
  const now = Date.now(), today = kymd(now), tomorrow = kstMidnight(today) + 86_400_000;
  if (r === 'all') return [0, tomorrow];
  if (r === 'tm') return [kstMidnight(today.slice(0, 8) + '01'), tomorrow];
  if (r === 'lm') { const first = kstMidnight(today.slice(0, 8) + '01'); return [kstMidnight(kymd(first - 1).slice(0, 8) + '01'), first]; }
  if (r.includes('~')) { const [a, b] = r.split('~'); return [kstMidnight(a), kstMidnight(b) + 86_400_000]; }
  return [tomorrow - Number(r) * 86_400_000, tomorrow]; // 최근 N일 = 오늘 포함 N일
}
const dotDate = (d) => d.replaceAll('-', '.');
function rangeLabel(r = S.range) {
  if (RANGES[r]) return RANGES[r];
  const [a, b] = r.split('~'); return a === b ? dotDate(a) : `${dotDate(a)} – ${dotDate(b)}`;
}
// 추이 단위: 짧으면 주, 3개월 안팎이면 보름, 길면 월
const PRESET_UNIT = { 7: 'day', 30: 'week', tm: 'week', lm: 'week', 90: 'half', 180: 'month', 365: 'month', all: 'month' };
function unitOf(r = S.range) {
  if (PRESET_UNIT[r]) return PRESET_UNIT[r];
  const [f, t] = rangeSpan(r), days = Math.round((t - f) / 86_400_000); // 직접 설정: 고른 날짜 수
  return days <= 1 ? 'hour' : days <= 7 ? 'day' : days <= 60 ? 'week' : days <= 180 ? 'half' : 'month';
}
const VIEWS = ['group', 'type', 'store', 'all'];

function readHash() {
  let hash = location.hash;
  try { if (!/v=/.test(hash)) hash = sessionStorage.getItem('run24-hash') || hash; sessionStorage.removeItem('run24-hash'); } catch {}
  const h = new URLSearchParams(hash.slice(1));
  S.view = VIEWS.includes(h.get('v')) ? h.get('v') : 'home';
  S.key = h.get('k') || '';
  S.range = validRange(h.get('r')) ? h.get('r') : '90';
  S.period = h.get('p') || ''; S.store = h.get('s') || ''; S.type = h.get('t') || ''; S.q = h.get('q') || '';
}
addEventListener('popstate', () => { if (!S.email) return; readHash(); S.shown = PAGE; S.animateNext = true; render(); });
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

// ── 로딩 스켈레톤: 실제 화면과 같은 자리에 회색 블록을 먼저 보여준다
const sk = (w = '100%', h = 12, extra = '') => `<span class="sk ${extra}" style="width:${w};height:${h}px"></span>`;
const skLines = (k, widths = ['92%', '78%', '85%', '64%', '72%', '58%']) => Array.from({ length: k }, (_, i) => sk(widths[i % widths.length], 10)).join('');
function skeletonView() {
  return `<div class="skeleton" aria-busy="true" aria-label="불러오는 중">
    <div class="page-head"><div>${sk('150px', 34)}<p class="page-sub loading">불러오는 중…</p></div><div class="page-tools">${sk('120px', 32)}</div></div>
    <section class="kpis">${Array.from({ length: 4 }, () => `<div class="kpi">${sk('55%', 11)}${sk('38%', 30)}${sk('48%', 10)}</div>`).join('')}</section>
    <div class="cards">
      <section class="card span-2"><div class="card-head"><div>${sk('120px', 15)}${sk('200px', 10)}</div></div>
        <div class="donut-wrap"><span class="sk sk-ring"></span><div>${skLines(6)}</div></div></section>
      <section class="card"><div class="card-head"><div>${sk('90px', 15)}</div></div>
        <div class="sk-cols">${[45, 55, 50, 60, 52, 70, 90].map((h) => sk('100%', h * 1.8)).join('')}</div></section>
      <section class="card span-3"><div class="card-head"><div>${sk('110px', 15)}${sk('240px', 10)}</div></div>
        <div class="sk-cols wide">${[60, 72, 68, 80, 75, 85, 78, 88, 82, 90, 70, 40].map((h) => sk('100%', h * 2)).join('')}</div></section>
    </div></div>`;
}
function skeletonFrame() {
  return `<div class="frame"><aside class="side">${sk('120px', 16, 'dark')}<div class="sk-nav">${Array.from({ length: 9 }, (_, i) => sk(`${[70, 60, 80, 66, 74, 58, 62, 76, 54][i]}%`, 12, 'dark')).join('')}</div></aside>
    <main class="main"><div class="view">${skeletonView()}</div></main></div>`;
}

// ── 화면 틀: 왼쪽 사이드바 + 오른쪽 본문
async function shell(email) {
  S.email = email;
  readHash();
  const approverP = db.rpc('is_approver');
  const dataP = ADMIN_PAGE ? null : loadData(); // 관리자 확인을 기다리지 않고 바로 시작
  dataP?.catch(() => {});
  const { data: ok } = await approverP;
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
      <main class="main"><div id="view" class="view">${skeletonView()}</div></main>
    </div>`;
  document.getElementById('out').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ''; login(); };
  if (ADMIN_PAGE) { renderNav(); return admins(); }
  S.animateNext = true;
  try { await dataP; } catch (e) { document.getElementById('view').innerHTML = `<p class="warn">데이터를 불러오지 못했어요. 새로고침해 주세요. (${esc(e.message || e)})</p>`; return; }
  render();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const item = (label, attrs, on, extra = '') => `<button class="nav-item ${on ? 'on' : ''}" ${attrs}>${label}${extra}</button>`;
  const here = (v, k = '') => !ADMIN_PAGE && S.view === v && (!k || S.key === k);
  nav.innerHTML = ADMIN_PAGE
    ? `<a class="nav-item" href="./">대시보드</a><span class="nav-item on">관리자</span>`
    : `${item('대시보드', 'data-nav="home"', here('home') || here('all'))}
       <p class="nav-head">유형 묶음</p>
       ${S.groupOrder.map((g) => item(`<i class="dot" style="background:${groupColor(g)}"></i>${esc(groupLabel(g))}`, `data-group="${esc(g)}"`,
         here('group', g) || (S.view === 'type' && groupOf(S.key) === g))).join('')}
       ${S.approver ? '<p class="nav-head">설정</p><a class="nav-item" href="admin.html">관리자</a>' : ''}`;
  for (const b of nav.querySelectorAll('[data-nav]')) b.onclick = () => go(b.dataset.nav);
  for (const b of nav.querySelectorAll('[data-group]')) b.onclick = () => go('group', b.dataset.group);
}

// 여러 요청을 limit개씩 동시에 돌린다
async function pool(tasks, limit = 6) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}
function loadFail(error) {
  (document.getElementById('view') || app).innerHTML = `<p class="warn">데이터를 불러오지 못했어요. 새로고침해 주세요. (${esc(error.message)})</p>`;
  throw error;
}

// ── 데이터: 집계에 필요한 가벼운 열(날짜·매장·태그)만 먼저 동시에 받고, 요약 문장은 화면에 보일 때 받는다.
async function loadData() {
  const { count, error: cErr } = await db.from('chat_list').select('chat_id', { count: 'exact', head: true });
  if (cErr) loadFail(cErr);
  let got = 0;
  const pages = await pool(Array.from({ length: Math.ceil((count || 0) / 1000) }, (_, k) => async () => {
    const { data, error } = await db.from('chat_list').select('chat_id, channel_id, opened_at, store, estimated, device_type')
      .order('opened_at', { ascending: false }).order('chat_id').order('device_type').range(k * 1000, k * 1000 + 999);
    if (error) loadFail(error);
    got += data.length;
    const el = document.querySelector('.loading'); if (el) el.textContent = `불러오는 중… ${n(got)} / ${n(count)}건`;
    return data;
  }));
  const rows = pages.flat();
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
        types: [], groups: [], estimated: false, period: periodOfParts(p), month: `${p.y}-${p.m}`, day: dayOfParts(p), hour: hourOfParts(p), week: mondayOf(p), wd: p.wd, h: p.h };
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

// ── 요약 문장: 화면에 보이는 상담만 받아 둔다. 오작동 증상 분석용 요약은 첫 화면 뒤에 한 번에 받는다.
const TEXT = new Map(); // chat_id → { summary, first_message }
const hideNumbers = (t) => t.replace(/\d{3,}(?:-\d{2,}| \d{3,})*/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '***' : m)); // 카드·계좌번호 (띄어쓰기·하이픈이 섞여도)
const textOf = (c) => { const t = TEXT.get(c.id); return t ? hideNumbers(t.summary || t.first_message || '') : ''; };
async function ensureText(chats) {
  const need = [...new Set(chats.filter((c) => !TEXT.has(c.id)).map((c) => c.id))];
  if (!need.length) return false;
  await pool(Array.from({ length: Math.ceil(need.length / 150) }, (_, k) => async () => {
    const ids = need.slice(k * 150, k * 150 + 150);
    const { data } = await db.from('chats').select('id, summary, first_message').in('id', ids);
    for (const r of data || []) TEXT.set(r.id, r);
    for (const id of ids) if (!TEXT.has(id)) TEXT.set(id, { summary: null, first_message: '' });
  }));
  return true;
}
const textState = {}; // 묶음 → loading | done
async function loadGroupText(g) {
  if (textState[g]) return;
  textState[g] = 'loading';
  const like = `${g}%`; // 태그 이름 앞부분이 묶음 이름이다 (세탁_수선문의/… → 세탁)
  const { count } = await db.from('chat_list').select('chat_id', { count: 'exact', head: true }).like('device_type', like);
  await pool(Array.from({ length: Math.ceil((count || 0) / 1000) }, (_, k) => async () => {
    const { data } = await db.from('chat_list').select('chat_id, summary, first_message').like('device_type', like)
      .order('chat_id').range(k * 1000, k * 1000 + 999);
    for (const r of data || []) TEXT.set(r.chat_id, { summary: r.summary, first_message: r.first_message });
  }));
  textState[g] = 'done';
  afterEntrance(render);
}
// 검색은 서버에서: 검색어가 들어간 상담 ID를 받아 둔다
const SEARCH = { q: '', ids: null };
async function searchIds(q) {
  const safe = q.replace(/[,()*%\\]/g, ' ').trim();
  if (!safe) return new Set();
  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('chats').select('id').or(`summary.ilike.*${safe}*,first_message.ilike.*${safe}*`).range(from, from + 999);
    for (const r of data || []) out.add(r.id);
    if (!data || data.length < 1000) break;
  }
  return out;
}

function countBy(list, keyFn) {
  const m = {};
  for (const x of list) for (const k of [].concat(keyFn(x))) m[k] = (m[k] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
const inRange = (c) => { const [f, t] = rangeSpan(); return c.ms >= f && c.ms < t; };
const sortGroups = (entries) => entries.sort((a, b) => (a[0] === 'OB유형') - (b[0] === 'OB유형') || b[1] - a[1]);
function halves() { const P = S.periods; return { cur: P.at(-1), last: P.at(-2), prev: P.at(-3) }; }

// 증감 배지: 상담은 줄어드는 게 좋아서 늘면 빨강, 줄면 초록
// 두 보름 비교 설명 창
function tipBox(lastP, prevP, a, b, note = '') {
  const d = a - b;
  return `<span class="tip" role="tooltip"><span class="tip-title">끝난 두 보름 비교</span>
    <span class="tip-row"><span>${periodLabel(lastP)}</span><strong>${n(a)}건</strong></span>
    <span class="tip-row"><span>${periodLabel(prevP)}</span><strong>${n(b)}건</strong></span>
    <span class="tip-row tip-diff"><span>차이</span><strong>${d > 0 ? '+' : d < 0 ? '−' : ''}${n(Math.abs(d))}건</strong></span>
    <span class="tip-note">${note || '진행 중인 이번 보름은 빼고 비교해요'}</span></span>`;
}
function delta(now, before, { words = false, tip = '' } = {}) {
  const t = tip ? ' tabindex="0"' : '', box = tip || '';
  const d = now - before;
  if (!before && !now) return '';
  if (d === 0) return `<span class="delta flat"${t}>${words ? '그 전과 같아요' : '0'}${box}</span>`;
  const pct = before ? Math.round((Math.abs(d) / before) * 100) : null;
  const txt = words ? `${n(Math.abs(d))}건 ${d > 0 ? '늘었어요' : '줄었어요'}` : `${d > 0 ? '+' : '−'}${n(Math.abs(d))}${pct !== null && before >= 10 ? ` (${pct}%)` : ''}`;
  return `<span class="delta ${d > 0 ? 'up' : 'down'}"${t}>${d > 0 ? '↗' : '↘'} ${txt}${box}</span>`;
}

// ── 모션: 화면이 처음 뜨거나 바뀔 때 차트가 차례로 그려지고 KPI 숫자가 올라간다. 기기의 '동작 줄이기'를 켜면 끈다.
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function playEntrance(root) {
  if (!root) return;
  const stagger = (sel, step, groupSel) => root.querySelectorAll(groupSel || 'body').forEach((g) =>
    (groupSel ? g : root).querySelectorAll(sel).forEach((el, i) => el.style.setProperty('--i', i * step)));
  stagger('.vbar', 1, '.vbars');
  stagger('.st-col', 1, '.stack-trend');
  stagger('.hbars > li, .stores > li', 1, '.card');
  stagger('.legend > li', 1, '.donut-wrap');
  root.querySelectorAll('.heat-grid').forEach((g) => [...g.children].forEach((el, i) => el.style.setProperty('--i', i % 13)));
  root.querySelectorAll('.donut circle').forEach((c, i) => c.style.setProperty('--i', i));
  root.classList.add('enter');
  clearTimeout(playEntrance.t);
  playEntrance.t = setTimeout(() => root.classList.remove('enter'), 1600);
  // KPI 숫자 올라가기
  root.querySelectorAll('.kpi b').forEach((b) => {
    const node = [...b.childNodes].find((x) => x.nodeType === 3 && /\d/.test(x.textContent));
    if (!node) return;
    const target = Number(node.textContent.replace(/[^\d]/g, ''));
    if (!target) return;
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(target * e).toLocaleString('ko-KR');
      if (k < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function afterEntrance(fn) {
  const v = document.getElementById('view');
  if (v?.classList.contains('enter')) setTimeout(() => afterEntrance(fn), 200); else fn();
}

// 화면을 옮길 때는 기록을 하나 남긴다 (뒤로 가기로 이전 화면에 돌아오도록). 필터 변경은 기록을 덮어쓴다.
function go(view, key = '') {
  if (S.view !== view || S.key !== key) history.pushState(null, '', location.href);
  Object.assign(S, { view, key, period: '', store: '', type: '', q: '', shown: PAGE, actOpen: false, allStores: false, animateNext: true });
  render(); scrollTo({ top: 0 });
}
function render() {
  writeHash();
  renderNav();
  const viewEl = document.getElementById('view');
  const play = S.animateNext && !REDUCED_MOTION; S.animateNext = false;
  viewEl?.classList.remove('enter'); // 다시 그릴 때(요약 도착 등)는 모션을 처음부터 반복하지 않는다
  if (S.view === 'home') renderHome(); else renderDetail();
  if (play) playEntrance(viewEl);
  S.revealFrom = null;
  const visible = [...document.querySelectorAll('.chat[data-id]')].map((li) => ({ id: li.dataset.id }));
  ensureText(visible).then((loaded) => {
    if (!loaded) return;
    for (const li of document.querySelectorAll('.chat[data-id]')) {
      const el = li.querySelector('.chat-text'), c = { id: li.dataset.id };
      if (el && el.querySelector('.sk-text') && TEXT.has(c.id)) { el.innerHTML = esc(textOf(c)) || '<span class="muted">(고객이 남긴 내용 없음)</span>'; el.classList.add('reveal'); }
    }
  });
  if (S.q && SEARCH.q !== S.q.trim()) searchIds(S.q.trim()).then((ids) => { SEARCH.ids = ids; SEARCH.q = S.q.trim(); render(); });
}

// ── 차트와 조각 (흑백)
const CAL_ICON = '<svg class="cal-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const rangeSelect = () => `<div class="menu-wrap" id="range-wrap">
  <button type="button" id="range-btn" class="range-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="기간: ${esc(rangeLabel())}">${CAL_ICON}${esc(rangeLabel())}<span aria-hidden="true">⌄</span></button>
  <div class="picker rp" id="range-menu" role="dialog" aria-label="기간 고르기" hidden></div></div>`;

const WD_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const addMonth = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const longDate = (d) => (d ? `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8)}일` : '');

// 기간 선택 창: 왼쪽 프리셋, 오른쪽 두 달 달력. 시작일 → 끝 날짜를 차례로 누르면 바로 적용
function bindRangeMenu(root) {
  const wrap = root.querySelector('#range-wrap'); if (!wrap) return;
  const btn = wrap.querySelector('#range-btn'), menu = wrap.querySelector('#range-menu');
  const today = kymd(Date.now());
  let a = '', b = '', pick = '', view = '';
  const monthGrid = (ym) => {
    const [y, m] = ym.split('-').map(Number), lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const k = `${ym}-${String(d).padStart(2, '0')}`;
      const cls = [k === a && 'start', k === b && 'end', a && k > a && k < b && 'mid', k === today && 'today'].filter(Boolean).join(' ');
      cells += `<button type="button" class="rp-day ${cls}" data-day="${k}" ${k > today ? 'disabled' : ''}>${d}</button>`;
    }
    return `<div class="rp-month"><p class="rp-mtitle">${y}년 ${m}월</p><div class="rp-grid">${WD_SHORT.map((w) => `<span class="rp-wd">${w}</span>`).join('')}${cells}</div></div>`;
  };
  const draw = () => {
    const on = RANGES[S.range] ? S.range : 'custom';
    const preset = (k, label, attr) => `<button type="button" class="rp-preset ${on === k ? 'on' : ''}" ${attr}>${label}<span aria-hidden="true">${on === k ? '✓' : ''}</span></button>`;
    menu.innerHTML = `<div class="rp-presets">${PRESET_ORDER.map((k) => preset(k, RANGES[k], `data-range="${k}"`)).join('')}${preset('custom', '직접 설정', 'data-custom')}</div>
      <div class="rp-cal">
        <div class="rp-fields"><span class="rp-field ${pick ? '' : 'act'}">${longDate(a) || '시작 날짜'}</span><span class="rp-sep">–</span><span class="rp-field ${pick ? 'act' : ''}">${pick ? '끝 날짜' : longDate(b) || '끝 날짜'}</span></div>
        <div class="rp-months">
          <button type="button" class="rp-arrow prev" data-move="-1" aria-label="이전 달">‹</button>
          <button type="button" class="rp-arrow next" data-move="1" aria-label="다음 달" ${view >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
          ${monthGrid(addMonth(view, -1))}${monthGrid(view)}</div>
        <p class="rp-hint">${pick ? '끝 날짜를 누르면 바로 적용돼요' : '시작 날짜와 끝 날짜를 차례로 눌러 직접 정할 수 있어요'}</p>
      </div>`;
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }; // 창 안 어디에 포커스가 있어도 ESC로 닫기
  const open = () => {
    const [f, t] = rangeSpan();
    a = kymd(S.range === 'all' ? (S.chats.length ? S.chats.at(-1).ms : Date.now()) : f);
    b = kymd(Math.min(t - 1, Date.now())); pick = ''; view = b.slice(0, 7);
    draw(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); wrap.classList.add('is-open');
    menu.querySelector('.rp-preset.on')?.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    document.addEventListener('keydown', esc);
  };
  const close = (back = true) => {
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); wrap.classList.remove('is-open');
    document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc);
    if (back) btn.focus({ preventScroll: true });
  };
  const apply = (r, e) => {
    close(false); if (unitOf(r) !== unitOf()) S.period = '';
    S.range = r; S.shown = PAGE; S.animateNext = false; render();
    if (!e.detail) document.getElementById('range-btn')?.focus({ preventScroll: true });
  };
  btn.onclick = (e) => (menu.hidden ? open() : close(!e.detail));
  btn.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } };
  menu.onclick = (e) => {
    const p = e.target.closest('[data-range]'); if (p) return apply(p.dataset.range, e);
    if (e.target.closest('[data-custom]')) { a = b = pick = ''; draw(); menu.querySelector('[data-custom]').focus({ preventScroll: true }); return; }
    const mv = e.target.closest('[data-move]'); if (mv) { view = addMonth(view, +mv.dataset.move); draw(); menu.querySelector(`[data-move="${mv.dataset.move}"]`)?.focus({ preventScroll: true }); return; }
    const d = e.target.closest('[data-day]'); if (!d) return;
    const k = d.dataset.day;
    if (!pick) { pick = a = b = k; draw(); menu.querySelector(`[data-day="${k}"]`)?.focus({ preventScroll: true }); return; }
    const [x, y] = pick <= k ? [pick, k] : [k, pick]; pick = '';
    apply(`${x}~${y}`, e);
  };
  // 끝 날짜를 고르는 동안 마우스를 올린 날짜까지 미리 칠한다
  menu.onpointerover = (e) => {
    const d = pick && e.target.closest('[data-day]'); if (!d) return;
    const k = d.dataset.day, [x, y] = pick <= k ? [pick, k] : [k, pick];
    for (const el of menu.querySelectorAll('[data-day]')) {
      const v = el.dataset.day;
      el.classList.toggle('start', v === x); el.classList.toggle('end', v === y); el.classList.toggle('mid', v > x && v < y);
    }
  };
}
const card = (title, sub, body, { cls = '', tools = '' } = {}) => `<section class="card ${cls}">
  <div class="card-head"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${tools}</div>${body}</section>`;

function hbars(entries, { onKey, color, label = (k) => k, dim, title, tip, top = Math.max(1, ...entries.map(([, v]) => v)) } = {}) {
  return `<ul class="hbars">${entries.map(([k, v]) => `<li>
    ${onKey ? `<button class="hbar" data-${onKey}="${esc(k)}" ${title ? `title="${esc(title(k))}"` : ''}>` : tip ? '<div class="hbar has-tip" tabindex="0">' : '<div class="hbar">'}
      <span class="hbar-label ${dim && dim(k) ? 'dim' : ''}">${esc(label(k))}</span>
      <span class="hbar-track"><span style="width:${Math.min(100, (v / top) * 100)}%;background:${color ? color(k) : 'var(--ink)'}"></span></span>
      <span class="hbar-val">${n(v)}</span>${!onKey && tip ? tip(k, v) : ''}
    ${onKey ? '</button>' : '</div>'}</li>`).join('')}</ul>`;
}

// 값이 비슷하게 모여 있으면 막대 바닥을 0 대신 범위 아래쪽에서 시작해 차이가 보이게 한다.
// exclude: 기준 계산에서 뺄 칸(진행 중인 보름 등). 튀게 작은 값(중앙값의 40% 미만)도 기준에서 뺀다.
function barScale(values, exclude = []) {
  const max = Math.max(1, ...values);
  const zero = { h: (v) => (v / max) * 100, floor: 0 };
  const base = values.filter((v, i) => v > 0 && !exclude.includes(i)).sort((a, b) => a - b);
  if (base.length < 3) return zero;
  const med = base[Math.floor(base.length / 2)];
  const lo = base.find((v) => v >= med * 0.4);
  if ((max - lo) / max > 0.6) return zero; // 이미 차이가 크면 0부터 그린다
  const floor = Math.max(0, Math.floor((lo - (max - lo) * 0.5) / 10) * 10); // 가장 낮은 막대가 대략 1/3 높이
  return { h: (v) => (v <= floor ? 4 : 8 + (92 * (v - floor)) / (max - floor)), floor };
}

// 요일별 막대: 가장 많은 요일만 진하게
// 요일별 하루 평균: 기간 안에서 요일마다 건수를 그 요일이 몇 번 있었는지로 나눈다.
// 수집 시작 전 날과 아직 진행 중인 오늘은 날짜 수에서 뺀다 (기간이 오늘 하루뿐이면 오늘을 센다).
function weekdayDays() {
  const [f, t] = rangeSpan(), today = kstMidnight(kymd(Date.now()));
  const first = S.chats.length ? kstMidnight(kymd(S.chats[S.chats.length - 1].ms)) : today;
  const from = kstMidnight(kymd(Math.max(f, first)));
  let to = Math.min(t, today);
  if (to <= from) to = from + DAY_MS;
  const days = Array(7).fill(0);
  for (let d = from; d < to; d += DAY_MS) days[kparts(new Date(d + 12 * 3600_000)).wd]++;
  return days;
}
function weekdayBars(chats) {
  const m = Array(7).fill(0);
  for (const c of chats) m[c.wd]++;
  const days = weekdayDays(), avg = m.map((v, i) => (days[i] ? v / days[i] : 0));
  const dec = Math.max(...avg) < 20 ? 1 : 0; // 작은 숫자일 때만 소수점 한 자리, 모든 막대가 같은 형식
  const fmt = (v) => (dec ? v.toFixed(1) : n(Math.round(v)));
  const best = avg.indexOf(Math.max(...avg)), sc = barScale(avg);
  return `<div class="vbars">${avg.map((v, i) => `<div class="vbar ${i === best ? 'top' : ''}" title="${WD_LABEL[i]}요일 하루 평균 ${fmt(v)}건 (${n(m[i])}건 ÷ ${days[i]}일)">
    <span class="vbar-v">${fmt(v)}</span><span class="vbar-b" style="height:${sc.h(v)}%"></span><span class="vbar-l">${WD_LABEL[i]}</span></div>`).join('')}</div>`;
}

// 상위 N개만 남기고 나머지는 '그 외'로 합친다
const OTHER = '__other';
const topN = (entries, k) => entries.length <= k + 1 ? entries : [...entries.slice(0, k), [OTHER, entries.slice(k).reduce((s, [, v]) => s + v, 0)]];
const withOther = (fn, other) => (k) => (k === OTHER ? other : fn(k));

// 도넛: 조각 사이에 틈을 둔 흑백 도넛
function donut(all, { color, label, onKey, count } = {}) {
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
      <text x="70" y="77" text-anchor="middle" class="donut-n">${n(count ?? total)}<tspan class="donut-l" dx="2">건</tspan></text></svg>
    <ul class="legend">${entries.map(([k, v]) => `<li>${onKey && k !== OTHER ? `<button data-${onKey}="${esc(k)}">` : '<span>'}
      <i style="background:${color(k)}"></i><span class="lg-l">${esc(label(k))}</span><span class="lg-v">${n(v)}</span><span class="lg-p">${Math.round((v / total) * 100)}%</span>
      ${onKey && k !== OTHER ? '</button>' : '</span>'}</li>`).join('')}</ul></div>`;
}

// ── 추이 단위: 기간 설정에 따라 주·보름·월로 나눈다
const DAY_MS = 86_400_000;
const UNIT_LABEL = { hour: '시간', day: '일', week: '주', half: '보름', month: '월' };
const dayOfParts = (p) => `${p.y}-${p.m}-${String(p.d).padStart(2, '0')}`;
const hourOfParts = (p) => `${dayOfParts(p)} ${String(p.h % 24).padStart(2, '0')}`;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
function mondayOf(p) { return ymd(Date.UTC(+p.y, +p.m - 1, p.d - p.wd)); } // 한국 날짜 기준 그 주의 월요일
const bucketOf = (c, u) => (u === 'hour' ? c.hour : u === 'day' ? c.day : u === 'week' ? c.week : u === 'half' ? c.period : c.month);
const bucketOfDate = (date, u) => { const p = kparts(date); return u === 'hour' ? hourOfParts(p) : u === 'day' ? dayOfParts(p) : u === 'week' ? mondayOf(p) : u === 'half' ? periodOfParts(p) : `${p.y}-${p.m}`; };
function monthsBetween(a, b) {
  const out = []; let [y, m] = a.split('-').map(Number);
  for (let k = a; k <= b; ) { out.push(k); m++; if (m > 12) { m = 1; y++; } k = `${y}-${String(m).padStart(2, '0')}`; }
  return out;
}
function buckets() {
  const u = unitOf(), [f, t] = rangeSpan(), now = new Date();
  const end = new Date(Math.min(t - 1, now.getTime())), start = new Date(Math.max(f, 0));
  const live = bucketOfDate(end, u) === bucketOfDate(now, u); // 마지막 칸이 아직 진행 중인지
  const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
  if (u === 'hour') {
    const keys = [];
    for (let ms = Math.max(f, 0); ms < Math.min(t, now.getTime() + 1); ms += 3_600_000) keys.push(bucketOfDate(new Date(ms), 'hour'));
    return { u, keys, live, label: (k) => `${+k.slice(11)}시`, long: (k) => `${+k.slice(5, 7)}월 ${+k.slice(8, 10)}일 ${+k.slice(11)}시` };
  }
  if (u === 'day') {
    const keys = [];
    for (let k = bucketOfDate(start, 'day'), last = bucketOfDate(end, 'day'); k <= last; k = ymd(Date.parse(k) + DAY_MS)) keys.push(k);
    return { u, keys, live, label: md, long: (k) => `${+k.slice(5, 7)}월 ${+k.slice(8)}일` };
  }
  if (u === 'week') {
    const keys = [];
    for (let k = bucketOfDate(start, 'week'), last = bucketOfDate(end, 'week'); k <= last; k = ymd(Date.parse(k) + 7 * DAY_MS)) keys.push(k);
    return { u, keys, live, label: (k) => `${+k.slice(5, 7)}/${+k.slice(8)}~`, long: (k) => `${+k.slice(5, 7)}월 ${+k.slice(8)}일부터 한 주` };
  }
  if (u === 'half') {
    const a = periodOf(start), b = periodOf(end);
    return { u, keys: S.periods.filter((x) => x >= a && x <= b), live, label: shortLabel, long: periodLabel };
  }
  const cur = bucketOfDate(end, 'month');
  // 수집을 시작한 날(가장 오래된 상담). 그 달 중간부터 모였으면 그 달은 일부만 있어 낮게 보이므로 뺀다.
  const firstMs = S.chats.length ? S.chats[S.chats.length - 1].ms : now.getTime();
  const fp = kparts(new Date(firstMs)), firstMonth = `${fp.y}-${fp.m}`;
  let from = S.range === 'all' ? firstMonth : bucketOfDate(start, 'month');
  if (from < firstMonth) from = firstMonth;
  if (from === firstMonth && fp.d > 3 && from < cur) from = monthsBetween(from, cur)[1];
  const keys = monthsBetween(from, cur);
  return { u, keys, live, label: (k) => (k === keys[0] || k.endsWith('-01') ? `${k.slice(2, 4)}년 ${+k.slice(5)}월` : `${+k.slice(5)}월`), long: (k) => `${k.slice(0, 4)}년 ${+k.slice(5)}월` };
}

// 기간별 누적 막대: 유형 묶음(또는 세부 유형)별 흑백 단계
function stackedTrend(chats, { keyFn = (c) => c.groups, color = groupColor, label = groupLabel, actPeriods = new Set(), keys } = {}) {
  const B = buckets(), P = B.keys, cur = B.live ? P.at(-1) : null;
  chats = chats.filter((c) => P.includes(bucketOf(c, B.u)) && (!S.range.includes("~") || inRange(c))); // 직접 정한 기간은 그 날짜 안의 상담만
  const all = keys || Object.keys(countBy(chats, keyFn));
  const order = all.length > 6 ? [...all.slice(0, 5), OTHER] : all;
  const top = new Set(order);
  const kf = (c) => [].concat(keyFn(c)).map((k) => (top.has(k) ? k : OTHER));
  color = withOther(color, '#E8E8E8'); label = withOther(label, '그 외');
  const per = Object.fromEntries(P.map((p) => [p, countBy(chats.filter((c) => bucketOf(c, B.u) === p), kf)]));
  const tot = (p) => chats.filter((c) => bucketOf(c, B.u) === p).length;
  const sums = P.map((p) => Object.values(per[p]).reduce((s, v) => s + v, 0));
  const sc = barScale(sums, B.live ? [P.length - 1] : []); // 진행 중인 칸은 기준에서 뺀다
  return `<div class="stack-trend ${P.length > 14 ? 'dense' : ''}">${P.map((p) => {
    const sum = Object.values(per[p]).reduce((s, v) => s + v, 0);
    return `<button class="st-col ${p === cur ? 'cur' : ''} ${S.period === p ? 'on' : ''}" data-period="${p}" title="${B.long(p)}${p === cur ? ' (진행 중)' : ''}: ${tot(p)}건">
      <span class="st-v">${n(tot(p))}</span>
      <span class="st-bar" style="height:${sc.h(sum)}%">${order.filter((k) => per[p][k]).map((k) =>
        `<i style="flex:${per[p][k]};background:${color(k)}" title="${esc(label(k))} ${per[p][k]}건"></i>`).join('')}</span>
      <span class="st-l">${B.label(p)}${actPeriods.has(p) ? '<b class="st-flag" aria-label="개선 조치">●</b>' : ''}</span></button>`;
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
function chatRow(c, reveal = false) {
  return `<li class="chat${reveal ? ' reveal' : ''}" data-id="${esc(c.id)}">
    <div class="chat-meta"><span>${kst(c.opened_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <button class="linkish" data-store="${esc(c.store)}">${esc(c.store)}</button>
      <a class="open" href="${CHANNEL_DESK(encodeURIComponent(c.channel_id), encodeURIComponent(c.id))}" target="_blank" rel="noopener">채널톡</a></div>
    <p class="chat-text">${TEXT.has(c.id) ? esc(textOf(c)) || '<span class="muted">(고객이 남긴 내용 없음)</span>' : `<span class="sk-text">${sk('88%', 11)}${sk('56%', 11)}</span>`}</p>
    <div class="chat-foot">${c.types.map(tagChip).join('')}${c.estimated ? '<span class="est" title="상담원 태그에 세부유형이 없어 내용으로 추정했어요">추정</span>' : ''}</div></li>`;
}

// 묶음 하나의 상담 요약에서 '무슨 문의였나'와 '어떻게 처리했나'를 센다
function insightCard(chats, g, title, { resOnly = false } = {}) {
  const R = INSIGHTS[g]; if (!R) return '';
  const mine = chats.filter((c) => c.groups.includes(g));
  if (!mine.length) return '';
  title = title || R.title;
  if (textState[g] !== 'done') { loadGroupText(g); return card(title, '상담 요약을 불러오는 중이에요', `<div class="stacked" aria-busy="true"><div>${sk('40px', 12)}${skLines(5)}</div><div>${sk('40px', 12)}${skLines(4)}</div></div>`); }
  const issues = tally(R.issues, mine).slice(0, 8), res = tallyFirst(R.res, mine).sort((a, b) => b[1] - a[1]);
  const issueRe = Object.fromEntries(R.issues);
  const examples = (pick) => (k, v) => {
    const ex = mine.filter((c) => pick(c, k)).slice(0, 2).map((c) => textOf(c).split(' / ')[0]);
    return `<span class="tip ins-tip" role="tooltip"><span class="tip-title">${esc(k)}</span>${ex.map((t) => `<span class="tip-ex">${esc(t)}</span>`).join('')}</span>`;
  };
  // 어느 기준에도 안 맞는 상담: 이 막대가 커지면 새로운 불편이 생겼다는 신호 (그때 INSIGHTS에 항목을 추가한다)
  const OTHER = '그 외 (분류 안 됨)';
  const isOther = (c) => textOf(c) && !R.issues.some(([, re]) => re.test(textOf(c)));
  const otherN = mine.filter(isOther).length;
  if (otherN) issues.push([OTHER, otherN]);
  const issueTip = examples((c, k) => (k === OTHER ? isOther(c) : issueRe[k].test(textOf(c))));
  if (resOnly) title = '처리 방식';
  return card(title, `${esc(groupLabel(g).replace(/ 상담$/, ""))} 상담 ${n(mine.length)}건의 요약에서 찾았어요`, `
    <div class="stacked">
      ${resOnly ? '' : `<div><h3>${R.a}</h3>${issues.length ? hbars(issues, { top: Math.max(1, ...issues.filter(([k]) => k !== OTHER).map(([, v]) => v)), tip: issueTip, dim: (k) => k === OTHER, color: (k) => (k === OTHER ? "var(--soft)" : "var(--ink)") }) : '<p class="muted">찾은 내용이 없어요.</p>'}</div>`}
      <div><h3>${R.b}</h3>${res.length ? hbars(res, { color: () => 'var(--mid)' }) : ''}</div>
    </div>`);
}

// ── 개선 과제: 묶음 안을 '대상'(기기·영역)으로 나누고, 대상마다 많이 나온 문제를 센다.
// 대상은 상담원이 붙인 세부 유형 태그로 정하고, 세부 유형이 없으면 내용에서 추정한다(guess).
// 문제는 요약 문장 키워드 또는 세부 유형 태그로 센다. ponytail: 2026-11-16 실제 요약을 읽고 만든 규칙. 안 맞으면 여기에 추가.
const hasTag = (c, ...names) => c.types.some((t) => names.some((nm) => t === nm || t.endsWith('/' + nm))); // 'A/B' 형식이면 뒤쪽, 아니면 태그 전체
const byTag = (names, re) => (c) => hasTag(c, ...names) || re.test(textOf(c));
const ITEMS = [['패딩', /패딩|다운/], ['셔츠', /셔츠/], ['니트', /니트|스웨터|가디건/], ['코트', /코트/], ['정장·자켓', /정장|자켓|재킷|블레이저/],
  ['바지', /바지|슬랙스|청바지/], ['운동화·신발', /운동화|신발/], ['이불·침구', /이불|침구|베개/], ['티셔츠', /티셔츠|맨투맨|후드/], ['원피스·치마', /원피스|치마|스커트/]];
const NOT_WORK = /결제.{0,10}(미작동|작동\s?안|작동하지|오류|미인식)|미작동|시작\s?(버튼)?\s?(미작동|안\s?됨|안\s?돼)|작동\s?(불가|안\s?함|하지\s?않)/;
const SUBJECTS = {
  기기오작동: [
    { name: '드라이스테이션', tags: ['드라이스테이션오류', '접수증미출력'], guess: /드라이|투입구|접수증|반출|수거함/, problems: [
      ['세탁물이 안 나옴', /안\s?나|나오지|미배출|미수령|미회수|미출고|못\s?찾|떨어/],
      ['문·투입구가 먼저 닫힘', /(문|투입구)[이가]?\s?(먼저\s?)?(닫혀|닫혔|닫힘|안\s?닫|닫히지)|못\s?(꺼내|넣)/],
      ['문·투입구가 안 열림', /(문|투입구|보관함)[이가]?\s?(안\s?열|열리지)/],
      ['접수증 미출력·접수 오류', /접수증|접수\s?(중\s?)?오류|출력/],
      ['보관함 비밀번호', /비밀번호/],
      ['결제 오류', /결제\s?(오류|실패|안\s?됨|안\s?돼|불가|창)|이중\s?결제|중복\s?결제|카드\s?(인식|오류|단말)/],
      ['화면 오류·멈춤', /화면|키오스크\s?(오류|멈|먹통|꺼)|초기화|멈춤|멈췄|멈춰/],
    ] },
    { name: '세탁기', tags: ['세탁기오류', '세탁기오류_세제,섬유유연제', '콤보오류'], guess: /세탁기|탈수|세제|유연제/, problems: [
      ['결제 후 작동 안 함', NOT_WORK],
      ['탈수 안 됨', /탈수/],
      ['도중에 멈춤', /멈|중단|정지|안\s?끝/],
      ['코스·시간 잘못 설정', /코스|시간\s?(설정|잘못|다르|오류|미종료)/],
      ['물 넘침·누수·배수', /물\s?넘|누수|배수|급수|물이/],
      ['세제·유연제', byTag(['세탁기오류_세제,섬유유연제'], /세제|유연제|거품/)],
      ['동전·카드 인식', /동전|코인\s?투입\s?오류|미인식|카드\s?인식/],
      ['세탁물 오염·이물질', /오염|이물질|얼룩/],
    ] },
    { name: '건조기', tags: ['건조기오류'], guess: /건조/, problems: [
      ['결제 후 작동 안 함', NOT_WORK],
      ['덜 마름·건조 불량', /덜|미건조|건조\s?(가\s?)?(안|불량|거의|되지)|젖|배기/],
      ['도중에 멈춤·에러', /멈|에러|중단/],
      ['시간 부족', /시간\s?(부족|추가|경과)|추가\s?시간/],
      ['사용 중 표시·번호 오류', /사용\s?중|번호|이중\s?결제/],
      ['동전·카드 인식', /동전|미인식|카드\s?인식/],
      ['냄새·소음·녹', /냄새|소음|녹|타는/],
    ] },
    { name: '키오스크·결제기', tags: ['키오스크오류', '카드리더기오류', '영수증미출력', '동전교환기오류'], guess: /키오스크|카드\s?리더|단말기|동전\s?교환|영수증/, problems: [
      ['화면 멈춤·터치 안 됨', /화면|터치|먹통|멈|꺼/],
      ['카드 인식 안 됨', byTag(['카드리더기오류'], /카드|단말기|리더기/)],
      ['동전 교환·현금', byTag(['동전교환기오류'], /동전|교환|지폐|현금/)],
      ['결제·충전 오류', /결제|충전|이중|중복/],
      ['영수증 미출력', byTag(['영수증미출력'], /영수증|출력/)],
    ] },
    { name: '자판기', tags: ['자판기오류'], guess: /자판기/, problems: [
      ['상품이 안 나옴', /미배출|안\s?나|나오지|배출/],
      ['돈·카드를 먹음', /먹|투입.{0,4}(안|오류)|미인식|결제/],
      ['재고 없음', /재고|품절/],
    ] },
    { name: '이불함', tags: ['이불함'], guess: /이불함/, problems: [
      ['문이 안 열림', /(문|함)[이가]?\s?(안\s?열|열리지)/],
      ['세탁물 미수령', /미수령|안\s?나|못\s?찾/],
      ['결제 오류', /결제/],
    ] },
    { name: '앱', tags: ['기기오작동문의_앱'], guess: /앱|어플/, problems: [
      ['로그인·인증', /로그인|인증/], ['결제·충전', /결제|충전/], ['화면·기능 오류', /오류|안\s?됨|안\s?돼/],
    ] },
  ],
  세탁: [
    { name: '세탁 품질', items: true, tags: ['오염미제거', '오염발생', '변형_변색_손상', '다림질미흡', '건조_냄새', '보풀_이물질_먼지', '세탁_수선문의_재케어', '세탁_수선문의_재세탁'], guess: /오염|얼룩|손상|변색|재세탁|재케어|냄새|다림/, problems: [
      ['오염이 안 지워짐', byTag(['오염미제거'], /미제거|안\s?지워|제거되지|지워지지/)],
      ['손상·변형·변색', byTag(['변형_변색_손상'], /손상|찢|늘어|줄어|변형|변색|탈색|올풀|터짐/)],
      ['세탁 중 오염이 생김', byTag(['오염발생'], /이염|오염\s?발생|묻어/)],
      ['다림질 미흡', byTag(['다림질미흡'], /다림|구김|주름/)],
      ['냄새', byTag(['건조_냄새'], /냄새|악취/)],
      ['보풀·이물질·먼지', byTag(['보풀_이물질_먼지'], /보풀|이물질|먼지/)],
    ] },
    { name: '수선', tags: ['수선', '수선이슈', '수선요청서누락'], guess: /수선|기장|단추|지퍼/, problems: [
      ['기장·치수가 다름', /기장|길게|짧게|치수|사이즈/],
      ['일정·지연 문의', /언제|일정|지연|소요|당일/],
      ['비용 문의', /비용|금액|가격|얼마/],
      ['동의·반려', /동의|반려|요청서/],
      ['수선 가능 여부', /가능|불가/],
    ] },
    { name: '세탁물 찾기·분실', tags: ['세탁물확인', '분실', '타인세탁물발견_의류회수요청', '소지품', '세탁물수량'], guess: /분실|타인|못\s?찾|미수령|누락/, problems: [
      ['타인 세탁물·오매칭', /타인|오매칭|오수령|바뀌/],
      ['일부 누락·미출고', /누락|미출고|미수령|일부|1벌|한\s?벌|안\s?왔/],
      ['부속품 누락', /부속|모자|벨트|허리끈|버클/],
      ['접수증·바코드 오류', /접수증|바코드|출력|밀림/],
      ['분실', byTag(['분실'], /분실|잃어/)],
      ['소지품', byTag(['소지품'], /소지품|주머니/)],
    ] },
    { name: '접수·가격 문의', tags: ['세탁금액', '세탁가능품목', '세탁반려', '세탁불가', '세탁_수선문의'], guess: /가격|금액|반려/, problems: [
      ['가격·금액', /가격|금액|비용|얼마|차액/],
      ['세탁 가능 품목', /가능|품목|소재|라벨/],
      ['세탁 반려·불가', /반려|불가/],
      ['소요 기간', /언제|기간|소요|일정/],
    ] },
    { name: '사고·보상', tags: ['세탁사고안내', '심의'], guess: /사고|보상|심의/, problems: [
      ['보상 절차', /보상/], ['심의 진행', /심의/], ['브랜드 A/S', /A\/S|AS/],
    ] },
  ],
};
const DOOR_CLOSE = /(투입구|문)[이가]?\s?(먼저\s?)?(닫혀|닫혔|닫힘|닫혀버)|못\s?(꺼내|넣|집)[^.]{0,20}닫|회수\s?(를\s?)?못|나오기\s?전에/;
// 수거·배송: 일정 문의 / 입고 지연과 그 원인
const SHIP_ASK = /도착|언제|일정|수령\s?일|당일|며칠/;
const SHIP_LATE = /지연|늦|미출고|밀려/;
// 지연 원인: 위에서부터 먼저 맞는 하나만 (겹치지 않게)
const SHIP_CAUSES = [
  ['물량·연휴', /물량|연휴|명절|증가|많아|겨울옷|성수기|주말/],
  ['격일 배송 주기', /격일|배송\s?주기|방문\s?일정|수거\s?일정/],
  ['세탁 공정·재작업', /바코드|검수|분류|공정|재다림|재케어|재세탁|오염\s?케어|프레스|건조\s?지연|작업\s?(누락|지연)|태그|확인\s?(이\s?)?지연/],
  ['접수 누락·오배출', /접수증|미동봉|오배출|오매칭|누락/],
  ['매장 기기·공간', /기기|기계|키오스크|오류|공간|랙|적치|보관함|이불함|배송\s?차량|기사/],
];
const lateCause = (c) => { const t = textOf(c); return SHIP_LATE.test(t) ? (SHIP_CAUSES.find(([, re]) => re.test(t))?.[0] || '원인 미기재') : null; };
Object.assign(SUBJECTS, {
  매장이용: [
    { name: '셀프 세탁 기기', tags: ['코인장비'], guess: /세탁기|건조기|코인|탈수|코스/, problems: [
      ['사용 방법·코스 문의', /방법|어떻게|사용법|코스\s?(선택|문의)|이용\s?방법/],
      ['기기 미작동·멈춤', /미작동|작동\s?안|작동하지|오작동|멈|중단|사용\s?중/],
      ['탈수·건조 미흡', /탈수|재탈수|덜\s?마|미건조|건조\s?(가\s?)?(안|덜|불량|미흡)|젖|배기/],
      ['이전 사용자 세탁물', /방치|미수거|이전\s?(이용자|사용자|고객)/],
      ['세탁물 오염·이물질', /오염|이물질|얼룩/],
      ['세제·유연제', /세제|유연제|거품/],
      ['동전·카드·결제 오류', /동전|현금|지폐|카드\s?(인식|안|오류)|결제\s?(오류|안\s?됨|안\s?돼|실패|취소|불가)|이중\s?결제|중복\s?결제|미인식/],
    ] },
    { name: '드라이스테이션 이용', tags: ['드라이스테이션', '접수증미동봉', '봉투'], guess: /드라이|투입구|접수증|봉투/, problems: [
      ['꺼내거나 넣기 전에 문이 닫힘', DOOR_CLOSE],
      ['접수증 미동봉·누락', byTag(['접수증미동봉'], /접수증/)],
      ['봉투가 없음', byTag(['봉투'], /봉투/)],
      ['맡기는 방법·세탁 방식', /방법|어떻게|맡기|세탁\s?방식|케어라벨/],
      ['수령·보관', /수령|보관|찾/],
    ] },
    { name: '이벤트·쿠폰', tags: ['이벤트', '이벤트,쿠폰', '이벤트_리뷰이벤트', '블로그체험단'], guess: /쿠폰|이벤트|리뷰/, problems: [
      ['쿠폰 코드·사용 방법', /코드|어디|사용\s?방법|입력|찾/],
      ['쿠폰 미적용', /미적용|적용\s?(이\s?)?안|적용되지|사용\s?(을\s?)?못/],
      ['첫 이용 무료·신규', /첫|신규|무료/],
      ['리뷰·체험단', byTag(['이벤트_리뷰이벤트', '블로그체험단'], /리뷰|체험단|블로그/)],
    ] },
    { name: '매장 시설·환경', tags: ['매장불편사항접수', '에어컨', '난방', '기타문의'], guess: /에어컨|난방|청소|출입문|조명/, problems: [
      ['냉난방', byTag(['에어컨', '난방'], /에어컨|난방|덥|춥|더워|추워/)],
      ['청소·위생', /청소|쓰레기|더럽|위생|냄새|벌레/],
      ['출입·잠금', /출입|문이?\s?잠|입구|열쇠/],
      ['조명·전기', /조명|전등|불이|전기|정전/],
      ['소음·다른 손님', /소음|시끄|다른\s?(손님|고객)|흡연|담배/],
    ] },
    { name: '분실물', tags: ['분실물'], guess: /분실|두고|놓고/, problems: [
      ['두고 간 물건 찾기', /두고|놓고|분실|잃어|찾/],
      ['기기 안에 남은 물건', /세탁기|건조기|기기\s?안|안에/],
    ] },
    { name: '자판기', tags: ['자판기', '자판기_재고'], guess: /자판기/, problems: [
      ['재고 없음', byTag(['자판기_재고'], /재고|품절|없/)],
      ['상품이 안 나옴', /미배출|안\s?나|나오지/],
      ['결제·돈 먹음', /결제|먹|투입/],
    ] },
  ],
  수거: [
    { name: '입고 일정', max: 8, tags: ['매장입고일정', '공장입고일정문의', '수령가능일자문의'], guess: /도착|일정|언제|입고/, problems: [
      // 지연이 있었던 상담은 '입고 지연 · 원인'으로만 세고, 일정 문의는 지연 없이 일정만 안내한 상담만 센다 (겹치지 않게)
      ['일정 문의 (지연 없음)', (c) => SHIP_ASK.test(textOf(c)) && !SHIP_LATE.test(textOf(c))],
      ...[...SHIP_CAUSES.map(([l]) => l), '원인 미기재'].map((l) => [`입고 지연 · ${l}`, (c) => lateCause(c) === l]),
      ['일부만 입고', /일부|분할|1벌|한\s?벌|누락/],
    ] },
    { name: '입고 지연·미수거', tags: ['입고지연', '미수거'], guess: /지연|미수거/, problems: [
      ['입고 지연', /지연|늦|물량/],
      ['수거가 안 됨', byTag(['미수거'], /미수거|수거\s?(가\s?)?안|안\s?가져/)],
      ['오래 지연됨', /한\s?달|오래|주\s?째|\d+일\s?째/],
    ] },
    { name: '오배송·타인 세탁물', tags: ['타인세탁물발견', '오입고'], guess: /타인|오배송|오입고|오출고/, problems: [
      ['타인 세탁물을 받음', /타인|남의|다른\s?사람/],
      ['다른 매장·칸으로 감', byTag(['오입고'], /타\s?매장|다른\s?매장|오배송|오출고|오입고/)],
    ] },
    { name: '수령 확인', tags: ['수령확인'], guess: /수령|보관함/, problems: [
      ['수령 여부 확인', /수령|받았|찾았/],
      ['보관함·비밀번호', /보관함|비밀번호/],
      ['알림', /알림/],
    ] },
  ],
  결제: [
    { name: '셀프 기기 결제', tags: ['셀프장비', '결제_결제문의_셀프장비'], guess: /세탁기|건조기|기기/, problems: [
      ['결제 후 기기 미작동', /미작동|작동\s?안|작동하지|오작동|오류|미건조|건조\s?불량/],
      ['현금·동전 인식', /현금|동전|지폐|오투입|미인식/],
      ['기기 잘못 선택', /오선택|잘못\s?(눌|선택|결제|투입)|혼동|타\s?기기|다른\s?기기|위치/],
      ['중복·과다 결제', /중복|이중|과청구|불일치|전액/],
      ['환불 방법·카드사', /계좌|카드사|승인\s?취소/],
    ] },
    { name: '런드리페이·포인트', tags: ['론디페이', '결제문의_포인트'], guess: /론디페이|런드리페이|포인트|캐시/, problems: [
      ['잔액 환불', /환불|잔액/],
      ['보너스 포인트 공제', /보너스|공제/],
      ['충전', /충전|캐시/],
      ['폐점·지점 이전', /폐점|지점|이전/],
    ] },
    { name: '품목·금액 오류', tags: ['품목오등록', '품목_재세탁오과금', '세탁금액', '오과금', '결제_환불문의_수선오과금'], guess: /품목|오과금|금액/, problems: [
      ['품목이 잘못 등록됨', byTag(['품목오등록'], /품목|오등록/)],
      ['재세탁인데 과금됨', byTag(['품목_재세탁오과금'], /재세탁|재케어/)],
      ['금액 문의', byTag(['세탁금액'], /금액|가격|얼마/)],
      ['차액 환불', /차액/],
    ] },
    { name: '드라이스테이션 결제', tags: ['결제_결제문의_드라이스테이션', '드라이스테이션_결제실패'], guess: /드라이/, problems: [
      ['결제 실패', byTag(['드라이스테이션_결제실패'], /실패|오류|안\s?됨/)],
      ['이중 결제', /이중|중복/],
      ['결제 취소', /취소/],
    ] },
    { name: '결제 취소·오류', tags: ['결제취소', '결제오류'], guess: /취소|오류/, problems: [
      ['결제 취소 요청', /취소/], ['결제 오류', /오류|실패/], ['자판기 결제', /자판기/],
    ] },
    { name: '영수증', tags: ['영수증'], guess: /영수증/, problems: [
      ['영수증 발급 요청', /발급|발행|요청|보내/], ['영수증이 안 나옴', /미출력|안\s?나|출력/],
    ] },
  ],
  주차등록: [
    { name: '주차 등록', tags: ['주차등록'], guess: /주차/, problems: [
      ['무료 주차 등록 요청', /등록\s?(을\s?)?(완료|처리|요청)|시간\s?등록|\d시간|주차\s?(등록|부탁|요청)|등록\s?(부탁|해\s?주)|차량\s?번호|\d{2,3}[가-힣]\s?\d{4}/],
      ['등록 실패·오류', /실패|오류|누락|접속|초기화|입차\s?내역/],
      ['주차 가능 여부·요금', /가능|유상|요금|주차권|공간/],
      ['주차비 환불', /환불|자비/],
      ['상담 운영 시간', /운영\s?시간|휴무|시간\s?외|야간/],
    ] },
  ],
  기타: [
    { name: '알림톡', tags: ['알림톡'], guess: /알림/, problems: [
      ['수령했는데 계속 옴', /수령|계속|지속|후에도/],
      ['잘못 옴(오발송)', /오발송|맡긴\s?(게|것이|세탁물이)?\s?없|잘못/],
      ['안 옴(미발송)', /미발송|안\s?와|못\s?받|미수신/],
    ] },
    { name: '회원정보', tags: ['회원가입및정보변경'], guess: /회원|탈퇴|전화번호/, problems: [
      ['전화번호·회원번호 변경', /전화번호|번호\s?변경|회원\s?번호|아이디/],
      ['탈퇴·개인정보 삭제', /탈퇴|개인정보/],
      ['인증번호', /인증/],
    ] },
    { name: '창업', tags: ['창업'], guess: /창업|가맹/, problems: [
      ['창업·가맹 문의', /창업|가맹|오픈|출점/], ['비용', /비용|금액|투자/],
    ] },
    { name: '서비스 개선·불편', tags: ['서비스개선사항_불편사항접수'], guess: /개선|불편|건의/, problems: [
      ['앱 기능', /앱|어플|기능/], ['매장 운영', /매장|점주/], ['안내·응대', /응대|안내|상담/],
    ] },
    { name: '기타 문의', tags: ['기타_서비스문의'], guess: /./, problems: [
      ['외부 기관 연락', /관리사무소|조사|지자체|공단|구청/],
      ['영업·제휴 제안', /제휴|광고|영업|입점|제안/],
      ['매장 이용 정보', /화장실|비밀번호|와이파이|영업\s?시간/],
    ] },
  ],
  OB유형: [
    { name: '결제 오류 환불 안내', tags: ['결제오류안내'], guess: /환불|과청구|오결제/, problems: [
      ['환불 처리 완료', /환불\s?(처리|완료|접수)/], ['계좌·정보 요청', /계좌|정보|문자/], ['부재로 다시 연락', /부재|재시도|재통화|재인입/],
    ] },
    { name: '세탁 사고 안내', tags: ['세탁사고안내', '세탁중추가손상우려_동의'], guess: /손상|사고/, problems: [
      ['브랜드 A/S·수선', /A\/S|AS|수선/], ['보상 안내', /보상/], ['손상 우려 동의', byTag(['세탁중추가손상우려_동의'], /동의|우려/)], ['부재로 다시 연락', /부재|재시도/],
    ] },
    { name: '세탁물 미수령·타인 수령', tags: ['세탁물미수령_타인세탁물수령_후속안내'], guess: /미수령|타인/, problems: [
      ['타인 세탁물 수령', /타인/], ['미수령', /미수령|못\s?받/],
    ] },
    { name: '고객 의사 확인·반려', tags: ['고객확인_고객의사확인', '반려안내', '마케팅문의안내'], guess: /확인|반려/, problems: [
      ['의사 확인·합의', /동의|합의|확인/], ['반려 안내', byTag(['반려안내'], /반려/)],
    ] },
  ],
});
SUBJECTS.셀프장비 = SUBJECTS.기기오작동;
const subjectOf = (list, c) => list.find((x) => hasTag(c, ...x.tags)) || list.find((x) => x.guess.test(textOf(c)));
const passes = (t, c) => (t instanceof RegExp ? t.test(textOf(c)) : t(c));

// 개선 과제 보드: 맨 위에 가장 많은 '대상 · 문제' 3개, 아래에 대상별 문제 막대
function taskBoard(chats, g) {
  const list = SUBJECTS[g]; if (!list) return '';
  const mine = chats.filter((c) => c.groups.includes(g));
  if (!mine.length) return '';
  const skBlock = `<div>${sk('40%', 14)}${skLines(4)}</div>`;
  if (textState[g] !== 'done') { loadGroupText(g); return card('개선 과제', '상담 요약을 불러오는 중이에요', `<div class="task-grid" aria-busy="true">${skBlock.repeat(3)}</div>`, { cls: 'span-3' }); }
  const groups = new Map(list.map((x) => [x, []]));
  let unknown = 0;
  for (const c of mine) { const x = subjectOf(list, c); if (x) groups.get(x).push(c); else unknown++; }
  const OTHER = '그 외';
  const blocks = [...groups].filter(([, cs]) => cs.length).sort((a, b) => b[1].length - a[1].length).map(([x, cs]) => {
    const probs = x.problems.map(([label, t]) => [label, cs.filter((c) => passes(t, c)).length]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, x.max || 5);
    const isOther = (c) => textOf(c) && !x.problems.some(([, t]) => passes(t, c));
    const otherN = cs.filter(isOther).length;
    const tip = (k) => {
      const t = k === OTHER ? null : x.problems.find(([l]) => l === k)[1];
      const ex = cs.filter((c) => (t ? passes(t, c) : isOther(c))).slice(0, 2).map((c) => textOf(c).split(' / ')[0]);
      return `<span class="tip ins-tip" role="tooltip"><span class="tip-title">${esc(x.name)} · ${esc(k)}</span>${ex.map((e) => `<span class="tip-ex">${esc(e)}</span>`).join('')}</span>`;
    };
    const items = x.items ? ITEMS.map(([l, re]) => [l, cs.filter((c) => re.test(textOf(c))).length]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
    return { x, cs, probs, otherN, tip, items };
  });
  const top = blocks.flatMap((b) => b.probs.map(([l, v]) => ({ who: b.x.name, l, v }))).sort((a, b) => b.v - a.v).slice(0, 3);
  const total = mine.length;
  const bars = (b) => (b.probs.length || b.otherN
    ? hbars(b.otherN ? [...b.probs, [OTHER, b.otherN]] : b.probs, { top: Math.max(1, ...b.probs.map(([, v]) => v)), tip: b.tip, dim: (k) => k === OTHER, color: (k) => (k === OTHER ? 'var(--soft)' : 'var(--ink)') })
    : '<p class="muted">요약이 아직 없어요.</p>');
  return card('개선 과제', `${esc(groupLabel(g))} 상담 ${n(total)}건을 대상별로 나눠, 많이 나온 문제를 모았어요. 막대에 마우스를 올리면 예시가 보여요`, `
    ${top.length ? `<ol class="task-top">${top.map((t) => `<li><span class="task-who">${esc(t.who)}</span><b>${esc(t.l)}</b><span class="task-n">${n(t.v)}건</span></li>`).join('')}</ol>` : ''}
    <div class="task-grid">${blocks.map((b) => `<div class="task-block">
      <div class="task-head"><h3>${esc(b.x.name)}</h3><span>${n(b.cs.length)}건 · ${Math.round((b.cs.length / total) * 100)}%</span></div>
      ${bars(b)}
      ${b.items.length ? `<p class="task-items">많이 나온 품목 ${b.items.map(([l, v]) => `<span>${esc(l)} ${n(v)}</span>`).join('')}</p>` : ''}
    </div>`).join('')}</div>
    ${unknown ? `<p class="task-note">어떤 대상인지 알 수 없는 상담 ${n(unknown)}건은 빠져 있어요.</p>` : ''}`, { cls: 'span-3' });
}

function bindCommon(root) {
  bindRangeMenu(root);
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

// ── 중점 유형: 대시보드에서 따로 지켜볼 유형. 'g:묶음' 또는 't:세부유형'. 브라우저마다 기억한다.
const FOCUS_KEY = 'run24-focus';
const getFocus = () => { try { return localStorage.getItem(FOCUS_KEY) || 'g:기기오작동'; } catch { return 'g:기기오작동'; } };
const setFocus = (v) => { try { localStorage.setItem(FOCUS_KEY, v); } catch {} };
const focusMatch = (f) => (f.startsWith('g:') ? (c) => c.groups.includes(f.slice(2)) : (c) => c.types.includes(f.slice(2)));
const focusLabel = (f) => (f.startsWith('g:') ? groupLabel(f.slice(2)) : tagLabel(f.slice(2)));
function focusPicker(current, ranged) {
  const cnt = (f) => ranged.filter(focusMatch(f)).length;
  const item = (f, label, cls = '') => `<button type="button" class="pk-item ${cls} ${current === f ? 'on' : ''}" role="option" aria-selected="${current === f}" data-focus="${esc(f)}" data-label="${esc(label)}">
      <span class="pk-label">${esc(label)}</span><span class="pk-count">${n(cnt(f))}</span><span class="pk-check" aria-hidden="true">${current === f ? '✓' : ''}</span></button>`;
  return `<div class="picker" id="focus-picker" role="dialog" aria-label="지켜볼 유형 고르기" hidden>
    <input type="search" class="pk-search" placeholder="유형 이름으로 찾기" aria-label="유형 이름으로 찾기">
    <div class="pk-list" role="listbox">${S.groupOrder.map((g) => {
      const subs = Object.keys(countBy(S.chats.filter((c) => c.groups.includes(g)), (c) => c.types.filter((t) => groupOf(t) === g)));
      return `<div class="pk-group"><p class="pk-head"><i class="dot" style="background:${groupColor(g)}"></i>${esc(groupLabel(g))}</p>
        ${item('g:' + g, groupLabel(g) + ' 전체', 'pk-all')}${subs.map((t) => item('t:' + t, tagLabel(t))).join('')}</div>`;
    }).join('')}<p class="pk-empty" hidden>찾는 유형이 없어요</p></div>
  </div>`;
}

function bindFocusPicker(view) {
  const kpi = view.querySelector('#focus-kpi'), btn = view.querySelector('#focus-btn'), pk = view.querySelector('#focus-picker');
  const search = pk.querySelector('.pk-search');
  const items = () => [...pk.querySelectorAll('.pk-item:not([hidden])')];
  const open = () => {
    pk.hidden = false; btn.setAttribute('aria-expanded', 'true'); kpi.classList.add('is-open');
    search.value = ''; filter();
    // 화면 아래 남은 공간에 맞춰 목록 높이를 줄인다 (창이 화면 밖으로 넘치지 않게)
    const list = pk.querySelector('.pk-list');
    list.style.maxHeight = `${Math.max(160, Math.min(380, innerHeight - list.getBoundingClientRect().top - 24))}px`;
    search.focus({ preventScroll: true }); // 커서를 놓을 때 페이지가 스크롤되지 않게
    const on = pk.querySelector('.pk-item.on'); // 선택한 항목은 목록 안에서만 가운데로
    if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.clientHeight / 2; // .pk-list가 기준 위치(position: relative)
    setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  };
  const close = (back = true) => {
    pk.hidden = true; btn.setAttribute('aria-expanded', 'false'); kpi.classList.remove('is-open');
    document.removeEventListener('pointerdown', outside);
    if (back) btn.focus({ preventScroll: true });
  };
  const outside = (e) => { if (!kpi.contains(e.target)) close(false); };
  const filter = () => {
    const q = search.value.trim();
    for (const g of pk.querySelectorAll('.pk-group')) {
      let any = false;
      for (const it of g.querySelectorAll('.pk-item')) { const hit = !q || it.dataset.label.includes(q); it.hidden = !hit; any ||= hit; }
      g.hidden = !any;
    }
    pk.querySelector('.pk-empty').hidden = items().length > 0;
  };
  const choose = (f, kb = true) => { setFocus(f); close(false); S.animateNext = false; render(); if (kb) document.getElementById('focus-btn')?.focus({ preventScroll: true }); };
  kpi.onclick = (e) => { if (pk.contains(e.target)) return; pk.hidden ? open() : close(!e.detail); };
  search.oninput = filter;
  pk.onclick = (e) => { const it = e.target.closest('.pk-item'); if (it) choose(it.dataset.focus, !e.detail); };
  pk.onkeydown = (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const t = list[i + 1] || list[0]; t?.focus({ preventScroll: true }); t?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const t = i <= 0 ? search : list[i - 1]; t.focus({ preventScroll: true }); t.scrollIntoView?.({ block: 'nearest' }); }
    else if (e.key === 'Enter' && document.activeElement === search && list.length) { e.preventDefault(); choose(list[0].dataset.focus); }
  };
}


// 대시보드: 모든 묶음을 통틀어 가장 시급한 개선 과제 (기간 안 건수 순, 지난 보름에 급증하면 표시)
const URGENT_GROUPS = ['기기오작동', '세탁', '매장이용', '수거', '결제', '주차등록', '기타', 'OB유형'];
function urgentTasks(ranged) {
  const groups = URGENT_GROUPS.filter((g) => ranged.some((c) => c.groups.includes(g)));
  const waiting = groups.filter((g) => textState[g] !== 'done');
  const head = ['가장 시급한 개선 과제', `${rangeLabel()} 모든 유형 묶음에서 많이 나온 '대상 · 문제'예요. 누르면 그 묶음을 자세히 볼 수 있어요`];
  if (waiting.length) { waiting.forEach(loadGroupText); return card(...head, `<div aria-busy="true">${skLines(5)}</div>`, { cls: 'span-3' }); }
  const { last, prev } = halves();
  const rows = [];
  for (const g of groups) {
    const list = SUBJECTS[g];
    const inG = (cs) => cs.filter((c) => c.groups.includes(g));
    const mine = inG(ranged), lastCs = inG(S.chats.filter((c) => c.period === last)), prevCs = inG(S.chats.filter((c) => c.period === prev));
    for (const x of list) {
      const own = (cs) => cs.filter((c) => subjectOf(list, c) === x);
      const a = own(mine), l = own(lastCs), p = own(prevCs);
      if (!a.length) continue;
      for (const [label, t] of x.problems) {
        const v = a.filter((c) => passes(t, c)).length;
        if (v) rows.push({ g, who: x.name, label, v, l: l.filter((c) => passes(t, c)).length, p: p.filter((c) => passes(t, c)).length });
      }
    }
  }
  rows.sort((a, b) => b.v - a.v);
  const top = rows.slice(0, 6);
  if (!top.length) return '';
  const max = top[0].v;
  return card(...head, `<ol class="urgent">${top.map((r) => {
    const surge = r.l >= 10 && r.l >= r.p * 1.3; // 지난 보름에 30% 넘게 늘면 급증
    return `<li><button class="urgent-row" data-group="${esc(r.g)}">
      <span class="urgent-who">${esc(groupLabel(r.g))} · ${esc(r.who)}</span>
      <b class="urgent-what">${esc(r.label)}${surge ? '<span class="urgent-flag">급증</span>' : ''}</b>
      <span class="urgent-bar"><span style="width:${(r.v / max) * 100}%"></span></span>
      <span class="urgent-n">${n(r.v)}건</span>
    </button>${delta(r.l, r.p, { tip: tipBox(last, prev, r.l, r.p, `${groupLabel(r.g)} · ${r.who} · ${r.label}`) })}</li>`;
  }).join('')}</ol>`, { cls: 'span-3' });
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
  let focus = getFocus();
  if (!S.chats.some(focusMatch(focus))) focus = 'g:기기오작동';
  const fm = focusMatch(focus);
  const focusN = ranged.filter(fm).length;
  const focusShare = ranged.length ? Math.round((focusN / ranged.length) * 100) : 0;
  const focusLast = byP(last).filter(fm).length, focusPrev = byP(prev).filter(fm).length;

  const cmp = (a, b, note) => tipBox(last, prev, a, b, note);
  const roseType = rose && ((c) => c.types.includes(rose[0]));
  view.innerHTML = `
    ${pageHead('대시보드', `${periodLabel(cur)} 기준 · ${rangeLabel()} ${n(ranged.length)}건`)}
    <section class="kpis">
      <div class="kpi"><p>이번 보름 상담</p><b>${n(curN)}</b><span class="delta flat">진행 중</span><span class="kpi-note">${periodLabel(cur)}</span></div>
      <div class="kpi"><p>지난 보름 상담</p><b>${n(lastN)}</b>${delta(lastN, prevN, { tip: cmp(lastN, prevN) })}<span class="kpi-note">그 전 보름 대비</span></div>
      <div class="kpi"><p>가장 많이 늘어난 유형</p><b class="kpi-text">${rose && rose[1] > 0 ? `<button class="linkish" data-type="${esc(rose[0])}" title="${esc(tagLabel(rose[0]))}">${esc(tagLabel(rose[0]))}</button>` : '-'}</b>
        ${rose && rose[1] > 0 ? delta(rose[1], 0, { words: true, tip: cmp(byP(last).filter(roseType).length, byP(prev).filter(roseType).length, '모든 세부 유형 중 가장 많이 늘었어요') }) : '<span class="delta-slot"></span>'}<span class="kpi-note">${rose ? esc(groupLabel(groupOf(rose[0]))) : ''}</span></div>
      <div class="kpi kpi-focus" id="focus-kpi">
        <p><button type="button" id="focus-btn" class="focus-btn" aria-haspopup="dialog" aria-expanded="false" title="눌러서 지켜볼 유형을 바꿀 수 있어요">${esc(focusLabel(focus))}<span aria-hidden="true">⌄</span></button></p>
        <b>${focusShare}<small>%</small></b>${delta(focusLast, focusPrev, { tip: cmp(focusLast, focusPrev, `위의 ${focusShare}%는 ${rangeLabel()} 전체 상담 중 비중이에요`) })}
        <span class="kpi-note">${rangeLabel()} ${n(focusN)}건 · 전체 상담 중 비중</span>${focusPicker(focus, ranged)}</div>
    </section>

    <div class="cards">
      ${urgentTasks(ranged)}
      ${card('유형 묶음 비중', `${rangeLabel()} · 묶음을 누르면 자세히 볼 수 있어요`, donut(groupTotals, { color: groupColor, label: groupLabel, onKey: 'group', count: ranged.length }), { cls: 'span-2' })}
      ${card('요일별 하루 평균', `${rangeLabel()} · 요일마다 하루에 몇 건 들어오는지예요`, weekdayBars(ranged))}
      ${card(`${UNIT_LABEL[unitOf()]}별 상담`, `${rangeLabel()} · 막대 안의 회색 단계는 유형 묶음이에요. 막대를 누르면 그 기간 상담을 볼 수 있어요`, stackedTrend(all, { keys: S.groupOrder }), { cls: 'span-3' })}
      ${card('매장 TOP 8', '상담이 많은 매장이에요. 막대는 유형 묶음 구성이에요', `<ul class="stores">${storeEntries.map(([s, v]) => {
        const comp = sortGroups(Object.entries(countBy(ranged.filter((c) => c.store === s), (c) => c.groups)));
        return `<li><button class="store-row" data-store="${esc(s)}"><span class="hbar-label">${esc(s)}</span>
          <span class="stack" style="width:${(v / storeEntries[0][1]) * 100}%">${comp.map(([g, k]) => `<i style="flex:${k};background:${groupColor(g)}" title="${esc(groupLabel(g))} ${k}건"></i>`).join('')}</span>
          <span class="hbar-val">${n(v)}</span></button></li>`;
      }).join('')}</ul>`)}
      ${card('시간대별 상담', '요일과 시간대별로 진할수록 많아요', heatmap(ranged))}
      ${insightCard(ranged, MAL_GROUP, '기기 오작동 증상과 처리')}
      ${card('최근 상담', '', `<ul class="chats compact">${all.slice(0, 5).map(chatRow).join('')}</ul><button class="btn ghost" id="more-chats">전체 상담 보기</button>`, { cls: 'span-3' })}
    </div>`;

  bindCommon(view);
  view.querySelector('#more-chats').onclick = () => go('all');
  bindFocusPicker(view);

  for (const b of view.querySelectorAll('[data-period]')) b.onclick = () => { go('all'); S.period = b.dataset.period; render(); };
}

// ── 상세: 묶음 하나 / 세부 유형 하나 / 매장 하나 / 전체 상담
function renderDetail() {
  const view = document.getElementById('view');
  const typing = document.activeElement?.id === 'q' ? document.activeElement.selectionStart : null; // 다시 그려도 검색창 입력을 이어가게
  const V = S.view, K = S.key;
  const base = S.chats.filter((c) => (V === 'group' ? c.groups.includes(K) : V === 'type' ? c.types.includes(K) : V === 'store' ? c.store === K : true));
  const ranged = base.filter(inRange);
  const { cur, last, prev } = halves();
  const cntP = (p) => base.filter((c) => c.period === p).length;
  const title = V === 'group' ? groupLabel(K) : V === 'type' ? tagLabel(K) : V === 'store' ? K : '전체 상담';
  const crumb = `<button class="linkish" id="back">대시보드</button>${V === 'type' ? ` / <button class="linkish" data-group="${esc(groupOf(K))}">${esc(groupLabel(groupOf(K)))}</button>` : ''}`;
  const allRanged = S.chats.filter(inRange).length;

  const acts = V === 'type' ? S.actions.filter((a) => a.device_type === K).sort((a, b) => (a.acted_on < b.acted_on ? -1 : 1)) : [];
  const actPeriods = new Set(acts.map((a) => bucketOfDate(new Date(a.acted_on), unitOf())));

  const q = S.q.trim();
  const listed = (S.period ? base.filter((c) => bucketOf(c, unitOf()) === S.period) : ranged)
    .filter((c) => (!S.store || c.store === S.store) && (!S.type || c.types.includes(S.type))
      && (!q || c.store.includes(q) || (SEARCH.q === q && SEARCH.ids?.has(c.id))));

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

  const kpi = (label, val, extra = '', note = '') => `<div class="kpi"><p>${label}</p><b>${val}</b>${extra || '<span class="delta-slot"></span>'}<span class="kpi-note">${note}</span></div>`;

  view.innerHTML = `
    ${pageHead(esc(title), V === 'type' ? esc(K) : '', { crumb })}
    <section class="kpis">
      ${kpi(rangeLabel(), n(ranged.length), '', V !== 'all' ? `전체 상담의 ${Math.round((ranged.length / Math.max(1, allRanged)) * 100)}%` : '')}
      ${kpi('지난 보름', n(cntP(last)), delta(cntP(last), cntP(prev), { tip: tipBox(last, prev, cntP(last), cntP(prev)) }), periodLabel(last))}
      ${kpi('이번 보름', n(cntP(cur)), '', `${periodLabel(cur)}, 진행 중`)}
      ${V === 'store' ? (() => {
        const [t, v] = Object.entries(countBy(ranged, (c) => c.types))[0] || [];
        return kpi('가장 많은 유형', t ? `<button class="linkish kpi-text" data-type="${esc(t)}" title="${esc(tagLabel(t))}">${esc(tagLabel(t))}</button>` : '-', '', t ? `${n(v)}건 · ${esc(groupLabel(groupOf(t)))}` : '');
      })() : (() => {
        const top = st.find(([s]) => s !== NO_STORE);
        return kpi('상담이 많은 매장', top ? `<button class="linkish kpi-text" data-store="${esc(top[0])}" title="${esc(top[0])}">${esc(top[0])}</button>` : '-', '', top ? `${n(top[1])}건` : '');
      })()}
    </section>

    <div class="cards">
      ${card(`${UNIT_LABEL[unitOf()]}별 추이`, `막대를 누르면 그 ${UNIT_LABEL[unitOf()]}의 상담만 아래에 보여요. 흐린 막대는 아직 진행 중이에요.${actPeriods.size ? ` 점은 개선 조치를 한 ${UNIT_LABEL[unitOf()]}이에요.` : ''}`,
        `${V === 'type' ? stackedTrend(base, { keyFn: () => ['x'], color: () => 'var(--ink)', label: () => title, actPeriods })
          : stackedTrend(base, { keyFn: subKey, color: subColor, label: subLabel, keys: subEntries.map(([k]) => k) })}
         ${V === 'type' ? actionsBlock(base, acts) : ''}`, { cls: 'span-3' })}
      ${V === 'group' || V === 'type' ? taskBoard(ranged, V === 'group' ? K : groupOf(K)) : ''}
      ${subEntries.length ? card(V === 'group' ? '세부 유형' : '유형 묶음', V === 'group' ? '누르면 그 유형만 자세히 볼 수 있어요' : '',
        donut(subEntries, { color: subColor, label: subLabel, onKey: V === 'group' ? 'type' : 'group', count: ranged.length }), { cls: 'span-2' }) : ''}
      ${V === 'store' ? card('이 매장의 세부 유형', '누르면 아래 목록을 거를 수 있어요',
        hbars(Object.entries(countBy(ranged, (c) => c.types)).slice(0, 10), { onKey: 'filter-type', color: (k) => groupColor(groupOf(k)), label: tagLabel, dim: isParent, title: (k) => k })) : ''}
      ${card('요일별 하루 평균', `${rangeLabel()} · 요일마다 하루에 몇 건 들어오는지예요`, weekdayBars(ranged))}
      ${storeCard}
      ${card('시간대별 상담', '진할수록 많아요', heatmap(ranged))}
      ${V === 'group' || V === 'type' ? insightCard(ranged, V === 'group' ? K : groupOf(K), '', { resOnly: !!SUBJECTS[V === 'group' ? K : groupOf(K)] }) : insightCard(ranged, MAL_GROUP, '기기 오작동 증상과 처리')}
    </div>

    <section class="card list-card" id="list">
      <div class="card-head"><div><h2>상담 ${n(listed.length)}건</h2><p class="card-sub">요약을 읽고, 자세한 대화는 채널톡에서 확인하세요</p></div></div>
      <div class="filters">
        <input type="search" id="q" value="${esc(q)}" placeholder="내용으로 찾기 (예: 탈수, 환불, 입고)" aria-label="상담 내용으로 찾기">
        ${S.period ? `<button class="pill" data-clear="period">${buckets().long(S.period)} ✕</button>` : ''}
        ${S.store ? `<button class="pill" data-clear="store">${esc(S.store)} ✕</button>` : ''}
        ${S.type ? `<button class="pill" data-clear="type">${esc(tagLabel(S.type))} ✕</button>` : ''}
      </div>
      ${listed.length ? `<ul class="chats">${listed.slice(0, S.shown).map((c, i) => chatRow(c, S.revealFrom !== null && i >= S.revealFrom)).join('')}</ul>
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
  view.querySelector('#more')?.addEventListener('click', () => { S.revealFrom = S.shown; S.shown += PAGE; render(); });
  view.querySelector('#all-stores')?.addEventListener('click', () => { S.allStores = !S.allStores; render(); });
  const qi = view.querySelector('#q');
  let timer;
  qi.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { S.q = qi.value; S.shown = PAGE; S.qFocus = true; const q2 = S.q.trim(); if (q2) { SEARCH.ids = await searchIds(q2); SEARCH.q = q2; } render(); }, 300); };
  if (S.qFocus || typing !== null) { S.qFocus = false; const el = document.getElementById('q'); const pos = typing ?? el.value.length; el.focus(); el.setSelectionRange(pos, pos); }
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
      <p class="form-msg" id="admin-msg" role="alert" hidden></p>
      <ul class="admins">${rows.map((r) => `<li><span>${esc(r.email)}${r.email === me ? ' <span class="muted">(나)</span>' : ''}</span>
        <span class="muted">${r.added_by ? `${esc(r.added_by.split('@')[0])}님이 ${kst(r.added_at, { month: 'numeric', day: 'numeric' })}에 추가` : '처음 설정'}</span>
        ${r.email === me ? '' : `<button class="linkish" data-rm="${esc(r.email)}">관리자에서 빼기</button>`}</li>`).join('')}</ul>
    </section>`;
  view.querySelector('#admin-form').onsubmit = async (e) => {
    e.preventDefault();
    const msg = view.querySelector('#admin-msg'), say = (t) => { msg.textContent = t; msg.hidden = false; };
    const email = e.target.e.value.trim().toLowerCase();
    if (!email.endsWith('@' + COMPANY_DOMAIN)) return say(`회사 계정(@${COMPANY_DOMAIN})만 등록할 수 있어요.`);
    const { error } = await db.from('approvers').insert({ email });
    if (error) return say(error.code === '23505' ? '이미 관리자예요.' : '추가하지 못했어요: ' + error.message);
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
if (app.querySelector('.loading')) app.innerHTML = skeletonFrame(); // 로그인 확인 전에도 화면 틀을 먼저 보여준다
let started = false, lastUser = '';
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    const who = session?.user?.id || '';
    if (started && who === lastUser) return; // 같은 사용자에 대한 알림이 또 오면 다시 불러오지 않는다
    started = true; lastUser = who;
    route(session);
  }
});
