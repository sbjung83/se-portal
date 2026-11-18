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
  const dept=$('reg-dept').value.trim(),position=$('reg-position').value.trim(),email=$('reg-email').value.trim();
  $('reg-err').style.color='';
  if(!username||!password||!engineer_name||!dept||!position||!email){$('reg-err').textContent='모든 항목을 입력해주세요';return}
  if(password.length<8){$('reg-err').textContent='비밀번호는 8자 이상이어야 합니다';return}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){$('reg-err').textContent='이메일 형식이 올바르지 않습니다';return}
  const r=await api.post('/api/auth/register',{username,password,engineer_name,dept,position,email});
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
// ── 계정 관리 (관리자 전용): 가입 승인 · 사용 중지 ─────────
const USER_ST_CLS = {'승인 대기':'b-amber', '사용 중':'b-green', '사용 중지':'b-gray'};
function _usersBadgeSet(n){ const b = $('users-badge'); b.textContent = n; b.style.display = n ? '' : 'none'; }
async function _usersBadge(){
  try { _usersBadgeSet((await api.get('/api/auth/users')).filter(u => u.state === '승인 대기').length); } catch(e) {}
}
async function renderUsers(){
  let list;
  try { list = await _apiSend('GET', '/api/auth/users'); }
  catch(e){ $('users-list').innerHTML = `<div class="empty" style="color:#dc2626">계정 목록을 불러오지 못했습니다: ${esc(e.message)}</div>`; return; }
  const wait = list.filter(u => u.state === '승인 대기').length;
  _usersBadgeSet(wait);
  $('users-info').innerHTML = (wait ? `<span class="sh-mon-cnt late">승인 대기 ${wait}건</span>` : '') + `<span class="sh-mon-cnt">전체 ${list.length}명</span>`;
  const act = u => u.me ? '<span class="en-hint" style="margin:0">본인</span>'
    : u.state === '승인 대기' ? `<button class="btn btn-sm btn-primary" onclick="userAct('${u.id}','approve')">승인</button> <button class="btn btn-sm" style="color:#dc2626" onclick="userAct('${u.id}','delete')">삭제</button>`
    : u.state === '사용 중지' ? `<button class="btn btn-sm" onclick="userAct('${u.id}','approve')">다시 사용</button>`
    : u.is_admin ? '' : `<button class="btn btn-sm" onclick="userAct('${u.id}','suspend')">사용 중지</button>`;
  const row = u => `<tr class="${u.state === '사용 중지' ? 'done' : ''}">
    <td class="c"><span class="badge ${USER_ST_CLS[u.state]}">${u.state}</span></td>
    <td>${esc(u.name)}${u.is_admin ? ' <span class="badge b-blue">관리자</span>' : ''}</td>
    <td>${esc(u.username)}</td><td>${esc(u.dept || '-')}</td><td>${esc(u.position || '-')}</td>
    <td title="${esc(u.email)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.email || '-')}</td>
    <td>${esc(u.created_at || '-')}</td><td class="c">${act(u)}</td></tr>`;
  $('users-list').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">
    <colgroup><col style="width:96px"><col style="width:15%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col><col style="width:140px"><col style="width:150px"></colgroup>
    <thead><tr><th class="c">상태</th><th>이름</th><th>아이디</th><th>부서</th><th>직급</th><th>이메일</th><th>가입 신청</th><th class="c">관리</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table>`;
}
async function userAct(id, what){
  const msg = {suspend:'이 계정의 사용을 중지할까요? 로그인이 막히고 지금 로그인된 화면도 끊깁니다. 데이터는 그대로 남습니다.',
               delete:'이 가입 신청을 삭제할까요?'}[what];
  if(msg && !confirm(msg)) return;
  try {
    if(what === 'delete') await _apiSend('DELETE', `/api/auth/users/${id}`);
    else await _apiSend('POST', `/api/auth/users/${id}/${what}`);
    toast({approve:'승인했습니다', suspend:'사용 중지했습니다', delete:'삭제했습니다'}[what]);
  } catch(e){ toast('처리 실패: ' + e.message); }
  renderUsers();
}

// 내 정보 수정 (부서·직급·이메일)
async function openProfile(){
  let p;
  try { p = await _apiSend('GET', '/api/auth/profile'); } catch(e){ toast('내 정보를 불러오지 못했습니다'); return; }
  $('pf-user').value = p.username; $('pf-name').value = p.engineer_name;
  $('pf-dept').value = p.dept; $('pf-position').value = p.position; $('pf-email').value = p.email;
  $('pf-err').textContent = '';
  openModal('modal-profile');
  $('pf-dept').focus();
}
async function saveProfile(){
  const dept=$('pf-dept').value.trim(), position=$('pf-position').value.trim(), email=$('pf-email').value.trim(), err=$('pf-err');
  if(!dept||!position||!email){err.textContent='부서, 직급, 이메일을 모두 입력해주세요';return}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){err.textContent='이메일 형식이 올바르지 않습니다';return}
  try { await _apiSend('PUT','/api/auth/profile',{dept,position,email}); }
  catch(e){ err.textContent=e.message; return }
  closeModal('modal-profile');
  toast('내 정보를 저장했습니다');
}
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
  if(IS_ADMIN) _usersBadge();
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
    if(page==='technotes')      renderTechNotes();
    if(page==='work-plan')      renderWorkPlans();
    if(page==='incidents')      renderIncidents();
    if(page==='service-history') renderServiceHistory();
    if(page==='weekly-report')  renderWeeklyReport();
    if(page==='dev-checklist')  loadDevChecklist();
    if(page==='users')          renderUsers();
    if(page==='gcal')           renderGcal();
    if(page==='lab')            renderLab();
    if(page==='eos')            renderEos();
    if(page==='docs')           renderDocs();
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
  // 미완료 장애: 발생일이 오늘 이전(또는 없음)이면 이번 주 위쪽 '진행 중 장애', 앞으로 예정된 건 그 날짜 칸에
  // (점검 일정·기술지원과 함께 등록한 장애는 그 일정이 이미 날짜 칸에 나오므로 따로 넣지 않는다)
  const _occ = i => (i.occurred_at || '').slice(0, 10);
  w.incidents.filter(i => i.status !== '완료' && _occ(i) > today && inRange(_occ(i)) && !i.entry_id).forEach(i => {
    items.push({kind:'inc', done:false, day:_occ(i), time:(i.occurred_at || '').slice(11,16), title:i.title, site:i.site,
      extra:`<span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span><span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>`,
      open:`openEditIncident('${i.id}')`});
  });
  const incs = isNext ? [] : w.incidents.filter(i => i.status !== '완료' && (!_occ(i) || _occ(i) <= today));

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
let _siteFilter = '';      // 요약 칸을 눌러 고른 조건: '' | open_issues | late_sched | checklist_todo | expiring_count
function siteFilter(k){ _siteFilter = _siteFilter === k ? '' : k; drawSites(); }
function drawSites(){
  const q = ($('site-search').value || '').trim().toLowerCase();
  const el = $('site-list');
  const sum = k => _sites.reduce((a, s) => a + (s[k] || 0), 0);
  const FILTERS = [['open_issues','미해결 이슈','red'], ['late_sched','점검 지연','red'], ['checklist_todo','체크리스트 남음','amber'], ['expiring_count','워런티 만료 임박','amber']];
  $('site-summary').innerHTML =
      `<div class="wr-sum-i"><span>사이트</span><b>${_sites.length}</b></div>`
    + `<div class="wr-sum-i"><span>장비</span><b>${sum('device_count')}</b></div>`
    + FILTERS.map(([k, name, cls]) => { const v = sum(k), n = _sites.filter(s => s[k]).length;
        return `<div class="wr-sum-i st-f ${v ? cls : 'zero'}${_siteFilter === k ? ' on' : ''}" ${v ? `onclick="siteFilter('${k}')" title="눌러서 해당 사이트만 보기 (다시 누르면 해제)"` : ''}>
          <span>${name}${v ? ` <em>${n}곳</em>` : ''}</span><b>${v}</b></div>`; }).join('');
  const list = _sites.filter(s => (!q || [s.name, s.location, s.manager, s.contact, s.memo].some(v => (v || '').toLowerCase().includes(q)))
                               && (!_siteFilter || s[_siteFilter]));
  const fname = (FILTERS.find(f => f[0] === _siteFilter) || [])[1];
  $('site-list-sub').innerHTML = `${list.length}곳${fname ? ` · <b>${fname}</b> 있는 사이트만 <a href="#" onclick="siteFilter('');return false">전체 보기</a>` : ''} · 줄을 누르면 상세 화면을 엽니다`;
  if(!list.length){ el.innerHTML = `<div class="empty">${_sites.length ? '조건에 맞는 사이트가 없습니다' : '사이트가 없습니다. [+ 사이트 추가]로 등록해주세요'}</div>`; return; }
  const none = '<span class="lab-none">-</span>';
  el.innerHTML = `<div class="svh-table-wrap"><table class="wr-tbl st-tbl">
    <thead><tr><th style="width:21%">사이트</th><th>위치</th><th style="width:11%">담당자</th><th style="width:14%">연락처</th>
      <th class="c" style="width:56px">장비</th><th style="width:21%">확인할 것</th><th style="width:84px"></th></tr></thead>
    <tbody>${list.map(s => {
      const badges = [
        s.open_issues ? `<span class="badge b-red" title="미해결 이슈">이슈 ${s.open_issues}</span>` : '',
        s.late_sched ? `<span class="badge b-red" title="날짜가 지난 미완료 점검">점검 지연 ${s.late_sched}</span>` : '',
        s.checklist_todo ? `<span class="badge b-amber" title="이번 주기에 남은 체크리스트">체크 ${s.checklist_todo}</span>` : '',
        s.expiring_count ? `<span class="badge b-amber" title="90일 이내 워런티 만료">워런티 ${s.expiring_count}</span>` : '',
      ].filter(Boolean).join(' ');
      return `<tr id="site-card-${s.id}" onclick="openSiteDetail('${s.id}')">
        <td><div class="wr-site">${esc(s.name)}</div>${s.memo ? `<div class="st-memo" title="${esc(s.memo)}">${esc(s.memo)}</div>` : ''}</td>
        <td class="st-loc">${esc(s.location) || none}</td>
        <td>${esc(s.manager) || none}</td>
        <td class="st-tel">${esc(s.contact) || none}</td>
        <td class="c"><b id="dev-count-${s.id}">${s.device_count}</b></td>
        <td>${badges || '<span class="st-ok">이상 없음</span>'}</td>
        <td class="lab-act">
          <button class="icon-btn edit" title="정보 수정" onclick="event.stopPropagation();openEditSite('${s.id}')">${ICO_EDIT}</button>
          <button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteSite('${s.id}')">${ICO_DEL}</button>
        </td></tr>`; }).join('')}</tbody></table></div>`;
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
  if(cntEl) cntEl.textContent=devs.length;
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
  if(cntEl&&r.site_device_count!==undefined) cntEl.textContent=r.site_device_count;
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
  if(cntEl&&r.site_device_count!==undefined) cntEl.textContent=r.site_device_count;
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

// ── 서비스 지원 목록 공통 (점검 일정 · 기술지원 · 장애처리) ──────────
// 세 목록은 열 구성(날짜 / 사이트 / 제목+상세 / 구분 / 작업자 / [장애 시간] / 상태 / 관리)·너비·버튼 자리를 같게 쓴다.
function _svcCols(extra = ''){
  return `<colgroup><col style="width:165px"><col style="width:15%"><col><col style="width:140px"><col style="width:10%">${extra}<col style="width:64px"><col style="width:136px"></colgroup>`;
}
// 관리 칸: [Excel] [수정] [삭제] — 없는 버튼도 자리를 비워 두어 줄마다 위치가 같다
function _svcActs(xls, edit, del){
  const ph = '<button class="btn btn-sm sm-xls ph" tabindex="-1" aria-hidden="true">Excel</button>';
  return `<td class="c cl-act" onclick="event.stopPropagation()">${xls ? `<button class="btn btn-sm sm-xls" title="${xls.title}" onclick="${xls.fn}">Excel</button>` : ph}`
    + `<button class="icon-btn edit" title="수정" onclick="${edit}">${ICO_EDIT}</button>`
    + (del ? `<button class="icon-btn del" title="삭제" onclick="${del}">${ICO_DEL}</button>` : `<button class="icon-btn del ph" tabindex="-1" aria-hidden="true">${ICO_DEL}</button>`) + '</td>';
}
// 날짜 칸: "11/18 (수) 10:00" + 오늘 / 지연 D+n
function _svcDate(day, time, isDone, today, lateWord = '지연'){
  const late = !isDone && day && day < today ? _daysBetween(day, today) : 0;
  return `<td class="sm-d">${day ? _smDateLabel(day) : '-'}${time && time !== '00:00' ? ` <span class="wp-time">${time}</span>` : ''}`
    + `${day === today && !isDone ? '<span class="badge b-blue">오늘</span>' : ''}${late ? `<span class="badge b-red">${lateWord} D+${late}</span>` : ''}</td>`;
}
// 구분 배지: 점검 / 기술지원·납품·유선원격·이전·기타 / 장애처리 — 세 목록에서 같은 이름·색
const SVC_KIND_CLS = {'점검': 'b-k-check', '장애처리': 'b-k-inc'};
const _svcKind = (t, title = '') => `<span class="badge ${SVC_KIND_CLS[t] || 'b-purple'}"${title ? ` title="${esc(title)}"` : ''}>${esc(t)}</span>`;
// 툴바의 "다른 달 지연 n건 →" — 보고 있는 달 밖에 남은 미완료 건, 누르면 가장 오래된 달로 이동
function _svcOthers(days, ym, goFn, word, what){
  const others = days.filter(d => d && !d.startsWith(ym)).sort();
  return others.length ? `<button class="btn btn-sm inc-others" onclick="${goFn}('${others[0].slice(0, 7)}')" title="가장 오래된 ${word} ${what}이(가) 있는 달로 이동">다른 달 ${word} ${others.length}건 →</button>` : '';
}
const _svcCheck = (isDone, fn) => `<td class="c" onclick="event.stopPropagation()"><button class="ds-check-btn ${isDone ? 'checked' : ''}" onclick="${fn}" title="${isDone ? '완료 취소' : '완료 처리'}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" ${isDone ? '' : 'style="opacity:.3"'}><polyline points="20 6 9 17 4 12"/></svg></button></td>`;
// 점검 일정·기술지원에 함께 등록된 장애 (일정 id → 장애) — 구분 칸의 '장애처리' 표시용
let _incByEntry = {};
async function _loadIncLinks(){
  try {
    const list = await api.get(`/api/engineers/${ENG_ID}/incidents`);
    _incByEntry = {}; list.forEach(i => { if(i.entry_id) _incByEntry[i.entry_id] = i; });
  } catch(e){}
}
const _svcIncLink = id => { const i = _incByEntry[id]; return i ? _svcKind('장애처리', `함께 등록된 장애: ${i.title} (${i.status})`) : ''; };

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

// 화면 구성은 점검 일정 관리와 같다: 달 이동 → 이 달 요약 → 12개월 띠 → 표(구분 탭·사이트·검색)
let _wpYM = _ymd(new Date()).slice(0, 7);   // 보고 있는 달 "YYYY-MM"
let _wpType = '';                            // 구분 탭 ('' = 전체)
let _wpOnly = '';                            // 요약 카드로 고른 조건 ('' | done | todo | late)
const WP_TYPES = ['기술지원', '납품', '유선원격', '이전', '기타'];
const _wpTypes = p => { const t = (p.support_type || '').split(',').filter(Boolean); return t.length ? t : ['기술지원']; };
function wpMove(delta){ const [y, m] = _wpYM.split('-').map(Number); wpGo(_ymd(new Date(y, m - 1 + delta, 1)).slice(0, 7)); }
function wpGo(ym){ _wpYM = ym; _wpOnly = ''; drawWorkPlans(); }
function wpToday(){ wpGo(_ymd(new Date()).slice(0, 7)); }
function wpSetType(t){ _wpType = t; drawWorkPlans(); }
function wpSetOnly(k){ _wpOnly = _wpOnly === k ? '' : k; drawWorkPlans(); }

async function renderWorkPlans() {
  try {
    [_allWorkPlans] = await Promise.all([api.get(`/api/engineers/${ENG_ID}/workplans`), _loadIncLinks()]);
    _allWorkPlans = _allWorkPlans.filter(isSupportPlan);
  } catch (e) {
    console.error("Failed to load work plans:", e);
    $('wp-list').innerHTML = '<div class="empty" style="color:#dc2626">기술지원 목록을 불러오지 못했습니다</div>';
    return;
  }
  drawWorkPlans();
}

function drawWorkPlans() {
  const year = _wpYM.slice(0, 4), mon = Number(_wpYM.slice(5, 7));
  const today = _ymd(new Date()), nowYM = today.slice(0, 7);
  const all = _allWorkPlans;
  const isLate = p => _wpIsOverdue(p, today);
  const month = all.filter(p => (p.work_date || '').startsWith(_wpYM));
  $('wp-label').textContent = `${year}년 ${mon}월`;
  $('wp-today-btn').style.visibility = _wpYM === nowYM ? 'hidden' : 'visible';
  $('wp-others').innerHTML = _svcOthers(all.filter(isLate).map(_wpDay), _wpYM, 'wpGo', '지연', '기술지원');

  // 이 달 요약 (카드를 누르면 그 조건만 표시)
  const done = month.filter(p => p.status === '완료').length, late = month.filter(isLate).length;
  const pct = month.length ? Math.round(done / month.length * 100) : 0;
  const act = k => _wpOnly === k ? ' active' : '';
  $('wp-summary').innerHTML = `
    <div class="metric m-gray${act('')}" onclick="wpSetOnly('')" title="전체 보기"><div class="metric-label">${mon}월 전체</div><div class="metric-value">${month.length}<small>건</small></div></div>
    <div class="metric m-green${act('done')}" onclick="wpSetOnly('done')" title="완료한 건만 보기"><div class="metric-label">완료</div><div class="metric-value">${done}<small>건 (${pct}%)</small></div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${pct}%;background:#22c55e"></div></div></div>
    <div class="metric m-blue${act('todo')}" onclick="wpSetOnly('todo')" title="남은 건만 보기"><div class="metric-label">남음</div><div class="metric-value">${month.length - done}<small>건</small></div></div>
    <div class="metric m-red${act('late')}" onclick="wpSetOnly('late')" title="작업일이 지났는데 완료하지 않은 건만 보기"><div class="metric-label">지연</div><div class="metric-value" style="${late ? 'color:#dc2626' : ''}">${late}<small>건</small></div></div>`;

  // 12개월 띠
  $('wp-months').innerHTML = Array.from({length: 12}, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    const its = all.filter(p => (p.work_date || '').startsWith(ym)), dn = its.filter(p => p.status === '완료').length;
    const cls = [ym === _wpYM ? 'active' : '', ym === nowYM ? 'cur' : '', !its.length ? 'none' : dn === its.length ? 'full' : its.some(isLate) ? 'late' : ''].join(' ');
    return `<button class="sm-mon ${cls}" onclick="wpGo('${ym}')" title="${i + 1}월${its.length ? ` · 완료 ${dn}/${its.length}` : ' · 기술지원 없음'}">
      <span class="sm-mon-name">${i + 1}월</span><span class="sm-mon-cnt">${its.length ? `${dn}/${its.length}` : '-'}</span></button>`;
  }).join('');

  // 구분 탭 · 사이트 선택 · 검색
  $('wp-types').innerHTML = ['', ...WP_TYPES].map(t =>
    `<button class="svh-tab ${_wpType === t ? 'active' : ''}" onclick="wpSetType('${t}')">${t || '전체'} ${month.filter(p => !t || _wpTypes(p).includes(t)).length}</button>`).join('');
  const sel = $('wp-site-filter'), prev = sel.value;
  const sites = [...new Set(month.map(p => (p.site || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  sel.innerHTML = '<option value="">전체 사이트</option>' + sites.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(sites.includes(prev)) sel.value = prev;
  const q = $('wp-search').value.toLowerCase().trim();

  const list = month.filter(p => (!_wpType || _wpTypes(p).includes(_wpType)) && (!sel.value || (p.site || '').trim() === sel.value)
      && (!q || [p.title, p.site, p.worker, p.reviewer, p.purpose, ..._wpTypes(p), p.from_schedule ? '점검' : '', _incByEntry[p.id] ? '장애처리' : ''].some(v => (v || '').toLowerCase().includes(q)))
      && (!_wpOnly || (_wpOnly === 'done' ? p.status === '완료' : _wpOnly === 'late' ? isLate(p) : p.status !== '완료')))
    .sort((a, b) => (a.work_date || '').localeCompare(b.work_date || '') || (a.site || '').localeCompare(b.site || '', 'ko'));

  const row = p => {
    const isDone = p.status === '완료', day = _wpDay(p), time = (p.work_date || '').slice(11, 16);
    return `<tr class="${isDone ? 'done' : ''} ${day === today ? 'today' : ''}" onclick="openEditWorkPlan('${p.id}')" style="cursor:pointer">
      ${_svcDate(day, time, isDone, today)}
      <td class="sm-s" title="${esc(p.site)}">${esc(p.site || '-')}</td>
      <td class="sm-t">${esc(p.title)}${_wpImpactBadge(p.impact) ? ' ' + _wpImpactBadge(p.impact) : ''}
        ${p.purpose ? `<div class="wp-purpose" title="${esc(p.purpose)}">${esc(p.purpose)}</div>` : ''}</td>
      <td class="c"><div class="svc-kind">${p.from_schedule ? _svcKind('점검', '점검 일정에 함께 등록된 건 — 삭제는 점검 일정에서') : ''}${_wpTypes(p).map(t => _svcKind(t)).join('')}${_svcIncLink(p.id)}</div></td>
      <td class="wp-worker" title="${esc(p.worker)}">${esc(p.worker || '-')}</td>
      ${_svcCheck(isDone, `changeWorkPlanStatus('${p.id}', '${isDone ? '예정' : '완료'}')`)}
      ${_svcActs(p.has_plan ? {title: '작업계획서 엑셀 내려받기', fn: `downloadWorkPlanExcel('${p.id}')`} : null, `openEditWorkPlan('${p.id}')`, p.from_schedule ? '' : `deleteWorkPlan('${p.id}')`)}
    </tr>`;
  };
  const emptyMsg = !month.length ? `${mon}월에 등록된 기술지원이 없습니다` : '조건에 맞는 기술지원이 없습니다';
  const cols = _svcCols();
  $('wp-panel-title').textContent = `${mon}월 기술지원`;
  $('wp-panel-info').innerHTML = (list.length !== month.length ? `<span class="sh-mon-note">${list.length}건 표시 중</span>` : '')
    + (late ? `<span class="sh-mon-cnt late">지연 ${late}건</span>` : '')
    + (month.length ? `<span class="sh-mon-cnt">${done}/${month.length} 완료</span>` : '');
  $('wp-list').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">${cols}
    <thead><tr><th>날짜</th><th>사이트</th><th>제목</th><th class="c">구분</th><th>작업자</th><th class="c">완료</th><th class="c">관리</th></tr></thead>
    <tbody>${list.length ? list.map(row).join('') : `<tr class="cl-msg"><td colspan="7">${emptyMsg}</td></tr>`}</tbody></table>`;
}
async function changeWorkPlanStatus(id, status){
  const p = _allWorkPlans.find(x => x.id === id);
  if(!p) return;
  try {
    // 점검 일정에 함께 등록된 건은 점검 일정의 상태를 바꾼다
    await _apiSend('PATCH', `/api/engineers/${ENG_ID}/${p.from_schedule ? 'schedules' : 'workplans'}/${id}`, { status });
    p.status = status;
    if(_incByEntry[id]) await _loadIncLinks();     // 함께 등록된 장애의 상태도 바뀐다
    toast(status === '완료' ? '완료 처리됨' : '완료 취소됨');
  } catch(e) {
    toast('변경 실패: ' + e.message);
  }
  drawWorkPlans();
  _refreshSvcHistory(); _refreshDash();
}
$('wp-search').addEventListener('input', () => { clearTimeout(window._wpT); window._wpT = setTimeout(drawWorkPlans, 200); });

