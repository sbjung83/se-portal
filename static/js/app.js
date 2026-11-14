const $ = id => document.getElementById(id);
let ENG_ID='', ENG_NAME='', IS_ADMIN=false;
let currentSiteId=null, revealedPw={};   // revealedPw: 하위 호환용(미사용)

// 페이지네이션 상태

const PAGE_SIZE = 5;

// 캐시
let _allIssues=[], _allCLItems=[], _devChecklist={};

// SVG 아이콘
const ICO_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICO_DEL  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICO_CLOSE= `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// 로그인이 풀린 상태(401)로 응답이 오면 로그인 화면으로 돌려보낸다
const _rawFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const r = await _rawFetch(...args);
  const u = String((args[0] && args[0].url) || args[0] || '');
  if(r.status === 401 && !u.includes('/api/auth/')) _sessionExpired();
  return r;
};
function _sessionExpired(){
  if(!ENG_ID) return;
  ENG_ID=''; ENG_NAME=''; IS_ADMIN=false;
  document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  $('main-app').style.display='none'; $('auth-wrap').style.display='flex';
  switchAuth('login');
  $('login-err').style.color='';
  $('login-err').textContent='로그인이 만료되었습니다. 다시 로그인해주세요';
}

const api = {
  get:   url     => fetch(url).then(r=>r.json()),
  post:  (url,d) => fetch(url,{method:'POST',  headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json()),
  patch: (url,d) => fetch(url,{method:'PATCH', headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json()),
  del:   url     => fetch(url,{method:'DELETE'}).then(r=>r.json()),
};

function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}
function openModal(id){$(id).classList.add('open'); $(id).querySelectorAll('.mop-grid textarea').forEach(mopGrow)}
function closeModal(id){$(id).classList.remove('open')}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open')}));

// ── 페이지네이션 헬퍼 ──────────────────────
function renderPagination(containerId, total, currentPage, onPageFn, pageSize=PAGE_SIZE){
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const el = $(containerId);
  if(totalPages <= 1){el.innerHTML='';return}
  let html = `<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="${onPageFn}(${currentPage-1})">‹</button>`;
  for(let i=1;i<=totalPages;i++){
    html+=`<button class="pg-btn ${i===currentPage?'active':''}" onclick="${onPageFn}(${i})">${i}</button>`;
  }
  html+=`<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="${onPageFn}(${currentPage+1})">›</button>`;
  html+=`<span class="pg-info">${currentPage}/${totalPages}</span>`;
  el.innerHTML=html;
}

// ── AUTH ──────────────────────────────────
function switchAuth(tab){
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',i===(tab==='login'?0:1)));
  $('pane-login').classList.toggle('active',tab==='login');
  $('pane-register').classList.toggle('active',tab==='register');
}
async function doLogin(){
  const username=$('login-user').value.trim(), password=$('login-pw').value;
  $('login-err').style.color='';
  if(!username||!password){$('login-err').textContent='아이디와 비밀번호를 입력해주세요';return}
  let r;
  try { r=await api.post('/api/auth/login',{username,password}); }
  catch(e){ $('login-err').textContent='서버에 연결하지 못했습니다'; return }
  if(r.ok){ENG_ID=r.engineer_id;ENG_NAME=r.engineer_name;IS_ADMIN=!!r.is_admin;$('login-pw').value='';$('login-err').textContent='';initApp()}
  else $('login-err').textContent=(typeof r.detail==='string'&&r.detail)||'로그인 실패';
}
async function doRegister(){
  const username=$('reg-user').value.trim(),password=$('reg-pw').value,engineer_name=$('reg-eng').value.trim();
  $('reg-err').style.color='';
  if(!username||!password||!engineer_name){$('reg-err').textContent='모든 항목을 입력해주세요';return}
  if(password.length<8){$('reg-err').textContent='비밀번호는 8자 이상이어야 합니다';return}
  const r=await api.post('/api/auth/register',{username,password,engineer_name});
  if(r.ok){$('reg-pw').value='';$('login-err').style.color='#15803d';$('login-err').textContent=r.message||'가입 완료! 로그인해주세요';switchAuth('login')}
  else $('reg-err').textContent=(typeof r.detail==='string'&&r.detail)||'가입 실패';
}
async function doLogout(){
  try { await api.post('/api/auth/logout',{}); } catch(e){}
  ENG_ID='';ENG_NAME='';IS_ADMIN=false;
  $('login-err').textContent='';
  $('auth-wrap').style.display='flex';$('main-app').style.display='none';
}
function toggleUserMenu(e){ if(e) e.stopPropagation(); $('sb-user').classList.toggle('open'); }
function closeUserMenu(){ $('sb-user').classList.remove('open'); }
document.addEventListener('click', e => { const u=$('sb-user'); if(u && !u.contains(e.target)) u.classList.remove('open'); });
document.addEventListener('keydown', e => { if(e.key==='Escape') closeUserMenu(); });
function openChangePw(){
  ['cp-cur','cp-new','cp-new2'].forEach(i=>$(i).value='');
  $('cp-err').textContent='';
  openModal('modal-change-pw');
  $('cp-cur').focus();
}
async function saveChangePw(){
  const cur=$('cp-cur').value, nw=$('cp-new').value, nw2=$('cp-new2').value, err=$('cp-err');
  if(!cur||!nw||!nw2){err.textContent='모든 항목을 입력해주세요';return}
  if(nw.length<8){err.textContent='새 비밀번호는 8자 이상이어야 합니다';return}
  if(nw!==nw2){err.textContent='새 비밀번호가 서로 다릅니다';return}
  try { await _apiSend('POST','/api/auth/password',{current_password:cur,new_password:nw}); }
  catch(e){ err.textContent=e.message; return }
  closeModal('modal-change-pw');
  toast('비밀번호를 변경했습니다');
}
// 대시보드 머리말: 제목 + "이름 님 · 오늘 날짜", 오른쪽에 사이트·장비 수
function _dashHead(d){
  const now = new Date();
  const today = `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 (${'일월화수목금토'[now.getDay()]})`;
  $('dash-title').innerHTML = `
    <div class="dash-h-main">
      <div class="dash-h-title">대시보드</div>
      <div class="dash-h-sub"><b>${esc(ENG_NAME)}</b> 님<span class="dash-h-dot"></span>${today}</div>
    </div>
    <div class="dash-h-stats">
      <span class="dash-stat"><em>사이트</em><b>${d ? d.site_count : '-'}</b></span>
      <span class="dash-stat"><em>장비</em><b>${d ? d.device_count : '-'}</b></span>
    </div>`;
}
function initApp(){
  $('auth-wrap').style.display='none';$('main-app').style.display='flex';
  $('sidebar-eng-name').textContent=ENG_NAME;
  const av=$('sidebar-avatar'); if(av) av.textContent=ENG_NAME.charAt(0);
  closeUserMenu();
  // 관리자 전용 메뉴(개발 체크리스트)는 관리자에게만 보인다. 서버도 관리자가 아니면 거절한다
  document.querySelectorAll('.nav-item[data-admin]').forEach(n => n.style.display = IS_ADMIN ? '' : 'none');
  if(!IS_ADMIN && document.querySelector('.page.active[data-admin]')){ const n = document.querySelector('.nav-item[data-page="dashboard"]'); if(n) n.click(); }
  _dashHead();
  renderDashboard();
}

// ── NAV ───────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    const page=el.dataset.page;
    $('page-'+page).classList.add('active');
    if(page==='dashboard')      renderDashboard();
    if(page==='checklist')      renderChecklistPage();
    if(page==='sites')          renderSites();
    if(page==='schedule-mgmt'){ _smYM=_ymd(new Date()).slice(0,7); renderSchedMgmt(); }
    if(page==='projects')       renderProjects();
    if(page==='sched-history')  renderSchedHistory();
    if(page==='technotes')      renderTechNotes();
    if(page==='work-plan')      renderWorkPlans();
    if(page==='incidents')      renderIncidents();
    if(page==='service-history') renderServiceHistory();
    if(page==='weekly-report')  renderWeeklyReport();
    if(page==='dev-checklist')  loadDevChecklist();
    if(page==='gcal')           renderGcal();
    if(page==='lab')            renderLab();
  });
});

// ── DETAIL TABS ───────────────────────────
document.querySelectorAll('.tab[data-dtab]').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('.tab[data-dtab]').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('[id^="dtab-"]').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    $('dtab-'+t.dataset.dtab).classList.add('active');
  });
});

// ── DASHBOARD ─────────────────────────────
async function renderDashboard(){
  // 요약 / 체크리스트를 동시에 불러온다
  const [d] = await Promise.all([
    api.get(`/api/engineers/${ENG_ID}/dashboard`),
    loadDashCL(),
  ]);
  _dashData = d;
  _allIssues = d.issues_all || d.issues || [];
  _dashHead(d);

  (d.week?.schedules || []).forEach(x => { _schedById[x.id] = x; });
  renderDashMetrics();
  renderDashWeek();
  renderDashIssues();
  renderDashWarranty();
  renderDashProjects();
}
// 대시보드를 열어 둔 채로 있어도 최신 내용이 보이도록: 1분마다, 그리고 다른 창에 갔다 돌아올 때 다시 불러온다
// (구글 캘린더에서 들어온 일정처럼 화면 밖에서 바뀐 내용 반영). 입력 창이 열려 있을 때는 건드리지 않는다.
let _dashAutoBusy = false;
async function _dashAutoRefresh(){
  if(_dashAutoBusy || !ENG_ID || document.hidden) return;
  if(!$('main-app') || $('main-app').style.display === 'none') return;
  if(!$('page-dashboard').classList.contains('active') || document.querySelector('.overlay.open')) return;
  _dashAutoBusy = true;
  try { await renderDashboard(); } catch(e) {} finally { _dashAutoBusy = false; }
}
setInterval(_dashAutoRefresh, 60000);
document.addEventListener('visibilitychange', () => { if(!document.hidden) _dashAutoRefresh(); });
window.addEventListener('focus', _dashAutoRefresh);

function _refreshDash(){
  if($('page-dashboard').classList.contains('active')) renderDashboard();
  if($('modal-site-detail').classList.contains('open')) loadOverview();
  if($('page-sites').classList.contains('active')) renderSites();
}

// ── 공통: 날짜 ─────────────────────────────
const _WD = ['일','월','화','수','목','금','토'];
function _daysBetween(a, b){   // "YYYY-MM-DD" 두 날짜의 차이(b - a, 일)
  const [y1,m1,d1] = a.split('-').map(Number), [y2,m2,d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2,m2-1,d2) - Date.UTC(y1,m1-1,d1)) / 86400000);
}
function _dayLabel(day, today){
  const n = _daysBetween(today, day);
  const [y,m,dd] = day.split('-').map(Number);
  const wd = _WD[new Date(y, m-1, dd).getDay()];
  const md = `${m}/${dd} (${wd})`;
  return n === 0 ? `오늘 · ${md}` : n === 1 ? `내일 · ${md}` : md;
}

// ── 이번 주 일정 ─────────────────────────
const WK_KIND = {
  sched: {label:'점검',     cls:'wk-sched'},
  plan:  {label:'기술지원', cls:'wk-plan'},
  inc:   {label:'장애',     cls:'wk-inc'},
  cl:    {label:'체크',     cls:'wk-cl'},
};
let _dashWeekTab = 'this';
function switchDashWeek(tab){
  _dashWeekTab = tab;
  document.querySelectorAll('[data-wk]').forEach(b => b.classList.toggle('active', b.dataset.wk === tab));
  renderDashWeek();
}
function renderDashWeek(){
  const w = _dashData?.week;
  const el = $('dash-week');
  if(!w){ el.innerHTML = ''; return; }
  const isNext = _dashWeekTab === 'next';
  const today = w.today;
  const thisEnd = w.this_end || w.end;
  const [ey, em, ed] = thisEnd.split('-').map(Number);
  // 이번 주: 월 ~ 일 전체 (완료한 일정도 흐리게 남김, 지난주 이전 미완료는 "지연") / 다음 주: 다음 주 월 ~ 일
  const start = isNext ? _ymd(new Date(ey, em-1, ed+1)) : (w.this_start || _ymd(new Date(ey, em-1, ed-6)));
  const end   = isNext ? _ymd(new Date(ey, em-1, ed+7)) : thisEnd;
  $('dash-week-title').textContent = isNext ? '다음 주 일정' : '이번 주 일정';
  $('dash-week-range').textContent = `${start.slice(5).replace('-','/')} ~ ${end.slice(5).replace('-','/')}`;

  const inRange = d => d >= start && d <= end;
  const items = [];
  // 제목 옆에 흐리게 붙일 내용(메모·작업 내용): 여러 줄은 ' · ' 로 이어 한 줄로
  const note = t => { t = (t || '').trim(); return t === '구글 캘린더에서 가져옴' ? '' : t.split('\n').map(l => l.trim().replace(/^[-•·]\s*/, '')).filter(Boolean).join(' · '); };
  w.schedules.forEach(x => { const done = x.status === '완료'; items.push({kind:'sched', done, day:x.sched_date.slice(0,10), title:x.title, note:note(x.memo), site:x.site_name,
    extra: x.sched_type !== '월간' ? `<span class="badge b-gray">${esc(x.sched_type)}</span>` : '',
    check:`<input type="checkbox" class="wk-check" ${done?'checked':''} title="${done?'완료 취소':'점검 완료 처리'}" onclick="event.stopPropagation()" onchange="weekDoneSched('${x.id}',this)">`,
    open:`openEditSched('${x.id}')`}); });
  w.workplans.forEach(x => { const done = x.status === '완료'; items.push({kind:'plan', done, day:x.work_date.slice(0,10), time:x.work_date.slice(11,16), title:x.title, note:note(x.purpose), site:x.site,
    extra:_wpImpactBadge(x.impact),
    check:`<input type="checkbox" class="wk-check" ${done?'checked':''} title="${done?'완료 취소':'기술지원 완료 처리'}" onclick="event.stopPropagation()" onchange="weekDonePlan('${x.id}',this)">`,
    open:`openEditWorkPlan('${x.id}')`}); });
  _allCLItems.filter(i => i.due && i.due <= end && (!i.done || i.due >= start)).forEach(i => items.push({kind:'cl', done:i.done, day:i.due, title:i.text, site:i.site_name,
    extra:`<span class="badge b-gray">${esc(i.category)} 마감</span>`,
    check:`<input type="checkbox" class="wk-check" ${i.done?'checked':''} title="${i.done?'완료 취소':'완료 처리'}" onclick="event.stopPropagation()" onchange="dashToggleCL('${i.id}',this.checked)">`,
    open:''}));
  // 이번 주에 처리 완료한 장애는 발생일(이번 주 밖이면 복구일) 칸에 흐리게 표시
  (isNext ? [] : w.incidents.filter(i => i.status === '완료')).forEach(i => {
    const occ = (i.occurred_at || '').slice(0,10), rec = (i.recovered_at || '').slice(0,10);
    items.push({kind:'inc', done:true, day: inRange(occ) ? occ : rec, time: inRange(occ) ? (i.occurred_at || '').slice(11,16) : '', title:i.title, site:i.site,
      extra:`<span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>`, open:`openEditIncident('${i.id}')`});
  });
  const incs = isNext ? [] : w.incidents.filter(i => i.status !== '완료');

  const row = it => `
    <div class="wk-row ${it.open?'clickable':''} ${it.done?'done':''}" ${it.open?`onclick="${it.open}"`:''}>
      ${it.check || '<span class="wk-check-gap"></span>'}
      <span class="wk-kind ${WK_KIND[it.kind].cls}">${WK_KIND[it.kind].label}</span>
      ${it.time ? `<span class="wk-time">${esc(it.time)}</span>` : ''}
      <span class="wk-title" title="${esc(it.title + (it.note ? ' — ' + it.note : ''))}">${esc(it.title)}${it.note ? `<span class="wk-note">${esc(it.note)}</span>` : ''}</span>
      ${it.lateTag ? '<span class="badge b-red">지연</span>' : ''}${it.extra || ''}
      <span class="wk-site" title="${esc(it.site||'')}">${esc(it.site||'-')}</span>
    </div>`;

  const groups = [];
  if(incs.length) groups.push({cls:'hot', head:`진행 중 장애 ${incs.length}건`, rows: incs.map(i => row({kind:'inc', title:i.title, site:i.site,
    time: i.occurred_at ? i.occurred_at.slice(5,10).replace('-','/') : '',
    extra:`<span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span><span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>`,
    open:`openEditIncident('${i.id}')`}))});
  // 이번 주 월요일 이전에 못 끝낸 일정
  const late = isNext ? [] : items.filter(i => !i.done && i.day < start).sort((a,b) => a.day.localeCompare(b.day));
  if(late.length) groups.push({cls:'late', head:`지연 ${late.length}건 <span class="wk-meta">지난주 이전 일정인데 미완료</span>`,
    rows: late.map(it => row({...it, time: it.day.slice(5).replace('-','/') + (it.time ? ' ' + it.time : '')}))});
  const [sy, sm, sd] = start.split('-').map(Number);
  let shown = 0, doneCnt = 0;
  for(let n = 0; ; n++){
    const day = _ymd(new Date(sy, sm-1, sd+n));
    if(day > end) break;
    const its = items.filter(i => i.day === day).sort((a,b) => (a.done - b.done) || (a.time||'').localeCompare(b.time||''));
    if(!its.length) continue;
    shown += its.length;
    const dn = its.filter(i => i.done).length;
    doneCnt += dn;
    const past = day < today;
    groups.push({cls: day === today ? 'today' : past ? 'past' : '',
      head: `${_dayLabel(day, today)}<span class="wk-meta">${dn === its.length ? '✓ 모두 완료' : dn ? `${dn}/${its.length} 완료` : `${its.length}건`}</span>`,
      rows: its.map(it => row({...it, lateTag: past && !it.done}))});
  }

  const total = incs.length + late.length + shown;
  $('dash-week-cnt').innerHTML = !total ? '' : isNext ? `${total}건`
    : `<span class="${doneCnt === total ? 'ok' : ''}">${doneCnt}/${total} 완료</span>`;
  el.innerHTML = groups.length
    ? groups.map(g => `<div class="wk-group ${g.cls}"><div class="wk-head">${g.head}</div>${g.rows.join('')}</div>`).join('')
    : `<div class="empty">${isNext ? '다음 주' : '이번 주'}에 예정된 일정이 없습니다</div>`;
}

// 이번 주 일정의 점검 체크박스: 체크하면 완료, 풀면 예정으로 되돌림
async function weekDoneSched(id, el){
  const toDone = el ? el.checked : true;
  try {
    await _apiSend('PATCH', `/api/engineers/${ENG_ID}/schedules/${id}`, { status: toDone ? '완료' : '예정' });
    toast(toDone ? '점검 완료 처리됨' : '완료 취소됨');
  } catch(e) {
    console.error('점검 상태 변경 실패:', e);
    toast('변경 실패: ' + e.message);
    if(el) el.checked = !toDone;
    return;
  }
  _schedHistory = [];
  _refreshDash();
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
}

async function weekDonePlan(id, el){
  const toDone = el ? el.checked : true;
  try {
    await _apiSend('PATCH', `/api/engineers/${ENG_ID}/workplans/${id}`, { status: toDone ? '완료' : '예정' });
    toast(toDone ? '기술지원 완료 처리됨' : '완료 취소됨');
  } catch(e) {
    toast('변경 실패: ' + e.message);
    if(el) el.checked = !toDone;
    return;
  }
  _refreshDash();
}

// ── 사이트 이슈 (심각도 → 오래된 순) ─────────────
const ISS_SEV_CLS = {긴급:'b-red',높음:'b-amber',보통:'b-blue',낮음:'b-gray'};
const ISS_ST_CLS  = {오픈:'b-red',처리중:'b-amber',완료:'b-green'};
const ISS_SEV_ORD = {긴급:0,높음:1,보통:2,낮음:3};
function _issAge(i){
  const c = (i.created_at || '').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(c) ? _daysBetween(c, _ymd(new Date())) : null;
}
function renderDashIssues(){
  const el = $('dash-issues');
  const list = [...(_allIssues || [])].sort((a,b) =>
    (ISS_SEV_ORD[a.severity] ?? 9) - (ISS_SEV_ORD[b.severity] ?? 9) || (a.created_at||'').localeCompare(b.created_at||''));
  $('dash-issue-cnt').textContent = list.length ? `${list.length}건` : '';
  if(!list.length){ el.innerHTML = '<div class="empty">미해결 이슈 없음</div>'; return; }
  el.innerHTML = list.map(i => {
    const age = _issAge(i);
    return `
    <div class="iss-row iss-sev-${ISS_SEV_ORD[i.severity] ?? 3}" onclick="showIssuePopup('${i.id}')">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:4px;margin-bottom:3px;flex-wrap:wrap;align-items:center">
          <span class="badge ${ISS_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>
          <span class="badge ${ISS_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>
          <span class="badge b-gray" style="font-size:10px;font-weight:600">${esc(i.site_name)}</span>
          ${age !== null ? `<span class="iss-age ${age>=30?'old':''}" title="등록일 ${esc(i.created_at)}">D+${age}</span>` : ''}
        </div>
        <div class="iss-title">${esc(i.title)}</div>
      </div>
      <div style="display:flex;gap:2px;flex-shrink:0">
        <button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditIssue('${i.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del"  title="삭제" onclick="event.stopPropagation();deleteIssue('${i.id}')">${ICO_DEL}</button>
      </div>
    </div>`;
  }).join('');
}

function showIssuePopup(i){
  if(typeof i === 'string') i = (_allIssues || []).find(x => x.id === i) || (_ovData?.issues || []).find(x => x.id === i);
  if(!i) return;
  const age = _issAge(i);
  $('issue-popup-content').innerHTML=`
    <div class="modal-head">
      <div class="issue-popup-title">${esc(i.title)}</div>
      <button class="icon-btn" style="width:24px;height:24px;flex-shrink:0" onclick="closeModal('modal-issue-popup')">${ICO_CLOSE}</button>
    </div>
    <div class="issue-popup-meta">
      <span class="badge ${ISS_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>
      <span class="badge ${ISS_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>
      <span style="font-size:12px;color:#888">${esc(i.site_name)}</span>
      <span style="font-size:11px;color:#bbb;margin-left:auto">${esc(i.created_at||'')}${age!==null?` (D+${age})`:''}</span>
    </div>
    <div class="issue-popup-body">${i.body ? esc(i.body) : '(내용 없음)'}</div>
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid #f0f0ee">
      <button class="icon-btn edit" title="수정" style="width:32px;height:32px" onclick="closeModal('modal-issue-popup');openEditIssue('${i.id}')">${ICO_EDIT}</button>
      <button class="btn" onclick="closeModal('modal-issue-popup')">닫기</button>
    </div>`;
  openModal('modal-issue-popup');
}

// ── 워런티 ────────────────────────────────
// ── 대시보드: 프로젝트 현황 (완료 전 프로젝트의 진행률, 없으면 최근 완료 건) ──
function renderDashProjects(){
  const pj = _dashData?.projects || { active: [], recent_done: [] };
  const today = _ymd(new Date());
  const cnt = st => pj.active.filter(p => p.status === st).length;
  $('dash-proj-cnt').innerHTML = pj.active.length
    ? [['진행 중', '#2563eb'], ['진행 대기', '#64748b'], ['보류', '#d97706']].filter(([st]) => cnt(st))
        .map(([st, c]) => `<span style="color:${c}">${st} ${cnt(st)}</span>`).join('<span class="sep">·</span>') : '';
  const stCls = {'진행 대기':'b-gray', '진행 중':'b-blue', '보류':'b-amber', '완료':'b-green'};
  const row = (p, dim) => {
    const pct = p.task_total ? Math.round(p.task_done / p.task_total * 100) : 0;
    const dd = p.end_date && /^\d{4}-\d{2}-\d{2}/.test(p.end_date) ? _daysBetween(today, p.end_date.slice(0, 10)) : null;
    const due = p.status === '완료' || dd === null ? '' : dd < 0 ? `<span class="badge b-red">지연 D+${-dd}</span>` : `<span class="badge ${dd <= 14 ? 'b-amber' : 'b-gray'}">D-${dd}</span>`;
    return `<div class="dp-row ${dim ? 'dim' : ''}" title="프로젝트 상세 보기" onclick="openProjectDetail('${p.id}')">
      <div class="dp-top"><span class="dp-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="badge ${stCls[p.status] || 'b-gray'}">${esc(p.status)}</span>${due}</div>
      <div class="dp-meta">${esc(p.customer || '-')}${p.end_date ? ` · 종료 ${esc(p.end_date.slice(0, 10))}` : ''}</div>
      <div class="dp-prog">${p.task_total
        ? `<span class="dp-bar"><i style="width:${pct}%"></i></span><span class="dp-pct">${p.task_done}/${p.task_total} · ${pct}%</span>`
        : '<span class="dp-pct none">세부 작업 없음</span>'}</div>
    </div>`;
  };
  $('dash-projects').innerHTML = pj.active.length ? pj.active.map(p => row(p, false)).join('')
    : `<div class="empty" style="padding:10px 4px 12px">진행 중인 프로젝트가 없습니다</div>`
      + (pj.recent_done.length ? `<div class="dp-sub">최근 완료</div>${pj.recent_done.map(p => row(p, true)).join('')}` : '');
}

function renderDashWarranty(){
  const all = _dashData?.expiring_warranties || [];
  const soon = all.filter(w => w.warranty_days > 0).sort((a,b) => a.warranty_days - b.warranty_days);
  const expired = all.filter(w => w.warranty_days <= 0).sort((a,b) => b.warranty_days - a.warranty_days);
  $('dash-warranty-cnt').innerHTML = all.length
    ? `<span style="color:#d97706">90일 이내 ${soon.length}</span><span class="sep">·</span><span style="color:#dc2626">만료 ${expired.length}</span>` : '';
  const row = w => {
    const dd = w.warranty_days;
    const bc = dd <= 30 ? 'b-red' : 'b-amber';
    return `<div class="w-alert ${dd<=0?'expired':''}" style="cursor:pointer" title="사이트 장비 보기" onclick="openSiteDetail('${w.site_id}','devices')">
      <div style="flex:1;min-width:0"><div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.name)}</div>
      <div style="font-size:11px;opacity:.8">${esc(w.site_name)} · ${esc(w.warranty)}</div></div>
      <span class="badge ${dd<=0?'b-red':bc}">${dd<=0 ? `만료 ${-dd}일` : 'D-'+dd}</span></div>`;
  };
  const el = $('dash-warranty');
  if(!all.length){ el.innerHTML = '<div class="empty" style="padding:14px">만료 임박 장비 없음</div>'; return; }
  el.innerHTML = (soon.length ? soon.map(row).join('') : '<div class="empty" style="padding:8px">90일 이내 만료 예정 장비 없음</div>')
    + (expired.length ? `<details class="dash-fold"><summary>이미 만료된 장비 ${expired.length}대</summary>${expired.map(row).join('')}</details>` : '');
}

// ── 대시보드 상단 메트릭 ──────────────────────
let _dashData = null;

function renderDashMetrics(){
  const d = _dashData;
  if(!d) return;
  const ss = d.schedule_summary;
  const todo = _allCLItems.filter(i => !i.done);
  const byCat = c => todo.filter(i => i.category === c).length;
  const issues = _allIssues || [];
  const hot = issues.filter(i => i.severity === '긴급' || i.severity === '높음').length;
  // 한 줄 높이의 낮은 카드: 왼쪽에 이름·보조 설명, 오른쪽에 숫자
  const pct = ss.total ? Math.round(ss.done / ss.total * 100) : 0;
  $('dash-metrics').innerHTML = `
    <div class="metric m-blue" style="cursor:pointer" title="점검 일정 메뉴로 이동" onclick="document.querySelector('.nav-item[data-page=\\'schedule-mgmt\\']').click()">
      <div class="dm-text"><div class="metric-label">이번 달 점검</div>
        <div class="dm-sub"><span class="prog-wrap"><span class="prog-bar" style="width:${pct}%"></span></span>${pct}%</div></div>
      <div class="metric-value">${ss.done}<small>/${ss.total}</small></div></div>
    <div class="metric m-amber" style="cursor:pointer" title="체크리스트 할 일 보기" onclick="switchDashCL('todo');$('dash-cl').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="dm-text"><div class="metric-label">체크리스트 남은 항목</div>
        <div class="dm-sub">월간 ${byCat('월간')} · 분기 ${byCat('분기')} · 일반 ${byCat('일반')}</div></div>
      <div class="metric-value" style="${todo.length?'color:#d97706':''}">${todo.length}<small>건</small></div></div>
    <div class="metric m-red" style="cursor:pointer" title="사이트 이슈 보기" onclick="$('dash-issues').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="dm-text"><div class="metric-label">미해결 이슈</div>
        <div class="dm-sub">긴급·높음 ${hot}건</div></div>
      <div class="metric-value" style="${hot?'color:#dc2626':''}">${issues.length}<small>건</small></div></div>
    ${_svcMetric(d)}`;
}

// ── 대시보드 체크리스트 (현재 주기 기준) ─────────
let _dashCLTab = 'todo';
const CL_CATS = ['월간', '분기', '일반'];

async function loadDashCL(){
  try {
    const clData = await api.get(`/api/engineers/${ENG_ID}/site-checklist`);
    _allCLItems = clData.flatMap(s => s.items.map(i => ({...i, site_name: s.site_name})));
    const sel = $('dcl-site'), prev = sel.value;
    sel.innerHTML = '<option value="">전체 사이트</option>' + clData.filter(s => s.items.length)
      .map(s => `<option value="${s.site_id}">${esc(s.site_name)} (${s.items.filter(i => !i.done).length})</option>`).join('');
    if([...sel.options].some(o => o.value === prev)) sel.value = prev;
  } catch(e) {
    console.error('체크리스트 조회 실패:', e);
    _allCLItems = [];
  }
  drawDashCL();
  renderDashMetrics();
  renderDashWeek();
}

function switchDashCL(tab){
  _dashCLTab = tab;
  document.querySelectorAll('[data-dcl]').forEach(b => b.classList.toggle('active', b.dataset.dcl === tab));
  drawDashCL();
}

function _clDue(i){
  if(i.days_left === null || i.days_left === undefined) return '';
  const d = i.days_left;
  const cls = d <= 3 ? 'dcl-due hot' : d <= 7 ? 'dcl-due warn' : 'dcl-due';
  return `<span class="${cls}">${d <= 0 ? '오늘 마감' : `D-${d}`}</span>`;
}

function drawDashCL(){
  const el = $('dash-cl');
  const site = $('dcl-site').value;
  const items = _allCLItems.filter(i => !site || i.site_id === site);
  const todo = items.filter(i => !i.done), done = items.filter(i => i.done);
  $('dcl-todo-cnt').textContent = todo.length;
  $('dcl-done-cnt').textContent = done.length;

  // 제목 옆 주기별 진행률 (예: 11월 0/3 · 4분기 2/2)
  $('dash-cl-summary').innerHTML = CL_CATS.filter(c => c !== '일반').map(c => {
    const all = items.filter(i => i.category === c);
    if(!all.length) return '';
    const n = all.filter(i => i.done).length;
    return `<span class="${n === all.length ? 'ok' : ''}">${esc(all[0].period)} ${n}/${all.length}</span>`;
  }).filter(Boolean).join('<span class="sep">·</span>');

  if(!items.length){
    el.innerHTML = `<div class="empty">체크리스트 항목이 없습니다<br><span style="font-size:12px">+ 추가 버튼으로 매월/분기 반복 업무를 등록해 보세요</span></div>`;
    return;
  }
  const row = i => `
    <div class="dcl-row">
      <input type="checkbox" ${i.done?'checked':''} onchange="dashToggleCL('${i.id}',this.checked)">
      <span class="dcl-text ${i.done?'done':''}" title="${esc(i.text)}">${esc(i.text)}</span>
      ${!i.done ? _clDue(i) : ''}
      <span class="badge b-gray dcl-site" title="${esc(i.site_name)}">${esc(i.site_name)}</span>
    </div>`;

  if(_dashCLTab === 'done'){
    el.innerHTML = done.length
      ? CL_CATS.map(c => {
          const its = done.filter(i => i.category === c);
          return its.length ? `<div class="dcl-group"><div class="dcl-group-head">${c}${its[0].period ? ` - ${esc(its[0].period)} 완료` : ' - 완료'}</div>${its.map(row).join('')}</div>` : '';
        }).join('')
      : '<div class="empty">이번 주기에 완료한 항목이 없습니다</div>';
    return;
  }
  el.innerHTML = CL_CATS.map(c => {
    const all = items.filter(i => i.category === c);
    if(!all.length) return '';
    const its = todo.filter(i => i.category === c);
    const n = all.length - its.length;
    const p = all[0];
    const head = c === '일반'
      ? `일반 - 상시 <span class="dcl-meta">기한 없음</span>`
      : `${c} - ${esc(p.period)} <span class="dcl-meta">${esc(p.due.slice(5).replace('-', '/'))} 마감 · ${n}/${all.length} 완료</span>`;
    return `<div class="dcl-group">
      <div class="dcl-group-head">${head}</div>
      ${its.length ? its.map(row).join('') : `<div class="dcl-alldone">✓ ${c === '일반' ? '모두 완료' : `${esc(p.period)} 항목 모두 완료`}</div>`}
    </div>`;
  }).join('');
}

async function dashToggleCL(id, checked){
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/site-checklist/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ done: checked }) });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = await r.json();
    const item = _allCLItems.find(i => i.id === id);
    if(item) Object.assign(item, res);
    toast(checked ? '완료 처리됨' : '완료 취소됨');
  } catch(e) {
    console.error('체크리스트 변경 실패:', e);
    toast('변경 실패: 서버 오류가 발생했습니다.');
  }
  drawDashCL(); renderDashMetrics(); renderDashWeek();
}

// ── 점검 일정 CRUD ────────────────────────
async function fillSiteSel(selId, selectedId=''){
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  $(selId).innerHTML='<option value="">— 선택 —</option>'+
    sites.map(s=>`<option value="${s.id}" ${s.id===selectedId?'selected':''}>${esc(s.name)}</option>`).join('');
}

$('btn-sm-add') && $('btn-sm-add').addEventListener('click', () => openEntry(null, ['점검']));

const _schedById = {};   // 대시보드·점검 화면이 불러온 일정 (id → 일정)
// 점검 일정 수정 → 점검·기술지원 공통 입력 창 (아래 '일정 공통 입력 창' 참고)
function openEditSched(s){ return openEntry(typeof s === 'string' ? s : s && s.id); }

// ── 이슈 CRUD ─────────────────────────────
$('btn-add-issue').addEventListener('click', async()=>{
  $('issue-modal-title').textContent='이슈 등록';
  $('issue-id').value='';
  ['issue-title','issue-body'].forEach(id=>$(id).value='');
  $('issue-severity').value='보통'; $('issue-status').value='오픈';
  await fillSiteSel('issue-site');
  openModal('modal-add-issue');
});

async function openEditIssue(iss){
  if(typeof iss === 'string') iss = (_allIssues || []).find(x => x.id === iss) || (_ovData?.issues || []).find(x => x.id === iss);
  if(!iss){ toast('이슈를 찾을 수 없습니다'); return; }
  $('issue-modal-title').textContent='이슈 수정';
  $('issue-id').value=iss.id;
  await fillSiteSel('issue-site', iss.site_id);   // ← site_id 미리 선택
  $('issue-title').value=iss.title;
  $('issue-body').value=iss.body||'';
  $('issue-severity').value=iss.severity;
  $('issue-status').value=iss.status;
  openModal('modal-add-issue');
}

async function saveIssue(){
  const site_id=$('issue-site').value, title=$('issue-title').value.trim();
  if(!site_id||!title){toast('사이트와 제목을 입력해주세요');return}
  const payload={site_id,title,body:$('issue-body').value,severity:$('issue-severity').value,status:$('issue-status').value};
  const id=$('issue-id').value;
  if(id) await api.patch(`/api/engineers/${ENG_ID}/issues/${id}`,payload);
  else   await api.post(`/api/engineers/${ENG_ID}/issues`,payload);
  closeModal('modal-add-issue');
  _refreshDash(); toast(id?'이슈 수정됨':'이슈 등록됨');
}

async function deleteIssue(id){
  if(!confirm('이슈를 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/issues/${id}`);
  _refreshDash(); toast('삭제됨');
}