// ── 일정 공통 입력 창 (점검 · 기술지원 · 장애처리) ─────────
// 구분 체크박스에 '점검'이 있으면 점검 일정으로, 없으면 기술지원으로 저장된다 (routers/entries.py)
// '장애처리'를 체크하면 "장애처리 보고서" 탭이 생기고 장애 기록(Incident)이 함께 저장된다. 장애처리만 체크하면 장애 기록만 만든다.
const ENTRY_PLAN_IDS = ['wp-prerequisites', 'wp-verification', 'wp-rollback'];
const ENTRY_SITE_MANUAL = '__manual__';   // 사이트 칸의 "직접 입력" — 등록되지 않은 고객사·다른 엔지니어의 사이트 (점검은 불가)
function entrySiteChanged(){
  const manual = $('wp-site').value === ENTRY_SITE_MANUAL;
  $('wp-site-manual').style.display = manual ? '' : 'none';
  if(manual && !$('wp-site-manual').value) $('wp-site-manual').focus();
}
function _entryTypes(){ return [...document.querySelectorAll('#wp-types input:checked')].map(c => c.value); }
let _entryTab = '';          // 펼쳐 놓은 탭 ('' = 접힘 | plan | report)
let _entryHadInc = false;    // 직전에 '장애처리'가 체크되어 있었는지
let _entryIncId = '';        // 열 때 이미 저장되어 있던 장애처리 보고서 id
let _entryHasPlan = false;
let _entryOccAuto = true;    // 발생 일시를 위의 날짜·시간에 맞춰 따라가게 할지 (직접 고치면 멈춤)
const ENTRY_INC_IDS = ['inc-title', 'inc-device', 'inc-recovered', 'inc-symptom', 'inc-cause', 'inc-action', 'inc-prevention'];
function entryTypesChanged(){
  const types = _entryTypes();
  const isCheck = types.includes('점검'), hasInc = types.includes('장애처리'), incOnly = hasInc && types.length === 1;
  const kind = isCheck ? '점검' : incOnly ? '장애' : hasInc && !types.some(t => t !== '장애처리' && t !== '기술지원') ? '기술지원 · 장애' : '기술지원';
  $('wp-modal-title').textContent = `${kind} ${$('wp-id').value ? '수정' : '등록'}`;
  $('wp-title').placeholder = incOnly ? '예: DB 서버 디스크 장애로 서비스 지연' : isCheck ? '예: 11월 정기점검 (PM)' : '예: vCenter 통합 작업';
  $('wp-site-req').style.display = isCheck ? '' : 'none';
  // 숨기는 칸은 display:none — 남은 칸이 줄을 채운다(grid-auto)
  $('wp-sched-type-row').style.display = isCheck ? '' : 'none';
  // 장애처리만 하는 건은 장애 기록 1건만 남으므로 일정 쪽 칸(결재자·메모·세부 작업계획)과 따로 받던 발생 일시는 감춘다
  $('wp-reviewer-row').style.display = incOnly ? 'none' : '';
  $('wp-purpose-row').style.display = incOnly ? 'none' : '';
  $('inc-title-row').style.display = incOnly ? 'none' : '';
  $('inc-occ-row').style.display = incOnly ? 'none' : '';
  $('wp-day-lbl').textContent = incOnly ? '발생 날짜' : '날짜';
  $('wp-time-lbl').textContent = incOnly ? '발생 시간' : '시간';
  _entryStatusOpts(hasInc);
  $('wp-status-hint').textContent = hasInc && !incOnly ? '장애 처리 상태 — 완료하면 일정도 완료' : '';
  $('wp-inc-excel').style.display = _entryIncId && hasInc ? '' : 'none';
  $('wp-tab-plan').style.display = incOnly ? 'none' : '';
  $('wp-tab-report').style.display = hasInc ? '' : 'none';
  $('wp-excel').style.display = $('wp-id').value && _entryHasPlan && !incOnly ? '' : 'none';
  $('wp-tab-hint').textContent = hasInc ? (incOnly ? '장애처리만 하는 건은 보고서만 작성합니다' : '탭을 눌러 펼치고, 한 번 더 누르면 접습니다')
    : '영향도 · 사전 준비 · 상세 절차(MOP) · 확인사항 · 비상 계획 — 필요할 때만 작성';
  if(hasInc && !_entryHadInc){ entrySyncOccurred(); entryTab('report', true); }     // 방금 체크함 → 보고서 탭을 연다
  else if(!hasInc && _entryTab === 'report') entryTab('', true);
  else if(incOnly && _entryTab === 'plan') entryTab('report', true);
  _entryHadInc = hasInc;
}
// 상태는 하나: 장애처리를 체크하면 접수/처리중/완료(일정은 완료일 때만 완료), 아니면 예정/완료
function _entryStatusOpts(hasInc){
  const sel = $('wp-status');
  if(sel.dataset.mode === String(hasInc)) return;
  const cur = sel.value;
  sel.innerHTML = (hasInc ? ['접수', '처리중', '완료'] : ['예정', '완료']).map(o => `<option>${o}</option>`).join('');
  sel.value = cur === '완료' ? '완료' : hasInc ? '접수' : '예정';
  sel.dataset.mode = String(hasInc);
}
// 탭을 누르면 펼치고, 펼쳐진 탭을 다시 누르면 접는다
function entryTab(name, force){
  _entryTab = (!force && _entryTab === name) ? '' : name;
  $('wp-pane-plan').style.display = _entryTab === 'plan' ? '' : 'none';
  $('wp-pane-report').style.display = _entryTab === 'report' ? '' : 'none';
  $('wp-tab-plan').classList.toggle('active', _entryTab === 'plan');
  $('wp-tab-report').classList.toggle('active', _entryTab === 'report');
  $('wp-plan').classList.toggle('open', !!_entryTab);
  if(_entryTab === 'plan') document.querySelectorAll('#wp-mop textarea').forEach(mopGrow);
  _entryMarkTabs();
}
// 내용이 적힌 탭에 점을 찍어 준다
function _entryMarkTabs(){
  const plan = ENTRY_PLAN_IDS.some(id => $(id).value.trim()) || !!mopGet('wp-mop') || $('wp-impact').value !== '없음';
  const rep = ['inc-device', 'inc-symptom', 'inc-cause', 'inc-action', 'inc-prevention'].some(id => $(id).value.trim()) || incGetParts().length > 0;
  $('wp-tab-plan').classList.toggle('filled', plan);
  $('wp-tab-report').classList.toggle('filled', rep);
}
// 사용 파트 표 (장애처리 보고서)
const INC_PART_F = ['name', 'part_no', 'qty', 'old_sn', 'new_sn', 'note'];
function _incPartRow(p = {}){
  const t = (f, ph) => `<td><input type="text" class="ip-${f}" value="${esc(p[f] || '')}" placeholder="${ph}" oninput="_entryMarkTabs()"></td>`;
  return `<tr><td class="c ip-no"></td>${t('name', '예: 600GB SAS HDD')}${t('part_no', '예: 00YK013')}
    <td><input type="number" class="ip-qty" min="1" step="1" value="${p.qty || 1}"></td>
    ${t('old_sn', '')}${t('new_sn', '')}${t('note', '예: Slot 3, RMA 번호')}
    <td class="c"><button type="button" class="icon-btn del" title="이 줄 삭제" onclick="incDelPart(this)">${ICO_DEL}</button></td></tr>`;
}
function _incPartsNo(){ [...$('inc-parts').children].forEach((tr, n) => tr.querySelector('.ip-no').textContent = n + 1); }
function incSetParts(list){
  $('inc-parts').innerHTML = (list && list.length ? list : [{}]).map(_incPartRow).join('');
  _incPartsNo();
}
function incAddPart(){
  if($('inc-parts').children.length >= 50){ toast('파트는 50줄까지 넣을 수 있습니다'); return; }
  $('inc-parts').insertAdjacentHTML('beforeend', _incPartRow());
  _incPartsNo();
  $('inc-parts').lastElementChild.querySelector('.ip-name').focus();
}
function incDelPart(btn){
  btn.closest('tr').remove();
  if(!$('inc-parts').children.length) incSetParts([]);
  _incPartsNo(); _entryMarkTabs();
}
function incGetParts(){
  return [...$('inc-parts').children].map(tr => {
    const p = {}; INC_PART_F.forEach(f => p[f] = tr.querySelector('.ip-' + f).value.trim());
    p.qty = Math.max(parseInt(p.qty, 10) || 1, 1);
    return p;
  }).filter(p => p.name || p.part_no || p.old_sn || p.new_sn);
}
function entrySyncOccurred(){
  if(!_entryOccAuto) return;
  const d = $('wp-day').value, t = $('wp-time').value;
  $('inc-occurred').value = d && t ? `${d}T${t}` : '';
}
function openAddWorkPlan(){ return openEntry(null, ['기술지원']); }
function openEditWorkPlan(p){ return openEntry(typeof p === 'string' ? p : p && p.id); }