// ── SITE CHECKLIST ────────────────────────
let _clData = [], _clCat = '';
const CL_BADGE = {'월간':'b-blue', '분기':'b-purple', '일반':'b-gray'};

async function renderChecklistPage(){
  try {
    _clData = (await api.get(`/api/engineers/${ENG_ID}/site-checklist`))
      .sort((x, y) => x.site_name.localeCompare(y.site_name, 'ko'));
  } catch(e) {
    console.error('체크리스트 조회 실패:', e);
    $('cl-content').innerHTML = '<div class="empty">체크리스트를 불러오지 못했습니다</div>';
    return;
  }
  const sel = $('cl-site-sel'), prev = sel.value;
  sel.innerHTML = '<option value="">전체 사이트</option>' + _clData.map(s =>
    `<option value="${s.site_id}">${esc(s.site_name)}${s.items.length ? ` (${s.items.filter(i => !i.done).length}/${s.items.length})` : ''}</option>`).join('');
  if([...sel.options].some(o => o.value === prev)) sel.value = prev;
  drawChecklist();
}
const renderChecklist = renderChecklistPage;

function clSetCat(cat){
  _clCat = cat;
  document.querySelectorAll('[data-clcat]').forEach(b => b.classList.toggle('active', b.dataset.clcat === cat));
  drawChecklist();
}

function drawChecklist(){
  const el = $('cl-content');
  const siteId = $('cl-site-sel').value, todoOnly = $('cl-todo-only').checked;
  const groups = _clData.filter(s => !siteId || s.site_id === siteId);
  const all = groups.flatMap(s => s.items);

  // 주기별 요약 카드 (누르면 해당 주기만 보기)
  const now = new Date();
  const sample = {'월간':`${now.getMonth()+1}월`, '분기':`${Math.ceil((now.getMonth()+1)/3)}분기`, '일반':'상시'};
  const note = {'월간':'매월 1일 자동 초기화', '분기':'분기 첫날 자동 초기화', '일반':'한 번 완료하면 유지'};
  $('cl-summary').innerHTML = CL_CATS.map(c => {
    const its = all.filter(i => i.category === c), done = its.filter(i => i.done).length;
    const p = its[0];
    const left = its.length - done;
    const due = p && p.due ? `${p.due.slice(5).replace('-', '/')} 마감${left ? ` - ${p.days_left <= 0 ? '오늘' : 'D-' + p.days_left}` : ''}` : (c === '일반' ? '기한 없음' : note[c]);
    const state = !its.length ? '' : left ? (p.days_left !== null && p.days_left <= 7 ? 'warn' : '') : 'ok';
    return `<div class="cl-sum ${state} ${_clCat === c ? 'active' : ''}" onclick="clSetCat(_clCat==='${c}'?'':'${c}')" title="${note[c]}">
      <div class="cl-sum-top"><span class="cl-sum-name">${c} - ${esc(p?.period || sample[c])}</span><span class="cl-sum-due">${due}</span></div>
      <div class="cl-sum-val">${its.length ? `${done}<small> / ${its.length} 완료</small>` : '<small>항목 없음</small>'}</div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${its.length ? Math.round(done / its.length * 100) : 0}%"></div></div>
    </div>`;
  }).join('');

  const order = i => CL_CATS.indexOf(i.category) + (i.done ? 10 : 0);
  const status = i => i.done
    ? `<span class="cl-st ok">✓ ${i.period ? esc(i.period) + ' ' : ''}완료</span>`
    : i.due ? `<span class="cl-st">${i.due.slice(5).replace('-', '/')} 마감</span> ${_clDue(i)}`
    : `<span class="cl-st mute">기한 없음</span>`;
  const row = i => `
    <tr class="${i.done ? 'done' : ''}">
      <td class="c"><input type="checkbox" ${i.done ? 'checked' : ''} onchange="toggleCL('${i.id}',this.checked)"></td>
      <td><span class="badge ${CL_BADGE[i.category] || 'b-gray'}">${esc(i.category)}</span></td>
      <td class="cl-text">${esc(i.text)}</td>
      <td class="cl-due-cell">${status(i)}</td>
      <td class="c cl-act"><button class="icon-btn edit" title="수정" onclick="openEditCL('${i.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="deleteCL('${i.id}')">${ICO_DEL}</button></td>
    </tr>`;
  const msgRow = html => `<tr class="cl-msg"><td colspan="5">${html}</td></tr>`;

  const body = groups.map(s => {
    const inCat = s.items.filter(i => !_clCat || i.category === _clCat);
    if(!inCat.length && !siteId) return '';
    const done = inCat.filter(i => i.done).length;
    const show = inCat.filter(i => !todoOnly || !i.done).sort((x, y) => order(x) - order(y));
    if(!show.length && !siteId) return '';
    const prog = !inCat.length ? '' : done === inCat.length
      ? `<span class="cl-site-prog ok">✓ 모두 완료 (${done}/${inCat.length})</span>`
      : `<span class="cl-site-prog">${inCat.length - done}건 남음 (${done}/${inCat.length})</span>`;
    return `<tr class="cl-grp"><td colspan="5"><div class="cl-site-head">
        <span class="cl-site-name">${esc(s.site_name)}</span>${prog}
        <button class="btn btn-sm" onclick="openAddCLItem('${s.site_id}')">+ 추가</button>
      </div></td></tr>
      ${show.length ? show.map(row).join('')
        : msgRow(!inCat.length ? (_clCat ? `${_clCat} 항목이 없습니다` : '등록된 항목이 없습니다') : '✓ 남은 항목이 없습니다')}`;
  }).join('');

  const table = `<div class="cl-panel"><table class="cl-table">
    <thead><tr><th class="c" style="width:52px">완료</th><th style="width:64px">주기</th><th>항목</th><th style="width:170px">마감</th><th class="c" style="width:86px">관리</th></tr></thead>
    <tbody>${body || msgRow(!all.length
      ? '등록된 체크리스트가 없습니다. 매월·분기마다 반복하는 일을 등록해 두면 주기가 바뀔 때 자동으로 다시 할 일이 됩니다.'
      : todoOnly ? '✓ 남은 항목이 없습니다' : '조건에 맞는 항목이 없습니다')}</tbody></table></div>`;

  // 체크리스트가 하나도 없는 사이트는 아래 상자에 모아서 표시
  const emptySites = siteId ? [] : groups.filter(s => !s.items.length);
  const emptyBox = emptySites.length ? `<div class="cl-panel cl-nosite">
    <div class="cl-nosite-title">체크리스트가 없는 사이트 - ${emptySites.length}곳 <span>이름을 누르면 항목을 추가합니다</span></div>
    <div class="cl-nosite-list">${emptySites.map(s => `<button class="cl-chip" onclick="openAddCLItem('${s.site_id}')">+ ${esc(s.site_name)}</button>`).join('')}</div></div>` : '';

  el.innerHTML = table + emptyBox;
}