async function openEntry(id, types = ['기술지원'], tab){
  const newInc = !id && types.includes('장애처리');      // 장애 등록: 지금 시각·본인 이름을 기본값으로
  const now = new Date();
  let e = { id:'', types, title:'', day:_ymd(now), time: newInc ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : '',
            site_id:'', site_name:'', sched_type:'월간', status:'예정',
            memo:'', worker: newInc ? (ENG_NAME || '') : '', reviewer:'', impact:'', prerequisites:'', mop_content:'', verification:'', rollback_plan:'', has_plan:false };
  let sites = [];
  try {
    sites = await api.get(`/api/engineers/${ENG_ID}/sites`);
    if(id) e = await _apiSend('GET', `/api/engineers/${ENG_ID}/entries/${id}`);
  } catch(err) { toast(id ? '일정을 찾을 수 없습니다' : '사이트 목록을 불러오지 못했습니다'); if(id) return; }

  $('wp-modal-title').textContent = id ? '일정 수정' : '일정 등록';
  $('wp-id').value = e.id || '';
  document.querySelectorAll('#wp-types input').forEach(c => c.checked = e.types.includes(c.value));
  const manualName = e.site_id ? '' : (e.site_name || '');
  $('wp-site').innerHTML = '<option value="">— 선택 —</option>'
    + sites.map(x => `<option value="${esc(x.id)}" ${x.id === e.site_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    + `<option value="${ENTRY_SITE_MANUAL}" ${manualName ? 'selected' : ''}>✎ 직접 입력 (목록에 없는 사이트)</option>`;
  $('wp-site-manual').value = manualName;
  $('wp-site-manual').style.display = manualName ? '' : 'none';
  $('wp-title').value = e.title;
  $('wp-day').value = e.day; $('wp-time').value = e.time || '';
  $('wp-sched-type').value = e.sched_type || '월간';
  $('wp-worker').value = e.worker || ''; $('wp-reviewer').value = e.reviewer || '';
  $('wp-purpose').value = e.memo || '';
  $('wp-impact').value = e.impact || '없음';
  if($('wp-impact').selectedIndex < 0) $('wp-impact').value = '없음';
  $('wp-prerequisites').value = e.prerequisites || '';
  mopSet('wp-mop', e.mop_content || '');
  $('wp-verification').value = e.verification || '';
  $('wp-rollback').value = e.rollback_plan || '';
  // 장애처리 보고서
  const hasInc = e.types.includes('장애처리');
  _entryIncId = e.inc_id || '';
  $('inc-title').value = e.inc_title && e.inc_title !== e.title ? e.inc_title : '';
  $('inc-device').value = e.inc_device || '';
  $('inc-severity').value = e.inc_severity || '보통';
  $('wp-status').dataset.mode = ''; _entryStatusOpts(hasInc);
  $('wp-status').value = hasInc ? (e.inc_status || '접수') : (e.status || '예정');
  $('inc-occurred').value = e.inc_occurred_at || ''; $('inc-recovered').value = e.inc_recovered_at || '';
  ['symptom', 'cause', 'action', 'prevention'].forEach(f => $('inc-' + f).value = e[f] || '');
  incSetParts(e.inc_parts || []);
  _entryOccAuto = !e.inc_occurred_at || e.inc_occurred_at === `${e.day}T${e.time}`;
  _entryHasPlan = !!e.has_plan;
  _entryHadInc = hasInc;
  entrySyncOccurred();
  // 탭: 장애 쪽에서 열었으면 보고서, 아니면 내용이 있는 탭만 펼쳐서 보여 준다
  const planFilled = !!(e.prerequisites || e.mop_content || e.verification || e.rollback_plan || (e.impact && e.impact !== '없음'));
  _entryTab = '';
  entryTypesChanged();
  entryTab(hasInc && (tab === 'report' || !planFilled) ? 'report' : planFilled ? 'plan' : '', true);
  openModal('modal-add-workplan');
}

function _entryPayload(){
  const manual = $('wp-site').value === ENTRY_SITE_MANUAL;
  const types = _entryTypes(), hasInc = types.includes('장애처리'), incOnly = hasInc && types.length === 1, st = $('wp-status').value;
  return {
    types: _entryTypes(), title: $('wp-title').value.trim(), day: $('wp-day').value, time: $('wp-time').value,
    site_id: manual ? '' : $('wp-site').value, site_name: manual ? $('wp-site-manual').value.trim() : '',
    sched_type: $('wp-sched-type').value, status: hasInc ? (st === '완료' ? '완료' : '예정') : st, memo: $('wp-purpose').value,
    worker: $('wp-worker').value.trim(), reviewer: $('wp-reviewer').value.trim(),
    impact: $('wp-impact').value, prerequisites: $('wp-prerequisites').value, mop_content: mopGet('wp-mop'),
    verification: $('wp-verification').value, rollback_plan: $('wp-rollback').value,
    inc_title: $('inc-title').value.trim(), inc_device: $('inc-device').value.trim(),
    inc_severity: $('inc-severity').value, inc_status: hasInc ? st : '접수',
    inc_occurred_at: incOnly ? '' : $('inc-occurred').value, inc_recovered_at: $('inc-recovered').value,     // 장애만이면 발생 = 위의 날짜·시간
    symptom: $('inc-symptom').value, cause: $('inc-cause').value, action: $('inc-action').value, prevention: $('inc-prevention').value,
    inc_parts: incGetParts(),
  };
}

// 저장하고 {id, kind} 를 돌려준다. 실패하면 null (입력 내용은 그대로 둠)
async function _entrySave(){
  const body = _entryPayload();
  if(!body.types.length){ toast('구분을 하나 이상 골라주세요'); return null; }
  if(!body.title){ toast('제목을 입력해주세요'); return null; }
  if(!body.day){ toast('날짜를 입력해주세요'); return null; }
  if(body.types.includes('점검') && !body.site_id){ toast('점검은 목록에 등록된 사이트를 골라주세요'); return null; }
  if(body.types.includes('장애처리')){
    const occ = body.inc_occurred_at || (body.day + (body.time ? 'T' + body.time : ''));
    if(body.inc_recovered_at && body.inc_recovered_at < occ){ entryTab('report', true); toast('복구 일시가 발생 일시보다 빠릅니다'); return null; }
  } else if(_entryIncId && !confirm('장애처리 체크를 풀고 저장하면 작성해 둔 장애처리 보고서가 지워집니다. 계속할까요?')) return null;
  const id = $('wp-id').value;
  try {
    return await _apiSend(id ? 'PUT' : 'POST', `/api/engineers/${ENG_ID}/entries${id ? '/' + id : ''}`, body);
  } catch(e) { toast('저장 실패: ' + e.message); return null; }
}

async function _entryRefresh(){
  await loadSchedWorkPlans(true);
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
  if($('page-work-plan').classList.contains('active')) renderWorkPlans();
  if($('page-incidents').classList.contains('active')) renderIncidents();
  else _allIncidents = [];                       // 다음에 열 때 다시 읽는다
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
  toast(`${{schedule:'점검', workplan:'기술지원', incident:'장애처리'}[r.kind]}${r.inc_id && r.kind !== 'incident' ? ' + 장애처리 보고서' : ''} ${wasNew ? '등록됨' : '수정됨'}`);
}

// 창에 적힌 내용을 먼저 저장한 뒤 작업계획서 엑셀을 내려받는다
async function downloadEntryExcel(){
  const r = await _entrySave();
  if(!r) return;
  $('wp-id').value = r.id; _entryIncId = r.inc_id || '';
  _entryRefresh();
  window.location.href = `/api/engineers/${ENG_ID}/workplans/${r.id}/download`;
}

// 창에 적힌 내용을 먼저 저장한 뒤 장애처리 보고서 엑셀을 내려받는다
async function downloadEntryIncReport(){
  const r = await _entrySave();
  if(!r) return;
  $('wp-id').value = r.id; _entryIncId = r.inc_id || '';
  entryTypesChanged(); _entryRefresh();
  if(_entryIncId) downloadIncidentReport(_entryIncId);
}

async function deleteWorkPlan(id) {
  const p = _allWorkPlans.find(x => x.id === id);
  if(!confirm(`${p ? `"${p.site ? p.site + ' - ' : ''}${p.title}" ` : ''}기술지원을 삭제하시겠습니까?${_incByEntry[id] ? '\n함께 등록된 장애 기록은 장애처리에 그대로 남습니다.' : ''}`)) return;
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/workplans/${id}`); }
  catch(e){ toast('삭제 실패: ' + e.message); return; }
  renderWorkPlans(); _refreshSvcHistory(); _refreshDash(); toast('삭제됨');
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
  return `<div class="metric m-violet" style="cursor:pointer" title="서비스 지원 이력으로 이동"
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

// 화면 구성은 점검 일정·기술지원과 같다: 달 이동 → 이 달 요약 → 12개월 띠 → 표(상태 탭·사이트·검색)
let _incYM = _ymd(new Date()).slice(0, 7);   // 보고 있는 달 "YYYY-MM" (발생 일시 기준)
let _incSt = '';                              // 상태 탭 ('' = 전체)
let _incOnly = '';                            // 요약 카드로 고른 조건 ('' | done | open | high)
function incMove(delta){ const [y, m] = _incYM.split('-').map(Number); incGo(_ymd(new Date(y, m - 1 + delta, 1)).slice(0, 7)); }
function incGo(ym){ _incYM = ym; _incOnly = ''; drawIncidents(); }
function incToday(){ incGo(_ymd(new Date()).slice(0, 7)); }
function incSetSt(t){ _incSt = t; drawIncidents(); }
function incSetOnly(k){ _incOnly = _incOnly === k ? '' : k; drawIncidents(); }

async function renderIncidents(){
  try {
    _allIncidents = await api.get(`/api/engineers/${ENG_ID}/incidents`);
  } catch(e) {
    console.error('장애 목록 조회 실패:', e);
    $('inc-list').innerHTML = '<div class="empty" style="color:#dc2626">장애 목록을 불러오지 못했습니다.</div>';
    return;
  }
  drawIncidents();
}

function drawIncidents(){
  const year = _incYM.slice(0, 4), mon = Number(_incYM.slice(5, 7));
  const nowYM = _ymd(new Date()).slice(0, 7);
  const all = _allIncidents;
  const today = _ymd(new Date());
  const isOpen = i => i.status !== '완료', isHigh = i => i.severity === '긴급' || i.severity === '높음';
  const isLate = i => isOpen(i) && (i.occurred_at || '').slice(0, 10) < today;     // 발생일이 지났는데 아직 처리 중
  const month = all.filter(i => (i.occurred_at || '').startsWith(_incYM));
  $('inc-label').textContent = `${year}년 ${mon}월`;
  $('inc-today-btn').style.visibility = _incYM === nowYM ? 'hidden' : 'visible';

  // 다른 달에 남아 있는 미완료 장애 (가장 오래된 달로 이동)
  $('inc-others').innerHTML = _svcOthers(all.filter(isOpen).map(i => i.occurred_at || ''), _incYM, 'incGo', '미완료', '장애');

  // 이 달 요약 (카드를 누르면 그 조건만 표시)
  const done = month.filter(i => !isOpen(i)).length, open = month.length - done, high = month.filter(isHigh).length;
  const pct = month.length ? Math.round(done / month.length * 100) : 0;
  const downSum = month.reduce((a, i) => a + (i.downtime_min || 0), 0);
  const act = k => _incOnly === k ? ' active' : '';
  $('inc-summary').innerHTML = `
    <div class="metric m-gray${act('')}" onclick="incSetOnly('')" title="전체 보기"><div class="metric-label">${mon}월 전체</div><div class="metric-value">${month.length}<small>건</small></div></div>
    <div class="metric m-green${act('done')}" onclick="incSetOnly('done')" title="처리를 끝낸 건만 보기"><div class="metric-label">완료</div><div class="metric-value">${done}<small>건 (${pct}%)</small></div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${pct}%;background:#22c55e"></div></div></div>
    <div class="metric m-blue${act('open')}" onclick="incSetOnly('open')" title="접수·처리중인 건만 보기"><div class="metric-label">미완료 (접수·처리중)</div><div class="metric-value" style="${open ? 'color:#d97706' : ''}">${open}<small>건</small></div></div>
    <div class="metric m-red${act('high')}" onclick="incSetOnly('high')" title="등급이 긴급·높음인 건만 보기"><div class="metric-label">긴급·높음</div><div class="metric-value" style="${high ? 'color:#dc2626' : ''}">${high}<small>건</small></div></div>`;

  // 12개월 띠
  $('inc-months').innerHTML = Array.from({length: 12}, (_, n) => {
    const ym = `${year}-${String(n + 1).padStart(2, '0')}`;
    const its = all.filter(i => (i.occurred_at || '').startsWith(ym)), dn = its.filter(i => !isOpen(i)).length;
    const cls = [ym === _incYM ? 'active' : '', ym === nowYM ? 'cur' : '', !its.length ? 'none' : dn === its.length ? 'full' : its.some(isLate) ? 'late' : ''].join(' ');
    return `<button class="sm-mon ${cls}" onclick="incGo('${ym}')" title="${n + 1}월${its.length ? ` · 완료 ${dn}/${its.length}` : ' · 장애 없음'}">
      <span class="sm-mon-name">${n + 1}월</span><span class="sm-mon-cnt">${its.length ? `${dn}/${its.length}` : '-'}</span></button>`;
  }).join('');

  // 상태 탭 · 사이트 선택 · 검색
  $('inc-sts').innerHTML = ['', '접수', '처리중', '완료'].map(t =>
    `<button class="svh-tab ${_incSt === t ? 'active' : ''}" onclick="incSetSt('${t}')">${t || '전체'} ${month.filter(i => !t || i.status === t).length}</button>`).join('');
  const sel = $('inc-site-filter'), prev = sel.value;
  const sites = [...new Set(month.map(i => (i.site || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  sel.innerHTML = '<option value="">전체 사이트</option>' + sites.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(sites.includes(prev)) sel.value = prev;
  const q = $('inc-search').value.toLowerCase().trim();

  const list = month.filter(i => (!_incSt || i.status === _incSt) && (!sel.value || (i.site || '').trim() === sel.value)
      && (!q || [i.title, i.site, i.device, i.worker, i.symptom, i.cause, i.action, i.severity, ...(i.entry_types || []),
          ...(i.parts || []).flatMap(p => [p.name, p.part_no, p.old_sn, p.new_sn])].some(v => (v || '').toLowerCase().includes(q)))
      && (!_incOnly || (_incOnly === 'done' ? !isOpen(i) : _incOnly === 'open' ? isOpen(i) : isHigh(i))))
    .sort((a, b) => (a.occurred_at || '').localeCompare(b.occurred_at || '') || (a.site || '').localeCompare(b.site || '', 'ko'));
  const late = month.filter(isLate).length;

  const row = i => {
    const day = (i.occurred_at || '').slice(0, 10), time = (i.occurred_at || '').slice(11, 16);
    const kinds = i.entry_id ? (i.entry_types && i.entry_types.length ? i.entry_types : [i.entry_id.startsWith('wp-') ? '기술지원' : '점검']) : [];
    const link = kinds.map(t => _svcKind(t, '이 일정과 함께 등록된 장애 — 누르면 그 일정이 함께 열립니다')).join('');
    const parts = i.parts || [];
    const partTxt = parts.length ? `파트: ${parts.map(p => (p.name || p.part_no) + (p.qty > 1 ? ` ×${p.qty}` : '')).join(', ')}` : '';
    const sub = [i.device ? `장비: ${i.device}` : '', partTxt, i.cause ? `원인: ${i.cause}` : ''].filter(Boolean).join(' · ');
    return `<tr class="${isOpen(i) ? '' : 'done'} ${day === today ? 'today' : ''}" onclick="openEditIncident('${i.id}')" style="cursor:pointer">
      ${_svcDate(day, time, !isOpen(i), today, '미처리')}
      <td class="sm-s" title="${esc(i.site)}">${esc(i.site || '-')}</td>
      <td class="sm-t">${esc(i.title)}${sub ? `<div class="wp-purpose" title="${esc(sub)}">${esc(sub)}</div>` : ''}</td>
      <td class="c"><div class="svc-kind"><span class="badge ${INC_SEV_CLS[i.severity] || 'b-gray'}" title="장애 등급">${esc(i.severity)}</span>${link}</div></td>
      <td class="wp-worker" title="${esc(i.worker)}">${esc(i.worker || '-')}</td>
      <td class="inc-down" title="${i.recovered_at ? `복구 ${esc(fmtDT(i.recovered_at))}` : '복구 일시가 아직 없습니다'}">${i.downtime_min !== null && i.downtime_min !== undefined ? fmtDuration(i.downtime_min) : '<span class="inc-nodown">복구 전</span>'}</td>
      <td class="c"><span class="badge ${INC_ST_CLS[i.status] || 'b-gray'}">${esc(i.status)}</span></td>
      ${_svcActs({title: '장애처리 보고서 엑셀 내려받기', fn: `downloadIncidentReport('${i.id}')`}, `openEditIncident('${i.id}')`, `deleteIncident('${i.id}')`)}
    </tr>`;
  };
  const emptyMsg = !month.length ? `${mon}월에 발생한 장애가 없습니다` : '조건에 맞는 장애가 없습니다';
  const cols = _svcCols('<col style="width:96px">');
  $('inc-panel-title').textContent = `${mon}월 장애처리`;
  $('inc-panel-info').innerHTML = (list.length !== month.length ? `<span class="sh-mon-note">${list.length}건 표시 중</span>` : '')
    + (late ? `<span class="sh-mon-cnt late">미처리 ${late}건</span>` : '')
    + (downSum ? `<span class="sh-mon-cnt late">장애 시간 ${fmtDuration(downSum)}</span>` : '')
    + (month.length ? `<span class="sh-mon-cnt">${done}/${month.length} 완료</span>` : '');
  $('inc-list').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">${cols}
    <thead><tr><th>발생 일시</th><th>사이트</th><th>장애명</th><th class="c">등급 · 구분</th><th>작업자</th><th>장애 시간</th><th class="c">상태</th><th class="c">관리</th></tr></thead>
    <tbody>${list.length ? list.map(row).join('') : `<tr class="cl-msg"><td colspan="8">${emptyMsg}</td></tr>`}</tbody></table>`;
}
$('inc-search').addEventListener('input', () => { clearTimeout(window._incT); window._incT = setTimeout(drawIncidents, 200); });
$('sm-search').addEventListener('input', () => { clearTimeout(window._smT); window._smT = setTimeout(drawSchedMgmt, 200); });