async function _fillCLSiteSel(selected=''){
  try {
    const sites = await api.get(`/api/engineers/${ENG_ID}/sites`);
    $('cl-item-site').innerHTML = '<option value="">— 사이트 선택 —</option>' +
      sites.map(s => `<option value="${s.id}" ${s.id===selected?'selected':''}>${esc(s.name)}</option>`).join('');
  } catch(e) {
    $('cl-item-site').innerHTML = '<option value="">사이트 로딩 실패</option>';
  }
}
async function openAddCLItem(siteId){
  $('cl-modal-title').textContent='체크리스트 항목 추가';
  $('cl-item-id').value=''; $('cl-text').value='';
  const onPage = $('page-checklist').classList.contains('active');
  $('cl-cat').value = (onPage && _clCat) || '월간';
  // 체크리스트 화면에서는 선택된 사이트, 대시보드에서는 사이트 필터 값을 기본으로
  const pre = (typeof siteId === 'string' && siteId) || (onPage ? $('cl-site-sel').value : $('dcl-site').value);
  await _fillCLSiteSel(pre);
  $('cl-item-site').disabled = false;
  openModal('modal-cl-item');
  setTimeout(() => $('cl-text').focus(), 50);
}
async function openEditCL(item){
  if(typeof item === 'string') item = _clData.flatMap(s => s.items).find(i => i.id === item);
  if(!item) return;
  $('cl-modal-title').textContent='항목 수정';
  $('cl-item-id').value=item.id; $('cl-text').value=item.text; $('cl-cat').value=item.category;
  await _fillCLSiteSel(item.site_id);
  $('cl-item-site').disabled = true;   // 사이트 이동은 지원하지 않음
  openModal('modal-cl-item');
}
function _refreshCL(){
  if($('page-checklist').classList.contains('active')) renderChecklist();
  if($('page-dashboard').classList.contains('active')) loadDashCL();
}
async function saveCLItem(){
  const text=$('cl-text').value.trim(), siteId=$('cl-item-site').value;
  if(!siteId){toast('사이트를 선택해주세요');return}
  if(!text){toast('내용을 입력해주세요');return}
  const id=$('cl-item-id').value;
  const url = id ? `/api/engineers/${ENG_ID}/site-checklist/${id}` : `/api/engineers/${ENG_ID}/site-checklist`;
  const body = id ? {text, category:$('cl-cat').value} : {site_id:siteId, text, category:$('cl-cat').value};
  try {
    const r = await fetch(url, {method: id ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    console.error('체크리스트 저장 실패:', e);
    toast('저장 실패: 서버 오류가 발생했습니다.');
    return;
  }
  closeModal('modal-cl-item');
  _refreshCL(); toast(id?'항목 수정됨':'항목 추가됨');
}
async function toggleCL(id,checked){
  try {
    const res = await _apiSend('PATCH', `/api/engineers/${ENG_ID}/site-checklist/${id}`, {done:checked});
    const item = _clData.flatMap(s => s.items).find(i => i.id === id);
    if(item) Object.assign(item, res);
    toast(checked ? '완료 처리됨' : '완료 취소됨');
  } catch(e) { toast('변경 실패: ' + e.message); }
  renderChecklistPage();
}
async function deleteCL(id){
  if(!confirm('항목을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/site-checklist/${id}`);
  _refreshCL(); toast('삭제됨');
}

// ── SITES ─────────────────────────────────
let _sites = [];
async function renderSites(){
  try { _sites = await api.get(`/api/engineers/${ENG_ID}/sites`); }
  catch(e){ $('site-list').innerHTML = '<div class="empty" style="color:#dc2626">사이트 목록을 불러오지 못했습니다</div>'; return; }
  drawSites();
}
function drawSites(){
  const q = ($('site-search').value || '').trim().toLowerCase();
  const el = $('site-list');
  const list = _sites.filter(s => !q || [s.name, s.location, s.manager].some(v => (v || '').toLowerCase().includes(q)));
  if(!list.length){ el.innerHTML = `<div class="empty">${_sites.length ? '검색 결과가 없습니다' : '사이트가 없습니다'}</div>`; return; }
  el.innerHTML = list.map(s => {
    const badges = [
      s.open_issues ? `<span class="badge b-red" title="미해결 이슈">이슈 ${s.open_issues}</span>` : '',
      s.late_sched ? `<span class="badge b-red" title="날짜가 지난 미완료 점검">점검 지연 ${s.late_sched}</span>` : '',
      s.checklist_todo ? `<span class="badge b-amber" title="이번 주기에 남은 체크리스트">체크 ${s.checklist_todo}</span>` : '',
      s.expiring_count ? `<span class="badge b-amber" title="90일 이내 워런티 만료">⚠ 워런티 ${s.expiring_count}</span>` : '',
    ].filter(Boolean).join('');
    return `
    <div class="site-card" id="site-card-${s.id}" onclick="openSiteDetail('${s.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0">
          <div style="font-size:15px;font-weight:600;margin-bottom:3px">${esc(s.name)}</div>
          <div style="font-size:12px;color:#888">${esc(s.location||'-')} · 담당: ${esc(s.manager||'-')}${s.contact?' · '+esc(s.contact):''}</div>
          ${s.memo ? `<div class="site-memo-line" title="${esc(s.memo)}">${esc(s.memo)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge b-blue" id="dev-count-${s.id}">장비 ${s.device_count}대</span>
          <button class="icon-btn edit" title="정보 수정" onclick="event.stopPropagation();openEditSite('${s.id}')">${ICO_EDIT}</button>
          <button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteSite('${s.id}')">${ICO_DEL}</button>
        </div>
      </div>
      ${badges ? `<div class="site-badges">${badges}</div>` : ''}
    </div>`;
  }).join('');
}
$('site-search').addEventListener('input', () => { clearTimeout(window._siteT); window._siteT = setTimeout(drawSites, 150); });

function openAddSite(){
  $('site-modal-title').textContent = '사이트 추가';
  $('s-id').value = '';
  ['s-name','s-loc','s-mgr','s-contact','s-memo'].forEach(id => $(id).value = '');
  $('s-name-note').style.display = 'none';
  openModal('modal-add-site');
}
async function openEditSite(id){
  let s = _sites.find(x => x.id === id);
  if(!s){ await renderSites(); s = _sites.find(x => x.id === id); }
  if(!s){ toast('사이트를 찾을 수 없습니다'); return; }
  $('site-modal-title').textContent = '사이트 정보 수정';
  $('s-id').value = s.id;
  $('s-name').value = s.name; $('s-loc').value = s.location || ''; $('s-mgr').value = s.manager || '';
  $('s-contact').value = s.contact || ''; $('s-memo').value = s.memo || '';
  $('s-name-note').style.display = '';
  openModal('modal-add-site');
}
async function _apiSend(method, url, body){
  const r = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  let data = null; try { data = await r.json(); } catch(e) {}
  if(!r.ok){
    const msg = (data && typeof data.detail === 'string') ? data.detail
      : r.status === 401 ? '로그인이 필요합니다. 다시 로그인해주세요.' : `서버 오류 (HTTP ${r.status})`;
    throw new Error(msg);
  }
  return data;
}
async function saveSite(){
  const name = $('s-name').value.trim();
  if(!name){ toast('사이트명을 입력해주세요'); return; }
  const id = $('s-id').value;
  const body = {name, location:$('s-loc').value, manager:$('s-mgr').value, contact:$('s-contact').value, memo:$('s-memo').value};
  try {
    if(id) await _apiSend('PATCH', `/api/engineers/${ENG_ID}/sites/${id}`, body);
    else   await _apiSend('POST',  `/api/engineers/${ENG_ID}/sites`, body);
  } catch(e){ toast(e.message); return; }
  closeModal('modal-add-site');
  await renderSites();
  if(id && id === currentSiteId && $('modal-site-detail').classList.contains('open')){ _drawSiteHead(); loadOverview(); }
  toast(id ? '사이트 정보 수정됨' : '사이트 추가됨');
}
async function deleteSite(id){
  let sm;
  try { sm = await _apiSend('GET', `/api/engineers/${ENG_ID}/sites/${id}/summary`); }
  catch(e){ toast(e.message); return; }
  const parts = [['장비',sm.devices,'대'],['접속 정보',sm.accesses,'건'],['점검표 파일',sm.reports,'개'],['특이사항',sm.notes,'건'],
                 ['점검일정',sm.schedules,'건'],['이슈',sm.issues,'건'],['체크리스트',sm.checklists,'건']]
    .filter(x => x[1]).map(x => `· ${x[0]} ${x[1]}${x[2]}`).join('\n');
  const typed = prompt(`'${sm.name}' 사이트를 삭제합니다.\n아래 데이터도 모두 함께 삭제되며 되돌릴 수 없습니다.\n\n${parts || '· (연결된 데이터 없음)'}\n\n※ 기술지원·장애처리 기록은 남습니다.\n\n삭제하려면 사이트명을 정확히 입력하세요.`);
  if(typed === null) return;
  if(typed.trim() !== sm.name){ toast('사이트명이 일치하지 않아 취소했습니다'); return; }
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/sites/${id}`); } catch(e){ toast(e.message); return; }
  if(currentSiteId === id) closeModal('modal-site-detail');
  renderSites(); toast('사이트 삭제됨');
}

function _drawSiteHead(){
  const s = _sites.find(x => x.id === currentSiteId);
  $('detail-site-name').textContent = s ? s.name : '';
  $('detail-site-info').innerHTML = s
    ? [s.location, s.manager ? `담당 ${s.manager}` : '', s.contact].filter(Boolean).map(esc).join(' · ') || '<span style="color:#cbd5e1">위치·담당자 미입력</span>'
    : '';
}
function _siteTab(tab){
  document.querySelectorAll('.tab[data-dtab]').forEach(t => t.classList.toggle('active', t.dataset.dtab === tab));
  document.querySelectorAll('[id^="dtab-"]').forEach(t => t.classList.toggle('active', t.id === 'dtab-' + tab));
}
async function openSiteDetail(siteId, tab='overview'){
  currentSiteId = siteId; revealedPw = {};
  _devType = ''; $('dev-search').value = '';
  if(!_sites.some(s => s.id === siteId)){ try { _sites = await api.get(`/api/engineers/${ENG_ID}/sites`); } catch(e){} }
  _drawSiteHead();
  _siteTab(tab);
  $('site-overview').innerHTML = '<div class="empty">불러오는 중...</div>';
  openModal('modal-site-detail');
  await Promise.all([loadOverview(), loadDevices(), loadAccesses(), loadReports(), loadNotes()]);
}

// ── 사이트 개요 ────────────────────────────
let _ovData = null;
async function loadOverview(){
  const el = $('site-overview');
  const sid = currentSiteId;
  let d;
  try { d = await _apiSend('GET', `/api/engineers/${ENG_ID}/sites/${sid}/overview`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  if(sid !== currentSiteId) return;
  _ovData = d;
  (d.schedules_pending.concat(d.schedules_done)).forEach(x => { _schedById[x.id] = x; });
  const today = d.today, c = d.counts;
  const card = (title, body, extra='') => `<div class="ov-card"><div class="ov-title">${title}${extra}</div>${body}</div>`;
  const empty = t => `<div class="ov-empty">${t}</div>`;
  const sevCls = INC_SEV_CLS;

  const sched = d.schedules_pending.map(x => {
    const day = x.sched_date.slice(0,10), late = day < today;
    return `<div class="ov-row clickable" onclick="openEditSched('${x.id}')">
      <span class="ov-date ${late?'late':day===today?'today':''}">${esc(day.slice(5).replace('-','/'))}</span>
      <span class="ov-text">${esc(x.title)}</span>
      ${x.sched_type!=='월간'?`<span class="badge b-gray">${esc(x.sched_type)}</span>`:''}
      ${late?`<span class="ov-late">${_daysBetween(day, today)}일 지남</span>`:''}</div>`;
  }).join('') || empty('예정된 점검 없음');
  const schedDone = d.schedules_done.length
    ? `<div class="ov-sub">최근 완료: ${d.schedules_done.map(x => `${esc(x.sched_date.slice(5,10).replace('-','/'))} ${esc(x.title)}`).join(', ')}</div>` : '';

  const issues = d.issues.map(i => {
    const age = _issAge(i);
    return `<div class="ov-row clickable" onclick="showIssuePopup(_ovData.issues.find(x=>x.id==='${i.id}'))">
      <span class="badge ${ISS_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>
      <span class="badge ${ISS_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>
      <span class="ov-text">${esc(i.title)}</span>
      ${age!==null?`<span class="iss-age ${age>=30?'old':''}">D+${age}</span>`:''}</div>`;
  }).join('') || empty('미해결 이슈 없음');

  const cls = d.checklists;
  const clTodo = cls.filter(i => !i.done);
  const clBody = cls.length
    ? (clTodo.map(i => `<div class="ov-row">
        <input type="checkbox" class="wk-check" onchange="ovToggleCL('${i.id}',this.checked)">
        <span class="badge b-gray">${esc(i.category)}${i.period?' · '+esc(i.period):''}</span>
        <span class="ov-text">${esc(i.text)}</span>${_clDue(i)}</div>`).join('') || `<div class="dcl-alldone">✓ 이번 주기 항목 모두 완료</div>`)
      + `<div class="ov-sub">완료 ${cls.length - clTodo.length} / 전체 ${cls.length}</div>`
    : empty('체크리스트 항목 없음');

  const svc = [
    ...d.workplans.map(p => ({d:p.work_date, html:`<div class="ov-row clickable" onclick="openEditWorkPlan('${p.id}')">
      <span class="ov-date">${esc((p.work_date||'').slice(5,10).replace('-','/') || '-')}</span>
      <span class="wk-kind wk-plan">기술지원</span><span class="ov-text">${esc(p.title)}</span>
      <span class="badge ${WP_ST_CLS[p.status]||'b-gray'}">${esc(p.status)}</span></div>`})),
    ...d.incidents.map(i => ({d:i.occurred_at, html:`<div class="ov-row clickable" onclick="openEditIncident('${i.id}')">
      <span class="ov-date">${esc((i.occurred_at||'').slice(5,10).replace('-','/') || '-')}</span>
      <span class="wk-kind wk-inc">장애</span><span class="ov-text">${esc(i.title)}</span>
      <span class="badge ${sevCls[i.severity]||'b-gray'}">${esc(i.severity)}</span>
      <span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span></div>`})),
  ].sort((a,b) => (b.d||'').localeCompare(a.d||'')).slice(0, 6).map(x => x.html).join('') || empty('기술지원·장애처리 기록 없음');

  const warr = d.warranty.map(w => `<div class="ov-row">
      <span class="ov-text">${esc(w.name)}</span><span style="font-size:11px;color:#94a3b8">${esc(w.warranty)}</span>
      <span class="badge ${w.warranty_days<=30?'b-red':'b-amber'}">${w.warranty_days<=0?`만료 ${-w.warranty_days}일`:'D-'+w.warranty_days}</span></div>`).join('');

  const stat = (tab, label, n, warn='') => `<button class="ov-stat" onclick="_siteTab('${tab}')"><b>${n}</b>${label}${warn}</button>`;
  el.innerHTML = `
    <div class="ov-stats">
      ${stat('devices','장비', c.devices, c.no_warranty ? `<span class="ov-warn" title="워런티 만료일 미입력 장비">워런티 미입력 ${c.no_warranty}</span>` : '')}
      ${stat('access','접속 정보', c.accesses)}
      ${stat('reports','점검표 파일', c.reports)}
      ${stat('notes','특이사항', c.notes)}
    </div>
    ${d.site.memo ? `<div class="ov-memo">${esc(d.site.memo)}</div>` : ''}
    <div class="ov-grid">
      <div>
        ${card('📅 점검 일정', sched + schedDone, _ovMonthSched())}
        ${card('🔴 미해결 이슈', issues, d.issues.length ? ` <span class="ov-cnt">${d.issues.length}</span>` : '')}
      </div>
      <div>
        ${card('✅ 체크리스트', clBody, clTodo.length ? ` <span class="ov-cnt">${clTodo.length}</span>` : '')}
        ${card('🛠 최근 기술지원 · 장애', svc)}
        ${warr ? card('⚠️ 워런티 만료 임박', warr) : ''}
      </div>
    </div>`;
}
function _ovMonthSched(){
  const ms = (_sites.find(x => x.id === currentSiteId) || {}).month_sched;
  if(!ms || !ms.total) return ' <span class="ov-month">이번 달 점검 없음</span>';
  return ` <span class="ov-month ${ms.done === ms.total ? 'ok' : ''}">이번 달 ${ms.done}/${ms.total} 완료</span>`;
}
async function ovToggleCL(id, checked){
  try { await _apiSend('PATCH', `/api/engineers/${ENG_ID}/site-checklist/${id}`, {done: checked}); }
  catch(e){ toast(e.message); }
  _refreshDash();   // 개요·사이트 목록·대시보드 갱신
}

// ── Devices ───────────────────────────────
let _siteDevs = [], _devType = '';
async function loadDevices(){
  const sid = currentSiteId;
  const devs = await api.get(`/api/engineers/${ENG_ID}/sites/${sid}/devices`);
  if(sid !== currentSiteId) return;
  _siteDevs = devs;
  const cntEl=$(`dev-count-${sid}`);
  if(cntEl) cntEl.textContent=`장비 ${devs.length}대`;
  drawDevices();
}
function devSetType(t){ _devType = t; drawDevices(); }
function drawDevices(){
  const el = $('device-table');
  const devs = _siteDevs;
  // 유형 탭 (건수 포함)
  const types = ['서버','스토리지','네트워크','기타'].filter(t => devs.some(d => d.dev_type === t));
  devs.forEach(d => { if(d.dev_type && !types.includes(d.dev_type)) types.push(d.dev_type); });
  if(_devType && !types.includes(_devType)) _devType = '';
  $('dev-type-tabs').innerHTML = [['', `전체 ${devs.length}`], ...types.map(t => [t, `${t} ${devs.filter(d => d.dev_type === t).length}`])]
    .map(([t, label]) => `<button class="svh-tab ${t===_devType?'active':''}" onclick="devSetType('${esc(t)}')">${esc(label)}</button>`).join('');
  if(!devs.length){ el.innerHTML='<div class="empty">장비가 없습니다</div>'; return; }

  const q = ($('dev-search').value || '').trim().toLowerCase();
  const list = devs.filter(d => (!_devType || d.dev_type === _devType)
      && (!q || [d.name, d.model, d.serial_no, d.os, d.memo].some(v => (v || '').toLowerCase().includes(q))))
    .sort((a,b) => (a.dev_type||'').localeCompare(b.dev_type||'', 'ko') || (a.name||'').localeCompare(b.name||'', 'ko', {numeric:true}));
  if(!list.length){ el.innerHTML = '<div class="empty">조건에 맞는 장비가 없습니다</div>'; return; }

  const wBadge=d=>{
    const dd=d.warranty_days;
    if(dd===null||dd===undefined) return `<span class="dev-muted">-</span>`;
    if(dd<=0) return `<span class="badge b-red">만료</span>`;
    if(dd<=30) return `<span class="badge b-red">D-${dd}</span>`;
    if(dd<=90) return `<span class="badge b-amber">D-${dd}</span>`;
    return `<span class="dev-muted">${esc(d.warranty)}</span>`;
  };
  const sCls={'점검중':'b-amber','교체예정':'b-red','철수':'b-gray'};
  const cell = (v, cls='') => `<td class="${cls}" title="${esc(v||'')}">${v ? esc(v) : '<span class="dev-muted">-</span>'}</td>`;
  el.innerHTML=`<div class="dev-wrap"><table class="dev-tbl">
    <colgroup><col style="width:19%"><col style="width:8%"><col style="width:17%"><col style="width:15%"><col style="width:13%"><col style="width:9%"><col style="width:13%"><col style="width:62px"></colgroup>
    <thead><tr><th>장비명</th><th>유형</th><th>모델</th><th>OS</th><th>S/N</th><th>워런티</th><th>메모</th><th></th></tr></thead><tbody>
    ${list.map(d=>`<tr ondblclick="openEditDevice('${d.id}')">
      <td class="dev-name" title="${esc(d.name)}">${esc(d.name)}${d.status && d.status!=='운영중' ? ` <span class="badge ${sCls[d.status]||'b-gray'}">${esc(d.status)}</span>` : ''}</td>
      ${cell(d.dev_type)}${cell(d.model)}${cell(d.os)}${cell(d.serial_no,'mono')}
      <td>${wBadge(d)}</td>${cell(d.memo,'dev-memo')}
      <td class="dev-act">
        <button class="icon-btn edit" title="수정" onclick="openEditDevice('${d.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del"  title="삭제" onclick="deleteDevice('${d.id}')">${ICO_DEL}</button>
      </td>
    </tr>`).join('')}
  </tbody></table></div>
  <div class="dev-foot">${list.length !== devs.length ? `${list.length} / ${devs.length}대 표시 · ` : `${devs.length}대 · `}행을 더블클릭하면 수정 · 운영중이 아닌 장비만 상태 표시</div>`;
}
$('dev-search').addEventListener('input', () => { clearTimeout(window._devT); window._devT = setTimeout(drawDevices, 120); });
async function saveDevice(){
  const name=$('d-name').value.trim();
  if(!name){toast('장비명을 입력해주세요');return}
  const r=await api.post(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/devices`,{
    name,model:$('d-model').value,serial_no:$('d-sn').value,dev_type:$('d-type').value,
    os:$('d-os').value,purchase:$('d-purchase').value,warranty:$('d-warranty').value,
    status:$('d-status').value,memo:$('d-memo').value
  });
  closeModal('modal-add-device');
  ['d-name','d-model','d-sn','d-os','d-memo','d-purchase','d-warranty'].forEach(id=>$(id).value='');
  const cntEl=$(`dev-count-${currentSiteId}`);
  if(cntEl&&r.site_device_count!==undefined) cntEl.textContent=`장비 ${r.site_device_count}대`;
  loadDevices(); loadOverview(); toast('장비 추가됨');
}
function openEditDevice(d){
  if(typeof d === 'string') d = _siteDevs.find(x => x.id === d);
  if(!d){ toast('장비를 찾을 수 없습니다'); return; }
  $('ed-id').value=d.id; $('ed-name').value=d.name; $('ed-model').value=d.model||'';
  $('ed-sn').value=d.serial_no||''; $('ed-type').value=d.dev_type; $('ed-os').value=d.os||'';
  $('ed-status').value=d.status; $('ed-purchase').value=d.purchase||''; $('ed-warranty').value=d.warranty||'';
  $('ed-memo').value=d.memo||'';
  openModal('modal-edit-device');
}
async function updateDevice(){
  const id=$('ed-id').value, name=$('ed-name').value.trim();
  if(!name){toast('장비명을 입력해주세요');return}
  await api.patch(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/devices/${id}`,{
    name,model:$('ed-model').value,serial_no:$('ed-sn').value,dev_type:$('ed-type').value,
    os:$('ed-os').value,purchase:$('ed-purchase').value,warranty:$('ed-warranty').value,
    status:$('ed-status').value,memo:$('ed-memo').value
  });
  closeModal('modal-edit-device'); loadDevices(); loadOverview(); toast('장비 수정됨');
}
async function deleteDevice(id){
  if(!confirm('장비를 삭제하시겠습니까?'))return;
  const r=await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/devices/${id}`);
  const cntEl=$(`dev-count-${currentSiteId}`);
  if(cntEl&&r.site_device_count!==undefined) cntEl.textContent=`장비 ${r.site_device_count}대`;
  loadDevices(); loadOverview(); toast('삭제됨');
}

// ── Access (비밀번호는 '보기'/'복사' 할 때만 서버에서 받아옴, 로그인 세션 필요) ──
let _siteAccs = [];
async function loadAccesses(){
  const sid = currentSiteId;
  const el=$('access-table');
  let items;
  try { items = await _apiSend('GET', `/api/engineers/${ENG_ID}/sites/${sid}/accesses`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  if(sid !== currentSiteId) return;
  _siteAccs = items;
  if(!items.length){el.innerHTML='<div class="empty">접속 정보가 없습니다</div>';return}
  el.innerHTML=`<table class="tbl"><thead><tr><th>구분</th><th>IP</th><th>포트</th><th>프로토콜</th><th>계정</th><th>비밀번호</th><th>메모</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr>
      <td style="font-weight:600;min-width:100px">${esc(a.name)}</td><td class="mono" style="min-width:120px">${esc(a.ip||'-')}</td><td style="min-width:50px">${esc(a.port||'-')}</td>
      <td><span class="badge b-blue">${esc(a.protocol)}</span></td><td class="mono" style="min-width:80px">${esc(a.username||'-')}</td>
      <td style="min-width:150px">${a.has_password ? `<span class="pw-cell" id="pw-${a.id}">••••••</span>
        <button class="btn btn-sm pw-btn" onclick="togglePw('${a.id}')" id="pwb-${a.id}">보기</button>
        <button class="btn btn-sm pw-btn" onclick="copyPw('${a.id}')">복사</button>` : '<span style="color:#cbd5e1">-</span>'}</td>
      <td style="font-size:12px;color:#888;min-width:80px;white-space:pre-wrap">${esc(a.memo||'-')}</td>
      <td style="display:flex;gap:3px">
        <button class="icon-btn edit" title="수정" onclick="openEditAccess('${a.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteAccess('${a.id}')">${ICO_DEL}</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function _fetchPw(id){
  const r = await _apiSend('GET', `/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses/${id}/password`);
  return r.password;
}
const _pwCache = {};
async function togglePw(id){
  const cell = $('pw-'+id), btn = $('pwb-'+id);
  if(!cell) return;
  if(cell.dataset.shown){
    cell.textContent = '••••••'; delete cell.dataset.shown; btn.textContent = '보기'; return;
  }
  try { if(_pwCache[id] === undefined) _pwCache[id] = await _fetchPw(id); }
  catch(e){ toast(e.message); return; }
  cell.textContent = _pwCache[id]; cell.dataset.shown = '1'; btn.textContent = '숨기기';
  clearTimeout(cell._t); cell._t = setTimeout(() => { if(cell.dataset.shown) togglePw(id); }, 30000);   // 30초 후 자동 숨김
}
async function copyPw(id){
  let pw;
  try { pw = _pwCache[id] !== undefined ? _pwCache[id] : await _fetchPw(id); }
  catch(e){ toast(e.message); return; }
  try {
    if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(pw);
    else {   // http 접속 등 보안 컨텍스트가 아닐 때
      const ta = document.createElement('textarea');
      ta.value = pw; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('비밀번호를 복사했습니다');
  } catch(e){ toast('복사 실패: 브라우저에서 클립보드 사용이 막혀 있습니다'); }
}
function openAddAccess(){
  $('acc-modal-title').textContent = '접속 정보 추가';
  $('a-id').value = '';
  ['a-name','a-ip','a-port','a-user','a-pass','a-memo'].forEach(id => $(id).value = '');
  $('a-proto').value = 'SSH';
  $('a-pass').placeholder = '';
  openModal('modal-add-access');
}
function openEditAccess(id){
  const a = _siteAccs.find(x => x.id === id);
  if(!a){ toast('접속 정보를 찾을 수 없습니다'); return; }
  $('acc-modal-title').textContent = '접속 정보 수정';
  $('a-id').value = a.id;
  $('a-name').value = a.name; $('a-ip').value = a.ip || ''; $('a-port').value = a.port || '';
  $('a-proto').value = a.protocol || 'SSH'; $('a-user').value = a.username || ''; $('a-memo').value = a.memo || '';
  $('a-pass').value = '';
  $('a-pass').placeholder = a.has_password ? '변경할 때만 입력 (비우면 기존 유지)' : '';
  openModal('modal-add-access');
}
async function saveAccess(){
  const name=$('a-name').value.trim();
  if(!name){toast('구분명을 입력해주세요');return}
  const id = $('a-id').value;
  const body = {name, ip:$('a-ip').value, port:$('a-port').value, protocol:$('a-proto').value,
                username:$('a-user').value, memo:$('a-memo').value};
  const pw = $('a-pass').value;
  if(!id || pw) body.password = pw;
  try {
    if(id) await _apiSend('PATCH', `/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses/${id}`, body);
    else   await _apiSend('POST',  `/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses`, body);
  } catch(e){ toast(e.message); return; }
  if(id) delete _pwCache[id];
  closeModal('modal-add-access');
  $('a-pass').value = '';
  loadAccesses(); loadOverview(); toast(id ? '접속 정보 수정됨' : '접속 정보 추가됨');
}
async function deleteAccess(id){
  if(!confirm('접속 정보를 삭제하시겠습니까?'))return;
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses/${id}`); }
  catch(e){ toast(e.message); return; }
  loadAccesses(); loadOverview(); toast('삭제됨');
}

// ── Reports ───────────────────────────────
async function loadReports(){
  const sid = currentSiteId;
  const items=await api.get(`/api/engineers/${ENG_ID}/sites/${sid}/reports`);
  if(sid !== currentSiteId) return;
  const el=$('report-table');
  if(!items.length){el.innerHTML='<div class="empty">업로드된 파일 없음</div>';return}
  el.innerHTML=`<table class="tbl"><thead><tr><th>파일명</th><th>업로드일</th><th>크기</th><th></th></tr></thead><tbody>
    ${items.map(r=>`<tr>
      <td>📄 ${esc(r.filename)}</td>
      <td style="color:#888;font-size:12px">${esc(r.uploaded_at)}</td>
      <td style="color:#888;font-size:12px">${esc(r.size)}</td>
      <td style="display:flex;gap:4px">
        <a href="/api/engineers/${ENG_ID}/sites/${sid}/reports/${r.id}/download" class="btn btn-sm" download>↓ 다운로드</a>
        <button class="icon-btn del" title="삭제" onclick="deleteReport('${r.id}')">${ICO_DEL}</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function uploadReport(event){
  const file=event.target.files[0]; if(!file)return;
  const fd=new FormData(); fd.append('file',file);
  await fetch(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports`,{method:'POST',body:fd});
  event.target.value=''; loadReports(); loadOverview(); toast('파일 업로드 완료');
}
async function deleteReport(id){
  if(!confirm('파일을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports/${id}`);
  loadReports(); loadOverview(); toast('삭제됨');
}

// ── Notes ─────────────────────────────────
let _siteNotes = [];
async function loadNotes(){
  const sid = currentSiteId;
  const items=await api.get(`/api/engineers/${ENG_ID}/sites/${sid}/notes`);
  if(sid !== currentSiteId) return;
  _siteNotes = items;
  const el=$('notes-list');
  if(!items.length){el.innerHTML='<div class="empty">특이사항 없음</div>';return}
  el.innerHTML=items.map(n=>`
    <div style="display:flex;gap:12px;padding:9px 2px;border-bottom:1px solid #f0f0ee">
      <div style="font-size:11px;color:#aaa;min-width:78px;padding-top:2px">${esc(n.date||'')}</div>
      <div style="flex:1;min-width:0"><div style="font-weight:500;margin-bottom:2px">${esc(n.title||'(제목 없음)')}</div><div style="font-size:13px;color:#666;white-space:pre-wrap">${esc(n.body)}</div></div>
      <div style="display:flex;gap:3px;align-items:flex-start">
        <button class="icon-btn edit" title="수정" onclick="openEditNote('${n.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteNote('${n.id}')">${ICO_DEL}</button>
      </div>
    </div>`).join('');
}
function openAddNote(){
  $('note-modal-title').textContent = '특이사항 추가';
  $('n-id').value = ''; $('n-title').value = ''; $('n-body').value = '';
  $('n-date').value = _ymd(new Date());
  openModal('modal-add-note');
}
function openEditNote(id){
  const n = _siteNotes.find(x => x.id === id);
  if(!n){ toast('특이사항을 찾을 수 없습니다'); return; }
  $('note-modal-title').textContent = '특이사항 수정';
  $('n-id').value = n.id; $('n-date').value = n.date || ''; $('n-title').value = n.title || ''; $('n-body').value = n.body || '';
  openModal('modal-add-note');
}
async function saveNote(){
  const body=$('n-body').value.trim(); if(!body){toast('내용을 입력해주세요');return}
  const id = $('n-id').value;
  const data = {date:$('n-date').value, title:$('n-title').value, body};
  try {
    if(id) await _apiSend('PATCH', `/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes/${id}`, data);
    else   await _apiSend('POST',  `/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes`, data);
  } catch(e){ toast(e.message); return; }
  closeModal('modal-add-note');
  loadNotes(); loadOverview(); toast(id ? '특이사항 수정됨' : '특이사항 추가됨');
}
async function deleteNote(id){
  if(!confirm('특이사항을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes/${id}`);
  loadNotes(); loadOverview(); toast('삭제됨');
}

// ── MOP 표 입력기 ───────────────────────────
// 저장 형식: JSON 배열 [{task, detail, time, worker, note}, ...]
// 기존 '작업내용 # 상세 # 소요시간 # 작업자 # 비고' 줄 형식도 읽어서 표로 변환한다.
const MOP_COLS = [
  {key:'task',   label:'작업 내용', width:'22%', multi:true},
  {key:'detail', label:'작업 상세 (CLI 및 상세 내용)', width:'37%', multi:true, mono:true},
  {key:'time',   label:'소요시간', width:'10%'},
  {key:'worker', label:'작업자', width:'12%'},
  {key:'note',   label:'비고', width:'19%', multi:true},
];

function mopParse(content){
  const s = (content || '').trim();
  if(!s) return [];
  if(s.startsWith('[')){
    try {
      const arr = JSON.parse(s);
      if(Array.isArray(arr)) return arr.map(r => Object.fromEntries(MOP_COLS.map(c => [c.key, String((r||{})[c.key] ?? '')])));
    } catch(e) {}
  }
  return s.split('\n').filter(l => l.trim()).map(l => {
    const p = l.replace(/^\s*#/, '').split('#');  // 줄 맨 앞 '#'은 머리표로 간주
    const parts = [...p.slice(0, 4), p.slice(4).join('#')].map(x => (x || '').trim());
    return Object.fromEntries(MOP_COLS.map((c, i) => [c.key, parts[i] || '']));
  });
}

function mopGrow(ta){
  if(!ta || !ta.offsetParent) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function _mopBody(id){ return $(id).querySelector('tbody'); }

function _mopRenumber(id){
  _mopBody(id).querySelectorAll('tr').forEach((tr, i) => tr.querySelector('.mop-no').textContent = i + 1);
}

function _mopNewRow(id, data = {}, beforeTr = null){
  const tr = document.createElement('tr');
  const no = document.createElement('td'); no.className = 'mop-no'; tr.appendChild(no);
  MOP_COLS.forEach(c => {
    const td = document.createElement('td');
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.className = 'mop-cell' + (c.mono ? ' mono' : '');
    ta.dataset.key = c.key;
    ta.value = data[c.key] || '';
    td.appendChild(ta); tr.appendChild(td);
  });
  const act = document.createElement('td'); act.className = 'mop-act';
  act.innerHTML = '<button type="button" tabindex="-1" title="위로" data-act="up">▲</button>'
                + '<button type="button" tabindex="-1" title="아래로" data-act="down">▼</button>'
                + '<button type="button" tabindex="-1" title="행 삭제" class="del" data-act="del">✕</button>';
  tr.appendChild(act);
  _mopBody(id).insertBefore(tr, beforeTr);
  tr.querySelectorAll('textarea').forEach(mopGrow);
  return tr;
}

function mopAddRow(id, focus = true){
  const rows = _mopBody(id).querySelectorAll('tr');
  const last = rows[rows.length - 1];
  // 작업자는 바로 윗 행 값을 기본으로 이어받음
  const worker = last ? last.querySelector('[data-key="worker"]').value : '';
  const tr = _mopNewRow(id, {worker});
  _mopRenumber(id);
  if(focus) tr.querySelector('textarea').focus();
  return tr;
}

function _parseTSV(text){
  text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = []; let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){
      if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += ch;
    }
    else if(ch === '"' && cell === '') q = true;
    else if(ch === '\t'){ row.push(cell); cell = ''; }
    else if(ch === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

function _mopInit(id){
  const box = $(id);
  if(box.dataset.ready) return;
  box.dataset.ready = '1';
  const cols = MOP_COLS.map(c => `<col style="width:${c.width}">`).join('');
  const ths = MOP_COLS.map(c => `<th>${c.label}</th>`).join('');
  box.innerHTML = `<table><colgroup><col style="width:42px">${cols}<col style="width:78px"></colgroup>
    <thead><tr><th>No.</th>${ths}<th></th></tr></thead><tbody></tbody></table>
    <div class="mop-foot"><span>Enter: 아래 칸 · Shift+Enter: 줄바꿈 · Tab: 다음 칸 · 엑셀 복사/붙여넣기 가능</span>
    <button type="button" class="btn btn-sm">+ 행 추가</button></div>`;
  box.querySelector('.mop-foot button').addEventListener('click', () => mopAddRow(id));

  box.addEventListener('input', e => { if(e.target.matches('textarea')) mopGrow(e.target); });

  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if(!b) return;
    const tr = b.closest('tr'), body = _mopBody(id);
    if(b.dataset.act === 'up' && tr.previousElementSibling) body.insertBefore(tr, tr.previousElementSibling);
    if(b.dataset.act === 'down' && tr.nextElementSibling) body.insertBefore(tr.nextElementSibling, tr);
    if(b.dataset.act === 'del'){
      tr.remove();
      if(!body.children.length) mopAddRow(id, false);
    }
    _mopRenumber(id);
  });

  box.addEventListener('keydown', e => {
    const ta = e.target; if(!ta.matches('textarea.mop-cell') || e.isComposing) return;
    const tr = ta.closest('tr'), key = ta.dataset.key;
    if(e.key === 'Enter' && !e.shiftKey && !e.altKey){
      // 엑셀처럼 Enter = 아래 칸 이동 (마지막 행이면 행 추가)
      e.preventDefault();
      const next = tr.nextElementSibling || mopAddRow(id, false);
      next.querySelector(`[data-key="${key}"]`).focus();
    } else if(e.key === 'Enter' && e.altKey){
      e.preventDefault();
      const p = ta.selectionStart;
      ta.setRangeText('\n', p, ta.selectionEnd, 'end'); mopGrow(ta);
    } else if(e.key === 'Tab' && !e.shiftKey && key === MOP_COLS[MOP_COLS.length-1].key && !tr.nextElementSibling){
      e.preventDefault();
      mopAddRow(id);
    }
  });

  box.addEventListener('paste', e => {
    const ta = e.target; if(!ta.matches('textarea.mop-cell')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if(_mopPasteText(id, ta, text)) e.preventDefault();
  });
}

// 엑셀/표 형태(탭 구분) 텍스트를 현재 칸부터 여러 행/열로 채운다. 처리했으면 true.
function _mopPasteText(id, ta, text){
  const colIdx = MOP_COLS.findIndex(c => c.key === ta.dataset.key);
  const single = !MOP_COLS[colIdx].multi;
  if(!text || (!text.includes('\t') && !(single && text.includes('\n')))) return false;  // 일반 붙여넣기
  let data = _parseTSV(text);
  // 엑셀 계획서에서 No. 열까지 복사한 경우 첫 열 제거
  if(colIdx === 0 && data.every(r => r.length > MOP_COLS.length && /^\d*$/.test(r[0].trim()))) data = data.map(r => r.slice(1));
  let tr = ta.closest('tr');
  data.forEach((vals, ri) => {
    if(ri > 0) tr = tr.nextElementSibling || _mopNewRow(id);
    vals.forEach((v, ci) => {
      const c = MOP_COLS[colIdx + ci]; if(!c) return;
      const cell = tr.querySelector(`[data-key="${c.key}"]`);
      cell.value = v.trim(); mopGrow(cell);
    });
  });
  _mopRenumber(id);
  return true;
}

function mopSet(id, content){
  _mopInit(id);
  _mopBody(id).innerHTML = '';
  const rows = mopParse(content);
  (rows.length ? rows : [{}, {}, {}]).forEach(r => _mopNewRow(id, r));
  _mopRenumber(id);
}

function mopGet(id){
  const rows = [..._mopBody(id).querySelectorAll('tr')].map(tr =>
    Object.fromEntries(MOP_COLS.map(c => [c.key, tr.querySelector(`[data-key="${c.key}"]`).value.trim()])))
    .filter(r => MOP_COLS.some(c => r[c.key]));
  return rows.length ? JSON.stringify(rows) : '';
}

// ── WORK PLANS ──────────────────────────────
// _allWorkPlans  : 기술지원 (scope=support, id "wp-*")
// _schedWorkPlans: 점검일정 모달의 작업자/결재자/MOP 보관 레코드 (scope=schedule, id = 일정 id) — 기술지원 실적 제외
let _allWorkPlans = [];
let _schedWorkPlans = [], _schedWpLoaded = false;
const isSupportPlan = p => String(p.id || '').startsWith('wp-') || !!p.from_schedule;   // from_schedule: 점검 일정에 지원 구분을 함께 체크한 건
async function loadSchedWorkPlans(force = false){
  if(_schedWpLoaded && !force) return;
  try {
    _schedWorkPlans = (await api.get(`/api/engineers/${ENG_ID}/workplans?scope=schedule`)).filter(p => !isSupportPlan(p));
    _schedWpLoaded = true;
  } catch(e){}
}
let _wpPage = 1;
const WP_PAGE_SIZE = 10;
const WP_ST_CLS = {'예정':'b-gray', '완료':'b-green'};
const WP_STATUSES = ['예정', '완료'];
const WP_ACTIVE = ['예정'];

function _ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function _wpDates(){
  const now = new Date();
  // 이번 주 = 오늘 ~ 이번 주 일요일 (weekEnd 는 다음 주 월요일, 미포함)
  const toMon = (8 - now.getDay()) % 7 || 7;
  return { today: _ymd(now), weekEnd: _ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMon)) };
}
const _wpDay = p => (p.work_date || '').slice(0, 10);
const _wpIsOverdue = (p, today) => p.status !== '완료' && !!_wpDay(p) && _wpDay(p) < today;
const _wpIsThisWeek = (p, today, weekEnd) => p.status !== '완료' && _wpDay(p) >= today && _wpDay(p) < weekEnd;

function _wpImpactBadge(impact){
  const v = (impact || '').trim();
  if(!v || v === '없음') return '';
  const lv = v.split(' ')[0];
  const cls = {'낮음':'b-gray', '중간':'b-amber', '높음':'b-red'}[lv] || 'b-gray';
  return `<span class="badge ${cls}" title="${esc(v)}">영향도 ${esc(lv)}</span>`;
}

let _wpAllPeriod = false;
function _wpSyncMonthUI(){
  $('wp-all-period').classList.toggle('btn-primary', _wpAllPeriod);
  $('wp-month').style.opacity = _wpAllPeriod ? '.45' : '';
}
function wpMoveMonth(delta){
  if(delta === 0 || !$('wp-month').value){ $('wp-month').value = _ym(new Date()); }
  else {
    const [y, m] = $('wp-month').value.split('-').map(Number);
    $('wp-month').value = _ym(new Date(y, m - 1 + delta, 1));
  }
  _wpAllPeriod = false; _wpSyncMonthUI(); drawWorkPlans(1);
}
function wpToggleAllPeriod(on = !_wpAllPeriod){
  _wpAllPeriod = on; _wpSyncMonthUI(); drawWorkPlans(1);
}

async function renderWorkPlans() {
  const el = $('wp-list');
  if(!$('wp-month').value){ $('wp-month').value = _ym(new Date()); _wpSyncMonthUI(); }
  try {
    _allWorkPlans = (await api.get(`/api/engineers/${ENG_ID}/workplans`)).filter(isSupportPlan);
  } catch (e) {
    console.error("Failed to load work plans:", e);
    el.innerHTML = '<div class="empty" style="color:#dc2626; line-height:1.6;">기술지원 목록을 불러오는 중 오류가 발생했습니다.<br>백엔드 서버가 재시작되었는지 확인해주세요.</div>';
    $('wp-summary').innerHTML = ''; $('wp-page').innerHTML = '';
    return;
  }
  _renderWpSummary();
  drawWorkPlans(_wpPage);
}

function _renderWpSummary(){
  const { today, weekEnd } = _wpDates();
  const plans = _allWorkPlans;
  const cnt = st => plans.filter(p => p.status === st).length;
  const active = plans.filter(p => WP_ACTIVE.includes(p.status)).length;
  const week = plans.filter(p => _wpIsThisWeek(p, today, weekEnd)).length;
  const overdue = plans.filter(p => _wpIsOverdue(p, today)).length;
  const card = (view, label, value, sub, color) => `
    <div class="metric" style="cursor:pointer" title="목록 필터: ${label}" onclick="wpSetView('${view}')">
      <div class="metric-label">${label}</div>
      <div class="metric-value" style="${color ? `color:${color}` : ''}">${value}건</div>
      ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${sub}</div>` : ''}</div>`;
  $('wp-summary').innerHTML =
    card('active', '예정', active, '아직 완료하지 않은 건') +
    card('완료', '완료', cnt('완료'), '완료 처리한 건') +
    card('week', '이번 주 예정', week, '오늘 ~ 이번 주 일요일 (미완료)', '') +
    card('overdue', '일정 경과', overdue, '작업일이 지났지만 미완료', overdue ? '#dc2626' : '');
}

function wpSetView(view){
  $('wp-view').value = view;
  if(view === 'week' || view === 'overdue') wpToggleAllPeriod(true);   // 월과 무관한 조건
  else drawWorkPlans(1);
}

function drawWorkPlans(page = 1) {
  const el = $('wp-list');
  const { today, weekEnd } = _wpDates();
  const q = $('wp-search').value.toLowerCase().trim();
  const view = $('wp-view').value;
  const ym = _wpAllPeriod ? '' : $('wp-month').value;

  let list = _allWorkPlans.filter(p => {
    if(q && ![p.title, p.site, p.worker, p.reviewer].some(v => (v || '').toLowerCase().includes(q))) return false;
    if(ym && !(p.work_date || '').startsWith(ym)) return false;
    if(view === 'active') return WP_ACTIVE.includes(p.status);
    if(view === 'week') return _wpIsThisWeek(p, today, weekEnd);
    if(view === 'overdue') return _wpIsOverdue(p, today);
    if(view) return p.status === view;
    return true;
  });

  // 진행할 건은 가까운 일정 순(날짜 없음은 맨 뒤), 완료/전체는 최신 순
  const asc = view && view !== '완료';
  list.sort((a, b) => {
    const da = a.work_date || '', db = b.work_date || '';
    if(asc){ if(!da) return 1; if(!db) return -1; return da.localeCompare(db); }
    return db.localeCompare(da);
  });

  const totalPages = Math.max(1, Math.ceil(list.length / WP_PAGE_SIZE));
  _wpPage = Math.min(Math.max(1, page), totalPages);
  renderPagination('wp-page', list.length, _wpPage, 'drawWorkPlans', WP_PAGE_SIZE);

  if(!list.length) {
    el.innerHTML = `<div class="empty">${_allWorkPlans.length ? '조건에 맞는 기술지원이 없습니다' : '등록된 기술지원이 없습니다'}</div>`;
    return;
  }
  const rows = list.slice((_wpPage - 1) * WP_PAGE_SIZE, _wpPage * WP_PAGE_SIZE);
  el.innerHTML = rows.map(p => {
    const overdue = _wpIsOverdue(p, today);
    return `
    <div class="svc-row wp-row" onclick="openEditWorkPlan('${p.id}')">
      <div style="flex:1;min-width:0">
        <div style="margin-bottom:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select class="wp-st-sel badge ${WP_ST_CLS[p.status]||'b-gray'}" title="상태 변경"
            onclick="event.stopPropagation()" onchange="changeWorkPlanStatus('${p.id}', this.value)">
            ${WP_STATUSES.map(st => `<option ${st===p.status?'selected':''}>${st}</option>`).join('')}
          </select>
          ${p.from_schedule ? '<span class="badge b-blue" title="점검 일정에 함께 등록된 건">점검</span>' : ''}
          ${(p.support_type || '').split(',').filter(t => t && (t !== '기술지원' || p.from_schedule || p.support_type.includes(','))).map(t => `<span class="badge b-purple">${esc(t)}</span>`).join('')}
          ${_wpImpactBadge(p.impact)}
          ${overdue ? '<span class="badge b-red">일정 경과</span>' : ''}
          <span style="font-size:12px;color:${overdue ? '#dc2626' : '#888'}">${esc(fmtDT(p.work_date))}</span>
        </div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(p.title)}</div>
        <div style="font-size:12px;color:#666">사이트: <b>${esc(p.site||'-')}</b> | 작업자: ${esc(p.worker||'-')} | 결재/공유: ${esc(p.reviewer||'-')}</div>
        ${p.purpose ? `<div class="svc-sub">내용: ${esc(p.purpose)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:flex-start" onclick="event.stopPropagation()">
        ${p.has_plan ? `<button class="btn btn-sm" title="작업계획서 엑셀 다운로드" onclick="downloadWorkPlanExcel('${p.id}')">Excel</button>` : ''}
        <button class="icon-btn edit" title="수정" onclick="openEditWorkPlan('${p.id}')">${ICO_EDIT}</button>
        ${p.from_schedule ? '' : `<button class="icon-btn del" title="삭제" onclick="deleteWorkPlan('${p.id}')">${ICO_DEL}</button>`}
      </div>
    </div>`;
  }).join('');
}
async function changeWorkPlanStatus(id, status){
  const p = _allWorkPlans.find(x => x.id === id);
  if(!p) return;
  const prev = p.status;
  try {
    // 점검 일정에 함께 등록된 건은 점검 일정의 상태를 바꾼다
    const r = await fetch(`/api/engineers/${ENG_ID}/${p.from_schedule ? 'schedules' : 'workplans'}/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    p.status = status;
    toast(`상태 변경: ${prev} → ${status}`);
  } catch(e) {
    console.error('기술지원 상태 변경 실패:', e);
    toast('상태 변경 실패: 서버 오류가 발생했습니다.');
  }
  _renderWpSummary();
  drawWorkPlans(_wpPage);   // 필터에서 빠지는 경우 목록에서 사라짐
  _refreshSvcHistory();
}
$('wp-search').addEventListener('input', () => { clearTimeout(window._wpT); window._wpT = setTimeout(() => drawWorkPlans(1), 200); });
$('wp-view').addEventListener('change', () => drawWorkPlans(1));
$('wp-month').addEventListener('change', () => {
  if(!$('wp-month').value) $('wp-month').value = _ym(new Date());
  _wpAllPeriod = false; _wpSyncMonthUI(); drawWorkPlans(1);
});

// ── 일정 공통 입력 창 (점검 · 기술지원) ─────────
// 구분 체크박스에 '점검'이 있으면 점검 일정으로, 없으면 기술지원으로 저장된다 (routers/entries.py)
const ENTRY_PLAN_IDS = ['wp-prerequisites', 'wp-verification', 'wp-rollback'];
let _entrySiteName = '';     // 사이트로 등록되지 않은 고객사 이름(기술지원)
function _entryTypes(){ return [...document.querySelectorAll('#wp-types input:checked')].map(c => c.value); }
function entryTypesChanged(){
  const isCheck = _entryTypes().includes('점검');
  $('wp-sched-type-row').style.visibility = isCheck ? 'visible' : 'hidden';
  $('wp-site-req').style.display = isCheck ? '' : 'none';
}
function openAddWorkPlan(){ return openEntry(null, ['기술지원']); }
function openEditWorkPlan(p){ return openEntry(typeof p === 'string' ? p : p && p.id); }

async function openEntry(id, types = ['기술지원']){
  let e = { id:'', types, title:'', day:_ymd(new Date()), time:'', site_id:'', site_name:'', sched_type:'월간', status:'예정',
            memo:'', worker:'', reviewer:'', impact:'', prerequisites:'', mop_content:'', verification:'', rollback_plan:'', has_plan:false };
  let sites = [];
  try {
    sites = await api.get(`/api/engineers/${ENG_ID}/sites`);
    if(id) e = await _apiSend('GET', `/api/engineers/${ENG_ID}/entries/${id}`);
  } catch(err) { toast(id ? '일정을 찾을 수 없습니다' : '사이트 목록을 불러오지 못했습니다'); if(id) return; }

  $('wp-modal-title').textContent = id ? '일정 수정' : '일정 등록';
  $('wp-id').value = e.id || '';
  document.querySelectorAll('#wp-types input').forEach(c => c.checked = e.types.includes(c.value));
  _entrySiteName = e.site_id ? '' : (e.site_name || '');
  $('wp-site').innerHTML = '<option value="">— 선택 —</option>'
    + (_entrySiteName ? `<option value="" selected>${esc(_entrySiteName)} (사이트 미등록)</option>` : '')
    + sites.map(x => `<option value="${esc(x.id)}" ${x.id === e.site_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  $('wp-title').value = e.title;
  $('wp-day').value = e.day; $('wp-time').value = e.time || '';
  $('wp-status').value = e.status; $('wp-sched-type').value = e.sched_type || '월간';
  $('wp-worker').value = e.worker || ''; $('wp-reviewer').value = e.reviewer || '';
  $('wp-purpose').value = e.memo || '';
  $('wp-impact').value = e.impact || '없음';
  if($('wp-impact').selectedIndex < 0) $('wp-impact').value = '없음';
  $('wp-prerequisites').value = e.prerequisites || '';
  mopSet('wp-mop', e.mop_content || '');
  $('wp-verification').value = e.verification || '';
  $('wp-rollback').value = e.rollback_plan || '';
  // 세부 작업계획은 내용이 있을 때만 펼쳐서 보여 준다
  $('wp-plan').open = !!(e.prerequisites || e.mop_content || e.verification || e.rollback_plan || (e.impact && e.impact !== '없음'));
  $('wp-excel').style.display = id && e.has_plan ? '' : 'none';
  entryTypesChanged();
  openModal('modal-add-workplan');
}

function _entryPayload(){
  const sel = $('wp-site');
  return {
    types: _entryTypes(), title: $('wp-title').value.trim(), day: $('wp-day').value, time: $('wp-time').value,
    site_id: sel.value, site_name: sel.value ? '' : (sel.selectedIndex > 0 && _entrySiteName ? _entrySiteName : ''),
    sched_type: $('wp-sched-type').value, status: $('wp-status').value, memo: $('wp-purpose').value,
    worker: $('wp-worker').value.trim(), reviewer: $('wp-reviewer').value.trim(),
    impact: $('wp-impact').value, prerequisites: $('wp-prerequisites').value, mop_content: mopGet('wp-mop'),
    verification: $('wp-verification').value, rollback_plan: $('wp-rollback').value,
  };
}

// 저장하고 {id, kind} 를 돌려준다. 실패하면 null (입력 내용은 그대로 둠)
async function _entrySave(){
  const body = _entryPayload();
  if(!body.types.length){ toast('구분을 하나 이상 골라주세요'); return null; }
  if(!body.title){ toast('제목을 입력해주세요'); return null; }
  if(!body.day){ toast('날짜를 입력해주세요'); return null; }
  if(body.types.includes('점검') && !body.site_id){ toast('점검은 사이트를 골라주세요'); return null; }
  const id = $('wp-id').value;
  try {
    return await _apiSend(id ? 'PUT' : 'POST', `/api/engineers/${ENG_ID}/entries${id ? '/' + id : ''}`, body);
  } catch(e) { toast('저장 실패: ' + e.message); return null; }
}

async function _entryRefresh(){
  await loadSchedWorkPlans(true);
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
  if($('page-sched-history').classList.contains('active')) renderSchedHistory();
  if($('page-work-plan').classList.contains('active')) renderWorkPlans();
  _refreshSvcHistory();
}

async function saveEntry(){
  const wasNew = !$('wp-id').value;
  const btn = $('wp-save'); btn.disabled = true;
  const r = await _entrySave();
  btn.disabled = false;
  if(!r) return;
  closeModal('modal-add-workplan');
  await _entryRefresh();
  toast(`${r.kind === 'schedule' ? '점검 일정' : '기술지원'} ${wasNew ? '등록됨' : '수정됨'}`);
}

// 창에 적힌 내용을 먼저 저장한 뒤 작업계획서 엑셀을 내려받는다
async function downloadEntryExcel(){
  const r = await _entrySave();
  if(!r) return;
  $('wp-id').value = r.id;
  _entryRefresh();
  window.location.href = `/api/engineers/${ENG_ID}/workplans/${r.id}/download`;
}

async function deleteWorkPlan(id) {
  if(!confirm('해당 기술지원을 삭제하시겠습니까?')) return;
  await api.del(`/api/engineers/${ENG_ID}/workplans/${id}`);
  renderWorkPlans(); _refreshSvcHistory(); toast('삭제됨');
}

function downloadWorkPlanExcel(id) {
  // 백엔드 다운로드 엔드포인트로 리디렉션
  window.location.href = `/api/engineers/${ENG_ID}/workplans/${id}/download`;
}

// ── 서비스 지원 공통 ─────────────────────────
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDT(v){ return v ? String(v).replace('T', ' ') : '-'; }
function fmtDuration(min){
  if(min === null || min === undefined) return '';
  const d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  return [d ? `${d}일` : '', h ? `${h}시간` : '', (m || (!d && !h)) ? `${m}분` : ''].filter(Boolean).join(' ');
}
function _svcMetric(d){
  const a = d.monthly_support_count ?? 0, b = d.monthly_incident_count ?? 0;
  return `<div class="metric m-violet" style="cursor:pointer" title="월별 기술지원 및 장애처리 이력으로 이동"
      onclick="document.querySelector('.nav-item[data-page=\\'service-history\\']').click()">
    <div class="dm-text"><div class="metric-label">이번 달 기술지원 · 장애</div>
      <div class="dm-sub">기술지원 ${a} · 장애처리 ${b}</div></div>
    <div class="metric-value">${a + b}<small>건</small></div></div>`;
}
function _refreshSvcHistory(){
  if($('page-service-history').classList.contains('active')) renderServiceHistory();
  _refreshDash();
}

// ── 장애처리 ─────────────────────────────────
const INC_SEV_CLS = {'긴급':'b-red', '높음':'b-amber', '보통':'b-blue', '낮음':'b-gray'};
const INC_ST_CLS  = {'접수':'b-purple', '처리중':'b-amber', '완료':'b-green'};
let _allIncidents = [];

async function renderIncidents(){
  const el = $('inc-list');
  const q = $('inc-search').value.trim(), st = $('inc-status-filter').value;
  const params = new URLSearchParams();
  if(q) params.set('q', q);
  if(st) params.set('status', st);
  let list;
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/incidents?${params}`);
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    list = await r.json();
  } catch(e) {
    console.error('장애 목록 조회 실패:', e);
    el.innerHTML = '<div class="empty" style="color:#dc2626">장애 목록을 불러오지 못했습니다.</div>';
    return;
  }
  _allIncidents = list;
  if(!list.length){ el.innerHTML = '<div class="empty">등록된 장애가 없습니다</div>'; return; }
  el.innerHTML = list.map(i => `
    <div class="svc-row">
      <div style="flex:1;min-width:0;cursor:pointer" onclick="openEditIncident('${i.id}')">
        <div style="margin-bottom:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>
          <span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>
          <span style="font-size:12px;color:#888">발생 ${esc(fmtDT(i.occurred_at))}${i.recovered_at ? ` → 복구 ${esc(fmtDT(i.recovered_at))}` : ''}</span>
          ${i.downtime_min !== null ? `<span style="font-size:12px;color:#dc2626;font-weight:600">장애 ${fmtDuration(i.downtime_min)}</span>` : ''}
        </div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(i.title)}</div>
        <div style="font-size:12px;color:#666">사이트: <b>${esc(i.site||'-')}</b> | 장비: ${esc(i.device||'-')} | 처리자: ${esc(i.worker||'-')}</div>
        ${i.cause ? `<div class="svc-sub">원인: ${esc(i.cause)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:flex-start">
        <button class="icon-btn edit" title="수정" onclick="openEditIncident('${i.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteIncident('${i.id}')">${ICO_DEL}</button>
      </div>
    </div>`).join('');
}
$('inc-search').addEventListener('input', () => { clearTimeout(window._incT); window._incT = setTimeout(renderIncidents, 250); });
$('inc-status-filter').addEventListener('change', renderIncidents);

async function _fillIncSiteSel(selected=''){
  try {
    const sites = await api.get(`/api/engineers/${ENG_ID}/sites`);
    const names = sites.map(s => s.name);
    if(selected && !names.includes(selected)) names.unshift(selected);   // 삭제된 사이트명도 보존
    $('inc-site').innerHTML = '<option value="">-</option>' + names.map(n => `<option ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
  } catch(e) {
    $('inc-site').innerHTML = '<option value="">사이트 로딩 실패</option>';
  }
}

function _nowLocal(){
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

async function openAddIncident(){
  $('inc-modal-title').textContent = '장애 등록';
  $('inc-id').value = '';
  ['inc-title','inc-device','inc-recovered','inc-worker','inc-symptom','inc-cause','inc-action','inc-prevention'].forEach(id => $(id).value = '');
  $('inc-occurred').value = _nowLocal();
  $('inc-severity').value = '보통';
  $('inc-status').value = '접수';
  $('inc-worker').value = ENG_NAME || '';
  await _fillIncSiteSel();
  openModal('modal-add-incident');
}

async function openEditIncident(id){
  let i = _allIncidents.find(x => x.id === id);
  if(!i){
    try { _allIncidents = await api.get(`/api/engineers/${ENG_ID}/incidents`); } catch(e) {}
    i = _allIncidents.find(x => x.id === id);
  }
  if(!i){ toast('장애 기록을 찾을 수 없습니다'); return; }
  $('inc-modal-title').textContent = '장애 수정';
  $('inc-id').value = i.id;
  $('inc-title').value = i.title || '';
  $('inc-device').value = i.device || '';
  $('inc-occurred').value = i.occurred_at || '';
  $('inc-recovered').value = i.recovered_at || '';
  $('inc-severity').value = i.severity || '보통';
  $('inc-status').value = i.status || '접수';
  $('inc-worker').value = i.worker || '';
  $('inc-symptom').value = i.symptom || '';
  $('inc-cause').value = i.cause || '';
  $('inc-action').value = i.action || '';
  $('inc-prevention').value = i.prevention || '';
  await _fillIncSiteSel(i.site || '');
  openModal('modal-add-incident');
}

async function saveIncident(){
  const title = $('inc-title').value.trim();
  const occurred = $('inc-occurred').value;
  if(!title){ toast('장애명을 입력해주세요'); return; }
  if(!occurred){ toast('발생 일시를 입력해주세요'); return; }
  const recovered = $('inc-recovered').value;
  if(recovered && recovered < occurred){ toast('복구 일시가 발생 일시보다 빠릅니다'); return; }
  let status = $('inc-status').value;
  if(recovered && status === '접수') status = '처리중';
  const payload = {
    title, site: $('inc-site').value, device: $('inc-device').value.trim(),
    severity: $('inc-severity').value, status,
    occurred_at: occurred, recovered_at: recovered, worker: $('inc-worker').value.trim(),
    symptom: $('inc-symptom').value, cause: $('inc-cause').value,
    action: $('inc-action').value, prevention: $('inc-prevention').value,
  };
  const id = $('inc-id').value;
  const url = id ? `/api/engineers/${ENG_ID}/incidents/${id}` : `/api/engineers/${ENG_ID}/incidents`;
  try {
    const r = await fetch(url, {method: id ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    console.error('장애 저장 실패:', e);
    toast('저장 실패: 서버 오류가 발생했습니다. 입력 내용은 유지됩니다.');
    return;
  }
  closeModal('modal-add-incident');
  if($('page-incidents').classList.contains('active')) renderIncidents();
  _refreshSvcHistory();
  toast(id ? '장애 수정됨' : '장애 등록됨');
}

async function deleteIncident(id){
  if(!confirm('해당 장애 기록을 삭제하시겠습니까?')) return;
  await api.del(`/api/engineers/${ENG_ID}/incidents/${id}`);
  renderIncidents(); _refreshSvcHistory(); toast('삭제됨');
}

// ── 월별 기술지원 및 장애처리 이력 ─────────────
let _svhTab = 'all';

function _ym(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function svhMove(delta){
  if(delta === 0){ $('svh-month').value = _ym(new Date()); }
  else {
    const [y, m] = ($('svh-month').value || _ym(new Date())).split('-').map(Number);
    $('svh-month').value = _ym(new Date(y, m - 1 + delta, 1));
  }
  renderServiceHistory();
}
$('svh-month').addEventListener('change', renderServiceHistory);
// 월별 이력의 탭만 대상으로 한다 (.svh-tab 모양은 대시보드·체크리스트 등 다른 화면의 탭도 같이 쓴다)
document.querySelectorAll('.svh-tab[data-svh]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.svh-tab[data-svh]').forEach(x => x.classList.toggle('active', x === t));
  _svhTab = t.dataset.svh;
  renderServiceHistory();
}));

async function renderServiceHistory(){
  if(!$('svh-month').value) $('svh-month').value = _ym(new Date());
  const ym = $('svh-month').value;
  const el = $('svh-list');
  let plans, incs, sites, scheds;
  try {
    [plans, incs, sites, scheds] = await Promise.all([
      api.get(`/api/engineers/${ENG_ID}/workplans`),
      api.get(`/api/engineers/${ENG_ID}/incidents`),
      api.get(`/api/engineers/${ENG_ID}/sites`).catch(() => []),
      api.get(`/api/engineers/${ENG_ID}/schedules/all?year=${ym.slice(0, 4)}`).catch(() => []),
    ]);
  } catch(e) {
    console.error('월별 이력 조회 실패:', e);
    el.innerHTML = '<div class="empty" style="color:#dc2626">이력을 불러오지 못했습니다.</div>';
    return;
  }
  plans = plans.filter(isSupportPlan);
  _allWorkPlans = plans;
  _allIncidents = incs;
  renderSvhSiteStats(plans, incs, Array.isArray(scheds) ? scheds : [], ym, (sites || []).map(x => (x.name || '').trim()).filter(Boolean));
  incs = incs.filter(i => (i.occurred_at || '').startsWith(ym));
  const sup = plans.filter(p => (p.work_date || '').startsWith(ym));

  const downMin = incs.reduce((a, i) => a + (i.downtime_min || 0), 0);
  const openInc = incs.filter(i => i.status !== '완료').length;
  const supDone = sup.filter(p => p.status === '완료').length;
  $('svh-summary').innerHTML = `
    <div class="metric"><div class="metric-label">기술지원</div><div class="metric-value">${sup.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">완료 ${supDone}건</div></div>
    <div class="metric"><div class="metric-label">장애처리</div><div class="metric-value">${incs.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">긴급·높음 ${incs.filter(i => i.severity==='긴급'||i.severity==='높음').length}건</div></div>
    <div class="metric"><div class="metric-label">미완료 장애</div><div class="metric-value" style="${openInc?'color:#dc2626':''}">${openInc}건</div></div>
    <div class="metric"><div class="metric-label">누적 장애 시간</div><div class="metric-value" style="font-size:20px">${downMin ? fmtDuration(downMin) : '-'}</div></div>`;

  const [ty, tm] = ym.split('-');
  $('svh-list-title').textContent = `${ty}년 ${Number(tm)}월 ${{all:'기술지원 / 장애처리', support:'기술지원', incident:'장애처리'}[_svhTab]} 이력`;

  const rows = [];
  if(_svhTab !== 'incident') sup.forEach(p => rows.push({
    kind:'support', date:p.work_date, site:p.site, title:p.title, worker:p.worker,
    status:p.status, stCls:WP_ST_CLS[p.status]||'b-gray',
    extra:'', open:`openEditWorkPlan('${p.id}')`,
  }));
  if(_svhTab !== 'support') incs.forEach(i => rows.push({
    kind:'incident', date:i.occurred_at, site:i.site, title:i.title, worker:i.worker,
    status:i.status, stCls:INC_ST_CLS[i.status]||'b-gray',
    extra:`<span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>${i.downtime_min!==null?` <span style="font-size:11px;color:#dc2626">${fmtDuration(i.downtime_min)}</span>`:''}`,
    open:`openEditIncident('${i.id}')`,
  }));
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if(!rows.length){ el.innerHTML = `<div class="empty">${ym} 이력이 없습니다</div>`; return; }
  el.innerHTML = `<div class="svh-table-wrap"><table class="svh-table">
    <thead><tr><th style="width:84px">구분</th><th style="width:130px">일시</th><th style="width:150px">사이트</th><th>제목</th><th style="width:110px">처리자</th><th style="width:170px">상태</th></tr></thead>
    <tbody>${rows.map(r => `<tr onclick="${r.open}">
      <td><span class="badge ${r.kind==='support'?'b-blue':'b-red'}">${r.kind==='support'?'기술지원':'장애처리'}</span></td>
      <td style="color:#666">${esc(fmtDT(r.date))}</td>
      <td>${esc(r.site||'-')}</td>
      <td style="font-weight:600">${esc(r.title)}</td>
      <td>${esc(r.worker||'-')}</td>
      <td><span class="badge ${r.stCls}">${esc(r.status)}</span> ${r.extra}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// 사이트별 월별/연간 점검·기술지원·장애처리 투입 횟수 (선택 월의 연도 기준, "점검 / 기술지원 / 장애처리" 형식)
// 점검 = 완료된 점검일정(Schedule) 건수, 기술지원 = WorkPlan(wp-*), 장애처리 = Incident
function renderSvhSiteStats(plans, incs, scheds, ym, siteNames){
  const year = ym.slice(0, 4);
  const selM = Number(ym.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const showChk = _svhTab === 'all', showSup = _svhTab !== 'incident', showInc = _svhTab !== 'support';
  const blank = () => ({ chk: Array(13).fill(0), sup: Array(13).fill(0), inc: Array(13).fill(0) });

  // { site: { chk:[연간,1월..12월], sup:[...], inc:[...] } }
  const by = {};
  const tot = blank();
  const add = (list, dateKey, kind, siteKey = 'site') => list.forEach(x => {
    const d = x[dateKey] || '';
    if(d.slice(0, 4) !== year) return;
    const m = Number(d.slice(5, 7));
    if(!(m >= 1 && m <= 12)) return;
    const site = (x[siteKey] || '').trim() || '(미지정)';
    const r = by[site] || (by[site] = blank());
    r[kind][m]++; r[kind][0]++; tot[kind][m]++; tot[kind][0]++;
  });
  add(plans, 'work_date', 'sup');
  add(incs, 'occurred_at', 'inc');
  add(scheds.filter(x => x.status === '완료'), 'sched_date', 'chk', 'site_name');   // 점검은 완료 건만

  // 등록된 사이트 순서 + 등록되지 않은(직접 입력) 사이트
  const sites = [...siteNames];
  Object.keys(by).sort((a, b) => a.localeCompare(b, 'ko')).forEach(n => { if(!sites.includes(n)) sites.push(n); });

  const n = (v, cls) => v ? `<b class="svh-cnt ${cls}">${v}</b>` : '<span class="svh-zero">0</span>';
  const cell = (r, i) => [showChk ? n(r.chk[i], 'chk') : null, showSup ? n(r.sup[i], 'sup') : null, showInc ? n(r.inc[i], 'inc') : null]
    .filter(Boolean).join('<span class="svh-slash"> / </span>');
  const sel = m => m === selM ? ' svh-sel' : '';
  const legend = [showChk ? '<b class="svh-cnt chk">점검</b>' : null, showSup ? '<b class="svh-cnt sup">기술지원</b>' : null, showInc ? '<b class="svh-cnt inc">장애처리</b>' : null]
    .filter(Boolean).join('<span class="svh-slash"> / </span>');
  const empty = blank();

  $('svh-site-stats').innerHTML = `<div class="card">
    <div class="svh-stat-head">
      <div class="card-title" style="margin:0">${year}년 사이트 월별/연간 투입 횟수</div>
      <div style="font-size:12px;color:#64748b">표시: ${legend} &nbsp;|&nbsp; ${year}년 합계 ${cell(tot, 0)}</div>
    </div>
    <div class="svh-table-wrap"><table class="svh-table svh-stat">
      <thead><tr><th class="svh-site">사이트</th>${months.map(m =>
        `<th class="svh-m${sel(m)}" title="${m}월 이력 보기" onclick="svhGoMonth(${year},${m})">${m}월</th>`).join('')}<th class="svh-year">연간</th></tr></thead>
      <tbody>${sites.map(site => { const r = by[site] || empty; return `<tr>
        <td class="svh-site" title="${esc(site)}">${esc(site)}</td>
        ${months.map(m => `<td class="${sel(m)}">${cell(r, m)}</td>`).join('')}
        <td class="svh-year">${cell(r, 0)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td class="svh-site">합계</td>
        ${months.map(m => `<td class="${sel(m)}">${cell(tot, m)}</td>`).join('')}
        <td class="svh-year">${cell(tot, 0)}</td></tr></tfoot>
    </table></div></div>`;
}

function svhGoMonth(y, m){
  $('svh-month').value = `${y}-${String(m).padStart(2,'0')}`;
  renderServiceHistory();
}

// ── 주간보고서 ─────────────────────────────
let _wrStart = '', _wrData = null;
function _wrMonday(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function wrMove(delta){
  if(delta === 0 || !_wrStart) _wrStart = _ymd(_wrMonday(new Date()));
  else { const [y,m,d] = _wrStart.split('-').map(Number); _wrStart = _ymd(new Date(y, m-1, d + 7*delta)); }
  renderWeeklyReport();
}
// 비고는 직접 입력: 주(시작일)별로 이 브라우저에 기억해 둔다
function _wrRemarkStore(){ try { return JSON.parse(localStorage.getItem('wrRemarks') || '{}'); } catch(e){ return {}; } }
function _wrRemark(r){ const m = _wrRemarkStore()[_wrStart] || {}; return r.key in m ? m[r.key] : (r.remark || ''); }
function wrSaveRemark(el){
  const all = _wrRemarkStore(); (all[_wrStart] = all[_wrStart] || {})[el.dataset.key] = el.value;
  const keep = Object.keys(all).sort().slice(-12); const out = {}; keep.forEach(k => out[k] = all[k]);   // 최근 12주만 보관
  try { localStorage.setItem('wrRemarks', JSON.stringify(out)); } catch(e){}
}
// 특이사항·확정사항도 고쳐 쓰면 주별로 기억 (자동 내용과 같아지면 지움)
function _wrTextStore(){ try { return JSON.parse(localStorage.getItem('wrTexts') || '{}'); } catch(e){ return {}; } }
function _wrText(which){ const m = _wrTextStore()[_wrStart] || {}; return which in m ? m[which] : null; }
function wrSaveText(which){
  const el = $('wr-' + which), all = _wrTextStore(), cur = all[_wrStart] = all[_wrStart] || {};
  if(_wrData && el.value === _wrData[which]) delete cur[which]; else cur[which] = el.value;
  if(!Object.keys(cur).length) delete all[_wrStart];
  const out = {}; Object.keys(all).sort().slice(-12).forEach(k => out[k] = all[k]);
  try { localStorage.setItem('wrTexts', JSON.stringify(out)); } catch(e){}
  $(`wr-${which}-ed`).classList.toggle('on', which in cur);
}
function wrGrow(el){ el.style.height = 'auto'; el.style.height = Math.max(34, el.scrollHeight + 2) + 'px'; }
async function renderWeeklyReport(){
  if(!_wrStart) _wrStart = _ymd(_wrMonday(new Date()));
  const el = $('wr-rows');
  let d;
  try { d = await _apiSend('GET', `/api/engineers/${ENG_ID}/reports/weekly?start=${_wrStart}`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  _wrData = d;
  const fmt = x => `${Number(x.slice(5,7))}/${Number(x.slice(8,10))}`;
  const thisWeek = d.start === _ymd(_wrMonday(new Date()));
  $('wr-range').innerHTML = `${d.start.slice(0,4)}년 ${fmt(d.start)} (월) ~ ${fmt(d.end)} (일)${thisWeek ? ' <span class="wr-now">이번 주</span>' : ''}`;
  $('wr-today').disabled = thisWeek;
  ['notes', 'confirmed'].forEach(w => {
    const saved = _wrText(w);
    $('wr-' + w).value = saved === null ? d[w] : saved;
    $(`wr-${w}-ed`).classList.toggle('on', saved !== null);
  });
  $('wr-download').disabled = !d.template_ok;
  $('wr-download').title = d.template_ok ? '' : '양식 파일(data/report_templates/weekly_report.xlsx)이 없습니다';

  const t = d.totals, COLS = [['F','정기점검'],['G','장애지원'],['H','기술지원'],['I','납품'],['J','원격'],['K','이전'],['L','기타']];
  $('wr-summary').innerHTML = COLS.map(([c, name]) =>
      `<div class="wr-sum-i${t[c] ? '' : ' zero'}${c === 'G' && t[c] ? ' red' : ''}"><span>${name}</span><b>${t[c]}</b></div>`).join('')
    + `<div class="wr-sum-i total"><span>합계</span><b>${d.total}건</b></div>`;
  $('wr-rows-sub').textContent = d.rows.length ? `${d.rows.length}줄${d.rows.length > 9 ? ' · 양식 9줄을 넘는 만큼 엑셀에 행이 추가됩니다' : ''}` : '';

  const pend = d.pending || [];
  $('wr-pending').innerHTML = !pend.length ? '' : `<div class="wr-pend">
    <div class="wr-pend-head">아직 '완료'가 아니라 보고서에서 빠진 일정 ${pend.length}건</div>
    <table><tbody>${pend.map(x => `<tr>
      <td class="k">${esc(x.kind)}</td><td class="d">${fmt(x.date)} (${x.weekday})</td>
      <td class="s">${esc(x.site || '-')}</td><td>${esc(x.title)}</td>
      <td class="b"><button class="btn btn-sm" onclick="wrComplete('${x.kind}','${x.id}')">완료 처리</button></td>
    </tr>`).join('')}</tbody></table></div>`;

  if(!d.rows.length){
    el.innerHTML = `<div class="empty">이 주에 집계된 지원 내역이 없습니다${pend.length ? ' — 위의 일정을 완료 처리하면 여기에 들어옵니다' : ''}</div>`;
    return;
  }
  const n = v => v ? `<b>${v}</b>` : '';
  el.innerHTML = `<div class="svh-table-wrap"><table class="wr-tbl">
    <thead><tr><th style="width:14%">고객사</th><th style="width:92px">지원일자</th><th>지원요약</th>
      ${COLS.map(([c, name]) => `<th class="c">${name.length === 4 ? name.slice(0,2) + '<br>' + name.slice(2) : name}</th>`).join('')}
      <th style="width:76px">지원<br>엔지니어</th><th style="width:22%">비고</th></tr></thead>
    <tbody>${d.rows.map(r => `<tr>
      <td class="wr-site">${esc(r.site)}</td>
      <td class="wr-date">${fmt(r.date)} (${r.weekday})${r.planned ? '<br><span class="badge b-amber" title="아직 완료 처리하지 않은 주말 일정입니다. 엑셀에는 그대로 들어갑니다">완료 전</span>' : ''}</td>
      <td class="wr-pre">${r.summary.map(x => '- ' + esc(x)).join('<br>')}</td>
      ${COLS.map(([c]) => `<td class="c${r.counts[c] ? ' on' : ''}">${n(r.counts[c])}</td>`).join('')}
      <td>${esc(r.workers)}</td>
      <td class="wr-remark"><textarea class="wr-remark-in" data-key="${esc(r.key)}" rows="1" placeholder="직접 입력" oninput="wrSaveRemark(this); wrGrow(this)">${esc(_wrRemark(r))}</textarea></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">합계</td>${COLS.map(([c]) => `<td class="c">${t[c] || ''}</td>`).join('')}<td colspan="2">총 ${d.total}건</td></tr></tfoot>
  </table></div>`;
  el.querySelectorAll('.wr-remark-in').forEach(wrGrow);
}
async function wrComplete(kind, id){
  try { await _apiSend('PATCH', `/api/engineers/${ENG_ID}/${kind === '점검' ? 'schedules' : 'workplans'}/${id}`, {status: '완료'}); }
  catch(e){ toast('변경 실패: ' + e.message); return; }
  toast(`${kind} 완료 처리됨 — 보고서에 반영했습니다`);
  renderWeeklyReport();
}
function wrReset(which){
  if(!_wrData) return;
  $('wr-' + which).value = _wrData[which];
  wrSaveText(which);
}
async function downloadWeeklyReport(){
  const btn = $('wr-download');
  btn.disabled = true; const label = btn.textContent; btn.textContent = '생성 중...';
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/reports/weekly/xlsx`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ start: _wrStart, notes: $('wr-notes').value, confirmed: $('wr-confirmed').value,
        remarks: Object.fromEntries([...document.querySelectorAll('.wr-remark-in')].map(t => [t.dataset.key, t.value])) }) });
    if(!r.ok){ let m = `HTTP ${r.status}`; try { m = (await r.json()).detail || m; } catch(e){} throw new Error(m); }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : `서비스지원본부_${ENG_NAME}_주간보고-${_ymd(new Date()).slice(2).replace(/-/g,"")}.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('주간보고서를 내려받았습니다');
  } catch(e) {
    console.error('주간보고서 생성 실패:', e);
    toast('생성 실패: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// ── 점검 일정 관리 페이지 ──────────────────
let _smYM = _ymd(new Date()).slice(0, 7);   // 보고 있는 달 "YYYY-MM"
let _smType = '';                            // 유형 탭 ('' = 전체)
const _smData = {};                          // 연도별 일정 캐시
const SCHED_TYPE_CLS = {월간:'b-monthly', 분기:'b-quarterly', 특별:'b-special'};
const _schedBase = () => `/api/engineers/${ENG_ID}/schedules`;

async function _smLoad(year, force){
  if(force || !_smData[year]) _smData[year] = await _apiSend('GET', `${_schedBase()}/all?year=${year}`);
  _smData[year].forEach(s => { _schedById[s.id] = s; });
  return _smData[year];
}
function _smDateLabel(day){   // "11/18 (수)"
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return `${m}/${d} (${_WD[new Date(y, m - 1, d).getDay()]})`;
}
function smMove(delta){
  const [y, m] = _smYM.split('-').map(Number);
  smGo(_ymd(new Date(y, m - 1 + delta, 1)).slice(0, 7));
}
function smGo(ym){ _smYM = ym; renderSchedMgmt(false); }
function smToday(){ smGo(_ymd(new Date()).slice(0, 7)); }
function smSetType(t){ _smType = t; drawSchedMgmt(); }

async function renderSchedMgmt(force = true){
  const year = _smYM.slice(0, 4);
  try {
    await _smLoad(year, force);
    await loadSchedWorkPlans();
  } catch(e){
    $('sm-content').innerHTML = `<div class="empty">점검 일정을 불러오지 못했습니다: ${esc(e.message)}</div>`;
    return;
  }
  drawSchedMgmt();
}

function drawSchedMgmt(){
  const year = _smYM.slice(0, 4), mon = Number(_smYM.slice(5, 7));
  const all = _smData[year] || [];
  const today = _ymd(new Date()), nowYM = today.slice(0, 7);
  const isLate = s => s.status !== '완료' && s.sched_date.slice(0, 10) < today;
  const month = all.filter(s => s.sched_date.startsWith(_smYM));
  $('sm-label').textContent = `${year}년 ${mon}월`;
  $('sm-today-btn').style.visibility = _smYM === nowYM ? 'hidden' : 'visible';

  // 이 달 요약
  const done = month.filter(s => s.status === '완료').length, late = month.filter(isLate).length;
  const pct = month.length ? Math.round(done / month.length * 100) : 0;
  $('sm-summary').innerHTML = `
    <div class="metric m-gray"><div class="metric-label">${mon}월 전체</div><div class="metric-value">${month.length}<small>건</small></div></div>
    <div class="metric m-green"><div class="metric-label">완료</div><div class="metric-value">${done}<small>건 (${pct}%)</small></div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${pct}%;background:#22c55e"></div></div></div>
    <div class="metric m-blue"><div class="metric-label">남음</div><div class="metric-value">${month.length - done}<small>건</small></div></div>
    <div class="metric m-red"><div class="metric-label">지연</div><div class="metric-value" style="${late ? 'color:#dc2626' : ''}">${late}<small>건</small></div></div>`;

  // 12개월 띠
  $('sm-months').innerHTML = Array.from({length: 12}, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    const its = all.filter(s => s.sched_date.startsWith(ym)), dn = its.filter(s => s.status === '완료').length;
    const cls = [ym === _smYM ? 'active' : '', ym === nowYM ? 'cur' : '', !its.length ? 'none' : dn === its.length ? 'full' : its.some(isLate) ? 'late' : ''].join(' ');
    return `<button class="sm-mon ${cls}" onclick="smGo('${ym}')" title="${i + 1}월${its.length ? ` · 완료 ${dn}/${its.length}` : ' · 일정 없음'}">
      <span class="sm-mon-name">${i + 1}월</span><span class="sm-mon-cnt">${its.length ? `${dn}/${its.length}` : '-'}</span></button>`;
  }).join('');

  // 유형 탭 · 사이트 선택
  $('sm-types').innerHTML = ['', '월간', '분기', '특별'].map(t =>
    `<button class="svh-tab ${_smType === t ? 'active' : ''}" onclick="smSetType('${t}')">${t || '전체'} ${month.filter(s => !t || s.sched_type === t).length}</button>`).join('');
  const sel = $('sm-site'), prev = sel.value;
  const sites = [...new Map(month.map(s => [s.site_id, s.site_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  sel.innerHTML = '<option value="">전체 사이트</option>' + sites.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
  if(sites.some(([id]) => id === prev)) sel.value = prev;

  const list = month.filter(s => (!_smType || s.sched_type === _smType) && (!sel.value || s.site_id === sel.value))
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date) || a.site_name.localeCompare(b.site_name, 'ko'));

  const row = s => {
    const isDone = s.status === '완료', day = s.sched_date.slice(0, 10);
    const lateDays = isLate(s) ? _daysBetween(day, today) : 0;
    const hasPlan = _schedWorkPlans.some(p => p.id === s.id);
    return `<tr class="${isDone ? 'done' : ''} ${day === today ? 'today' : ''}">
      <td class="sm-d">${_smDateLabel(day)}${day === today && !isDone ? '<span class="badge b-blue">오늘</span>' : ''}${lateDays ? `<span class="badge b-red">지연 D+${lateDays}</span>` : ''}</td>
      <td class="sm-s" title="${esc(s.site_name)}">${esc(s.site_name)}</td>
      <td class="sm-t">${esc(s.title)}${(s.extra_types || []).map(t => ` <span class="badge b-purple">${esc(t)}</span>`).join('')}</td>
      <td class="c"><span class="badge ${SCHED_TYPE_CLS[s.sched_type] || 'b-gray'}">${esc(s.sched_type || '-')}</span></td>
      <td class="sm-memo" title="${esc(s.memo)}">${esc(s.memo)}</td>
      <td class="c"><button class="ds-check-btn ${isDone ? 'checked' : ''}" onclick="toggleSchedStatusMgmt('${s.id}')" title="${isDone ? '완료 취소' : '완료 처리'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" ${isDone ? '' : 'style="opacity:.3"'}><polyline points="20 6 9 17 4 12"/></svg></button></td>
      <td class="c cl-act">${hasPlan ? `<button class="btn btn-sm sm-xls" title="작업계획서 엑셀 내려받기" onclick="downloadWorkPlanExcel('${s.id}')">Excel</button>` : ''}<button class="icon-btn edit" title="수정" onclick="openEditSched('${s.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="deleteSchedAndRefresh('${s.id}')">${ICO_DEL}</button></td>
    </tr>`;
  };
  const emptyMsg = !month.length
    ? `${mon}월에 등록된 점검 일정이 없습니다<br><button class="btn btn-sm" style="margin-top:10px" onclick="openSchedCopy()">이전 달 일정 복사</button>`
    : '조건에 맞는 일정이 없습니다';
  // 표 상자 하나: 위쪽 줄(일정 목록 제목 + 유형·사이트 필터 + 진행 상황) → 열 제목 → 일정
  const cols = '<colgroup><col style="width:140px"><col style="width:21%"><col><col style="width:74px"><col style="width:21%"><col style="width:64px"><col style="width:140px"></colgroup>';
  $('sm-panel-title').textContent = `${mon}월 점검 일정`;
  $('sm-panel-info').innerHTML = (list.length !== month.length ? `<span class="sh-mon-note">${list.length}건 표시 중</span>` : '')
    + (late ? `<span class="sh-mon-cnt late">지연 ${late}건</span>` : '')
    + (month.length ? `<span class="sh-mon-cnt">${done}/${month.length} 완료</span>` : '');
  $('sm-content').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">${cols}
    <thead><tr><th>점검일</th><th>사이트</th><th>제목</th><th class="c">유형</th><th>메모</th><th class="c">완료</th><th class="c">관리</th></tr></thead>
    <tbody>${list.length ? list.map(row).join('') : `<tr class="cl-msg"><td colspan="7">${emptyMsg}</td></tr>`}</tbody></table>`;
}

async function toggleSchedStatusMgmt(id){
  const s = _schedById[id];
  if(!s) return;
  const next = s.status === '완료' ? '예정' : '완료';
  try { await _apiSend('PATCH', `${_schedBase()}/${id}`, {status: next}); }
  catch(e){ toast('변경 실패: ' + e.message); return; }
  _schedHistory = [];
  await renderSchedMgmt();
  _refreshDash();
  toast(next === '완료' ? '완료 처리됨' : '완료 취소됨');
}

async function deleteSchedAndRefresh(id){
  const s = _schedById[id];
  if(!confirm(`${s ? `"${s.site_name} - ${s.title}" ` : ''}점검 일정을 삭제하시겠습니까?`)) return;
  try { await _apiSend('DELETE', `${_schedBase()}/${id}`); }
  catch(e){ toast('삭제 실패: ' + e.message); return; }
  _schedWpLoaded = false;
  await renderSchedMgmt(); _refreshDash(); toast('삭제됨');
}

// ── 이전 달 일정 복사 ─────────────────────
let _smCopyRows = [];
// 같은 주차·같은 요일로 옮김 (예: 둘째 주 화요일 → 둘째 주 화요일). 달을 넘기면 한 주 당김.
function _smShiftDate(src, targetYM){
  const [y, m, d] = src.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay(), nth = Math.floor((d - 1) / 7);
  const [ty, tm] = targetYM.split('-').map(Number);
  const first = 1 + (wd - new Date(ty, tm - 1, 1).getDay() + 7) % 7;
  const last = new Date(ty, tm, 0).getDate();
  let day = first + nth * 7;
  while(day > last) day -= 7;
  return `${targetYM}-${String(day).padStart(2, '0')}`;
}
// 제목 앞의 "06월" 같은 달 표기를 대상 달로 바꿈
function _smShiftTitle(title, srcYM, targetYM){
  const sm = Number(srcYM.slice(5, 7)), tm = Number(targetYM.slice(5, 7));
  return title.replace(/^(\s*)(\d{1,2})월/, (all, sp, n) => Number(n) === sm ? `${sp}${n.length === 2 ? String(tm).padStart(2, '0') : tm}월` : all);
}
async function openSchedCopy(){
  const [y] = _smYM.split('-').map(Number);
  let rows;
  try { rows = [...await _smLoad(String(y - 1), false), ...await _smLoad(String(y), false)]; }
  catch(e){ toast('조회 실패: ' + e.message); return; }
  const months = [...new Set(rows.map(s => s.sched_date.slice(0, 7)))].filter(ym => ym < _smYM).sort().reverse();
  if(!months.length){ toast('복사할 이전 달 일정이 없습니다'); return; }
  $('smc-title').textContent = `${Number(_smYM.slice(5, 7))}월 일정으로 복사`;
  $('smc-src').innerHTML = months.map(ym => `<option value="${ym}">${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월 (${rows.filter(s => s.sched_date.startsWith(ym)).length}건)</option>`).join('');
  $('smc-plan').checked = true;
  drawSchedCopy();
  openModal('modal-sched-copy');
}
function drawSchedCopy(){
  const srcYM = $('smc-src').value;
  const src = (_smData[srcYM.slice(0, 4)] || []).filter(s => s.sched_date.startsWith(srcYM))
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const target = (_smData[_smYM.slice(0, 4)] || []).filter(s => s.sched_date.startsWith(_smYM));
  _smCopyRows = src.map(s => {
    const dup = target.some(t => t.site_id === s.site_id && t.sched_type === s.sched_type);
    return {src: s, dup, on: !dup && s.sched_type === '월간',
            title: _smShiftTitle(s.title, srcYM, _smYM), date: _smShiftDate(s.sched_date, _smYM)};
  });
  $('smc-list').innerHTML = `<div class="cl-panel" style="margin-bottom:0"><table class="cl-table">
    <thead><tr><th class="c" style="width:46px"><input type="checkbox" id="smc-all" title="전체 선택" onchange="smcToggleAll(this.checked)"></th>
      <th style="width:24%">사이트</th><th>제목</th><th style="width:66px">유형</th><th style="width:104px">원래 날짜</th><th style="width:210px">새 점검일</th></tr></thead>
    <tbody>${_smCopyRows.map((r, i) => `<tr>
      <td class="c"><input type="checkbox" id="smc-chk-${i}" ${r.on ? 'checked' : ''} onchange="smcCount()"></td>
      <td class="sm-s">${esc(r.src.site_name)}${r.dup ? '<div class="smc-note">이 달에 이미 등록됨</div>' : r.src.sched_type !== '월간' ? '<div class="smc-note">월간이 아니라 선택 해제됨</div>' : ''}</td>
      <td><input type="text" class="smc-in" id="smc-title-${i}" value="${esc(r.title)}"></td>
      <td><span class="badge ${SCHED_TYPE_CLS[r.src.sched_type] || 'b-gray'}">${esc(r.src.sched_type || '-')}</span></td>
      <td class="pj-period">${_smDateLabel(r.src.sched_date)}</td>
      <td><div class="smc-date"><input type="date" class="smc-in" id="smc-date-${i}" value="${r.date}" onchange="smcWd(${i})"><span id="smc-wd-${i}">(${_WD[new Date(r.date + 'T00:00:00').getDay()]})</span></div></td>
    </tr>`).join('')}</tbody></table></div>`;
  smcCount();
}
function smcWd(i){
  const v = $(`smc-date-${i}`).value;
  $(`smc-wd-${i}`).textContent = v ? `(${_WD[new Date(v + 'T00:00:00').getDay()]})` : '';
}
function smcToggleAll(on){
  _smCopyRows.forEach((_, i) => { $(`smc-chk-${i}`).checked = on; });
  smcCount();
}
function smcCount(){
  const n = _smCopyRows.filter((_, i) => $(`smc-chk-${i}`).checked).length;
  $('smc-save').textContent = `선택한 ${n}건 등록`;
  $('smc-save').disabled = !n;
  $('smc-all').checked = n === _smCopyRows.length && n > 0;
}
async function saveSchedCopy(){
  const withPlan = $('smc-plan').checked, items = [];
  for(const [i, r] of _smCopyRows.entries()){
    if(!$(`smc-chk-${i}`).checked) continue;
    const title = $(`smc-title-${i}`).value.trim(), date = $(`smc-date-${i}`).value;
    if(!title || !date){ toast(`${r.src.site_name}: 제목과 점검일을 입력해주세요`); return; }
    items.push({site_id: r.src.site_id, title, sched_date: date, sched_type: r.src.sched_type, memo: '',
                copy_plan_from: withPlan ? r.src.id : null});
  }
  if(!items.length) return;
  const btn = $('smc-save'); btn.disabled = true;
  try { await _apiSend('POST', `${_schedBase()}/bulk`, {items}); }
  catch(e){ toast('등록 실패: ' + e.message); btn.disabled = false; return; }
  closeModal('modal-sched-copy');
  _schedWpLoaded = false;
  Object.keys(_smData).forEach(k => delete _smData[k]);
  await renderSchedMgmt(); _refreshDash();
  toast(`점검 일정 ${items.length}건 등록됨`);
}

// ── Init ──────────────────────────────────
$('n-date').value=new Date().toISOString().slice(0,10);

(async()=>{
  const me=await api.get('/api/auth/me').catch(()=>null);
  if(me&&me.engineer_id){ENG_ID=me.engineer_id;ENG_NAME=me.engineer_name;IS_ADMIN=!!me.is_admin;initApp()}
})();

// ── PROJECTS ─────────────────────────────────
let _currentProjectId = null;
let _projs = [], _projTab = '';
const PROJ_ST_CLS = {'진행 대기':'b-gray', '진행 중':'b-blue', '보류':'b-amber', '완료':'b-green'};
const TASK_ST_CLS = {'대기':'b-gray', '진행중':'b-blue', '완료':'b-done'};
const TASK_ST_NEXT = {'대기':'진행중', '진행중':'완료', '완료':'대기'};
const _projBase = () => `/api/engineers/${ENG_ID}/projects`;

function _addDays(day, n){ const [y,m,d] = day.split('-').map(Number); return _ymd(new Date(y, m-1, d+n)); }
function _projDone(p){ return p.tasks.filter(t => t.status === '완료').length; }
// 종료일이 지났는데 끝나지 않은 프로젝트의 지연 일수 (해당 없으면 0)
function _projLate(p){
  if(!p.end_date || p.status === '완료' || p.status === '보류') return 0;
  return Math.max(0, _daysBetween(p.end_date, _ymd(new Date())));
}
function _projBar(p, width){
  const n = _projDone(p);
  return `<div class="pj-prog"><div class="prog-wrap" style="${width ? `width:${width}px;` : 'flex:1;'}margin-top:0"><div class="prog-bar" style="width:${p.progress}%;${p.progress === 100 ? 'background:#22c55e' : ''}"></div></div>
    <span class="pj-prog-txt">${p.tasks.length ? `${n}/${p.tasks.length} (${p.progress}%)` : '태스크 없음'}</span></div>`;
}
function _projBadges(p){
  const late = _projLate(p);
  return `<span class="badge ${PROJ_ST_CLS[p.status] || 'b-gray'}">${esc(p.status || '-')}</span>${late ? `<span class="badge b-red" title="종료일 ${esc(p.end_date)}이 지났습니다">지연 D+${late}</span>` : ''}`;
}

async function renderProjects(){
  try { _projs = await _apiSend('GET', _projBase()); }
  catch(e){ $('project-list').innerHTML = `<div class="cl-panel"><div class="empty">프로젝트를 불러오지 못했습니다: ${esc(e.message)}</div></div>`; return; }
  drawProjects();
}

function projSetTab(tab){
  _projTab = tab;
  drawProjects();
}

// 프로젝트가 걸쳐 있는 연도 범위 [시작, 끝]. 끝나지 않은 프로젝트는 올해까지 이어지는 것으로 본다.
function _projYears(p){
  const cur = new Date().getFullYear();
  const s = Number((p.start_date || p.end_date || '').slice(0, 4)) || null;
  let e = Number((p.end_date || p.start_date || '').slice(0, 4)) || null;
  if(!s && !e) return null;                                   // 기간 미입력 → 모든 연도에 표시
  if(p.status !== '완료' && e < cur) e = cur;
  return [Math.min(s, e), Math.max(s, e)];
}
function _projInYear(p, y){
  if(!y) return true;
  const r = _projYears(p);
  return !r || (r[0] <= y && y <= r[1]);
}

function drawProjects(){
  // 연도 선택: 프로젝트가 있는 연도 + 올해 (처음에는 올해)
  const ySel = $('proj-year'), curY = new Date().getFullYear();
  const ys = new Set([curY]);
  _projs.forEach(p => { const r = _projYears(p); if(r) for(let y = r[0]; y <= r[1]; y++) ys.add(y); });
  const prevY = ySel.options.length ? ySel.value : String(curY);
  ySel.innerHTML = `<option value="">전체 연도 (${_projs.length})</option>` + [...ys].sort((a, b) => b - a)
    .map(y => `<option value="${y}">${y}년 (${_projs.filter(p => _projInYear(p, y)).length})</option>`).join('');
  ySel.value = prevY === '' || ys.has(Number(prevY)) ? prevY : String(curY);
  const year = Number(ySel.value) || 0;
  const yearProjs = _projs.filter(p => _projInYear(p, year));

  const inTab = (p, t) => !t || (t === '지연' ? _projLate(p) > 0 : p.status === t);
  const cnt = t => yearProjs.filter(p => inTab(p, t)).length;

  // 요약 카드 (누르면 해당 조건만 보기)
  const cards = [['', year ? `${year}년 프로젝트` : '전체 프로젝트', 'm-gray'], ['진행 중', '진행 중', 'm-blue'], ['지연', '지연', 'm-red'], ['완료', '완료', 'm-green']];
  $('proj-summary').innerHTML = cards.map(([t, label, cls]) => `
    <div class="metric ${cls} ${_projTab === t ? 'active' : ''}" onclick="projSetTab('${t}')">
      <div class="metric-label">${label}</div>
      <div class="metric-value" style="${t === '지연' && cnt(t) ? 'color:#dc2626' : ''}">${cnt(t)}<small>건</small></div>
    </div>`).join('');
  $('proj-tabs').innerHTML = ['', '지연', '진행 중', '진행 대기', '보류', '완료'].map(t =>
    `<button class="svh-tab ${_projTab === t ? 'active' : ''}" onclick="projSetTab('${t}')">${t || '전체'} ${cnt(t)}</button>`).join('');

  const q = $('project-search').value.trim().toLowerCase();
  const rank = p => _projLate(p) ? 0 : ({'진행 중':1, '진행 대기':2, '보류':3, '완료':4}[p.status] ?? 5);
  const list = yearProjs.filter(p => inTab(p, _projTab))
    .filter(p => !q || (p.name || '').toLowerCase().includes(q) || (p.customer || '').toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || (a.end_date || '9999').localeCompare(b.end_date || '9999'));

  const row = p => {
    const desc = (p.description || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
    const canFinish = p.tasks.length && p.progress === 100 && p.status !== '완료';
    return `<tr onclick="openProjectDetail('${p.id}')">
      <td><div class="pj-name">${esc(p.name)}${p.file_count ? `<button class="pj-clip" title="제출자료 보기" onclick="event.stopPropagation();openProjectDetail('${p.id}','files')">첨부 ${p.file_count}</button>` : ''}</div>${desc ? `<div class="pj-desc" title="${esc(p.description)}">${esc(desc)}</div>` : ''}</td>
      <td>${esc(p.customer || '-')}</td>
      <td class="pj-period">${esc(p.start_date || '-')} ~ ${esc(p.end_date || '-')}</td>
      <td><div class="pj-badges">${_projBadges(p)}${canFinish ? `<button class="btn btn-sm pj-finish" title="태스크가 모두 완료되었습니다" onclick="event.stopPropagation();completeProject('${p.id}')">완료 처리</button>` : ''}</div></td>
      <td>${_projBar(p)}</td>
      <td class="c cl-act"><button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditProject('${p.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteProject('${p.id}')">${ICO_DEL}</button></td>
    </tr>`;
  };
  $('project-list').innerHTML = `<div class="cl-panel"><table class="cl-table pj-table">
    <thead><tr><th>프로젝트</th><th style="width:16%">고객사</th><th style="width:180px">기간</th><th style="width:176px">상태</th><th style="width:176px">진척 (완료 태스크)</th><th class="c" style="width:86px">관리</th></tr></thead>
    <tbody>${list.length ? list.map(row).join('') : `<tr class="cl-msg"><td colspan="6">${
      !_projs.length ? '등록된 프로젝트가 없습니다' : !yearProjs.length ? `${year}년에 해당하는 프로젝트가 없습니다. 연도를 바꿔 보세요` : '조건에 맞는 프로젝트가 없습니다'}</td></tr>`}</tbody></table></div>`;
}

$('project-search').addEventListener('input', drawProjects);

// 목록과 열려 있는 상세 창을 함께 새로 그림
async function _reloadProj(){
  try { _projs = await _apiSend('GET', _projBase()); } catch(e){ toast('새로고침 실패: ' + e.message); return; }
  if($('page-projects').classList.contains('active')) drawProjects();
  if($('modal-project-detail').classList.contains('open')) drawProjectDetail();
}

function openAddProject() {
  $('proj-modal-title').textContent = '프로젝트 등록';
  $('p-id').value = '';
  $('p-name').value = '';
  $('p-customer').value = '';
  $('p-start').value = _ymd(new Date());
  $('p-end').value = '';
  $('p-status').value = '진행 대기';
  $('p-desc').value = '';
  $('p-template').value = '';
  $('p-template').disabled = false;
  openModal('modal-add-project');
}

function openEditProject(id) {
  const p = _projs.find(x => x.id === id);
  if(!p) return;
  $('proj-modal-title').textContent = '프로젝트 수정';
  $('p-id').value = p.id;
  $('p-name').value = p.name;
  $('p-customer').value = p.customer || '';
  $('p-start').value = p.start_date || '';
  $('p-end').value = p.end_date || '';
  $('p-status').value = p.status;
  $('p-desc').value = p.description || '';
  $('p-template').value = '';
  $('p-template').disabled = true;
  openModal('modal-add-project');
}

async function saveProject() {
  const name = $('p-name').value.trim();
  if(!name) { toast('프로젝트명을 입력해주세요'); return; }
  const id = $('p-id').value;
  const payload = {
    name, customer: $('p-customer').value.trim(),
    start_date: $('p-start').value, end_date: $('p-end').value,
    status: $('p-status').value, description: $('p-desc').value
  };
  if(payload.start_date && payload.end_date && payload.end_date < payload.start_date){ toast('종료일이 시작일보다 빠릅니다'); return; }
  if(!id) {
    const tmpl = $('p-template').value;
    if(tmpl && !payload.start_date) { toast('템플릿을 사용하려면 시작일을 지정해야 합니다.'); return; }
    payload.template = tmpl;
  }
  try {
    if(id) await _apiSend('PATCH', `${_projBase()}/${id}`, payload);
    else   await _apiSend('POST', _projBase(), payload);
  } catch(e){ toast('저장 실패: ' + e.message); return; }
  closeModal('modal-add-project');
  await _reloadProj(); toast(id ? '수정됨' : '등록됨');
}

async function deleteProject(id) {
  const p = _projs.find(x => x.id === id);
  if(!confirm(`프로젝트${p ? ` "${p.name}"` : ''}를 삭제하시겠습니까?\n태스크${p ? ` ${p.tasks.length}개` : ''}${p && p.file_count ? `와 첨부 파일 ${p.file_count}개` : ''}도 모두 삭제됩니다.`)) return;
  try { await _apiSend('DELETE', `${_projBase()}/${id}`); } catch(e){ toast('삭제 실패: ' + e.message); return; }
  await _reloadProj(); toast('삭제됨');
}

async function completeProject(id){
  try { await _apiSend('PATCH', `${_projBase()}/${id}`, {status: '완료'}); } catch(e){ toast('변경 실패: ' + e.message); return; }
  await _reloadProj(); toast('프로젝트 완료 처리됨');
}

// ── PROJECT DETAIL (TASKS) ───────────────────
async function openProjectDetail(id, tab = 'tasks') {
  _currentProjectId = id;
  if(!_projs.some(x => x.id === id)){
    try { _projs = await _apiSend('GET', _projBase()); } catch(e){ toast('조회 실패: ' + e.message); return; }
  }
  if(!_projs.some(x => x.id === id)) return;
  _projFiles = [];
  $('pj-file-note').value = '';
  $('pj-file-cat').value = '완료보고서';
  drawProjectDetail();
  pjSwitchTab(tab);
  openModal('modal-project-detail');
  loadProjFiles();
}

// ── 프로젝트 제출자료(첨부 파일) ─────────────────
let _projFiles = [];
const PROJ_FILE_CATS = ['완료보고서', '검수확인서', '구성도', '회의록', '기타'];
const PROJ_FILE_MAX = 50 * 1024 * 1024;

function pjSwitchTab(tab){
  document.querySelectorAll('[data-pjtab]').forEach(t => t.classList.toggle('active', t.dataset.pjtab === tab));
  $('pj-pane-tasks').style.display = tab === 'tasks' ? '' : 'none';
  $('pj-pane-files').style.display = tab === 'files' ? '' : 'none';
}
function _fmtSize(n){
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
async function loadProjFiles(){
  const pid = _currentProjectId;
  try {
    const files = await _apiSend('GET', `${_projBase()}/${pid}/files`);
    if(pid !== _currentProjectId) return;
    _projFiles = files;
  } catch(e){ $('pj-file-list').innerHTML = `<div class="empty">제출자료를 불러오지 못했습니다: ${esc(e.message)}</div>`; return; }
  drawProjFiles();
}
function drawProjFiles(){
  $('pj-file-cnt').textContent = _projFiles.length;
  const base = `${_projBase()}/${_currentProjectId}/files`;
  $('pj-file-list').innerHTML = `<div class="cl-panel" style="margin-bottom:0"><table class="cl-table">
    <thead><tr><th style="width:132px">구분</th><th>파일</th><th style="width:90px">크기</th><th style="width:140px">등록</th><th class="c" style="width:150px">관리</th></tr></thead>
    <tbody>${_projFiles.length ? _projFiles.map(f => `<tr>
      <td><select class="filter-select pj-cat-sel" title="구분 변경" onchange="updateProjFile('${f.id}',this.value)">${PROJ_FILE_CATS.map(c => `<option ${c === f.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><a class="pj-file-name" href="${base}/${f.id}/download" download title="내려받기">${esc(f.filename)}</a>${f.note ? `<div class="pj-desc" title="${esc(f.note)}">${esc(f.note)}</div>` : ''}</td>
      <td class="pj-period">${_fmtSize(f.size)}</td>
      <td class="pj-period">${esc(f.uploaded_at)}</td>
      <td class="c cl-act"><a class="btn btn-sm" href="${base}/${f.id}/download" download>내려받기</a><button class="icon-btn del" title="삭제" onclick="deleteProjFile('${f.id}')">${ICO_DEL}</button></td>
    </tr>`).join('') : '<tr class="cl-msg"><td colspan="5">첨부된 제출자료가 없습니다. 위의 "+ 파일 첨부"를 누르거나 파일을 끌어다 놓으세요.</td></tr>'}</tbody></table></div>`;
}
async function uploadProjFiles(fileList){
  const files = [...(fileList || [])];
  if(!files.length || !_currentProjectId) return;
  const pid = _currentProjectId, btn = $('pj-file-btn');
  const category = $('pj-file-cat').value, note = $('pj-file-note').value.trim();
  let ok = 0; const fails = [];
  btn.disabled = true;
  for(const [i, file] of files.entries()){
    btn.textContent = `올리는 중... (${i + 1}/${files.length})`;
    if(file.size > PROJ_FILE_MAX){ fails.push(`${file.name}: 50MB를 넘습니다`); continue; }
    if(!file.size){ fails.push(`${file.name}: 빈 파일입니다`); continue; }
    const fd = new FormData(); fd.append('file', file); fd.append('category', category); fd.append('note', note);
    try {
      const r = await fetch(`${_projBase()}/${pid}/files`, {method: 'POST', body: fd});
      if(!r.ok){
        let d = null; try { d = await r.json(); } catch(e) {}
        throw new Error(d && typeof d.detail === 'string' ? d.detail : r.status === 413 ? '파일이 너무 큽니다 (최대 50MB)' : `서버 오류 (HTTP ${r.status})`);
      }
      ok++;
    } catch(e){ fails.push(`${file.name}: ${e.message}`); }
  }
  btn.disabled = false; btn.textContent = '+ 파일 첨부';
  if(ok) $('pj-file-note').value = '';
  if(pid === _currentProjectId) await loadProjFiles();
  await _reloadProj();
  if(fails.length) alert(`첨부하지 못한 파일 ${fails.length}개\n\n` + fails.join('\n'));
  if(ok) toast(`파일 ${ok}개 첨부됨`);
}
async function updateProjFile(fid, category){
  try {
    const res = await _apiSend('PATCH', `${_projBase()}/${_currentProjectId}/files/${fid}`, {category});
    const f = _projFiles.find(x => x.id === fid); if(f) Object.assign(f, res);
    toast('구분 변경됨');
  } catch(e){ toast('변경 실패: ' + e.message); drawProjFiles(); }
}
async function deleteProjFile(fid){
  const f = _projFiles.find(x => x.id === fid);
  if(!confirm(`"${f ? f.filename : '파일'}"을(를) 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.`)) return;
  try { await _apiSend('DELETE', `${_projBase()}/${_currentProjectId}/files/${fid}`); }
  catch(e){ toast('삭제 실패: ' + e.message); return; }
  await loadProjFiles(); await _reloadProj(); toast('삭제됨');
}
// 제출자료 탭에 파일을 끌어다 놓으면 첨부
(() => {
  const pane = $('pj-pane-files');
  ['dragenter', 'dragover'].forEach(ev => pane.addEventListener(ev, e => { e.preventDefault(); pane.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => pane.addEventListener(ev, e => { e.preventDefault(); if(ev === 'drop' || !pane.contains(e.relatedTarget)) pane.classList.remove('drag'); }));
  pane.addEventListener('drop', e => uploadProjFiles(e.dataTransfer.files));
})();

function drawProjectDetail(){
  const p = _projs.find(x => x.id === _currentProjectId);
  if(!p){ closeModal('modal-project-detail'); return; }
  $('detail-proj-name').textContent = p.name;
  $('pj-task-cnt').textContent = p.tasks.length;
  $('pj-file-cnt').textContent = p.file_count ?? 0;
  const canFinish = p.tasks.length && p.progress === 100 && p.status !== '완료';
  $('proj-detail-info').innerHTML = `
    <div class="pj-info-top">
      <div class="pj-badges">${_projBadges(p)}</div>
      <span class="pj-info-item"><b>고객사</b>${esc(p.customer || '-')}</span>
      <span class="pj-info-item"><b>기간</b>${esc(p.start_date || '-')} ~ ${esc(p.end_date || '-')}</span>
      <span style="flex:1"></span>
      ${canFinish ? `<button class="btn btn-sm pj-finish" onclick="completeProject('${p.id}')">완료 처리</button>` : ''}
      <button class="btn btn-sm" onclick="openEditProject('${p.id}')">프로젝트 수정</button>
    </div>
    ${_projBar(p)}
    ${(p.description || '').trim() ? `<div class="pj-info-desc">${esc(p.description.trim())}</div>` : ''}`;
  renderTasks(p);
}

function renderTasks(p) {
  const tasks = p.tasks || [];
  const el = $('task-list');
  if(!tasks.length) { el.innerHTML = '<div class="empty">등록된 태스크가 없습니다. 위의 "+ 태스크 추가"로 등록하세요.</div>'; return; }

  // 간트 범위: 프로젝트·태스크 날짜 전체를 포함하는 주(월~일) 단위
  const dates = [p.start_date, p.end_date, ...tasks.flatMap(t => [t.start_date, t.end_date])].filter(d => /^\d{4}-\d{2}-\d{2}/.test(d || '')).map(d => d.slice(0, 10)).sort();
  const today = _ymd(new Date());
  let gStart = '', total = 0, weeks = 0;
  if(dates.length){
    const [y, m, d] = dates[0].split('-').map(Number);
    gStart = _addDays(dates[0], -((new Date(y, m-1, d).getDay() + 6) % 7));
    weeks = Math.floor(_daysBetween(gStart, dates[dates.length - 1]) / 7) + 1;
    total = weeks * 7;
  }
  const pct = n => (n / total * 100).toFixed(3);
  const todayOff = gStart ? _daysBetween(gStart, today) : -1;
  const todayLine = todayOff >= 0 && todayOff < total ? `<div class="pj-today" style="left:${pct(todayOff + 0.5)}%"></div>` : '';
  const grid = Array.from({length: weeks}, () => '<div class="pj-wk"></div>').join('');

  const head = Array.from({length: weeks}, (_, i) => {
    const day = _addDays(gStart, i * 7), prev = i ? _addDays(gStart, (i - 1) * 7) : '';
    const mm = Number(day.slice(5, 7)), dd = Number(day.slice(8, 10));
    const label = weeks <= 14 ? `${mm}/${dd}` : (!prev || prev.slice(5, 7) !== day.slice(5, 7) ? `${mm}월` : '');
    return `<div class="pj-wk" title="${day} 주">${label}</div>`;
  }).join('');

  const rows = tasks.map((t, i) => {
    let bar = '';
    const s = (t.start_date || '').slice(0, 10), e = (t.end_date || t.start_date || '').slice(0, 10);
    if(gStart && s && e >= s){
      const left = _daysBetween(gStart, s), len = _daysBetween(s, e) + 1;
      const late = t.status !== '완료' && e < today;
      bar = `<div class="pj-bar st-${t.status === '완료' ? 'done' : t.status === '진행중' ? 'doing' : 'wait'} ${late ? 'late' : ''}" style="left:${pct(left)}%;width:${pct(len)}%" title="${esc(t.name)}\n${s} ~ ${e}${late ? '\n종료일이 지났습니다' : ''}"></div>`;
    }
    const lateTxt = t.status !== '완료' && e && e < today;
    return `<div class="pj-trow ${t.status === '완료' ? 'done' : ''}">
      <div><button class="badge ${TASK_ST_CLS[t.status] || 'b-gray'} pj-st" title="눌러서 상태 변경 (대기 → 진행중 → 완료)" onclick="cycleTask('${t.id}')">${esc(t.status || '대기')}</button></div>
      <div class="pj-tname"><div class="pj-tname-txt" title="${esc(t.name)}">${esc(t.name)}</div>
        <div class="pj-tdate ${lateTxt ? 'late' : ''}">${s ? `${s.slice(5).replace('-', '/')} ~ ${e.slice(5).replace('-', '/')}` : '날짜 미정'}${lateTxt ? ' · 지연' : ''}</div></div>
      <div class="pj-track">${grid}${bar}${todayLine}</div>
      <div class="pj-tact">
        <button class="icon-btn" title="위로" ${i === 0 ? 'disabled' : ''} onclick="moveTask('${t.id}',-1)">▲</button>
        <button class="icon-btn" title="아래로" ${i === tasks.length - 1 ? 'disabled' : ''} onclick="moveTask('${t.id}',1)">▼</button>
        <button class="icon-btn edit" title="수정" onclick="openEditTask('${t.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteTask('${t.id}')">${ICO_DEL}</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="pj-gantt">
    <div class="pj-trow pj-thead"><div>상태</div><div>태스크</div>
      <div class="pj-track">${head}${todayLine ? `<div class="pj-today-label" style="left:${pct(todayOff + 0.5)}%">오늘</div>` : ''}</div><div style="text-align:center">순서 / 관리</div></div>
    ${rows}</div>`;
}

function _curProj(){ return _projs.find(x => x.id === _currentProjectId); }

function openAddTask() {
  $('task-modal-title').textContent = '태스크 추가';
  $('t-id').value = '';
  $('t-name').value = '';
  $('t-status').value = '대기';
  $('t-start').value = '';
  $('t-end').value = '';
  openModal('modal-add-task');
  setTimeout(() => $('t-name').focus(), 50);
}

function openEditTask(tid) {
  const t = (_curProj()?.tasks || []).find(x => x.id === tid);
  if(!t) return;
  $('task-modal-title').textContent = '태스크 수정';
  $('t-id').value = t.id;
  $('t-name').value = t.name;
  $('t-status').value = t.status;
  $('t-start').value = t.start_date || '';
  $('t-end').value = t.end_date || '';
  openModal('modal-add-task');
}

// 태스크가 모두 완료되면 프로젝트도 완료로 바꿀지 물어봄
async function _askFinishProject(){
  const p = _curProj();
  if(p && p.tasks.length && p.progress === 100 && p.status !== '완료'
     && confirm('모든 태스크가 완료되었습니다.\n프로젝트 상태를 "완료"로 바꿀까요?')) await completeProject(p.id);
}

async function saveTask() {
  const name = $('t-name').value.trim();
  if(!name) { toast('태스크명을 입력해주세요'); return; }
  const payload = { name, status: $('t-status').value, start_date: $('t-start').value, end_date: $('t-end').value };
  if(payload.start_date && payload.end_date && payload.end_date < payload.start_date){ toast('종료일이 시작일보다 빠릅니다'); return; }
  const tid = $('t-id').value, base = `${_projBase()}/${_currentProjectId}/tasks`;
  try {
    if(tid) await _apiSend('PATCH', `${base}/${tid}`, payload);
    else    await _apiSend('POST', base, payload);
  } catch(e){ toast('저장 실패: ' + e.message); return; }
  closeModal('modal-add-task');
  await _reloadProj();
  toast(tid ? '태스크 수정됨' : '태스크 추가됨');
  if(payload.status === '완료') await _askFinishProject();
}

async function cycleTask(tid){
  const t = (_curProj()?.tasks || []).find(x => x.id === tid);
  if(!t) return;
  const next = TASK_ST_NEXT[t.status] || '진행중';
  try { await _apiSend('PATCH', `${_projBase()}/${_currentProjectId}/tasks/${tid}`, {status: next}); }
  catch(e){ toast('변경 실패: ' + e.message); return; }
  await _reloadProj();
  if(next === '완료') await _askFinishProject();
}

async function moveTask(tid, dir){
  const ids = (_curProj()?.tasks || []).map(t => t.id);
  const i = ids.indexOf(tid), j = i + dir;
  if(i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try { await _apiSend('POST', `${_projBase()}/${_currentProjectId}/tasks/reorder`, {ids}); }
  catch(e){ toast('순서 변경 실패: ' + e.message); return; }
  await _reloadProj();
}

async function deleteTask(tid) {
  if(!confirm('태스크를 삭제하시겠습니까?')) return;
  try { await _apiSend('DELETE', `${_projBase()}/${_currentProjectId}/tasks/${tid}`); }
  catch(e){ toast('삭제 실패: ' + e.message); return; }
  await _reloadProj();
  toast('삭제됨');
}

// ── SCHED HISTORY ─────────────────────────────
let _schedHistory = [];
let _shPage = 1;
const SH_PAGE_SIZE = 20;

async function renderSchedHistory(){
  try {
    _schedHistory = await _apiSend('GET', `${_schedBase()}/history`);
    await loadSchedWorkPlans();
  } catch(e){
    $('sh-list').innerHTML = `<div class="empty">점검 이력을 불러오지 못했습니다: ${esc(e.message)}</div>`;
    return;
  }
  _schedHistory.forEach(s => { _schedById[s.id] = s; });
  // 연도 선택 채우기 (고른 값은 유지, 처음에는 올해)
  const ySel = $('sh-year'), py = ySel.value, first = !ySel.options.length;
  const years = [...new Set(_schedHistory.map(s => s.sched_date.slice(0, 4)))].sort().reverse();
  ySel.innerHTML = '<option value="">전체 연도</option>' + years.map(y => `<option value="${y}">${y}년</option>`).join('');
  const thisYear = String(new Date().getFullYear());
  ySel.value = first ? (years.includes(thisYear) ? thisYear : '') : (years.includes(py) ? py : '');
  drawSchedHistory(1);
}

function drawSchedHistory(page){
  if(page) _shPage = page;
  const year = $('sh-year').value, q = $('sh-search').value.toLowerCase().trim();
  const base = _schedHistory.filter(s => (!year || s.sched_date.startsWith(year))
    && (!q || (s.site_name || '').toLowerCase().includes(q) || (s.title || '').toLowerCase().includes(q) || (s.memo || '').toLowerCase().includes(q)));

  // 사이트 선택: 이름 옆에 완료 횟수 표시 (고른 값은 유지)
  const sSel = $('sh-site'), ps = sSel.value;
  const cnt = new Map();
  base.forEach(s => cnt.set(s.site_id, {name: s.site_name, n: (cnt.get(s.site_id)?.n || 0) + 1}));
  const sites = [...cnt.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ko'));
  sSel.innerHTML = `<option value="">전체 사이트 (${base.length})</option>` + sites.map(([id, v]) => `<option value="${id}">${esc(v.name)} (${v.n})</option>`).join('');
  if(cnt.has(ps)) sSel.value = ps;
  const site = sSel.value;

  const list = base.filter(s => !site || s.site_id === site);
  $('sh-count').textContent = `완료 ${list.length}건`;

  const pages = Math.max(1, Math.ceil(list.length / SH_PAGE_SIZE));
  if(_shPage > pages) _shPage = pages;
  const rows = list.slice((_shPage - 1) * SH_PAGE_SIZE, _shPage * SH_PAGE_SIZE);

  const cols = '<colgroup><col style="width:124px"><col style="width:28%"><col><col style="width:74px"><col style="width:124px"></colgroup>';
  const row = s => {
    const hasPlan = _schedWorkPlans.some(p => p.id === s.id);
    return `<tr>
      <td class="sm-d">${_smDateLabel(s.sched_date)}</td>
      <td class="sm-s" title="${esc(s.site_name)}">${esc(s.site_name)}</td>
      <td class="sm-t">${esc(s.title)}${(s.extra_types || []).map(t => ` <span class="badge b-purple">${esc(t)}</span>`).join('')}${s.memo ? `<div class="sh-memo">${esc(s.memo)}</div>` : ''}</td>
      <td class="c"><span class="badge ${SCHED_TYPE_CLS[s.sched_type] || 'b-gray'}">${esc(s.sched_type || '-')}</span></td>
      <td class="c cl-act">${hasPlan ? `<button class="btn btn-sm sm-xls" title="작업계획서 엑셀 내려받기" onclick="downloadWorkPlanExcel('${s.id}')">Excel</button>` : ''}<button class="icon-btn edit" title="수정 (상태를 예정으로 되돌릴 때도 여기서)" onclick="openEditSched('${s.id}')">${ICO_EDIT}</button></td>
    </tr>`;
  };
  // 표 상자 하나: 위쪽 줄(필터) → 열 제목 → 달 구분 줄 + 그 달의 점검 (최근 달이 위)
  const months = [...new Set(rows.map(s => s.sched_date.slice(0, 7)))];
  const body = months.map(ym => `<tr class="sh-grp"><td colspan="5"><span class="sh-month-name">${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월</span><span class="sh-grp-cnt">${list.filter(x => x.sched_date.startsWith(ym)).length}건 완료</span></td></tr>`
    + rows.filter(s => s.sched_date.startsWith(ym)).map(row).join('')).join('');
  $('sh-list').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">${cols}
    <thead><tr><th>점검일</th><th>사이트</th><th>제목 / 메모</th><th class="c">유형</th><th class="c">관리</th></tr></thead>
    <tbody>${body || `<tr class="cl-msg"><td colspan="5">${_schedHistory.length ? '조건에 맞는 점검 이력이 없습니다' : '완료된 점검 이력이 없습니다'}</td></tr>`}</tbody></table>`;
  renderPagination('sh-page', list.length, _shPage, 'drawSchedHistory', SH_PAGE_SIZE);
}

// ── TECH NOTES ──────────────────────────────
const TN_CATS = ['OS/서버구축', 'HW장애/교체', '펌웨어/패치', 'Storage/SAN', '네트워크/케이블', '기타'];
const TN_CAT_CLS = {'OS/서버구축':'b-blue', 'HW장애/교체':'b-red', '펌웨어/패치':'b-amber', 'Storage/SAN':'b-purple', '네트워크/케이블':'b-green', '기타':'b-gray'};
const TN_PAGE_SIZE = 20;
let _allTechNotes = [];
let _tnPage = 1;
let _tnViewId = '';

function _tnTags(n){ return (n.tags || '').split(',').map(x => x.trim()).filter(Boolean); }
// 저장 시각은 UTC — 화면에는 이곳 날짜로 표시
function _tnDate(v){
  if(!v) return '-';
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : v + 'Z');
  return isNaN(d) ? String(v).slice(0, 10) : _ymd(d);
}
// 목록 미리보기: 마크다운 기호를 걷어낸 한 줄
function _tnPreview(body){
  return (body || '').replace(/```\w*/g, ' ').replace(/[#>*`_~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
// 마크다운 → HTML (스크립트·이벤트 속성 제거)
function _tnRender(el, body){
  if(!window.marked){ el.textContent = body || ''; return; }
  const tpl = document.createElement('template');
  tpl.innerHTML = marked.parse(body || '', {breaks: true, gfm: true});   // 줄바꿈은 쓴 그대로 유지
  tpl.content.querySelectorAll('script,iframe,object,embed,style,link,form').forEach(x => x.remove());
  tpl.content.querySelectorAll('*').forEach(x => [...x.attributes].forEach(at => {
    if(/^on/i.test(at.name) || (/^(href|src)$/i.test(at.name) && /^\s*javascript:/i.test(at.value))) x.removeAttribute(at.name);
  }));
  tpl.content.querySelectorAll('a').forEach(x => { x.target = '_blank'; x.rel = 'noopener'; });
  el.innerHTML = ''; el.appendChild(tpl.content);
  if(window.hljs) el.querySelectorAll('pre code').forEach(c => hljs.highlightElement(c));
}

async function renderTechNotes(){
  try {
    const res = await api.get(`/api/engineers/${ENG_ID}/technotes`);
    _allTechNotes = Array.isArray(res) ? res : [];
  } catch(e) {
    $('technote-list').innerHTML = '<table class="cl-table"><tbody><tr class="cl-msg"><td>기술 노트를 불러오지 못했습니다</td></tr></tbody></table>';
    return;
  }
  drawTechNotes(1);
}

function tnSetTag(tag){ $('tn-tag').dataset.want = tag; drawTechNotes(1); }

function drawTechNotes(page){
  if(page) _tnPage = page;
  const q = $('tn-search').value.toLowerCase().trim();
  const base = _allTechNotes.filter(n => !q || (n.title || '').toLowerCase().includes(q)
    || (n.body || '').toLowerCase().includes(q) || (n.tags || '').toLowerCase().includes(q));

  // 분류 선택: 이름 옆에 건수 (고른 값 유지)
  const cSel = $('tn-cat'), pc = cSel.value;
  const cc = c => base.filter(n => (n.category || '기타') === c).length;
  cSel.innerHTML = `<option value="">전체 분류 (${base.length})</option>` + TN_CATS.map(c => `<option value="${esc(c)}">${esc(c)} (${cc(c)})</option>`).join('');
  cSel.value = TN_CATS.includes(pc) ? pc : '';
  const cat = cSel.value;
  const inCat = base.filter(n => !cat || (n.category || '기타') === cat);

  // 태그 선택: 쓰인 태그만, 많이 쓴 순
  const tSel = $('tn-tag'), pt = tSel.dataset.want ?? tSel.value;
  delete tSel.dataset.want;
  const tc = new Map();
  inCat.forEach(n => _tnTags(n).forEach(g => tc.set(g, (tc.get(g) || 0) + 1)));
  const tags = [...tc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  tSel.innerHTML = '<option value="">전체 태그</option>' + tags.map(([g, c]) => `<option value="${esc(g)}">#${esc(g)} (${c})</option>`).join('');
  tSel.value = tc.has(pt) ? pt : '';
  const tag = tSel.value;

  const list = inCat.filter(n => !tag || _tnTags(n).includes(tag));
  $('tn-count').textContent = `노트 ${list.length}건`;

  const pages = Math.max(1, Math.ceil(list.length / TN_PAGE_SIZE));
  if(_tnPage > pages) _tnPage = pages;
  const rows = list.slice((_tnPage - 1) * TN_PAGE_SIZE, _tnPage * TN_PAGE_SIZE);

  const cols = '<colgroup><col style="width:136px"><col><col style="width:22%"><col style="width:112px"><col style="width:96px"></colgroup>';
  const body = rows.map(n => {
    const c = n.category || '기타', pv = _tnPreview(n.body);
    return `<tr onclick="openViewTechNote('${n.id}')">
      <td class="c"><span class="badge ${TN_CAT_CLS[c] || 'b-gray'}">${esc(c)}</span></td>
      <td class="tn-t"><div class="tn-title">${esc(n.title)}</div>${pv ? `<div class="tn-pv">${esc(pv)}</div>` : ''}</td>
      <td class="tn-tags">${_tnTags(n).map(g => `<span class="tn-tag" title="이 태그만 보기" onclick="event.stopPropagation();tnSetTag(this.dataset.t)" data-t="${esc(g)}">#${esc(g)}</span>`).join('') || '<span class="tn-none">-</span>'}</td>
      <td class="sm-d">${_tnDate(n.created_at)}</td>
      <td class="c cl-act"><button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditTechNote('${n.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteTechNote('${n.id}')">${ICO_DEL}</button></td>
    </tr>`;
  }).join('');
  $('technote-list').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead tn-table">${cols}
    <thead><tr><th class="c">분류</th><th>제목 / 내용</th><th>태그</th><th>작성일</th><th class="c">관리</th></tr></thead>
    <tbody>${body || `<tr class="cl-msg"><td colspan="5">${_allTechNotes.length ? '조건에 맞는 기술 노트가 없습니다' : '등록된 기술 노트가 없습니다. 오른쪽 위 "+ 노트 추가"로 첫 노트를 남겨보세요'}</td></tr>`}</tbody></table>`;
  renderPagination('tn-page', list.length, _tnPage, 'drawTechNotes', TN_PAGE_SIZE);
}

function tnEditTab(tab){
  const pv = tab === 'preview';
  $('tn-tab-edit').classList.toggle('active', !pv);
  $('tn-tab-preview').classList.toggle('active', pv);
  $('tn-body').style.display = pv ? 'none' : '';
  $('tn-preview').style.display = pv ? '' : 'none';
  if(pv) _tnRender($('tn-preview'), $('tn-body').value || '_내용이 없습니다_');
}

function openAddTechNote() {
  $('tn-modal-title').textContent = '기술 노트 작성';
  $('tn-id').value = '';
  $('tn-title').value = '';
  $('tn-category').value = TN_CATS.includes($('tn-cat').value) ? $('tn-cat').value : 'OS/서버구축';
  $('tn-tags').value = '';
  $('tn-body').value = '';
  tnEditTab('edit');
  openModal('modal-add-technote');
}

function openEditTechNote(id) {
  const n = _allTechNotes.find(x => x.id === id);
  if(!n) return;
  $('tn-modal-title').textContent = '기술 노트 수정';
  $('tn-id').value = n.id;
  $('tn-title').value = n.title;
  $('tn-category').value = TN_CATS.includes(n.category) ? n.category : '기타';
  $('tn-tags').value = n.tags || '';
  $('tn-body').value = n.body || '';
  tnEditTab('edit');
  openModal('modal-add-technote');
}

function openViewTechNote(id) {
  const n = _allTechNotes.find(x => x.id === id);
  if(!n) return;
  _tnViewId = id;
  const c = n.category || '기타';
  $('view-tn-title').textContent = n.title;
  $('view-tn-category').textContent = c;
  $('view-tn-category').className = 'badge ' + (TN_CAT_CLS[c] || 'b-gray');
  $('view-tn-date').textContent = '작성일 ' + _tnDate(n.created_at);
  $('view-tn-tags').innerHTML = _tnTags(n).map(g => `<span class="tn-tag static">#${esc(g)}</span>`).join('');
  _tnRender($('view-tn-body'), n.body);
  openModal('modal-view-technote');
}

function editViewedTechNote(){
  closeModal('modal-view-technote');
  openEditTechNote(_tnViewId);
}

async function copyTechNote(){
  const n = _allTechNotes.find(x => x.id === _tnViewId);
  if(!n) return;
  try {
    if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(n.body || '');
    else {
      const ta = document.createElement('textarea');
      ta.value = n.body || ''; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      if(!ok) throw new Error();
    }
    toast('본문을 복사했습니다');
  } catch(e) { toast('복사하지 못했습니다. 본문을 직접 선택해 복사해주세요'); }
}

async function saveTechNote() {
  const title = $('tn-title').value.trim();
  if(!title) { toast('제목을 입력해주세요'); return; }
  if(!$('tn-body').value.trim()) { toast('내용을 입력해주세요'); return; }
  const tags = [...new Set($('tn-tags').value.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean))].join(', ');
  const payload = { title, category: $('tn-category').value, tags, body: $('tn-body').value };
  const id = $('tn-id').value;
  try {
    if(id) await _apiSend('PATCH', `/api/engineers/${ENG_ID}/technotes/${id}`, payload);
    else   await _apiSend('POST', `/api/engineers/${ENG_ID}/technotes`, payload);
  } catch (e) { toast('저장 실패: ' + e.message); return; }
  closeModal('modal-add-technote');
  toast(id ? '수정되었습니다' : '저장되었습니다');
  await renderTechNotes();
}

async function deleteTechNote(id) {
  const n = _allTechNotes.find(x => x.id === id);
  if(!confirm(`"${n ? n.title : '이 노트'}"\n노트를 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/technotes/${id}`); }
  catch (e) { toast('삭제 실패: ' + e.message); return; }
  toast('삭제되었습니다');
  await renderTechNotes();
}

// ── GOOGLE CALENDAR ───────────────────────
let _gcal = null, _gcalSites = [];
const GC_SCHED = ['월간', '분기', '특별'], GC_SUPPORT = ['기술지원', '납품', '유선원격', '이전', '기타'];
const _gcalUrl = () => `/api/engineers/${ENG_ID}/calendar`;

async function renderGcal(){
  try {
    [_gcal, _gcalSites] = await Promise.all([api.get(_gcalUrl()), api.get(`/api/engineers/${ENG_ID}/sites`)]);
  } catch (e) { $('gcal-content').innerHTML = '<div class="dv-panel"><div class="dv-empty">불러오지 못했습니다</div></div>'; return; }
  drawGcal();
}

function drawGcal(){
  const g = _gcal, evs = g.events || [];
  const wait = evs.filter(e => e.state === '확인 대기').sort((a, b) => a.event_date.localeCompare(b.event_date));
  const rest = evs.filter(e => e.state !== '확인 대기');
  const failed = (g.last_result || '').startsWith('실패');
  const typeOpts = sel => `<optgroup label="점검 일정">${GC_SCHED.map(t => `<option value="점검|${t}" ${sel === '점검|' + t ? 'selected' : ''}>점검 - ${t}</option>`).join('')}</optgroup>
    <optgroup label="기술지원">${GC_SUPPORT.map(t => `<option value="기술지원|${t}" ${sel === '기술지원|' + t ? 'selected' : ''}>기술지원 - ${t}</option>`).join('')}</optgroup>`;
  const siteOpts = `<option value="">사이트 선택</option>` + _gcalSites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const stCls = { '등록': 'ok', '무시': 'off', '포털에서 삭제': 'off' };

  $('gcal-content').innerHTML = `
  <div class="dv-panel gc-gap">
    <div class="dv-panel-head">
      <span class="dv-panel-title">연동 설정</span>
      <span class="gc-state ${g.linked ? (failed ? 'bad' : 'ok') : 'off'}">${g.linked ? (failed ? '가져오기 실패' : '연동 중') : '연동 안 됨'}</span>
      ${g.linked ? `<span class="gc-last">마지막 확인 ${esc(g.last_sync || '-')} · ${esc(g.last_result || '')}</span>
        <button class="btn btn-sm btn-primary gc-right" id="gc-sync-btn" onclick="gcalSync()">지금 가져오기</button>
        <button class="btn btn-sm" onclick="gcalUnlink()">연동 해제</button>` : ''}
    </div>
    <div class="gc-body">
      <div class="gc-url">
        <input type="text" id="gc-url" placeholder="${g.linked ? '주소를 바꾸려면 새 주소를 붙여 넣으세요 (등록된 주소는 보안상 표시하지 않습니다)' : 'https://calendar.google.com/calendar/ical/…/basic.ics'}" autocomplete="off">
        <button class="btn btn-primary" id="gc-save-btn" onclick="gcalSaveLink()">${g.linked ? '주소 변경' : '연동하기'}</button>
      </div>
      <div class="gc-start">
        <label for="gc-start">가져오기 시작일</label>
        <input type="date" id="gc-start" value="${esc(g.start_date || g.today)}">
        ${g.linked ? `<button class="btn btn-sm" onclick="gcalSetStart()">시작일 변경</button>` : ''}
        <span class="gc-last">이 날짜 이후의 일정만 가져옵니다 (그 전 일정은 캘린더에 있어도 건드리지 않음). 앞쪽은 오늘부터 180일 뒤까지.</span>
      </div>
      <table class="gc-guide">
        <tr><th>주소 찾는 곳</th><td>구글 캘린더 → 왼쪽 캘린더 이름 옆 ⋮ → 설정 및 공유 → 맨 아래 <b>iCal 형식의 비공개 주소</b>를 복사</td></tr>
        <tr><th>제목 규칙</th><td><code>[종류] 고객사이름 - 엔지니어이름</code> &nbsp;예: <code>[점검] A병원 - ${esc(g.engineer_name)}</code> · 여러 명이면 <code>${esc(g.engineer_name)}, 홍길동</code><br>엔지니어 이름에 <b>${esc(g.engineer_name)}</b> 이(가) 들어 있는 일정만 가져옵니다.</td></tr>
        <tr><th>종류</th><td><code>[점검]</code> <code>[분기점검]</code> <code>[특별점검]</code> → 점검 일정 &nbsp;·&nbsp; <code>[기술지원]</code> <code>[납품]</code> <code>[원격]</code> <code>[이전]</code> <code>[기타]</code> → 기술지원<br><code>[점검 및 기술지원]</code> <code>[점검/납품]</code> 처럼 함께 적으면 점검 일정 한 건에 지원 구분이 같이 체크됩니다.</td></tr>
        <tr><th>설명</th><td>캘린더 일정의 <b>설명</b> 칸 내용은 기술지원의 <b>작업 목적</b>에 들어갑니다 (점검 일정은 메모). 구글에서 설명을 고치면 반영하지만, 포털에서 직접 고친 내용은 덮어쓰지 않습니다.</td></tr>
        <tr><th>이미 있는 일정</th><td>포털에 <b>같은 날짜 · 같은 사이트</b>로 이미 등록된 건이 있으면 새로 만들지 않고 그 건에 연결합니다. 이렇게 연결된 건은 구글에서 일정을 지워도 포털에서 지우지 않습니다.</td></tr>
        <tr><th>반영 방식</th><td>${g.sync_minutes}분마다 자동으로 확인합니다. 구글에서 날짜를 바꾸거나 지우면 포털에도 반영하지만, 포털에서 <b>완료 처리한 건은 그대로</b> 둡니다. 포털에서 직접 지운 건은 다시 만들지 않으며, 아래 표의 "다시 가져오기"로 되살릴 수 있습니다.</td></tr>
      </table>
    </div>
  </div>

  ${g.linked ? `<div class="dv-panel gc-gap">
    <div class="dv-panel-head"><span class="dv-panel-title">확인 대기</span><span class="dv-panel-sub ${wait.length ? 'warn' : ''}">${wait.length}건</span>
      <span class="gc-last">종류나 사이트를 자동으로 정하지 못한 일정입니다. 직접 골라 등록하거나 무시하세요.</span></div>
    ${wait.length ? `<table class="dv-tbl gc-tbl"><thead><tr><th style="width:104px">날짜</th><th>캘린더 제목</th><th style="width:170px">종류</th><th style="width:220px">사이트</th><th style="width:132px"></th></tr></thead><tbody>
      ${wait.map(e => `<tr>
        <td class="gc-date">${esc(e.event_date)}</td>
        <td><div class="dv-task">${esc(e.summary)}</div><div class="dv-desc">${esc(e.reason)}</div></td>
        <td><select class="filter-select gc-sel" id="gc-kind-${e.id}">${typeOpts(e.kind ? e.kind + '|' + (e.sub_type || (e.kind === '점검' ? '월간' : '기술지원')) : '점검|월간')}</select></td>
        <td><select class="filter-select gc-sel" id="gc-site-${e.id}">${siteOpts}</select></td>
        <td class="gc-act"><button class="btn btn-sm btn-primary" onclick="gcalRegister('${e.id}')">등록</button><button class="btn btn-sm" onclick="gcalEvent('${e.id}','ignore')">무시</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="dv-empty">확인할 일정이 없습니다</div>'}
  </div>

  <div class="dv-panel">
    <div class="dv-panel-head"><span class="dv-panel-title">가져온 일정</span><span class="dv-panel-sub">${rest.length}건</span></div>
    ${rest.length ? `<table class="dv-tbl gc-tbl"><thead><tr><th style="width:104px">날짜</th><th>캘린더 제목</th><th style="width:150px">등록된 곳</th><th style="width:220px">사이트</th><th style="width:210px">상태</th></tr></thead><tbody>
      ${rest.map(e => `<tr>
        <td class="gc-date">${esc(e.event_date)}</td>
        <td><div class="dv-task">${esc(e.summary)}</div></td>
        <td>${e.state === '무시' ? '<span class="dev-muted">-</span>' : esc((e.kind === '점검' ? '점검 일정' : '기술지원') + ' - ' + (e.sub_type || ''))}</td>
        <td>${esc(e.site_name || (e.state === '무시' ? '' : e.customer))}</td>
        <td><span class="gc-state ${stCls[e.state] || 'off'}">${esc(e.state === '등록' && e.adopted ? '기존 일정 연결' : e.state)}</span>${e.state === '무시' ? ` <button class="btn btn-sm" onclick="gcalEvent('${e.id}','restore')">되돌리기</button>` : ''}${e.state === '포털에서 삭제' ? ` <button class="btn btn-sm" title="포털에서 지운 일정을 캘린더 내용으로 다시 등록합니다" onclick="gcalEvent('${e.id}','reimport')">다시 가져오기</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="dv-empty">아직 가져온 일정이 없습니다</div>'}
  </div>` : ''}`;
}

async function gcalSaveLink(){
  const url = $('gc-url').value.trim();
  if(!url){ toast('캘린더 주소를 붙여 넣어주세요'); return; }
  const btn = $('gc-save-btn'); btn.disabled = true; btn.textContent = '확인 중...';
  try { await _apiSend('POST', _gcalUrl() + '/link', {url, start_date: $('gc-start').value || null}); toast('캘린더를 연동했습니다'); }
  catch (e) { toast(e.message); }
  await renderGcal();
}
async function gcalSync(){
  const btn = $('gc-sync-btn'); btn.disabled = true; btn.textContent = '가져오는 중...';
  try {
    const n = await _apiSend('POST', _gcalUrl() + '/sync');
    toast(_gcalMsg(n));
  } catch (e) { toast(e.message); }
  await renderGcal();
}
const _gcalMsg = n => `새로 등록 ${n.added}건 · 기존 연결 ${n.linked}건 · 확인 대기 ${n.waiting}건 · 변경 ${n.updated}건 · 삭제 ${n.removed}건`;
async function gcalSetStart(){
  const start_date = $('gc-start').value;
  if(!start_date){ toast('시작일을 골라주세요'); return; }
  if(start_date < _gcal.start_date && !confirm(`${start_date} 이후의 지난 일정도 가져옵니다. 계속하시겠습니까?`)){ $('gc-start').value = _gcal.start_date; return; }
  try { toast(_gcalMsg(await _apiSend('POST', _gcalUrl() + '/start', {start_date}))); }
  catch (e) { toast(e.message); }
  await renderGcal();
}
async function gcalUnlink(){
  if(!confirm('캘린더 연동을 해제하시겠습니까?\n이미 등록된 점검 일정과 기술지원은 그대로 남습니다.')) return;
  try { await _apiSend('DELETE', _gcalUrl() + '/link'); toast('연동을 해제했습니다'); }
  catch (e) { toast(e.message); }
  await renderGcal();
}
async function gcalRegister(id){
  const [kind, sub_type] = $('gc-kind-' + id).value.split('|');
  const site_id = $('gc-site-' + id).value || null;
  if(kind === '점검' && !site_id){ toast('점검 일정은 사이트를 골라주세요'); return; }
  try { await _apiSend('POST', `${_gcalUrl()}/events/${id}/register`, {kind, sub_type, site_id}); toast('등록했습니다'); }
  catch (e) { toast(e.message); }
  await renderGcal();
}
async function gcalEvent(id, action){
  try { await _apiSend('POST', `${_gcalUrl()}/events/${id}/${action}`); }
  catch (e) { toast(e.message); }
  await renderGcal();
}

// ── DEVELOPMENT CHECKLIST ─────────────────
let _currentDevTab = 'all';
let _devCat = null;          // 선택한 분야('' = 전체, null = 아직 안 고름)
let _devOpen = new Set();    // 설명을 펼친 항목 id
let _devOpenAll = false;
const _devName = c => String(c || '').replace(/^[^0-9A-Za-z가-힣]+/, '');   // 분야 이름 앞의 그림 문자 제거
function devSetCat(cat){ _devCat = cat; renderDevChecklist(); const m = document.querySelector('.main'); if(m) m.scrollTop = 0; }
function devToggle(id){ _devOpen.has(id) ? _devOpen.delete(id) : _devOpen.add(id); renderDevChecklist(); }
function devToggleAll(){ _devOpenAll = !_devOpenAll; _devOpen.clear(); renderDevChecklist(); }

async function loadDevChecklist() {
  try {
    _devChecklist = await api.get('/api/dev/checklist');
    renderDevChecklist();
  } catch (e) {
    console.error('체크리스트 로드 실패:', e);
  }
}

function switchDevTab(tab) { _currentDevTab = tab; renderDevChecklist(); }

function renderDevChecklist() {
  const sections = _devChecklist.sections || [];
  const content = $('dev-checklist-content');
  const statusMap = { completed: '완료', 'in-progress': '진행중', planned: '예정' };
  const byStatus = items => _currentDevTab === 'all' ? items : items.filter(i => i.status === statusMap[_currentDevTab]);
  const cnt = (items, st) => items.filter(i => i.status === st).length;

  if (_devCat === null || (_devCat !== '' && !sections.some(s => s.category === _devCat))) _devCat = sections.length ? sections[0].category : '';
  const allItems = sections.flatMap(s => s.items || []);
  const scope = _devCat ? ((sections.find(s => s.category === _devCat) || {}).items || []) : allItems;

  // 맨 위 한 줄 요약: 전체 진행률
  const tDone = cnt(allItems, '완료'), tPct = allItems.length ? Math.round(tDone / allItems.length * 100) : 0;
  $('dev-summary').innerHTML = `<span class="dv-sum-text">전체 <b>${allItems.length}</b>개 중 <b>${tDone}</b>개 완료</span>
    <span class="dv-sum-bar"><i style="width:${tPct}%"></i></span><span class="dv-sum-pct">${tPct}%</span>`;

  // 왼쪽 분야 목록
  const catRow = (key, label, items) => {
    const done = cnt(items, '완료'), pct = items.length ? Math.round(done / items.length * 100) : 0;
    return `<button type="button" class="dv-cat ${_devCat === key ? 'active' : ''} ${byStatus(items).length ? '' : 'none'} ${items.length && done === items.length ? 'full' : ''}" data-cat="${esc(key)}" onclick="devSetCat(this.dataset.cat)">
      <span class="dv-cat-name">${esc(label)}</span>
      <span class="dv-cat-bar"><i style="width:${pct}%"></i></span>
      <span class="dv-cat-cnt">${done}/${items.length}</span>
    </button>`;
  };
  $('dev-cats').innerHTML = `<div class="dv-cats-title">분야</div>` + catRow('', '전체', allItems) + sections.map(s => catRow(s.category, _devName(s.category), s.items || [])).join('');

  // 오른쪽 표
  const tabs = [['all', '전체', scope.length], ['completed', '완료', cnt(scope, '완료')], ['in-progress', '진행중', cnt(scope, '진행중')], ['planned', '예정', cnt(scope, '예정')]];
  const stCls = { '완료': 'done', '진행중': 'doing', '예정': 'todo' };
  const prCls = { '필수': 'must', '권장': 'rec', '선택': 'opt' };
  const rowHtml = item => {
    const open = _devOpenAll || _devOpen.has(item.id);
    return `<tr class="dv-row ${open ? 'open' : ''}" data-id="${esc(item.id)}" onclick="devToggle(this.dataset.id)">
      <td class="dv-c-st"><select class="dv-st ${stCls[item.status] || 'todo'}" data-id="${esc(item.id)}" onclick="event.stopPropagation()" onchange="changeDevItemStatus(this.dataset.id, this.value)">
        ${['완료', '진행중', '예정'].map(v => `<option ${v === item.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td class="dv-c-task"><div class="dv-task">${esc(item.task)}</div>${item.desc ? `<div class="dv-desc">${esc(item.desc)}</div>` : ''}
        ${open ? `<div class="dv-more">
          ${item.why ? `<div><span>왜 필요한가</span>${esc(item.why)}</div>` : ''}
          ${item.notes ? `<div class="memo"><span>개발 메모</span>${esc(item.notes)}</div>` : ''}
          ${!item.why && !item.notes ? '<div class="memo">추가 설명이 없습니다</div>' : ''}</div>` : ''}</td>
      <td class="dv-c-pr"><span class="dv-pr ${prCls[item.priority] || 'opt'}">${esc(item.priority || '-')}</span></td>
      <td class="dv-c-arrow">${open ? '▴' : '▾'}</td>
    </tr>`;
  };
  let body = '';
  sections.forEach(sec => {
    if (_devCat && sec.category !== _devCat) return;
    const items = byStatus(sec.items || []);
    if (!items.length) return;
    if (!_devCat) body += `<tr class="dv-group"><td colspan="4">${esc(_devName(sec.category))}<span>${cnt(sec.items || [], '완료')}/${(sec.items || []).length} 완료</span></td></tr>`;
    body += items.map(rowHtml).join('');
  });

  content.innerHTML = `<div class="dv-panel">
    <div class="dv-panel-head">
      <span class="dv-panel-title">${esc(_devCat ? _devName(_devCat) : '전체 분야')}</span>
      <span class="dv-panel-sub">${cnt(scope, '완료')}/${scope.length} 완료</span>
      <div class="svh-tabs dv-tabs">${tabs.map(([k, l, n]) => `<button class="svh-tab ${_currentDevTab === k ? 'active' : ''}" onclick="switchDevTab('${k}')">${l} ${n}</button>`).join('')}</div>
      <button class="btn btn-sm" onclick="devToggleAll()">${_devOpenAll ? '설명 접기' : '설명 모두 펼치기'}</button>
    </div>
    ${body ? `<table class="dv-tbl"><thead><tr><th class="dv-c-st">상태</th><th>항목</th><th class="dv-c-pr">중요도</th><th class="dv-c-arrow"></th></tr></thead><tbody>${body}</tbody></table>
      <div class="dv-foot">항목을 누르면 필요한 이유와 개발 메모가 펼쳐집니다 · 상태는 왼쪽 칸에서 바로 바꿀 수 있습니다</div>`
      : '<div class="dv-empty">해당 상태의 항목이 없습니다</div>'}
  </div>`;
}

async function changeDevItemStatus(itemId, newStatus) {
  try {
    await api.patch(`/api/dev/checklist/item/${itemId}`, { status: newStatus });
    await loadDevChecklist();
    toast(`상태가 변경되었습니다: ${newStatus}`);
  } catch (e) {
    toast('업데이트 실패');
    console.error(e);
  }
}


// ── 사내 테스트서버 (routers/lab.py) ─────────────────────────
let _labItems = [];
const _labPw = {};
async function renderLab(){
  const el = $('lab-content');
  try { _labItems = await _apiSend('GET', `/api/engineers/${ENG_ID}/lab`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  drawLab();
}
function _labHit(s, q){
  if(!q) return true;
  const hay = [s.group_name, s.name, s.os, s.address, s.memo, ...s.accounts.map(a => a.label + ' ' + a.username),
               ...s.conns.map(c => c.kind + ' ' + c.label + ' ' + c.host)].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}
function drawLab(){
  const el = $('lab-content');
  const q = $('lab-q').value.trim().toLowerCase();
  const items = _labItems.filter(s => _labHit(s, q));
  const groups = [];
  items.forEach(s => {
    const g = s.group_name || '미분류';
    let grp = groups.find(x => x.name === g);
    if(!grp){ grp = {name: g, rows: []}; groups.push(grp); }
    grp.rows.push(s);
  });
  $('lab-summary').textContent = _labItems.length ? `서버 ${_labItems.length}대 · 계정 ${_labItems.reduce((n, s) => n + s.accounts.length, 0)}개` : '';
  $('lab-groups').innerHTML = [...new Set(_labItems.map(s => s.group_name).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('');
  if(!items.length){
    el.innerHTML = `<div class="empty">${_labItems.length ? '검색 결과가 없습니다' : '등록된 서버가 없습니다. [+ 서버 추가]로 내 테스트 서버를 등록해주세요 (여기 등록한 정보는 본인에게만 보입니다)'}</div>`;
    return;
  }
  const acc = a => `<div class="lab-acc">
      ${a.label ? `<span class="lab-acc-label">${esc(a.label)}</span>` : ''}
      <span class="lab-copy mono" title="눌러서 복사" onclick="labCopy(this)">${esc(a.username || '-')}</span>
      ${a.has_password ? `<span class="pw-cell" id="lpw-${a.id}">••••••</span>
        <button class="btn btn-sm pw-btn" onclick="labTogglePw('${a.id}')" id="lpwb-${a.id}">보기</button>
        <button class="btn btn-sm pw-btn" onclick="labCopyPw('${a.id}')">복사</button>` : ''}
    </div>`;
  const addr = t => t.split('\n').filter(x => x.trim()).map(l => {
    const m = l.match(/^(.*?[:：]\s+)(\S.*)$/);          // "설명 : 값" 형태면 값만 복사 대상
    return `<div>${m ? `<span class="lab-addr-k">${esc(m[1])}</span>` : ''}<span class="lab-copy mono" title="눌러서 복사" onclick="labCopy(this)">${esc(m ? m[2] : l.trim())}</span></div>`;
  }).join('') || '<span class="lab-none">-</span>';
  const go = (s, c) => {
    const tip = esc(c.kind === '웹' ? c.host : `${c.host}:${c.port || (c.kind === 'RDP' ? 3389 : 22)}`);
    const text = esc(c.kind) + (c.label ? ` <span>${esc(c.label)}</span>` : '');
    if(c.kind === '웹') return `<a class="lab-go web" href="${esc(c.host)}" target="_blank" rel="noopener noreferrer" title="${tip} 새 탭으로 열기">${text}</a>`;
    return `<button class="lab-go ${c.kind === 'RDP' ? 'rdp' : 'ssh'}" title="${tip} 접속" onclick="labConnect('${s.id}','${c.id}')">${text}</button>`;
  };
  el.innerHTML = `<table class="lab-tbl">
    <colgroup><col style="width:12%"><col style="width:11%"><col style="width:14%"><col style="width:15%"><col><col style="width:13%"><col style="width:84px"></colgroup>
    <thead><tr><th>이름</th><th>OS / 버전</th><th>주소</th><th>접속</th><th>계정 / 비밀번호</th><th>메모</th><th></th></tr></thead>
    <tbody>${groups.map(g => `
      <tr class="lab-grp"><td colspan="7">${esc(g.name)} <span>${g.rows.length}</span></td></tr>
      ${g.rows.map(s => `<tr>
        <td class="lab-name">${esc(s.name)}</td>
        <td class="lab-os">${esc(s.os) || '<span class="lab-none">-</span>'}</td>
        <td>${addr(s.address)}</td>
        <td class="lab-gos">${s.conns.map(c => go(s, c)).join('') || '<span class="lab-none">-</span>'}</td>
        <td>${s.accounts.map(acc).join('') || '<span class="lab-none">-</span>'}</td>
        <td class="lab-memo">${esc(s.memo) || '<span class="lab-none">-</span>'}</td>
        <td class="lab-act">
          <button class="icon-btn edit" title="수정" onclick="openEditLab('${s.id}')">${ICO_EDIT}</button>
          <button class="icon-btn del" title="삭제" onclick="deleteLab('${s.id}')">${ICO_DEL}</button>
        </td>
      </tr>`).join('')}`).join('')}
    </tbody></table>
    <details class="lab-logs" id="lab-logs" ontoggle="if(this.open) labLoadLogs()">
      <summary>원격 접속 기록 <span>최근 50건</span></summary><div id="lab-logs-body"></div>
    </details>`;
}
// 원격 접속: SSH·RDP 는 새 탭의 접속 화면(/remote)에서 포털이 대신 접속한다
function labConnect(srvId, connId){
  const s = _labItems.find(x => x.id === srvId), c = s && s.conns.find(x => x.id === connId);
  if(!c) return;
  if(!c.account_id){ toast('접속에 쓸 계정이 지정되지 않았습니다. 수정 창에서 계정을 골라주세요'); return; }
  const q = new URLSearchParams({c: c.id, k: c.kind.toLowerCase(), n: s.name + (c.label ? ` (${c.label})` : ''),
                                 t: `${c.host}:${c.port || (c.kind === 'RDP' ? 3389 : 22)}`});
  window.open('/remote?' + q.toString(), '_blank');
}
async function labLoadLogs(){
  const el = $('lab-logs-body');
  let rows;
  try { rows = await _apiSend('GET', `/api/engineers/${ENG_ID}/lab/logs`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  if(!rows.length){ el.innerHTML = '<div class="empty">접속 기록이 없습니다</div>'; return; }
  el.innerHTML = `<table class="lab-tbl lab-log-tbl">
    <thead><tr><th>시작</th><th>종료</th><th>서버</th><th>방식</th><th>대상</th><th>계정</th><th>접속한 PC</th><th>결과</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="mono">${esc(r.started_at)}</td><td class="mono">${esc(r.ended_at ? r.ended_at.slice(11) : '-')}</td>
      <td class="lab-name">${esc(r.server_name)}</td><td>${esc(r.kind)}</td><td class="mono">${esc(r.target)}</td>
      <td class="mono">${esc(r.username)}</td><td class="mono">${esc(r.client_ip || '-')}</td>
      <td class="${r.result.startsWith('실패') ? 'lab-log-bad' : r.result === '접속 중' ? 'lab-log-on' : ''}">${esc(r.result)}</td>
    </tr>`).join('')}</tbody></table>`;
}
function labAddConnRow(c){
  c = c || {kind: 'SSH'};
  const row = document.createElement('div');
  row.className = 'lab-conn-row';
  row.dataset.id = c.id || '';
  row.dataset.acc = c.account_id || '';
  row.innerHTML = `<select class="lc-kind" onchange="labConnKind(this.parentNode)">${['웹', 'SSH', 'RDP'].map(k => `<option${k === c.kind ? ' selected' : ''}>${k}</option>`).join('')}</select>
    <input type="text" class="lc-label" placeholder="구분 (선택)" value="${esc(c.label || '')}">
    <input type="text" class="lc-host" value="${esc(c.host || '')}">
    <input type="number" class="lc-port" min="1" max="65535" value="${c.port || ''}">
    <select class="lc-acc" onfocus="labFillConnAcc(this.parentNode)"></select>
    <button class="icon-btn del" title="접속 대상 삭제" onclick="this.parentNode.remove()">${ICO_DEL}</button>`;
  $('lab-conns').appendChild(row);
  labConnKind(row);
  labFillConnAcc(row);
}
function labConnKind(row){
  const k = row.querySelector('.lc-kind').value, web = k === '웹';
  row.querySelector('.lc-host').placeholder = web ? 'https://10.10.10.10' : 'IP 또는 호스트 이름';
  row.querySelector('.lc-port').placeholder = web ? '-' : (k === 'RDP' ? '3389' : '22');
  row.querySelector('.lc-port').disabled = web;
  row.querySelector('.lc-acc').disabled = web;
}
// 계정 고르는 칸: 지금 창에 적힌 계정 줄을 그대로 보여 준다 (값 = 줄 번호)
function labFillConnAcc(row){
  const sel = row.querySelector('.lc-acc');
  const accs = [...$('lab-accs').querySelectorAll('.lab-acc-row')];
  let cur = sel.value;
  if(sel.options.length === 0 && row.dataset.acc) cur = String(accs.findIndex(r => r.dataset.id === row.dataset.acc));
  sel.innerHTML = '<option value="">계정 선택</option>' + accs.map((r, i) => {
    const u = r.querySelector('.la-user').value.trim(), l = r.querySelector('.la-label').value.trim();
    return u ? `<option value="${i}">${esc((l ? l + ' · ' : '') + u)}</option>` : '';
  }).join('');
  if(cur !== '' && cur !== '-1' && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
  else if(sel.options.length === 2 && sel.options.length - 1 === accs.length && !row.dataset.id) sel.selectedIndex = 1;   // 계정이 하나뿐이면 새 줄은 그 계정으로
}
async function _labCopyText(text, msg){
  try {
    if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(msg);
  } catch(e){ toast('복사 실패: 브라우저에서 클립보드 사용이 막혀 있습니다'); }
}
function labCopy(el){ const t = el.textContent.trim(); if(t && t !== '-') _labCopyText(t, `복사했습니다: ${t}`); }
async function _labFetchPw(id){
  if(_labPw[id] === undefined) _labPw[id] = (await _apiSend('GET', `/api/engineers/${ENG_ID}/lab/accounts/${id}/password`)).password;
  return _labPw[id];
}
async function labTogglePw(id){
  const cell = $('lpw-'+id), btn = $('lpwb-'+id);
  if(!cell) return;
  if(cell.dataset.shown){ cell.textContent = '••••••'; delete cell.dataset.shown; btn.textContent = '보기'; return; }
  let pw;
  try { pw = await _labFetchPw(id); } catch(e){ toast(e.message); return; }
  cell.textContent = pw; cell.dataset.shown = '1'; btn.textContent = '숨기기';
  clearTimeout(cell._t); cell._t = setTimeout(() => { if(cell.dataset.shown) labTogglePw(id); }, 30000);   // 30초 후 자동 숨김
}
async function labCopyPw(id){
  let pw;
  try { pw = await _labFetchPw(id); } catch(e){ toast(e.message); return; }
  _labCopyText(pw, '비밀번호를 복사했습니다');
}
function labAddAccRow(a){
  a = a || {};
  const row = document.createElement('div');
  row.className = 'lab-acc-row';
  row.dataset.id = a.id || '';
  row.innerHTML = `<input type="text" class="la-label" placeholder="용도 (OS, 웹 콘솔 ...)" value="${esc(a.label || '')}">
    <input type="text" class="la-user" placeholder="계정" value="${esc(a.username || '')}">
    <input type="password" class="la-pass" autocomplete="new-password" placeholder="${a.has_password ? '변경 시에만 입력' : '비밀번호'}">
    <button class="icon-btn del" title="계정 삭제" onclick="this.parentNode.remove()">${ICO_DEL}</button>`;
  $('lab-accs').appendChild(row);
}
function _labOpen(s){
  $('lab-modal-title').textContent = s ? '서버 수정' : '서버 추가';
  $('lab-id').value = s ? s.id : '';
  $('lab-group').value = s ? s.group_name : '';
  $('lab-name').value = s ? s.name : '';
  $('lab-os').value = s ? s.os : '';
  $('lab-addr').value = s ? s.address : '';
  $('lab-addr').style.height = Math.max(34, 20 * ((s ? s.address : '').split('\n').length) + 14) + 'px';
  $('lab-memo').value = s ? s.memo : '';
  $('lab-accs').innerHTML = '';
  (s && s.accounts.length ? s.accounts : [{}]).forEach(labAddAccRow);
  $('lab-conns').innerHTML = '';
  (s ? s.conns : []).forEach(labAddConnRow);
  openModal('modal-lab');
}
function openAddLab(){ _labOpen(null); }
function openEditLab(id){ const s = _labItems.find(x => x.id === id); if(s) _labOpen(s); }
async function saveLab(){
  const name = $('lab-name').value.trim();
  if(!name){ toast('이름을 입력해주세요'); return; }
  const id = $('lab-id').value;
  const accounts = [...$('lab-accs').querySelectorAll('.lab-acc-row')].map(r => {
    const a = {label: r.querySelector('.la-label').value, username: r.querySelector('.la-user').value};
    const pw = r.querySelector('.la-pass').value;
    if(r.dataset.id) a.id = r.dataset.id;
    if(pw || !r.dataset.id) a.password = pw;      // 기존 계정은 비워 두면 그대로 유지
    return a;
  });
  const conns = [];
  for(const r of $('lab-conns').querySelectorAll('.lab-conn-row')){
    labFillConnAcc(r);
    const kind = r.querySelector('.lc-kind').value, host = r.querySelector('.lc-host').value.trim();
    if(!host) continue;
    const port = r.querySelector('.lc-port').value, acc = r.querySelector('.lc-acc').value;
    if(kind !== '웹' && acc === ''){ toast(`${kind} 접속(${host})에 쓸 계정을 골라주세요`); return; }
    conns.push({id: r.dataset.id || null, kind, label: r.querySelector('.lc-label').value, host,
                port: kind === '웹' || !port ? null : parseInt(port), account_idx: kind === '웹' ? null : parseInt(acc)});
  }
  const body = {group_name: $('lab-group').value, name, os: $('lab-os').value, address: $('lab-addr').value, memo: $('lab-memo').value, accounts, conns};
  try {
    if(id) await _apiSend('PUT', `/api/engineers/${ENG_ID}/lab/${id}`, body);
    else   await _apiSend('POST', `/api/engineers/${ENG_ID}/lab`, body);
  } catch(e){ toast(e.message); return; }
  accounts.forEach(a => { if(a.id) delete _labPw[a.id]; });
  closeModal('modal-lab');
  $('lab-accs').innerHTML = '';
  toast(id ? '서버 정보 수정됨' : '서버 추가됨');
  renderLab();
}
async function deleteLab(id){
  const s = _labItems.find(x => x.id === id);
  if(!s || !confirm(`'${s.name}' 접속 정보를 삭제하시겠습니까?`)) return;
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/lab/${id}`); }
  catch(e){ toast(e.message); return; }
  toast('삭제됨'); renderLab();
}