// 장애 등록·수정은 일정 공통 입력 창을 쓴다 (구분 '장애처리' + "장애처리 보고서" 탭).
// 점검/기술지원과 함께 등록된 장애는 그 일정을 열어 보고서 탭을 보여 준다.
function openAddIncident(){ return openEntry(null, ['장애처리']); }
function openEditIncident(id){ return openEntry(id, undefined, 'report'); }

async function deleteIncident(id){
  const i = _allIncidents.find(x => x.id === id);
  if(!confirm(`${i ? `"${i.site ? i.site + ' - ' : ''}${i.title}" ` : ''}장애 기록을 삭제하시겠습니까?${i && i.entry_id ? '\n함께 등록된 점검 일정/기술지원은 그대로 남습니다.' : ''}`)) return;
  try { await _apiSend('DELETE', `/api/engineers/${ENG_ID}/incidents/${id}`); }
  catch(e){ toast('삭제 실패: ' + e.message); return; }
  renderIncidents(); _refreshSvcHistory(); _refreshDash(); toast('삭제됨');
}
function downloadIncidentReport(id){ window.location.href = `/api/engineers/${ENG_ID}/incidents/${id}/report`; }

// ── 서비스 지원 이력 (점검·기술지원·장애처리를 월 단위로, 검색은 그 해 전체) ─────────────
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
// 제목 옆 "2026년 11월"을 누르면 달 고르는 창을 연다. 달 고르기를 지원하지 않는 브라우저(Firefox)에서는 ◀ ▶ 로만 이동
if($('svh-month').type !== 'month') $('svh-month').style.display = 'none';
else $('svh-month').addEventListener('click', () => { try { $('svh-month').showPicker(); } catch(e){} });
// 월별 이력의 탭만 대상으로 한다 (.svh-tab 모양은 대시보드·체크리스트 등 다른 화면의 탭도 같이 쓴다)
document.querySelectorAll('.svh-tab[data-svh]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.svh-tab[data-svh]').forEach(x => x.classList.toggle('active', x === t));
  _svhTab = t.dataset.svh;
  renderServiceHistory();
}));

let _svhCache = null;       // 마지막으로 불러온 자료 (검색어를 칠 때는 다시 불러오지 않는다)
$('svh-q').addEventListener('input', () => { clearTimeout(window._svhT); window._svhT = setTimeout(() => renderServiceHistory(true), 200); });
async function renderServiceHistory(reuse){
  if(!$('svh-month').value) $('svh-month').value = _ym(new Date());
  const ym = $('svh-month').value;
  const [ty, tm] = ym.split('-');
  const isNow = ym === _ym(new Date());
  $('svh-label').innerHTML = `${ty}년 ${Number(tm)}월${isNow ? ' <span class="wr-now">이번 달</span>' : ''}`;
  $('svh-today').disabled = isNow;
  const el = $('svh-list');
  let plans, incs, sites, scheds;
  if(reuse === true && _svhCache && _svhCache.year === ty && _svhCache.eng === ENG_ID) ({plans, incs, sites, scheds} = _svhCache);
  else {
    try {
      [plans, incs, sites, scheds] = await Promise.all([
        api.get(`/api/engineers/${ENG_ID}/workplans`),
        api.get(`/api/engineers/${ENG_ID}/incidents`),
        api.get(`/api/engineers/${ENG_ID}/sites`).catch(() => []),
        api.get(`/api/engineers/${ENG_ID}/schedules/all?year=${ty}`).catch(() => []),
      ]);
    } catch(e) {
      console.error('서비스 지원 이력 조회 실패:', e);
      el.innerHTML = '<div class="empty" style="color:#dc2626">이력을 불러오지 못했습니다.</div>';
      return;
    }
    _svhCache = {year: ty, eng: ENG_ID, plans, incs, sites, scheds};
  }
  plans = plans.filter(isSupportPlan);
  scheds = Array.isArray(scheds) ? scheds : [];
  _allWorkPlans = plans;
  _allIncidents = incs;
  renderSvhSiteStats(plans, incs, scheds, ym, (sites || []).map(x => (x.name || '').trim()).filter(Boolean));
  // 검색어가 있으면 목록은 그 해 전체에서 찾는다 (요약 줄은 계속 고른 달 기준)
  const q = $('svh-q').value.trim().toLowerCase();
  const hit = (...v) => q.split(/\s+/).every(w => v.some(x => String(x || '').toLowerCase().includes(w)));
  const yIncs = incs.filter(i => (i.occurred_at || '').startsWith(ty)), yPlans = plans.filter(p => (p.work_date || '').startsWith(ty));
  const fChk = q ? scheds.filter(c => hit(c.site_name, c.title, c.memo)) : null;
  const fSup = q ? yPlans.filter(p => hit(p.site, p.title, p.purpose, p.worker)) : null;
  const fInc = q ? yIncs.filter(i => hit(i.site, i.title, i.symptom, i.cause, i.action, i.worker, ...(i.parts || []).flatMap(p => [p.name, p.part_no, p.old_sn, p.new_sn]))) : null;
  incs = incs.filter(i => (i.occurred_at || '').startsWith(ym));
  const sup = plans.filter(p => (p.work_date || '').startsWith(ym));
  const chk = scheds.filter(x => (x.sched_date || '').startsWith(ym));

  const downMin = incs.reduce((a, i) => a + (i.downtime_min || 0), 0);
  const openInc = incs.filter(i => i.status !== '완료').length;
  const done = list => list.filter(x => x.status === '완료').length;
  const item = (name, val, sub, cls) => `<div class="wr-sum-i ${cls || ''}"><span>${name}${sub ? ` <em>${sub}</em>` : ''}</span><b>${val}</b></div>`;
  $('svh-summary').innerHTML =
      item('점검', chk.length, chk.length ? `완료 ${done(chk)}` : '', chk.length ? '' : 'zero')
    + item('기술지원', sup.length, sup.length ? `완료 ${done(sup)}` : '', sup.length ? '' : 'zero')
    + item('장애처리', incs.length, incs.length ? `긴급·높음 ${incs.filter(i => i.severity==='긴급'||i.severity==='높음').length}` : '', incs.length ? '' : 'zero')
    + item('미완료 장애', openInc, '', openInc ? 'red' : 'zero')
    + item('장애 시간 합계', downMin ? fmtDuration(downMin) : '-', '', downMin ? 'sm' : 'zero sm')
    + item('합계', `${chk.length + sup.length + incs.length}건`, '', 'total');

  const tabName = {all:'전체', check:'점검', support:'기술지원', incident:'장애처리'}[_svhTab];
  $('svh-list-title').textContent = q ? `${ty}년 ${tabName} 검색 결과` : `${Number(tm)}월 ${tabName} 이력`;

  const rows = [];
  const withChk = _svhTab === 'all' || _svhTab === 'check';
  if(withChk) (fChk || chk).forEach(c => rows.push({
    kind:'check', date:c.sched_date, site:c.site_name, title:c.title, worker:'',
    status:c.status, stCls:WP_ST_CLS[c.status]||'b-gray',
    extra:(Array.isArray(c.extra_types) ? c.extra_types : String(c.extra_types || '').split(',')).filter(Boolean).map(t => `<span class="badge b-blue" title="점검과 함께 한 지원">+${esc(t)}</span>`).join(' '),
    open:`openEditSched('${c.id}')`,
  }));
  if(_svhTab === 'all' || _svhTab === 'support') (fSup || sup).forEach(p => {
    if(p.from_schedule && _svhTab === 'all') return;        // 전체 보기에서는 점검 줄에 "+기술지원"으로 이미 표시됨
    rows.push({
      kind:'support', date:p.work_date, site:p.site, title:p.title, worker:p.worker,
      status:p.status, stCls:WP_ST_CLS[p.status]||'b-gray',
      extra:p.from_schedule ? '<span class="badge b-green" title="점검 일정에 함께 등록된 건">점검과 함께</span>' : '',
      open:`openEditWorkPlan('${p.id}')`,
    });
  });
  if(_svhTab === 'all' || _svhTab === 'incident') (fInc || incs).forEach(i => rows.push({
    kind:'incident', date:i.occurred_at, site:i.site, title:i.title, worker:i.worker,
    status:i.status, stCls:INC_ST_CLS[i.status]||'b-gray',
    extra:`<span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span>${i.downtime_min!==null?` <span class="sv-down">장애 ${fmtDuration(i.downtime_min)}</span>`:''}`,
    open:`openEditIncident('${i.id}')`,
  }));
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  $('svh-list-sub').textContent = rows.length ? `${rows.length}건${q ? ` · ${ty}년 전체에서 찾음` : ''} · 줄을 누르면 내용을 열어 봅니다` : '';

  if(!rows.length){ el.innerHTML = `<div class="empty">${q ? `${ty}년에 "${esc($('svh-q').value.trim())}"(으)로 찾은 이력이 없습니다` : `${ty}년 ${Number(tm)}월에 등록된 ${{all:'', check:'점검 ', support:'기술지원 ', incident:'장애처리 '}[_svhTab]}이력이 없습니다`}</div>`; return; }
  const KIND = {check:['점검','chk'], support:['기술지원','sup'], incident:['장애처리','inc']};
  const day = v => { const d = String(v || ''); if(d.length < 10) return '-';
    const w = '일월화수목금토'[new Date(Number(d.slice(0,4)), Number(d.slice(5,7)) - 1, Number(d.slice(8,10))).getDay()];
    const t = d.length >= 16 ? d.slice(11, 16) : '';
    return `${Number(d.slice(5,7))}/${Number(d.slice(8,10))} (${w})${t && t !== '00:00' ? ` <span class="sv-time">${t}</span>` : ''}`; };
  el.innerHTML = `<div class="svh-table-wrap"><table class="wr-tbl sv-list">
    <thead><tr><th style="width:92px">구분</th><th style="width:128px">일자</th><th style="width:20%">사이트</th><th>제목</th><th style="width:100px">처리자</th><th style="width:210px">상태</th></tr></thead>
    <tbody>${rows.map(r => `<tr onclick="${r.open}">
      <td><span class="sv-kind ${KIND[r.kind][1]}">${KIND[r.kind][0]}</span></td>
      <td class="wr-date">${day(r.date)}</td>
      <td class="wr-site">${esc(r.site||'-')}</td>
      <td>${esc(r.title)}</td>
      <td>${esc(r.worker||'-')}</td>
      <td><span class="badge ${r.stCls}">${esc(r.status)}</span> ${r.extra}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// 사이트별 월별/연간 점검·기술지원·장애처리 투입 횟수 (선택 월의 연도 기준)
// 점검 = 완료된 점검일정(Schedule) 건수, 기술지원 = WorkPlan(wp-*)+점검과 함께 한 지원, 장애처리 = Incident
function renderSvhSiteStats(plans, incs, scheds, ym, siteNames){
  const year = ym.slice(0, 4);
  const selM = Number(ym.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const showChk = _svhTab === 'all' || _svhTab === 'check', showSup = _svhTab === 'all' || _svhTab === 'support', showInc = _svhTab === 'all' || _svhTab === 'incident';
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

  // 0 은 비우고, 있는 것만 색 숫자로 (초록 점검 · 파랑 기술지원 · 빨강 장애)
  const kinds = [showChk && 'chk', showSup && 'sup', showInc && 'inc'].filter(Boolean);
  const TIP = {chk:'점검', sup:'기술지원', inc:'장애처리'};
  const cell = (r, i) => kinds.map(k => r[k][i] ? `<b class="sv-n ${k}" title="${TIP[k]} ${r[k][i]}건">${r[k][i]}</b>` : '').join('');
  const sel = m => m === selM ? ' svh-sel' : '';
  const empty = blank();
  const active = r => kinds.some(k => r[k][0]);

  $('svh-site-stats').innerHTML = `<div class="wr-box">
    <div class="wr-box-head"><span>${year}년 사이트별 투입 횟수</span>
      <span class="wr-box-sub">달 이름을 누르면 그 달 이력으로 이동합니다</span>
      <span class="sv-legend">${kinds.map(k => `<b class="sv-n ${k}">${tot[k][0]}</b>${TIP[k]}${k === 'chk' ? '(완료)' : ''}`).join('')}</span>
    </div>
    <div class="svh-table-wrap"><table class="wr-tbl sv-stat">
      <thead><tr><th class="sv-site">사이트</th>${months.map(m =>
        `<th class="sv-m${sel(m)}" title="${m}월 이력 보기" onclick="svhGoMonth(${year},${m})">${m}월</th>`).join('')}<th class="sv-year">연간</th></tr></thead>
      <tbody>${sites.map(site => { const r = by[site] || empty; return `<tr class="${active(r) ? '' : 'sv-idle'}">
        <td class="sv-site" title="${esc(site)}">${esc(site)}</td>
        ${months.map(m => `<td class="${sel(m)}">${cell(r, m)}</td>`).join('')}
        <td class="sv-year">${cell(r, 0)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td class="sv-site">합계</td>
        ${months.map(m => `<td class="${sel(m)}">${cell(tot, m)}</td>`).join('')}
        <td class="sv-year">${cell(tot, 0)}</td></tr></tfoot>
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
let _smOnly = '';                            // 요약 카드로 고른 조건 ('' | done | todo | late)
function smSetOnly(k){ _smOnly = _smOnly === k ? '' : k; drawSchedMgmt(); }
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
function smGo(ym){ _smYM = ym; _smOnly = ''; renderSchedMgmt(false); }
function smToday(){ smGo(_ymd(new Date()).slice(0, 7)); }
function smSetType(t){ _smType = t; drawSchedMgmt(); }

async function renderSchedMgmt(force = true){
  const year = _smYM.slice(0, 4);
  try {
    await Promise.all([_smLoad(year, force), _loadIncLinks()]);
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
  $('sm-others').innerHTML = _svcOthers(all.filter(isLate).map(s => s.sched_date.slice(0, 10)), _smYM, 'smGo', '지연', '점검');

  // 이 달 요약
  const done = month.filter(s => s.status === '완료').length, late = month.filter(isLate).length;
  const pct = month.length ? Math.round(done / month.length * 100) : 0;
  const act = k => _smOnly === k ? ' active' : '';
  $('sm-summary').innerHTML = `
    <div class="metric m-gray${act('')}" onclick="smSetOnly('')" title="전체 보기"><div class="metric-label">${mon}월 전체</div><div class="metric-value">${month.length}<small>건</small></div></div>
    <div class="metric m-green${act('done')}" onclick="smSetOnly('done')" title="완료한 건만 보기"><div class="metric-label">완료</div><div class="metric-value">${done}<small>건 (${pct}%)</small></div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${pct}%;background:#22c55e"></div></div></div>
    <div class="metric m-blue${act('todo')}" onclick="smSetOnly('todo')" title="남은 건만 보기"><div class="metric-label">남음</div><div class="metric-value">${month.length - done}<small>건</small></div></div>
    <div class="metric m-red${act('late')}" onclick="smSetOnly('late')" title="점검일이 지났는데 완료하지 않은 건만 보기"><div class="metric-label">지연</div><div class="metric-value" style="${late ? 'color:#dc2626' : ''}">${late}<small>건</small></div></div>`;

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

  const plans = {}; _schedWorkPlans.forEach(p => { plans[p.id] = p; });     // 일정 id → 작업자·작업계획 보관 레코드
  const q = $('sm-search').value.toLowerCase().trim();
  const list = month.filter(s => (!_smType || s.sched_type === _smType) && (!sel.value || s.site_id === sel.value)
      && (!q || [s.title, s.site_name, s.memo, (plans[s.id] || {}).worker, ...(s.extra_types || []), _incByEntry[s.id] ? '장애처리' : ''].some(v => (v || '').toLowerCase().includes(q)))
      && (!_smOnly || (_smOnly === 'done' ? s.status === '완료' : _smOnly === 'late' ? isLate(s) : s.status !== '완료')))
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date) || a.site_name.localeCompare(b.site_name, 'ko'));

  const row = s => {
    const isDone = s.status === '완료', day = s.sched_date.slice(0, 10), time = s.sched_date.slice(11, 16);
    const plan = plans[s.id], worker = plan ? plan.worker : '';
    return `<tr class="${isDone ? 'done' : ''} ${day === today ? 'today' : ''}" onclick="openEditSched('${s.id}')" style="cursor:pointer">
      ${_svcDate(day, time, isDone, today)}
      <td class="sm-s" title="${esc(s.site_name)}">${esc(s.site_name)}</td>
      <td class="sm-t">${esc(s.title)}${s.memo ? `<div class="wp-purpose" title="${esc(s.memo)}">${esc(s.memo)}</div>` : ''}</td>
      <td class="c"><div class="svc-kind"><span class="badge ${SCHED_TYPE_CLS[s.sched_type] || 'b-gray'}" title="점검 유형">${esc(s.sched_type || '-')}</span>${(s.extra_types || []).map(t => _svcKind(t)).join('')}${_svcIncLink(s.id)}</div></td>
      <td class="wp-worker" title="${esc(worker)}">${esc(worker || '-')}</td>
      ${_svcCheck(isDone, `toggleSchedStatusMgmt('${s.id}')`)}
      ${_svcActs(plan && plan.has_plan ? {title: '작업계획서 엑셀 내려받기', fn: `downloadWorkPlanExcel('${s.id}')`} : null, `openEditSched('${s.id}')`, `deleteSchedAndRefresh('${s.id}')`)}
    </tr>`;
  };
  const emptyMsg = !month.length
    ? `${mon}월에 등록된 점검이 없습니다<br><button class="btn btn-sm" style="margin-top:10px" onclick="openSchedCopy()">이전 달 일정 복사</button>`
    : '조건에 맞는 일정이 없습니다';
  // 표 상자 하나: 위쪽 줄(일정 목록 제목 + 유형·사이트 필터 + 진행 상황) → 열 제목 → 일정
  const cols = _svcCols();
  $('sm-panel-title').textContent = `${mon}월 점검`;
  $('sm-panel-info').innerHTML = (list.length !== month.length ? `<span class="sh-mon-note">${list.length}건 표시 중</span>` : '')
    + (late ? `<span class="sh-mon-cnt late">지연 ${late}건</span>` : '')
    + (month.length ? `<span class="sh-mon-cnt">${done}/${month.length} 완료</span>` : '');
  $('sm-content').innerHTML = `<table class="cl-table sm-table sh-table sh-inhead">${cols}
    <thead><tr><th>날짜</th><th>사이트</th><th>제목</th><th class="c">유형 · 구분</th><th>작업자</th><th class="c">완료</th><th class="c">관리</th></tr></thead>
    <tbody>${list.length ? list.map(row).join('') : `<tr class="cl-msg"><td colspan="7">${emptyMsg}</td></tr>`}</tbody></table>`;
}

async function toggleSchedStatusMgmt(id){
  const s = _schedById[id];
  if(!s) return;
  const next = s.status === '완료' ? '예정' : '완료';
  try { await _apiSend('PATCH', `${_schedBase()}/${id}`, {status: next}); }
  catch(e){ toast('변경 실패: ' + e.message); return; }
  await renderSchedMgmt();
  _refreshDash();
  toast(next === '완료' ? '완료 처리됨' : '완료 취소됨');
}

async function deleteSchedAndRefresh(id){
  const s = _schedById[id];
  if(!confirm(`${s ? `"${s.site_name} - ${s.title}" ` : ''}점검 일정을 삭제하시겠습니까?${_incByEntry[id] ? '\n함께 등록된 장애 기록은 장애처리에 그대로 남습니다.' : ''}`)) return;
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
    <optgroup label="기술지원">${GC_SUPPORT.map(t => `<option value="기술지원|${t}" ${sel === '기술지원|' + t ? 'selected' : ''}>기술지원 - ${t}</option>`).join('')}</optgroup>
    <optgroup label="장애처리"><option value="장애처리|" ${sel === '장애처리|' ? 'selected' : ''}>장애처리</option></optgroup>`;
  const placeLabel = e => e.kind === '장애처리' ? '장애처리'
    : (e.kind === '점검' ? '점검' : '기술지원') + ' - ' + (e.sub_type || '') + (e.with_incident ? ' + 장애' : '');
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
        <tr><th>종류</th><td><code>[점검]</code> <code>[분기점검]</code> <code>[특별점검]</code> → 점검 일정 &nbsp;·&nbsp; <code>[기술지원]</code> <code>[납품]</code> <code>[원격]</code> <code>[이전]</code> <code>[기타]</code> → 기술지원 &nbsp;·&nbsp; <code>[장애처리]</code> → 장애처리<br><code>[점검 및 기술지원]</code> <code>[점검/납품]</code> 처럼 함께 적으면 점검 일정 한 건에 지원 구분이 같이 체크됩니다. <code>[점검/장애처리]</code> <code>[기술지원 및 장애처리]</code>는 그 일정에 연결된 장애가 함께 생깁니다.</td></tr>
        <tr><th>설명</th><td>캘린더 일정의 <b>설명</b> 칸 내용은 기술지원의 <b>작업 목적</b>에 들어갑니다 (점검 일정은 메모, 장애처리는 장애 증상). 구글에서 설명을 고치면 반영하지만, 포털에서 직접 고친 내용은 덮어쓰지 않습니다.</td></tr>
        <tr><th>이미 있는 일정</th><td>포털에 <b>같은 날짜 · 같은 사이트</b>로 이미 등록된 건이 있으면 새로 만들지 않고 그 건에 연결합니다. 이렇게 연결된 건은 구글에서 일정을 지워도 포털에서 지우지 않습니다.</td></tr>
        <tr><th>반영 방식</th><td>${g.sync_minutes}분마다 자동으로 확인합니다. 구글에서 날짜를 바꾸거나 지우면 포털에도 반영하지만, 포털에서 <b>완료 처리한 건은 그대로</b> 둡니다. 장애처리는 원인·조치·파트 등 보고서를 쓰기 시작했거나 처리중으로 바꾼 건도 지우지 않습니다. 포털에서 직접 지운 건은 다시 만들지 않으며, 아래 표의 "다시 가져오기"로 되살릴 수 있습니다.</td></tr>
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
        <td><select class="filter-select gc-sel" id="gc-kind-${e.id}">${typeOpts(e.kind ? e.kind + '|' + (e.kind === '장애처리' ? '' : (e.sub_type || (e.kind === '점검' ? '월간' : '기술지원'))) : '점검|월간')}</select></td>
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
        <td>${e.state === '무시' ? '<span class="dev-muted">-</span>' : esc(placeLabel(e))}</td>
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
  if(!confirm('캘린더 연동을 해제하시겠습니까?\n이미 등록된 점검 일정·기술지원·장애처리는 그대로 남습니다.')) return;
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
      <summary>접속·비밀번호 보기 기록 <span id="lab-logs-span">최근 100건</span></summary><div id="lab-logs-body"></div>
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
let _labLogAll = false;     // 관리자: 모든 엔지니어 기록 보기
function labLogAll(on){ _labLogAll = on; labLoadLogs(); }
async function labLoadLogs(){
  const el = $('lab-logs-body');
  let rows;
  try { rows = await _apiSend('GET', `/api/engineers/${ENG_ID}/lab/logs${IS_ADMIN && _labLogAll ? '/all' : ''}`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  const all = IS_ADMIN && _labLogAll;
  $('lab-logs-span').textContent = all ? '모든 엔지니어 · 최근 300건' : '최근 100건';
  const bar = IS_ADMIN ? `<label class="lab-log-all"><input type="checkbox" ${all ? 'checked' : ''} onchange="labLogAll(this.checked)"> 모든 엔지니어의 기록 보기 (관리자)</label>` : '';
  if(!rows.length){ el.innerHTML = bar + '<div class="empty">기록이 없습니다</div>'; return; }
  el.innerHTML = bar + `<table class="lab-tbl lab-log-tbl">
    <thead><tr><th>시작</th><th>종료</th>${all ? '<th>엔지니어</th>' : ''}<th>서버</th><th>방식</th><th>대상</th><th>계정</th><th>접속한 PC</th><th>결과</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="mono">${esc(r.started_at)}</td><td class="mono">${esc(r.ended_at ? r.ended_at.slice(11) : '-')}</td>${all ? `<td>${esc(r.engineer)}</td>` : ''}
      <td class="lab-name">${esc(r.server_name)}</td><td>${r.kind === '비밀번호 보기' ? '<span class="badge b-amber">비밀번호 보기</span>' : esc(r.kind)}</td><td class="mono">${esc(r.target)}</td>
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

// ── 문서 양식: 휴가원 · 차량 운행 일지 · 개인 경비 (양식 파일은 서버의 data/doc_templates/ 에 둔다) ─────────────

const DOC_TABS = {leave: () => renderLeaves(), car: () => renderCarLog(), repair: () => renderCarRepairs(), expense: () => renderExpenses()};   // 문서 종류가 늘면 여기에 탭을 추가
function docTab(k){
  document.querySelectorAll('#doc-tabs .svh-tab').forEach(t => t.classList.toggle('active', t.dataset.doc === k));
  Object.keys(DOC_TABS).forEach(x => { $('doc-pane-' + x).style.display = x === k ? '' : 'none'; });
  DOC_TABS[k]();
}
function renderDocs(){ docTab((document.querySelector('#doc-tabs .svh-tab.active') || {dataset: {doc: 'leave'}}).dataset.doc); }

// ── 휴가원: 간단히 입력 → 연차 사용 내역에 기록 → 목록에서 휴가원 문서 내려받기 ─────────
let _lvYear = String(new Date().getFullYear()), _lvData = null;
const _lvBase = () => `/api/engineers/${ENG_ID}/leaves`;
const _lvNum = v => String(Math.round(Number(v || 0) * 100) / 100);
function _lvWeekdays(a, b){          // 시작~종료 사이 평일 수 (공휴일은 모르므로 필요하면 일수를 직접 고친다)
  if(!a) return 0;
  const s = new Date(a + 'T00:00:00'), e = new Date((b || a) + 'T00:00:00');
  let n = 0;
  for(const d = new Date(s); d <= e && n < 400; d.setDate(d.getDate() + 1)) if(d.getDay() % 6) n++;
  return n;
}
function lvMove(d){ _lvYear = String(Number(_lvYear) + d); renderLeaves(); }

async function renderLeaves(){
  $('lv-year').textContent = `${_lvYear}년`;
  try { _lvData = await _apiSend('GET', `${_lvBase()}?year=${_lvYear}`); }
  catch(e) { $('lv-list').innerHTML = `<div class="empty" style="color:#dc2626">연차 사용 내역을 불러오지 못했습니다 (${esc(e.message)})</div>`; return; }
  const d = _lvData;
  const item = (label, val, sub, cls, extra = '') => `<div class="wr-sum-i ${cls}" ${extra}><span>${label}${sub ? `<em>${sub}</em>` : ''}</span><b>${val}</b></div>`;
  $('lv-summary').innerHTML =
      item('총 연차', `${_lvNum(d.total)}일`, d.total_is_default ? '기본값 · 눌러서 수정' : '눌러서 수정', 'st-f', 'onclick="lvSetQuota()" title="이 해의 총 연차 일수 바꾸기"')
    + item('사용', `${_lvNum(d.used)}일`, d.deduct_types.join(' · '), d.used ? '' : 'zero')
    + item('그 밖의 휴가', `${_lvNum(d.other)}일`, '연차에서 빼지 않음', d.other ? '' : 'zero')
    + item('남은 연차', `${_lvNum(d.remain)}일`, '', 'total');
  $('lv-sub').innerHTML = (d.records.length ? `${d.records.length}건 · 기간 시작일이 ${_lvYear}년인 휴가원` : '')
    + (d.has_template ? '' : ' <span class="doc-warn">휴가원 양식 파일이 서버에 없어 문서를 내려받을 수 없습니다</span>');
  $('lv-list').innerHTML = !d.records.length ? `<div class="empty">${_lvYear}년에 작성한 휴가원이 없습니다. <b>+ 휴가원 작성</b>을 눌러 주세요.</div>`
    : `<table class="wr-tbl doc-tbl lv-tbl"><colgroup><col style="width:120px"><col style="width:230px"><col style="width:100px"><col style="width:80px"><col><col style="width:210px"></colgroup>
      <thead><tr><th>신청일</th><th>기간</th><th>종류</th><th>일수</th><th>사유</th><th>관리</th></tr></thead><tbody>${d.records.map(r => `
      <tr onclick="openEditLeave('${r.id}')" title="눌러서 수정">
        <td class="wr-date">${esc(r.apply_date)}</td>
        <td class="wr-date">${esc(r.start_date)}${r.end_date && r.end_date !== r.start_date ? ` ~ ${esc(r.end_date)}` : ''}</td>
        <td><span class="badge ${r.deduct ? 'b-blue' : 'b-gray'}">${esc(r.leave_type)}</span></td>
        <td><b>${_lvNum(r.days)}</b>일</td>
        <td class="lv-reason">${esc(r.reason || '-')}</td>
        <td class="doc-act" onclick="event.stopPropagation()"><button class="btn btn-sm sm-xls" title="이 내용이 채워진 휴가원 문서(워드) 내려받기" onclick="downloadLeaveDoc('${r.id}')">휴가원 받기</button><button class="icon-btn edit" title="수정" onclick="openEditLeave('${r.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="deleteLeave('${r.id}')">${ICO_DEL}</button></td>
      </tr>`).join('')}</tbody></table>`;
}
function downloadLeaveDoc(id){ location.href = `${_lvBase()}/${id}/document`; }

async function lvSetQuota(){
  const v = prompt(`${_lvYear}년 총 연차 일수`, _lvData ? _lvNum(_lvData.total) : '15');
  if(v === null) return;
  const n = Number(v);
  if(!(n >= 0) || v.trim() === ''){ toast('숫자로 넣어주세요'); return; }
  try { await _apiSend('PUT', `${_lvBase()}/quota`, {year: _lvYear, total_days: n}); } catch(e) { toast('저장 실패: ' + e.message); }
  renderLeaves();
}
function lvAutoDays(){
  if($('lv-end').value && $('lv-end').value < $('lv-start').value) $('lv-end').value = $('lv-start').value;
  $('lv-days').value = _lvWeekdays($('lv-start').value, $('lv-end').value) || '';
}
function _lvOpen(r){
  const today = _ymd(new Date());
  $('lv-modal-title').textContent = r ? '휴가원 수정' : '휴가원 작성';
  $('lv-type').innerHTML = ((_lvData && _lvData.types) || ['연차']).map(x => `<option>${esc(x)}</option>`).join('');
  $('lv-id').value = r ? r.id : '';
  $('lv-type').value = r ? r.leave_type : '연차';
  $('lv-apply').value = r ? r.apply_date : today;
  $('lv-start').value = r ? r.start_date : today;
  $('lv-end').value = r ? r.end_date : today;
  $('lv-reason').value = r ? r.reason : '';
  if(r) $('lv-days').value = r.days; else lvAutoDays();
  const p = (_lvData && _lvData.profile) || {};
  $('lv-modal-hint').textContent = `저장하면 연차 사용 내역에 기록되고, 목록의 '휴가원 받기'로 문서를 내려받습니다. (신청인: ${p.name || '-'})`;
  openModal('modal-leave');
}
function openAddLeave(){ _lvOpen(null); }
function openEditLeave(id){ const r = _lvData && _lvData.records.find(x => x.id === id); if(r) _lvOpen(r); }
async function saveLeave(){
  const id = $('lv-id').value;
  const body = {leave_type: $('lv-type').value, start_date: $('lv-start').value, end_date: $('lv-end').value || $('lv-start').value,
                days: Number($('lv-days').value), reason: $('lv-reason').value.trim(), apply_date: $('lv-apply').value};
  if(!body.start_date){ toast('기간 시작일을 넣어주세요'); return; }
  if(!(body.days > 0)){ toast('일수를 넣어주세요'); return; }
  try { await _apiSend(id ? 'PATCH' : 'POST', `${_lvBase()}${id ? '/' + id : ''}`, body); }
  catch(e) { toast('저장 실패: ' + e.message); return; }
  closeModal('modal-leave');
  toast(id ? '수정했습니다' : "휴가원을 작성했습니다. 목록의 '휴가원 받기'로 내려받으세요");
  _lvYear = body.start_date.slice(0, 4);
  renderLeaves();
}
async function deleteLeave(id){
  if(!confirm('이 휴가원 기록을 삭제하시겠습니까? 사용한 연차에서도 빠집니다.')) return;
  try { await _apiSend('DELETE', `${_lvBase()}/${id}`); toast('삭제됨'); } catch(e) { toast('삭제 실패: ' + e.message); }
  renderLeaves();
}
function openLeaveProfile(){
  const p = (_lvData && _lvData.profile) || {};
  $('lp-dept').value = p.dept || ''; $('lp-position').value = p.position || ''; $('lp-name').value = p.name || '';
  openModal('modal-leave-profile');
}
async function saveLeaveProfile(){
  try { await _apiSend('PUT', `${_lvBase()}/profile`, {dept: $('lp-dept').value, position: $('lp-position').value, name: $('lp-name').value}); }
  catch(e) { toast('저장 실패: ' + e.message); return; }
  closeModal('modal-leave-profile'); toast('저장됨');
  renderLeaves();
}

// ── 차량 운행 일지: 일정에서 운행 줄을 가져오고, 첫 출발·마지막 도착 km 만 넣으면 줄마다 나눠 채운다 ─────────
let _carYM = _ymd(new Date()).slice(0, 7), _carData = null;
const _carBase = () => `/api/engineers/${ENG_ID}/carlog`;
const _carKm = v => v === null || v === undefined ? '' : Number(v).toLocaleString('ko-KR');
function carMove(d){ const [y, m] = _carYM.split('-').map(Number); _carYM = _ymd(new Date(y, m - 1 + d, 1)).slice(0, 7); renderCarLog(); }

async function renderCarLog(){
  try { _carData = await _apiSend('GET', `${_carBase()}?month=${_carYM}`); }
  catch(e) { $('car-list').innerHTML = `<div class="empty" style="color:#dc2626">운행 일지를 불러오지 못했습니다 (${esc(e.message)})</div>`; return; }
  if(_carData.imported) toast(`일정에서 운행 ${_carData.imported}건을 가져왔습니다`);
  drawCarLog();
}
function drawCarLog(){
  const d = _carData, [y, m] = d.month.split('-');
  $('car-month').textContent = `${y}년 ${Number(m)}월`;
  if(document.activeElement !== $('car-model')) $('car-model').value = d.profile.car_model;
  if(document.activeElement !== $('car-no')) $('car-no').value = d.profile.car_no;
  if(document.activeElement !== $('car-place')) $('car-place').value = d.profile.start_place;
  if(document.activeElement !== $('car-driver')) $('car-driver').value = d.profile.driver_name || d.login_name;
  if(document.activeElement !== $('car-biz')) $('car-biz').value = d.profile.biz_no;
  const item = (label, val, sub, cls) => `<div class="wr-sum-i ${cls}"><span>${label}${sub ? `<em>${sub}</em>` : ''}</span><b>${val}</b></div>`;
  $('car-summary').innerHTML =
      item('운행', `${d.trips.length}건`, d.empty_count ? `거리 미입력 ${d.empty_count}건` : '', d.trips.length ? (d.empty_count ? 'amber' : '') : 'zero')
    + item('첫 출발 때', d.start_km === null ? '-' : _carKm(d.start_km) + ' km', d.start_km_is_carried ? '지난달 마지막 값' : '', d.start_km === null ? 'zero sm' : 'sm')
    + item('마지막 도착 때', d.end_km === null ? '-' : _carKm(d.end_km) + ' km', '', d.end_km === null ? 'zero sm' : 'sm')
    + item('이 달 주행 거리', `${_carKm(d.total_km)} km`, '', 'total');
  if(document.activeElement !== $('car-start')) $('car-start').value = d.start_km === null ? '' : d.start_km;
  if(document.activeElement !== $('car-end')) $('car-end').value = d.total_km && d.end_km !== null && !d.empty_count ? d.end_km : '';
  $('car-keep').checked = d.trips.some(t => t.km) && d.empty_count > 0;
  $('car-title').textContent = `${Number(m)}월 운행 내역`;
  $('car-sub').innerHTML = (d.trips.length ? '칸을 고치면 바로 저장됩니다 · 출발·도착 km 는 거리를 이어 붙여 자동으로 계산됩니다' : '')
    + (d.has_template ? '' : ' <span class="doc-warn">양식 파일이 서버에 없어 엑셀을 내려받을 수 없습니다</span>');
  $('car-list').innerHTML = !d.trips.length ? `<div class="empty doc-empty">${Number(m)}월 운행 내역이 없습니다.<br><b>일정에서 가져오기</b> 또는 <b>+ 운행 추가</b>를 눌러 주세요.</div>`
    : `<table class="wr-tbl doc-tbl car-tbl"><colgroup><col style="width:150px"><col style="width:90px"><col style="width:12%"><col style="width:120px"><col><col style="width:100px"><col style="width:120px"><col style="width:16%"><col style="width:56px"></colgroup>
      <thead><tr><th>일자</th><th>성명</th><th>출발지명</th><th class="r">출발시 주행km</th><th>운행목적(거래처명)</th><th class="r">거리 km</th><th class="r">도착시 주행km</th><th>비고</th><th></th></tr></thead><tbody>${d.trips.map(t => `
      <tr data-id="${t.id}">
        <td><input type="date" value="${esc(t.trip_date)}" onchange="carEdit('${t.id}', 'trip_date', this.value)"></td>
        <td><input type="text" value="${esc(t.driver || d.name)}"${t.driver && t.driver !== d.name ? ' class="car-diff"' : ''} title="이 줄만 다른 사람이 운전했으면 고칩니다 (비우면 기본 성명)" onchange="carEdit('${t.id}', 'driver', this.value.trim() === _carData.name ? '' : this.value)"></td>
        <td><input type="text" value="${esc(t.start_place)}" onchange="carEdit('${t.id}', 'start_place', this.value)"></td>
        <td class="r car-ro">${_carKm(t.start_km)}</td>
        <td><input type="text" value="${esc(t.purpose)}" onchange="carEdit('${t.id}', 'purpose', this.value)"${t.from_schedule ? ' title="일정에서 가져온 운행"' : ''}></td>
        <td><input type="number" class="r${t.km ? '' : ' car-miss'}" min="0" value="${t.km || ''}" placeholder="-" onchange="carEdit('${t.id}', 'km', this.value)"></td>
        <td class="r car-ro">${_carKm(t.end_km)}</td>
        <td><input type="text" value="${esc(t.note)}" onchange="carEdit('${t.id}', 'note', this.value)"></td>
        <td class="c"><button class="icon-btn del" title="이 운행 삭제" onclick="carDelete('${t.id}')">${ICO_DEL}</button></td>
      </tr>`).join('')}</tbody></table>`;
}
async function carSaveProfile(){
  try { await _apiSend('PUT', `${_carBase()}/profile`, {car_model: $('car-model').value, car_no: $('car-no').value, start_place: $('car-place').value || '회사',
      driver_name: $('car-driver').value.trim() === (_carData && _carData.login_name) ? '' : $('car-driver').value, biz_no: $('car-biz').value}); toast('기본 정보를 저장했습니다 (다음부터 그대로 씁니다)'); }
  catch(e) { toast('저장 실패: ' + e.message); }
  renderCarLog();
}
async function carEdit(id, field, value){
  const body = {[field]: field === 'km' ? (Number(value) || 0) : value};
  try { await _apiSend('PATCH', `${_carBase()}/trips/${id}`, body); }
  catch(e) { toast('저장 실패: ' + e.message); }
  if(field === 'trip_date' && value) _carYM = value.slice(0, 7);
  renderCarLog();
}
async function carAdd(){
  const today = _ymd(new Date());
  const last = _carData && _carData.trips.length ? _carData.trips[_carData.trips.length - 1].trip_date : '';
  const day = today.startsWith(_carYM) ? today : (last || `${_carYM}-01`);
  try { _carData = await _apiSend('POST', `${_carBase()}/trips`, {trip_date: day}); drawCarLog(); }
  catch(e) { toast('추가 실패: ' + e.message); }
}
async function carDelete(id){
  if(!confirm('이 운행 줄을 삭제하시겠습니까?')) return;
  try { await _apiSend('DELETE', `${_carBase()}/trips/${id}`); } catch(e) { toast('삭제 실패: ' + e.message); }
  renderCarLog();
}
async function carImport(){
  try { _carData = await _apiSend('POST', `${_carBase()}/import?month=${_carYM}`); }
  catch(e) { toast('가져오기 실패: ' + e.message); return; }
  toast(_carData.imported ? `일정에서 운행 ${_carData.imported}건을 가져왔습니다` : '새로 가져올 일정이 없습니다');
  _carData.imported = 0; drawCarLog();
}
async function carDistribute(){
  const s = $('car-start').value, e = $('car-end').value;
  if(s === '' || e === ''){ toast('첫 출발 때 km 와 마지막 도착 때 km 를 넣어주세요'); return; }
  try {
    _carData = await _apiSend('POST', `${_carBase()}/distribute`, {month: _carYM, start_km: Number(s), end_km: Number(e), keep_filled: $('car-keep').checked});
    toast(_carData.used_history ? '거래처별 평소 거리 비율로 나눠 채웠습니다' : '참고할 예전 기록이 없어 똑같이 나눴습니다. 거리를 고쳐 두면 다음 달부터 그 비율을 씁니다');
    drawCarLog();
  } catch(err) { toast('자동 계산 실패: ' + err.message); }
}
function carDownload(){
  if(!_carData || !_carData.trips.length){ toast('운행 내역이 없습니다'); return; }
  if(!_carData.profile.car_model || !_carData.profile.car_no){ toast('차종과 차량번호를 먼저 넣어주세요'); return; }
  if(_carData.empty_count && !confirm(`거리를 넣지 않은 운행이 ${_carData.empty_count}건 있습니다. 그 줄은 km 가 빈 채로 내려받습니다. 계속할까요?`)) return;
  location.href = `${_carBase()}/download?month=${_carYM}`;
}

// ── 법인차량 점검 품의서: 정비 내용 입력 → 정비 이력에 기록 → 목록에서 품의서(엑셀) 내려받기 (routers/carrepair.py) ─────────
let _crYear = String(new Date().getFullYear()), _crData = null;
const _crBase = () => `/api/engineers/${ENG_ID}/carrepairs`;
const _won = n => Number(n || 0).toLocaleString('ko-KR');
function crMove(d){ _crYear = String(Number(_crYear) + d); renderCarRepairs(); }

async function renderCarRepairs(){
  $('cr-year').textContent = `${_crYear}년`;
  try { _crData = await _apiSend('GET', `${_crBase()}?year=${_crYear}`); }
  catch(e) { $('cr-list').innerHTML = `<div class="empty" style="color:#dc2626">정비 이력을 불러오지 못했습니다 (${esc(e.message)})</div>`; return; }
  const d = _crData, last = d.records[0];
  const item = (label, val, sub, cls) => `<div class="wr-sum-i ${cls}"><span>${label}${sub ? `<em>${sub}</em>` : ''}</span><b>${val}</b></div>`;
  $('cr-summary').innerHTML = item('정비', `${d.count}건`, `${_crYear}년`, d.count ? '' : 'zero')
    + item('최근 정비', last ? esc(last.doc_date) : '-', last ? esc(last.vendor) : '', last ? 'sm' : 'zero')
    + item('최근 주행거리', last && last.odometer != null ? `${_won(last.odometer)} km` : '-', '', last && last.odometer != null ? 'sm' : 'zero')
    + item('정비 금액 합계', `${_won(d.total)}원`, '부가세 포함', 'total');
  $('cr-sub').innerHTML = (d.count ? `${d.count}건 · 작성일이 ${_crYear}년인 품의서` : '')
    + (d.has_template ? '' : ' <span class="doc-warn">품의서 양식 파일이 서버에 없어 문서를 내려받을 수 없습니다</span>');
  $('cr-list').innerHTML = !d.count ? `<div class="empty">${_crYear}년 정비 이력이 없습니다. <b>+ 품의서 작성</b>을 눌러 주세요.</div>`
    : `<table class="wr-tbl doc-tbl lv-tbl"><colgroup><col style="width:112px"><col style="width:120px"><col style="width:17%"><col><col style="width:110px"><col style="width:120px"><col style="width:200px"></colgroup>
      <thead><tr><th>작성일</th><th>차량번호</th><th>정비처</th><th>정비 내용</th><th>주행거리</th><th>금액(부가세 포함)</th><th>관리</th></tr></thead><tbody>${d.records.map(r => `
      <tr onclick="openEditCarRepair('${r.id}')" title="눌러서 수정">
        <td class="wr-date">${esc(r.doc_date)}</td>
        <td>${esc(r.car_no || '-')}</td>
        <td>${esc(r.vendor)}</td>
        <td class="lv-reason">${r.items.map(i => esc(i.name) + (i.qty !== 1 ? ` ×${i.qty}` : '')).join(', ')}</td>
        <td class="cr-amt">${r.odometer != null ? _won(r.odometer) + ' km' : '-'}</td>
        <td class="cr-amt"><b>${_won(r.total)}</b>원</td>
        <td class="doc-act" onclick="event.stopPropagation()"><button class="btn btn-sm sm-xls" title="이 내용이 채워진 품의서(엑셀) 내려받기" onclick="downloadCarRepairDoc('${r.id}')">품의서 받기</button><button class="icon-btn edit" title="수정" onclick="openEditCarRepair('${r.id}')">${ICO_EDIT}</button><button class="icon-btn del" title="삭제" onclick="deleteCarRepair('${r.id}')">${ICO_DEL}</button></td>
      </tr>`).join('')}</tbody></table>`;
}
function downloadCarRepairDoc(id){ location.href = `${_crBase()}/${id}/document`; }

// 품목 줄
function _crItemRow(it = {}){
  return `<tr><td class="c cr-no"></td>
    <td><input type="text" class="cr-name" value="${esc(it.name || '')}" placeholder="예: 엔진오일 교체"></td>
    <td><input type="number" class="cr-price" min="0" step="100" value="${it.price ?? ''}" oninput="crCalc()"></td>
    <td><input type="number" class="cr-qty" min="0" step="1" value="${it.qty ?? 1}" oninput="crCalc()"></td>
    <td class="cr-amt cr-line">0</td>
    <td class="c"><button class="icon-btn del" title="이 줄 삭제" onclick="crDelItem(this)">${ICO_DEL}</button></td></tr>`;
}
function crAddItem(it){
  const max = (_crData && _crData.max_items) || 6;
  if($('cr-items').children.length >= max){ toast(`품목은 양식에 ${max}줄까지 들어갑니다`); return; }
  $('cr-items').insertAdjacentHTML('beforeend', _crItemRow(it));
  crCalc();
}
function crDelItem(btn){
  btn.closest('tr').remove();
  if(!$('cr-items').children.length) crAddItem();
  crCalc();
}
function _crItems(){
  return [...$('cr-items').children].map(tr => ({ name: tr.querySelector('.cr-name').value.trim(),
    price: Number(tr.querySelector('.cr-price').value || 0), qty: Number(tr.querySelector('.cr-qty').value || 0) }));
}
function crCalc(){
  let sub = 0;
  [...$('cr-items').children].forEach((tr, n) => {
    const p = Number(tr.querySelector('.cr-price').value || 0), q = Number(tr.querySelector('.cr-qty').value || 0);
    tr.querySelector('.cr-no').textContent = n + 1;
    tr.querySelector('.cr-line').textContent = _won(p * q);
    sub += p * q;
  });
  $('cr-subtotal').textContent = _won(sub);
  $('cr-total').textContent = _won(Math.round(sub * 1.1)) + '원';
  $('cr-add-item').style.display = $('cr-items').children.length >= ((_crData && _crData.max_items) || 6) ? 'none' : '';
}
// 거래내역·특기사항 칸에 "비우면 이렇게 들어갑니다"를 보여 준다
function crAutoText(){
  const no = $('cr-carno').value.trim();
  $('cr-title').placeholder = no ? `법인차량(${no}) 정비` : '법인차량 정비';
  $('cr-note').placeholder = no ? `법인차량(${no}) 점검.정비` : '법인차량 점검.정비';
}
function _crOpen(r){
  const df = (_crData && _crData.defaults) || {}, p = (_crData && _crData.profile) || {};
  $('cr-modal-title').textContent = r ? '법인차량 점검 품의서 수정' : '법인차량 점검 품의서 작성';
  $('cr-id').value = r ? r.id : '';
  $('cr-date').value = r ? r.doc_date : _ymd(new Date());
  $('cr-carno').value = r ? r.car_no : (df.car_no || '');
  $('cr-odo').value = r && r.odometer != null ? r.odometer : '';
  $('cr-vendor').value = r ? r.vendor : (df.vendor || '');
  $('cr-title').value = r && r.title !== `법인차량(${r.car_no}) 정비` && r.title !== '법인차량 정비' ? r.title : '';   // 자동으로 들어간 값은 비워 두어 차량번호를 따라가게
  $('cr-note').value = r ? r.note : '';
  $('cr-items').innerHTML = (r && r.items.length ? r.items : [{}]).map(_crItemRow).join('');
  $('cr-modal-hint').innerHTML = `품의서의 담당 칸에는 <b>${esc([p.dept, p.position, p.name].filter(Boolean).join(' · ') || '(내 정보 없음)')}</b> 이(가) 들어갑니다. 바꾸려면 휴가원 탭의 <b>내 정보</b>에서 고칩니다.`
    + (_crData && !_crData.has_template ? ' <span class="doc-warn">양식 파일이 서버에 없어 저장만 됩니다</span>' : '');
  $('cr-save-dl').style.display = _crData && _crData.has_template ? '' : 'none';
  crAutoText(); crCalc();
  openModal('modal-car-repair');
}
function openAddCarRepair(){ _crOpen(null); }
function openEditCarRepair(id){ const r = _crData && _crData.records.find(x => x.id === id); if(r) _crOpen(r); }

async function saveCarRepair(download){
  const no = $('cr-carno').value.trim();
  const body = { doc_date: $('cr-date').value, car_no: no, title: $('cr-title').value.trim(), vendor: $('cr-vendor').value.trim(),
    odometer: $('cr-odo').value === '' ? null : Number($('cr-odo').value),
    note: $('cr-note').value.trim() || (no ? `법인차량(${no}) 점검.정비` : '법인차량 점검.정비'),
    items: _crItems().filter(i => i.name) };
  if(!body.doc_date){ toast('작성일을 입력해주세요'); return; }
  if(!body.vendor){ toast('정비처를 입력해주세요'); return; }
  if(!body.items.length){ toast('정비 품목을 하나 이상 입력해주세요'); return; }
  if(body.items.some(i => !(i.qty > 0))){ toast('수량을 확인해주세요'); return; }
  const id = $('cr-id').value;
  let r;
  try { r = await _apiSend(id ? 'PUT' : 'POST', `${_crBase()}${id ? '/' + id : ''}`, body); }
  catch(e) { toast('저장 실패: ' + e.message); return; }
  closeModal('modal-car-repair');
  _crYear = body.doc_date.slice(0, 4);
  await renderCarRepairs();
  toast(id ? '정비 이력을 수정했습니다' : '정비 이력에 기록했습니다');
  if(download) downloadCarRepairDoc(r.id);
}
async function deleteCarRepair(id){
  if(!confirm('이 정비 이력(품의서)을 삭제할까요?')) return;
  try { await api.del(`${_crBase()}/${id}`); } catch(e) { toast('삭제 실패'); }
  renderCarRepairs(); toast('삭제됨');
}

// ── 개인 경비 정산 내역서 (월 단위, routers/expenses.py): 칸을 고치면 바로 저장 → 엑셀 내려받기 ─────────
let _exYM = _ymd(new Date()).slice(0, 7), _exData = null;
const _exBase = () => `/api/engineers/${ENG_ID}/expenses`;
function exMove(delta){ const [y, m] = _exYM.split('-').map(Number); _exYM = _ymd(new Date(y, m - 1 + delta, 1)).slice(0, 7); renderExpenses(); }

async function renderExpenses(){
  try { _exData = await _apiSend('GET', `${_exBase()}?month=${_exYM}`); }
  catch(e) { $('ex-list').innerHTML = `<div class="empty" style="color:#dc2626">개인 경비를 불러오지 못했습니다 (${esc(e.message)})</div>`; return; }
  drawExpenses();
}
function drawExpenses(){
  const d = _exData, [y, m] = d.month.split('-');
  $('ex-month').textContent = `${y}년 ${Number(m)}월`;
  [['ex-title', d.title], ['ex-applicant', d.applicant], ['ex-card', d.card_no]].forEach(([id, v]) => { if(document.activeElement !== $(id)) $(id).value = v; });
  const item = (label, val, sub, cls) => `<div class="wr-sum-i ${cls}"><span>${label}${sub ? `<em>${sub}</em>` : ''}</span><b>${val}</b></div>`;
  $('ex-summary').innerHTML = item('지출', `${d.items.length}건`, `최대 ${d.max_rows}줄`, d.items.length ? '' : 'zero')
    + item('법인카드', `${_won(d.card_total)}원`, '', d.card_total ? 'sm' : 'zero sm')
    + item('현금(개인카드)', `${_won(d.cash_total)}원`, '', d.cash_total ? 'sm' : 'zero sm')
    + item('총계', `${_won(d.total)}원`, '', 'total');
  $('ex-box-title').textContent = `${Number(m)}월 지출 내역`;
  $('ex-sub').innerHTML = (d.items.length ? '칸을 고치면 바로 저장됩니다 · 날짜순으로 정렬됩니다' : '')
    + (d.has_template ? '' : ' <span class="doc-warn">양식 파일이 서버에 없어 엑셀을 내려받을 수 없습니다</span>');
  $('ex-list').innerHTML = !d.items.length ? `<div class="empty doc-empty">${Number(m)}월 지출 내역이 없습니다.<br><b>+ 지출 추가</b>를 눌러 주세요.</div>`
    : `<table class="wr-tbl doc-tbl car-tbl"><colgroup><col style="width:150px"><col style="width:22%"><col style="width:15%"><col style="width:120px"><col style="width:120px"><col><col style="width:50px"></colgroup>
      <thead><tr><th>날짜</th><th>거래처</th><th>지출내용</th><th class="r">법인카드</th><th class="r">현금(개인카드)</th><th>비고</th><th></th></tr></thead><tbody>${d.items.map(t => `
      <tr>
        <td><input type="date" value="${esc(t.spend_date)}" min="${d.month}-01" max="${d.month}-31" onchange="exEdit('${t.id}', 'spend_date', this.value)"></td>
        <td><input type="text" value="${esc(t.vendor)}" placeholder="가게 이름" onchange="exEdit('${t.id}', 'vendor', this.value)"></td>
        <td><input type="text" value="${esc(t.content)}" list="ex-contents" placeholder="식대 외 2명" onchange="exEdit('${t.id}', 'content', this.value)"></td>
        <td><input type="number" class="r" min="0" step="100" value="${t.card_amount || ''}" onchange="exEdit('${t.id}', 'card_amount', this.value)"></td>
        <td><input type="number" class="r" min="0" step="100" value="${t.cash_amount || ''}" onchange="exEdit('${t.id}', 'cash_amount', this.value)"></td>
        <td><input type="text" value="${esc(t.note)}" placeholder="작업 사이트 · 함께한 사람" onchange="exEdit('${t.id}', 'note', this.value)"></td>
        <td class="c"><button class="icon-btn del" title="이 줄 삭제" onclick="exDel('${t.id}')">${ICO_DEL}</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr class="ex-foot"><td colspan="3" style="text-align:right">합계</td><td class="r">${_won(d.card_total)}</td><td class="r">${_won(d.cash_total)}</td><td colspan="2">총계 <b>${_won(d.total)}</b>원</td></tr></tfoot></table>`;
}
async function _exCall(method, url, body){
  try { _exData = await _apiSend(method, url, body); drawExpenses(); return true; }
  catch(e) { toast('저장 실패: ' + e.message); renderExpenses(); return false; }
}
function exSaveHeader(){
  _exCall('PUT', `${_exBase()}/header`, {month: _exYM, title: $('ex-title').value, applicant: $('ex-applicant').value, card_no: $('ex-card').value})
    .then(ok => ok && toast('저장됨'));
}
async function exAdd(){
  if(await _exCall('POST', `${_exBase()}/items`, {month: _exYM})){
    const rows = $('ex-list').querySelectorAll('tbody tr');
    const last = [...rows].find(tr => !tr.querySelector('input[type=text]').value) || rows[rows.length - 1];
    if(last) last.querySelector('input[type=text]').focus();
  }
}
function exEdit(id, field, value){
  const v = (field === 'card_amount' || field === 'cash_amount') ? Math.max(0, Math.round(Number(value) || 0)) : value;
  _exCall('PATCH', `${_exBase()}/items/${id}`, {[field]: v});
}
function exDel(id){
  if(!confirm('이 지출 줄을 삭제할까요?')) return;
  _exCall('DELETE', `${_exBase()}/items/${id}`);
}
function exDownload(){
  if(_exData && !_exData.has_template){ toast('양식 파일이 서버에 없습니다'); return; }
  // 고치던 칸이 있으면 먼저 저장되도록 포커스를 뺀 뒤 내려받는다
  if(document.activeElement) document.activeElement.blur();
  setTimeout(() => { location.href = `${_exBase()}/download?month=${_exYM}`; }, 300);
}

// ── OS별 EOS 현황 (routers/eos.py) ─────────────────────────────
// 날짜 칸 값: "YYYY-MM-DD" / "Y"(종료, 날짜 모름) / "N"(미발표) / ""(해당 없음)
let _eos = null, _eosCat = '전체', _eosSt = '', _eosUpAll = false;
const EOS_ST = {
  end:   {t: '지원 종료',     cls: 'b-red',    tip: '보안 업데이트까지 끝난 버전'},
  ext:   {t: '연장 지원만',   cls: 'b-purple', tip: '일반 지원은 끝났고 유료 연장 지원 계약으로만 업데이트를 받는 버전'},
  soon:  {t: '종료 임박',     cls: 'b-amber',  tip: '1년 안에 지원(EOL)이 끝나는 버전'},
  maint: {t: '유지보수 단계', cls: 'b-blue',   tip: '일반 지원은 끝나고 보안·중요 업데이트만 나오는 버전'},
  ok:    {t: '지원 중',       cls: 'b-green',  tip: '일반 지원 중인 버전'},
};
const EOS_F = {eoas: '일반 지원 종료', eol: '지원 종료 (EOL)', eoes: '연장 지원 종료'};
const _eosIsDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
function _eosDays(d){ return Math.round((new Date(d + 'T00:00:00') - new Date(_ymd(new Date()) + 'T00:00:00')) / 86400000); }
function _eosSpan(days){
  const m = Math.round(days / 30.44);
  if(m < 1) return `${days}일`;
  const y = Math.floor(m / 12), mo = m % 12;
  return y ? `${y}년${mo ? ' ' + mo + '개월' : ''}` : `${mo}개월`;
}
function eosStatus(r){
  const today = _ymd(new Date());
  const ended = r.eol === 'Y' || (_eosIsDate(r.eol) && r.eol < today);
  if(ended) return _eosIsDate(r.eoes) && r.eoes >= today ? 'ext' : 'end';
  if(_eosIsDate(r.eol) && _eosDays(r.eol) <= 365) return 'soon';
  if(r.eoas === 'Y' || (_eosIsDate(r.eoas) && r.eoas < today)) return 'maint';
  return 'ok';
}
function _eosLeft(r){
  if(r.eol === 'N') return '<span class="eos-muted">미발표</span>';
  if(r.eol === 'Y') return '<span class="eos-muted">종료</span>';
  if(!_eosIsDate(r.eol)) return '<span class="eos-muted">-</span>';
  const d = _eosDays(r.eol);
  if(d < 0) return `<span class="eos-muted">${_eosSpan(-d)} 전 종료</span>`;
  return d <= 90 ? `<b class="eos-dday">D-${d}</b>` : _eosSpan(d);
}
function _eosRecent(at){ return at && _eosDays(at) >= -30; }
function _eosDate(r, f){
  const v = r[f] || '', ch = (r.changes || {})[f];
  const today = _ymd(new Date());
  let html = v === '' ? '<span class="eos-muted">-</span>' : v === 'N' ? '<span class="eos-muted">미발표</span>'
           : v === 'Y' ? '<span class="eos-muted">종료</span>' : `<span class="${v < today ? 'eos-past' : ''}">${esc(v)}</span>`;
  if(ch && _eosRecent(ch.at)) html += ` <span class="eos-chg" title="${esc(ch.at)} 변경 · 이전 값: ${esc(ch.old)}">변경</span>`;
  return html;
}
function _eosLink(u){ return /^https:\/\//.test(u || '') ? u : ''; }
async function renderEos(){
  try { _eos = await _apiSend('GET', '/api/eos'); }
  catch(e){ $('eos-list').innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  $('eos-tabs').innerHTML = ['전체', ..._eos.categories].map(c =>
    `<button class="svh-tab${c === _eosCat ? ' active' : ''}" onclick="eosCat('${c}')">${c}</button>`).join('');
  drawEos();
}
function eosCat(c){ _eosCat = c; _eosSt = ''; renderEos(); }
function eosSt(k){ _eosSt = _eosSt === k ? '' : k; drawEos(); }
function eosUpToggle(){ _eosUpAll = !_eosUpAll; drawEos(); }
async function eosRefresh(btn){
  btn.disabled = true; btn.textContent = '갱신 중…';
  try {
    const r = await _apiSend('POST', '/api/eos/refresh');
    toast(r.failed.length ? `${r.ok}개 제품 갱신 · 실패: ${r.failed.join(', ')}` : `${r.ok}개 제품을 모두 갱신했습니다`);
  } catch(e){ toast(e.message); }
  renderEos();
}
function drawEos(){
  const d = _eos; if(!d) return;
  const today = _ymd(new Date());
  const q = ($('eos-q').value || '').trim().toLowerCase();
  const scope = $('eos-scope').value;
  const prods = d.products.filter(p => _eosCat === '전체' || p.category === _eosCat);
  const failed = d.products.filter(p => p.error);
  $('eos-info').innerHTML = `
    <div class="eos-info-t">
      <b>제조사 공식 지원 종료일</b> · 매일 1회 자동 갱신 ·
      마지막 갱신 <b>${esc(d.last_refresh ? d.last_refresh.slice(0, 16) : '없음')}</b>
      ${failed.length ? `<span class="eos-err" title="${esc(failed.map(p => p.label + ': ' + p.error).join('\n'))}">갱신 실패 ${failed.length}개 제품 — 마지막으로 받은 값을 표시 중</span>` : ''}
      <div class="eos-info-s">자료: endoflife.date 오픈 데이터(제조사 발표 기준) · Microsoft 수명 주기 페이지(Hyper-V) · IBM FLRT(HMC·PowerVM VIOS) · IBM 수명 주기 페이지(PowerVC) · HPE 발표(HP-UX, 수동). 제품마다 <b>공식 정책 ↗</b> 링크로 원문을 확인할 수 있습니다.</div>
    </div>
    <button class="btn" onclick="eosRefresh(this)"${d.refreshing ? ' disabled' : ''}>${d.refreshing ? '갱신 중…' : '지금 갱신'}</button>`;
  if(!d.products.length){
    $('eos-sum').innerHTML = ''; $('eos-up').innerHTML = '';
    $('eos-list').innerHTML = '<div class="empty doc-empty">아직 받은 정보가 없습니다.<br><b>지금 갱신</b>을 누르면 바로 받아 옵니다.</div>';
    return;
  }
  // 검색 + 표시 범위 (상태 필터 전)
  const base = [];
  prods.forEach(p => p.releases.forEach(r => {
    const st = eosStatus(r);
    if(q && ![p.label, p.key, r.label, r.cycle, r.latest].some(v => (v || '').toLowerCase().includes(q))
         && !(p.label + ' ' + r.cycle).toLowerCase().includes(q)) return;
    if(scope === 'active' && st === 'end') return;
    if(scope === 'recent' && st === 'end'){
      const last = [r.eol, r.eoes].filter(_eosIsDate).sort().pop();
      if(!last || _eosDays(last) < -365 * 3) return;
    }
    base.push({p, r, st});
  }));
  const cnt = k => base.filter(x => x.st === k).length;
  $('eos-sum').innerHTML = ['end', 'ext', 'soon', 'maint', 'ok'].map(k => {
    const n = cnt(k);
    return `<div class="wr-sum-i st-f${n ? '' : ' zero'}${_eosSt === k ? ' on' : ''}${k === 'end' ? ' red' : k === 'soon' ? ' amber' : ''}"
      title="${EOS_ST[k].tip} — 누르면 이 상태만 봅니다" onclick="${n || _eosSt === k ? `eosSt('${k}')` : ''}"><span>${EOS_ST[k].t}</span><b>${n}</b></div>`;
  }).join('');
  // 앞으로 12개월 안의 지원 종료 (분류만 반영)
  const ev = [];
  prods.forEach(p => p.releases.forEach(r => ['eoas', 'eol', 'eoes'].forEach(f => {
    const v = r[f];
    if(!_eosIsDate(v) || v < today || _eosDays(v) > 365) return;
    if(f === 'eoas' && v === r.eol) return;            // 일반·EOL 이 같은 날이면 EOL 만
    ev.push({v, f, p, r});
  })));
  ev.sort((a, b) => a.v.localeCompare(b.v) || a.p.label.localeCompare(b.p.label));
  const evShow = _eosUpAll ? ev : ev.slice(0, 6);
  $('eos-up').innerHTML = `
    <div class="eos-up-h">앞으로 12개월 안에 끝나는 지원 <span>${ev.length}건</span>
      ${ev.length > 6 ? `<button class="eos-more" onclick="eosUpToggle()">${_eosUpAll ? '접기' : `모두 보기 (${ev.length})`}</button>` : ''}</div>
    ${ev.length ? `<table class="lab-tbl eos-up-tbl"><colgroup><col style="width:110px"><col style="width:80px"><col style="width:26%"><col><col style="width:150px"></colgroup>
      <thead><tr><th>날짜</th><th>남은 날</th><th>제품</th><th>버전</th><th>구분</th></tr></thead><tbody>
      ${evShow.map(e => { const n = _eosDays(e.v); return `<tr>
        <td class="mono">${esc(e.v)}</td><td class="${n <= 90 ? 'eos-dday' : ''}">D-${n}</td>
        <td>${esc(e.p.label)}</td><td>${esc(e.r.label)}</td>
        <td><span class="badge ${e.f === 'eol' ? 'b-red' : e.f === 'eoes' ? 'b-purple' : 'b-blue'}">${EOS_F[e.f]}</span></td></tr>`; }).join('')}
      </tbody></table>` : '<div class="eos-up-none">12개월 안에 지원이 끝나는 버전이 없습니다</div>'}`;
  // 제품별 표
  const rows = _eosSt ? base.filter(x => x.st === _eosSt) : base;
  const byP = new Map();
  rows.forEach(x => { if(!byP.has(x.p)) byP.set(x.p, []); byP.get(x.p).push(x); });
  if(!byP.size){ $('eos-list').innerHTML = '<div class="empty doc-empty">조건에 맞는 버전이 없습니다</div>'; return; }
  const srcTxt = p => p.source === 'manual' ? '수동 입력 · 자동 갱신 안 됨'
    : `${({microsoft: 'Microsoft 공식 페이지', flrt: 'IBM FLRT', ibm: 'IBM 공식 페이지'})[p.source] || 'endoflife.date'} · ${esc((p.fetched_at || '').slice(5, 16))} 갱신`;
  $('eos-list').innerHTML = [...byP.entries()].map(([p, list]) => {
    const t = p.terms || {}, link = _eosLink(p.policy_link);
    const terms = ['eoas', 'eol', 'eoes'].filter(f => t[f]).map(f => `${EOS_F[f]} = ${esc(t[f])}`).join(' · ');
    return `<div class="eos-prod">
      <div class="eos-ph">
        <span class="eos-pn">${esc(p.label)}</span><span class="badge b-gray">${esc(p.category)}</span>
        <span class="eos-cnt">${list.length} / ${p.releases.length}개 버전</span>
        <span style="flex:1"></span>
        ${p.error ? `<span class="eos-err" title="${esc(p.error)}">갱신 실패 — 이전 값</span>` : ''}
        <span class="eos-src">${srcTxt(p)}</span>
        ${link ? `<a class="eos-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">공식 정책 ↗</a>` : ''}
      </div>
      <div class="eos-tw"><table class="lab-tbl eos-tbl">
        <colgroup><col><col style="width:104px"><col style="width:150px"><col style="width:132px"><col style="width:132px"><col style="width:132px"><col style="width:120px"><col style="width:112px"></colgroup>
        <thead><tr><th>버전</th><th>출시일</th><th>최신 릴리스</th><th>${EOS_F.eoas}</th><th class="eos-key">${EOS_F.eol}</th><th>${EOS_F.eoes}</th><th>남은 기간 (EOL)</th><th>상태</th></tr></thead>
        <tbody>${list.map(({r, st}) => { const ll = _eosLink(r.link); return `<tr class="eos-r-${st}">
          <td><span class="eos-ver">${esc(r.label)}</span>${r.lts && !/LTS/i.test(r.label) ? ' <span class="badge b-gray">LTS</span>' : ''}${_eosRecent(r.added_at) ? ' <span class="eos-new">신규</span>' : ''}
            ${r.note ? `<div class="eos-note">${esc(r.note)}</div>` : ''}</td>
          <td class="mono">${esc(r.release_date) || '<span class="eos-muted">-</span>'}</td>
          <td class="mono">${r.latest ? (ll ? `<a href="${esc(ll)}" target="_blank" rel="noopener noreferrer">${esc(r.latest)}</a>` : esc(r.latest)) : '<span class="eos-muted">-</span>'}</td>
          <td class="mono">${_eosDate(r, 'eoas')}</td>
          <td class="mono eos-key">${_eosDate(r, 'eol')}</td>
          <td class="mono">${_eosDate(r, 'eoes')}</td>
          <td>${_eosLeft(r)}</td>
          <td><span class="badge ${EOS_ST[st].cls}" title="${EOS_ST[st].tip}">${EOS_ST[st].t}</span></td>
        </tr>`; }).join('')}</tbody></table></div>
      ${terms || p.note ? `<div class="eos-legend">${terms ? '제조사 용어: ' + terms : ''}${terms && p.note ? '<br>' : ''}${esc(p.note)}</div>` : ''}
    </div>`;
  }).join('');
}
