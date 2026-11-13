const $ = id => document.getElementById(id);
let ENG_ID='', ENG_NAME='';
let currentSiteId=null, revealedPw={};   // revealedPw: 하위 호환용(미사용)

// 페이지네이션 상태

const PAGE_SIZE = 5;

// 캐시
let _allIssues=[], _allCLItems=[], _devChecklist={};

// SVG 아이콘
const ICO_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICO_DEL  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICO_CLOSE= `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

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
  if(!username||!password){$('login-err').textContent='아이디와 비밀번호를 입력해주세요';return}
  const r=await api.post('/api/auth/login',{username,password});
  if(r.ok){ENG_ID=r.engineer_id;ENG_NAME=r.engineer_name;initApp()}
  else $('login-err').textContent=r.detail||'로그인 실패';
}
async function doRegister(){
  const username=$('reg-user').value.trim(),password=$('reg-pw').value,engineer_name=$('reg-eng').value.trim();
  if(!username||!password||!engineer_name){$('reg-err').textContent='모든 항목을 입력해주세요';return}
  const r=await api.post('/api/auth/register',{username,password,engineer_name});
  if(r.ok){$('reg-err').style.color='#15803d';$('reg-err').textContent=r.message||'가입 완료! 로그인해주세요';switchAuth('login')}
  else $('reg-err').textContent=r.detail||'가입 실패';
}
async function doLogout(){
  await api.post('/api/auth/logout',{});
  ENG_ID='';ENG_NAME='';
  $('auth-wrap').style.display='flex';$('main-app').style.display='none';
}
function initApp(){
  $('auth-wrap').style.display='none';$('main-app').style.display='flex';
  $('sidebar-eng-name').textContent=ENG_NAME;
  const av=$('sidebar-avatar'); if(av) av.textContent=ENG_NAME.charAt(0);
  $('dash-title').textContent=`대시보드 — ${ENG_NAME}`;
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
    if(page==='schedule-mgmt'){ _smYear=new Date().getFullYear(); renderSchedMgmt(); }
    if(page==='projects')       renderProjects();
    if(page==='proj-status')    renderProjStatus();
    if(page==='sched-history')  renderSchedHistory();
    if(page==='technotes')      renderTechNotes();
    if(page==='work-plan')      renderWorkPlans();
    if(page==='incidents')      renderIncidents();
    if(page==='service-history') renderServiceHistory();
    if(page==='weekly-report')  renderWeeklyReport();
    if(page==='dev-checklist')  loadDevChecklist();
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
  $('dash-title').innerHTML = `대시보드 — ${esc(ENG_NAME)}
    <span class="dash-sub">사이트 ${d.site_count} · 장비 ${d.device_count}</span>`;

  (d.week?.schedules || []).forEach(x => { _schedById[x.id] = x; });
  renderDashMetrics();
  renderDashWeek();
  renderDashIssues();
  renderDashWarranty();
}
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

// ── 이번 주 할 일 ─────────────────────────
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
  // 이번 주: 오늘 ~ 일요일 (+ 지연·진행 중 장애) / 다음 주: 다음 주 월 ~ 일
  const start = isNext ? _ymd(new Date(ey, em-1, ed+1)) : today;
  const end   = isNext ? _ymd(new Date(ey, em-1, ed+7)) : thisEnd;
  $('dash-week-title').textContent = isNext ? '다음 주 할 일' : '이번 주 할 일';
  $('dash-week-range').textContent = `${start.slice(5).replace('-','/')} ~ ${end.slice(5).replace('-','/')}`;

  const items = [];
  w.schedules.forEach(x => items.push({kind:'sched', day:x.sched_date.slice(0,10), title:x.title, site:x.site_name,
    extra: x.sched_type !== '월간' ? `<span class="badge b-gray">${esc(x.sched_type)}</span>` : '',
    check:`<input type="checkbox" class="wk-check" title="점검 완료 처리" onclick="event.stopPropagation()" onchange="weekDoneSched('${x.id}',this)">`,
    open:`openEditSched('${x.id}')`}));
  w.workplans.forEach(x => items.push({kind:'plan', day:x.work_date.slice(0,10), time:x.work_date.slice(11,16), title:x.title, site:x.site,
    extra:`<span class="badge ${WP_ST_CLS[x.status]||'b-gray'}">${esc(x.status)}</span>${_wpImpactBadge(x.impact)}`,
    open:`openEditWorkPlan('${x.id}')`}));
  _allCLItems.filter(i => !i.done && i.due && i.due <= end).forEach(i => items.push({kind:'cl', day:i.due, title:i.text, site:i.site_name,
    extra:`<span class="badge b-gray">${esc(i.category)} 마감</span>`,
    check:`<input type="checkbox" class="wk-check" title="완료 처리" onclick="event.stopPropagation()" onchange="dashToggleCL('${i.id}',this.checked)">`,
    open:''}));
  const incs = isNext ? [] : w.incidents;

  const row = it => `
    <div class="wk-row ${it.open?'clickable':''}" ${it.open?`onclick="${it.open}"`:''}>
      ${it.check || ''}
      <span class="wk-kind ${WK_KIND[it.kind].cls}">${WK_KIND[it.kind].label}</span>
      ${it.time ? `<span class="wk-time">${esc(it.time)}</span>` : ''}
      <span class="wk-title" title="${esc(it.title)}">${esc(it.title)}</span>
      ${it.extra || ''}
      <span class="wk-site" title="${esc(it.site||'')}">${esc(it.site||'-')}</span>
    </div>`;

  const groups = [];
  if(incs.length) groups.push({cls:'hot', head:`진행 중 장애 ${incs.length}건`, rows: incs.map(i => row({kind:'inc', title:i.title, site:i.site,
    time: i.occurred_at ? i.occurred_at.slice(5,10).replace('-','/') : '',
    extra:`<span class="badge ${INC_SEV_CLS[i.severity]||'b-gray'}">${esc(i.severity)}</span><span class="badge ${INC_ST_CLS[i.status]||'b-gray'}">${esc(i.status)}</span>`,
    open:`openEditIncident('${i.id}')`}))});
  const late = isNext ? [] : items.filter(i => i.day < today).sort((a,b) => a.day.localeCompare(b.day));
  if(late.length) groups.push({cls:'late', head:`지연 ${late.length}건 <span class="wk-meta">날짜가 지났지만 미완료</span>`,
    rows: late.map(it => row({...it, time: it.day.slice(5).replace('-','/') + (it.time ? ' ' + it.time : '')}))});
  const [sy, sm, sd] = start.split('-').map(Number);
  let shown = 0;
  for(let n = 0; ; n++){
    const day = _ymd(new Date(sy, sm-1, sd+n));
    if(day > end) break;
    const its = items.filter(i => i.day === day).sort((a,b) => (a.time||'').localeCompare(b.time||''));
    shown += its.length;
    if(its.length) groups.push({cls: day === today ? 'today' : '', head: _dayLabel(day, today), rows: its.map(row)});
  }

  const cnt = incs.length + late.length + shown;
  $('dash-week-cnt').textContent = cnt ? `${cnt}건` : '';
  el.innerHTML = groups.length
    ? groups.map(g => `<div class="wk-group ${g.cls}"><div class="wk-head">${g.head}</div>${g.rows.join('')}</div>`).join('')
    : `<div class="empty">${isNext ? '다음 주' : '이번 주'}에 예정된 일이 없습니다</div>`;
}

async function weekDoneSched(id, el){
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/schedules/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status:'완료' }) });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    toast('점검 완료 처리됨');
  } catch(e) {
    console.error('점검 완료 처리 실패:', e);
    toast('완료 처리 실패: 서버 오류가 발생했습니다.');
    if(el) el.checked = false;
    return;
  }
  _schedHistory = [];
  _refreshDash();
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
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
    <div class="iss-row" onclick="showIssuePopup('${i.id}')">
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
  $('dash-metrics').innerHTML = `
    <div class="metric" style="cursor:pointer" title="점검 일정 메뉴로 이동" onclick="document.querySelector('.nav-item[data-page=\\'schedule-mgmt\\']').click()"><div class="metric-label">이번 달 점검</div><div class="metric-value">${ss.done}/${ss.total}</div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${ss.total?Math.round(ss.done/ss.total*100):0}%"></div></div></div>
    <div class="metric" style="cursor:pointer" title="체크리스트 할 일 보기" onclick="switchDashCL('todo');$('dash-cl').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="metric-label">체크리스트 남은 항목</div>
      <div class="metric-value" style="${todo.length?'color:#d97706':''}">${todo.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">월간 ${byCat('월간')} · 분기 ${byCat('분기')} · 일반 ${byCat('일반')}</div></div>
    <div class="metric" style="cursor:pointer" title="사이트 이슈 보기" onclick="$('dash-issues').scrollIntoView({behavior:'smooth',block:'center'})">
      <div class="metric-label">미해결 이슈</div>
      <div class="metric-value" style="${hot?'color:#dc2626':''}">${issues.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">긴급·높음 ${hot}건</div></div>
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
          return its.length ? `<div class="dcl-group"><div class="dcl-group-head">${c}${its[0].period ? ` · ${esc(its[0].period)} 완료` : ''}</div>${its.map(row).join('')}</div>` : '';
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
      ? `일반 <span class="dcl-meta">기한 없음</span>`
      : `${c} · ${esc(p.period)} <span class="dcl-meta">${esc(p.due.slice(5).replace('-', '/'))} 마감 · ${n}/${all.length} 완료</span>`;
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

$('btn-sm-add') && $('btn-sm-add').addEventListener('click', async()=>{
  $('sched-modal-title').textContent='점검 일정 등록';
  $('sched-id').value='';
  ['sched-title','sched-memo','sched-worker','sched-reviewer'].forEach(id=>$(id).value='');
  mopSet('sched-mop', '');
  $('sched-date').value=_ymd(new Date());
  $('sched-type').value='월간'; $('sched-status').value='예정';
  $('btn-sched-excel').style.display='none';
  await fillSiteSel('sched-site');
  openModal('modal-add-sched');
});

const _schedById = {};
async function openEditSched(s){
  if(typeof s === 'string') s = _schedById[s];
  if(!s){ toast('일정을 찾을 수 없습니다'); return; }
  $('sched-modal-title').textContent='점검 일정 수정';
  $('sched-id').value=s.id;
  await fillSiteSel('sched-site', s.site_id);   // ← site_id 미리 선택
  $('sched-title').value=s.title;
  $('sched-date').value=s.sched_date;
  $('sched-type').value=s.sched_type;
  $('sched-status').value=s.status;
  $('sched-memo').value=s.memo||'';
  
  ['sched-worker','sched-reviewer'].forEach(id=>$(id).value='');
  mopSet('sched-mop', '');
  $('btn-sched-excel').style.display='none';
  
  await loadSchedWorkPlans();
  const wp = _schedWorkPlans.find(p => p.id === s.id);
  if(wp) {
    $('sched-worker').value = wp.worker || '';
    $('sched-reviewer').value = wp.reviewer || '';
    mopSet('sched-mop', wp.mop_content || '');
    $('btn-sched-excel').style.display='block';
  }

  openModal('modal-add-sched');
}

async function saveSched(){
  const site_id=$('sched-site').value, title=$('sched-title').value.trim();
  if(!site_id||!title){toast('사이트와 제목을 입력해주세요');return}
  const payload={site_id,title,sched_date:$('sched-date').value,sched_type:$('sched-type').value,status:$('sched-status').value,memo:$('sched-memo').value};
  const id=$('sched-id').value;
  
  let schedId = id;
  if(id) {
    await api.patch(`/api/engineers/${ENG_ID}/schedules/${id}`,payload);
  } else {
    const res = await api.post(`/api/engineers/${ENG_ID}/schedules`,payload);
    schedId = res.id;
  }
  
  const worker = $('sched-worker').value.trim();
  const reviewer = $('sched-reviewer').value.trim();
  const mop = mopGet('sched-mop');
  if(worker || reviewer || mop || id) {
    const wpPayload = {
      id: schedId, title: title, work_date: $('sched-date').value,
      site: $('sched-site').options[$('sched-site').selectedIndex].text,
      worker: worker, reviewer: reviewer, mop_content: mop,
      status: $('sched-status').value === '완료' ? '작업완료' : '계획중'
    };
    await api.post(`/api/engineers/${ENG_ID}/workplans`, wpPayload);
    await loadSchedWorkPlans(true);
  }

  closeModal('modal-add-sched');
  _refreshDash();
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
  toast(id?'일정 수정됨':'일정 등록됨');
}

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
async function renderChecklistPage(){
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  const sel=$('cl-site-sel');
  const prev=sel.value;
  sel.innerHTML='<option value="">— 사이트 선택 —</option>'+sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  if(prev) sel.value=prev;
  renderChecklist();
}

async function renderChecklist(){
  const siteId=$('cl-site-sel').value;
  const el=$('cl-content');
  if(!siteId){el.innerHTML='<div class="empty">사이트를 선택해주세요</div>';return}
  const items=await api.get(`/api/engineers/${ENG_ID}/site-checklist/${siteId}`);
  const cats=['월간','분기','일반'];
  const sample = c => ({'월간':`${new Date().getMonth()+1}월`, '분기':`${Math.ceil((new Date().getMonth()+1)/3)}분기`}[c] || '');
  const note = {'월간':'매월 1일 자동 초기화', '분기':'분기 첫날 자동 초기화', '일반':'한 번 완료하면 유지'};
  el.innerHTML=cats.map(cat=>{
    const its=items.filter(i=>i.category===cat);
    const done=its.filter(i=>i.done).length;
    const per = its[0]?.period || sample(cat);
    return `<div class="card">
      <div class="card-title"><span>${cat} 점검${per?` · ${esc(per)}`:''} <span style="font-weight:400;font-size:11px;color:#94a3b8;text-transform:none;letter-spacing:0">${note[cat]}</span></span><span style="font-weight:400;text-transform:none;letter-spacing:0">${done}/${its.length}</span></div>
      ${its.length?`<div class="prog-wrap" style="margin-bottom:10px"><div class="prog-bar" style="width:${its.length?Math.round(done/its.length*100):0}%"></div></div>`:''}
      ${its.map(i=>`
        <div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #f0f0ee">
          <input type="checkbox" ${i.done?'checked':''} onchange="toggleCL('${i.id}',this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#378ADD">
          <span style="flex:1;${i.done?'text-decoration:line-through;color:#bbb':''}">${esc(i.text)}</span>
          ${!i.done ? _clDue(i) : ''}
          <button class="icon-btn edit" title="수정" onclick="openEditCL(${JSON.stringify(i).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
          <button class="icon-btn del"  title="삭제" onclick="deleteCL('${i.id}')">${ICO_DEL}</button>
        </div>`).join('')}
      ${!its.length?'<div class="empty" style="padding:12px">항목 없음</div>':''}
    </div>`;
  }).join('');
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
async function openAddCLItem(){
  $('cl-modal-title').textContent='체크리스트 항목 추가';
  $('cl-item-id').value=''; $('cl-text').value='';
  $('cl-cat').value='월간';
  // 체크리스트 화면에서는 선택된 사이트, 대시보드에서는 사이트 필터 값을 기본으로
  const pre = $('page-checklist').classList.contains('active') ? $('cl-site-sel').value : $('dcl-site').value;
  await _fillCLSiteSel(pre);
  $('cl-item-site').disabled = false;
  openModal('modal-cl-item');
}
async function openEditCL(item){
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
  await api.patch(`/api/engineers/${ENG_ID}/site-checklist/${id}`,{done:checked});
  renderChecklist();
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
const isSupportPlan = p => String(p.id || '').startsWith('wp-');
async function loadSchedWorkPlans(force = false){
  if(_schedWpLoaded && !force) return;
  try {
    _schedWorkPlans = (await api.get(`/api/engineers/${ENG_ID}/workplans?scope=schedule`)).filter(p => !isSupportPlan(p));
    _schedWpLoaded = true;
  } catch(e){}
}
let _wpPage = 1;
const WP_PAGE_SIZE = 10;
const WP_ST_CLS = {'계획중':'b-gray', '결재대기':'b-amber', '승인완료':'b-blue', '작업완료':'b-green'};
const WP_STATUSES = ['계획중', '결재대기', '승인완료', '작업완료'];
const WP_ACTIVE = ['계획중', '결재대기', '승인완료'];

function _ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function _wpDates(){
  const now = new Date();
  // 이번 주 = 오늘 ~ 이번 주 일요일 (weekEnd 는 다음 주 월요일, 미포함)
  const toMon = (8 - now.getDay()) % 7 || 7;
  return { today: _ymd(now), weekEnd: _ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMon)) };
}
const _wpDay = p => (p.work_date || '').slice(0, 10);
const _wpIsOverdue = (p, today) => p.status !== '작업완료' && !!_wpDay(p) && _wpDay(p) < today;
const _wpIsThisWeek = (p, today, weekEnd) => p.status !== '작업완료' && _wpDay(p) >= today && _wpDay(p) < weekEnd;

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
    card('active', '진행 중', active, `계획중 ${cnt('계획중')} · 결재대기 ${cnt('결재대기')} · 승인완료 ${cnt('승인완료')}`) +
    card('결재대기', '결재대기', cnt('결재대기'), '결재 진행이 필요한 건', cnt('결재대기') ? '#d97706' : '') +
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
  const asc = view && view !== '작업완료';
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
          ${p.support_type && p.support_type !== '기술지원' ? `<span class="badge b-purple">${esc(p.support_type)}</span>` : ''}
          ${_wpImpactBadge(p.impact)}
          ${overdue ? '<span class="badge b-red">일정 경과</span>' : ''}
          <span style="font-size:12px;color:${overdue ? '#dc2626' : '#888'}">${esc(fmtDT(p.work_date))}</span>
        </div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(p.title)}</div>
        <div style="font-size:12px;color:#666">사이트: <b>${esc(p.site||'-')}</b> | 작업자: ${esc(p.worker||'-')} | 결재/공유: ${esc(p.reviewer||'-')}</div>
        ${p.purpose ? `<div class="svc-sub">목적: ${esc(p.purpose)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:flex-start" onclick="event.stopPropagation()">
        <button class="btn btn-sm" title="작업계획서 엑셀 다운로드" onclick="downloadWorkPlanExcel('${p.id}')">Excel</button>
        <button class="icon-btn edit" title="수정" onclick="openEditWorkPlan('${p.id}')">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteWorkPlan('${p.id}')">${ICO_DEL}</button>
      </div>
    </div>`;
  }).join('');
}
async function changeWorkPlanStatus(id, status){
  const p = _allWorkPlans.find(x => x.id === id);
  if(!p) return;
  const prev = p.status;
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/workplans/${id}`, {
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

async function fillWpSiteSel(selectedSite=''){
  const names = (await api.get(`/api/engineers/${ENG_ID}/sites`)).map(s => s.name);
  if(selectedSite && !names.includes(selectedSite)) names.unshift(selectedSite);   // 삭제·변경된 사이트명도 보존
  $('wp-site').innerHTML = '<option value="">-</option>' + names.map(n => `<option ${n===selectedSite?'selected':''}>${esc(n)}</option>`).join('');
}

async function openAddWorkPlan() {
  $('wp-modal-title').textContent = '기술지원 등록';
  $('wp-id').value = '';
  ['wp-title', 'wp-worker', 'wp-reviewer', 'wp-purpose', 'wp-prerequisites', 'wp-verification', 'wp-rollback'].forEach(id => $(id).value='');
  mopSet('wp-mop', '');
  $('wp-date').value = '';
  $('wp-status').value = '계획중';
  $('wp-support-type').value = '기술지원';
  $('wp-impact').value = '없음';
  try {
    await fillWpSiteSel();
  } catch (e) {
    console.error("Failed to fill site selector for work plan:", e);
    // Don't stop, just show an empty/error state in the dropdown
    $('wp-site').innerHTML = '<option value="">사이트 로딩 실패</option>';
  }
  openModal('modal-add-workplan');
}

async function openEditWorkPlan(p) {
  if(typeof p === 'string'){
    const id = p;
    p = _allWorkPlans.find(x => x.id === id);
    if(!p){
      try { _allWorkPlans = (await api.get(`/api/engineers/${ENG_ID}/workplans`)).filter(isSupportPlan); } catch(e){}
      p = _allWorkPlans.find(x => x.id === id);
    }
  }
  if(!p) { toast('기술지원 데이터를 찾을 수 없습니다'); return; }
  $('wp-modal-title').textContent = '기술지원 수정';
  $('wp-id').value = p.id;
  $('wp-title').value = p.title;
  $('wp-date').value = p.work_date || '';
  $('wp-worker').value = p.worker || '';
  $('wp-reviewer').value = p.reviewer || '';
  $('wp-status').value = p.status;
  $('wp-support-type').value = p.support_type || '기술지원';
  $('wp-purpose').value = p.purpose || '';
  $('wp-impact').value = p.impact || '없음';
  $('wp-prerequisites').value = p.prerequisites || '';
  mopSet('wp-mop', p.mop_content || '');
  $('wp-verification').value = p.verification || '';
  $('wp-rollback').value = p.rollback_plan || '';
  try {
    await fillWpSiteSel(p.site || '');
  } catch (e) {
    console.error("Failed to fill site selector for work plan edit:", e);
    $('wp-site').innerHTML = '<option value="">사이트 로딩 실패</option>';
  }
  openModal('modal-add-workplan');
}

async function saveWorkPlan() {
  const title = $('wp-title').value.trim();
  if(!title) { toast('제목을 입력해주세요'); return; }
  if(!$('wp-date').value) { toast('작업 일시를 입력해주세요'); return; }
  const payload = { 
    title, 
    work_date: $('wp-date').value, 
    site: $('wp-site').value, 
    worker: $('wp-worker').value, 
    reviewer: $('wp-reviewer').value, 
    status: $('wp-status').value,
    support_type: $('wp-support-type').value,
    purpose: $('wp-purpose').value,
    impact: $('wp-impact').value,
    prerequisites: $('wp-prerequisites').value,
    mop_content: mopGet('wp-mop'),
    verification: $('wp-verification').value,
    rollback_plan: $('wp-rollback').value
  };
  const id = $('wp-id').value;
  const url = id ? `/api/engineers/${ENG_ID}/workplans/${id}` : `/api/engineers/${ENG_ID}/workplans`;
  try {
    const r = await fetch(url, {method: id ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    console.error('기술지원 저장 실패:', e);
    toast('저장 실패: 서버 오류가 발생했습니다. 입력 내용은 유지됩니다.');
    return;
  }
  closeModal('modal-add-workplan');
  renderWorkPlans(); _refreshSvcHistory(); toast(id ? '기술지원 수정됨' : '기술지원 등록됨');
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

async function downloadSchedWorkPlanExcel() {
  const id = $('sched-id').value;
  if (!id) {
    toast('일정을 먼저 저장한 후 다운로드할 수 있습니다.');
    return;
  }

  // 다운로드 전, 현재 폼의 내용을 저장하여 최신 상태를 반영합니다.
  const title = $('sched-title').value;
  const worker = $('sched-worker').value;
  const reviewer = $('sched-reviewer').value;
  const mop = mopGet('sched-mop');
  
  const wpPayload = {
    id: id, title: title, work_date: $('sched-date').value,
    site: $('sched-site').options[$('sched-site').selectedIndex].text,
    worker: worker, reviewer: reviewer, mop_content: mop,
    status: $('sched-status').value === '완료' ? '작업완료' : '계획중'
  };
  await api.post(`/api/engineers/${ENG_ID}/workplans`, wpPayload);
  
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
  return `<div class="metric" style="cursor:pointer" title="월별 기술지원 및 장애처리 이력으로 이동"
      onclick="document.querySelector('.nav-item[data-page=\\'service-history\\']').click()">
    <div class="metric-label">이번 달 기술지원 · 장애</div>
    <div class="metric-value">${a + b}건</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">기술지원 ${a} · 장애처리 ${b}</div></div>`;
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
document.querySelectorAll('.svh-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.svh-tab').forEach(x => x.classList.toggle('active', x === t));
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
  const supDone = sup.filter(p => p.status === '작업완료').length;
  $('svh-summary').innerHTML = `
    <div class="metric"><div class="metric-label">기술지원</div><div class="metric-value">${sup.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">작업완료 ${supDone}건</div></div>
    <div class="metric"><div class="metric-label">장애처리</div><div class="metric-value">${incs.length}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">긴급·높음 ${incs.filter(i => i.severity==='긴급'||i.severity==='높음').length}건</div></div>
    <div class="metric"><div class="metric-label">미완료 장애</div><div class="metric-value" style="${openInc?'color:#dc2626':''}">${openInc}건</div></div>
    <div class="metric"><div class="metric-label">누적 장애 시간</div><div class="metric-value" style="font-size:20px">${downMin ? fmtDuration(downMin) : '-'}</div></div>`;

  const [ty, tm] = ym.split('-');
  $('svh-list-title').textContent = `${ty}년 ${Number(tm)}월 ${{all:'기술지원 / 장애처리', support:'기술지원', incident:'장애처리'}[_svhTab]} 이력`;

  const rows = [];
  if(_svhTab !== 'incident') sup.forEach(p => rows.push({
    kind:'support', date:p.work_date, site:p.site, title:p.title, worker:p.worker,
    status:p.status, stCls:{'계획중':'b-gray','결재대기':'b-amber','승인완료':'b-blue','작업완료':'b-green'}[p.status]||'b-gray',
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
async function renderWeeklyReport(){
  if(!_wrStart) _wrStart = _ymd(_wrMonday(new Date()));
  const el = $('wr-rows');
  let d;
  try { d = await _apiSend('GET', `/api/engineers/${ENG_ID}/reports/weekly?start=${_wrStart}`); }
  catch(e){ el.innerHTML = `<div class="empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
  _wrData = d;
  const fmt = x => `${Number(x.slice(5,7))}/${Number(x.slice(8,10))}`;
  $('wr-range').textContent = `${d.start.slice(0,4)}년 ${fmt(d.start)} (월) ~ ${fmt(d.end)} (일)`;
  $('wr-notes').value = d.notes;
  $('wr-confirmed').value = d.confirmed;
  $('wr-download').disabled = !d.template_ok;
  $('wr-download').title = d.template_ok ? '' : '양식 파일(data/report_templates/weekly_report.xlsx)이 없습니다';

  const t = d.totals;
  const sup = t.H + t.I + t.J + t.K + t.L;
  $('wr-summary').innerHTML = `
    <div class="metric"><div class="metric-label">정기점검</div><div class="metric-value">${t.F}건</div></div>
    <div class="metric"><div class="metric-label">장애지원</div><div class="metric-value" style="${t.G?'color:#dc2626':''}">${t.G}건</div></div>
    <div class="metric"><div class="metric-label">기술지원 (요청·납품·원격·이전·기타)</div><div class="metric-value">${sup}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">요청 ${t.H} · 납품 ${t.I} · 원격 ${t.J} · 이전 ${t.K} · 기타 ${t.L}</div></div>
    <div class="metric"><div class="metric-label">합계</div><div class="metric-value">${d.total}건</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">${d.rows.length}줄${d.rows.length > 9 ? ' (양식 9줄 초과분은 행 자동 추가)' : ''}</div></div>`;

  if(!d.rows.length){ el.innerHTML = '<div class="empty">이 주에 집계된 지원 내역이 없습니다</div>'; return; }
  const n = v => v ? `<b>${v}</b>` : '';
  el.innerHTML = `<div class="svh-table-wrap"><table class="svh-table wr-table">
    <thead><tr><th style="width:150px">고객사</th><th style="width:110px">지원일자</th><th>지원요약</th>
      <th class="c">정기<br>점검</th><th class="c">장애<br>지원</th><th class="c">기술<br>지원</th><th class="c">납품</th><th class="c">원격</th><th class="c">이전</th><th class="c">기타</th>
      <th style="width:110px">지원엔지니어</th><th style="width:28%">비고</th></tr></thead>
    <tbody>${d.rows.map(r => `<tr>
      <td style="font-weight:600">${esc(r.site)}</td>
      <td>${r.date.replace(/-/g, "/")} (${r.weekday})</td>
      <td class="wr-pre">${r.summary.map(x => '- ' + esc(x)).join('<br>')}</td>
      ${['F','G','H','I','J','K','L'].map(c => `<td class="c">${n(r.counts[c])}</td>`).join('')}
      <td>${esc(r.workers)}</td>
      <td class="wr-pre wr-remark">${r.remarks.map(x => '- ' + esc(x)).join('<br>')}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3" style="text-align:right">합계</td>${['F','G','H','I','J','K','L'].map(c => `<td class="c">${t[c]||''}</td>`).join('')}<td colspan="2">총 ${d.total}건</td></tr></tfoot>
  </table></div>
  <div class="wr-help" style="margin-top:8px">주말 작업 등 포털에 없는 내용은 내려받은 엑셀에서 직접 추가하세요. 교체파트·담당영업 칸은 비워 둡니다.</div>`;
}
function wrReset(which){
  if(!_wrData) return;
  $(which === 'notes' ? 'wr-notes' : 'wr-confirmed').value = _wrData[which];
}
async function downloadWeeklyReport(){
  const btn = $('wr-download');
  btn.disabled = true; const label = btn.textContent; btn.textContent = '생성 중...';
  try {
    const r = await fetch(`/api/engineers/${ENG_ID}/reports/weekly/xlsx`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ start: _wrStart, notes: $('wr-notes').value, confirmed: $('wr-confirmed').value }) });
    if(!r.ok){ let m = `HTTP ${r.status}`; try { m = (await r.json()).detail || m; } catch(e){} throw new Error(m); }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : `주간보고서_${_wrStart}.xlsx`;
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
let _smTab  = 'monthly';
let _smYear = new Date().getFullYear();

function smYear(delta){
  _smYear += delta;
  $('sm-year-label').textContent = _smYear;
  renderSchedMgmt();
}

function switchSchedMgmtTab(tab){
  _smTab = tab;
  document.querySelectorAll('.sm-tab').forEach(t=>t.classList.toggle('active',t.dataset.smtab===tab));
  renderSchedMgmt();
}

function _smRow(s){
  _schedById[s.id] = s;
  const typCls={월간:'b-monthly',분기:'b-quarterly',특별:'b-special'};
  const stCls={예정:'b-planned',완료:'b-done'};
  const done = s.status==='완료';
  return `<div class="sm-row">
    <span class="sm-date">${s.sched_date.slice(5)}</span>
    <span class="sm-site" style="${done?'text-decoration:line-through;color:#bbb':''}">${s.site_name}</span>
    <span class="sm-title" style="${done?'text-decoration:line-through;color:#bbb':''}">${s.title}</span>
    <span class="badge ${typCls[s.sched_type]||'b-gray'}" style="flex-shrink:0">${s.sched_type}</span>
    <button class="ds-check-btn ${done?'checked':''}" onclick="toggleSchedStatusMgmt('${s.id}','${s.status}')" title="${done?'완료 취소':'완료 처리'}" style="flex-shrink:0">
      ${done
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:.3"><polyline points="20 6 9 17 4 12"/></svg>'}
    </button>
    <div style="display:flex;gap:2px;flex-shrink:0">
      ${_schedWorkPlans.some(p => p.id === s.id) ? `<button class="btn btn-sm" style="padding:2px 4px;font-size:10px;color:#16a34a;border-color:#16a34a;margin-right:4px;" title="계획서 엑셀 다운로드" onclick="downloadWorkPlanExcel('${s.id}')">Excel</button>` : ''}
      <button class="icon-btn edit" title="수정" onclick="openEditSched('${s.id}')">${ICO_EDIT}</button>
      <button class="icon-btn del"  title="삭제" onclick="deleteSchedAndRefresh('${s.id}')">${ICO_DEL}</button>
    </div>
  </div>`;
}

function _smProgressBar(done, total, color){
  const pct = total ? Math.round(done/total*100) : 0;
  return `<div style="display:flex;align-items:center;gap:8px;flex:1">
    <div style="flex:1;max-width:160px;background:#e8e8e4;border-radius:4px;height:6px;overflow:hidden">
      <div style="height:100%;border-radius:4px;background:${pct===100?'#16a34a':color};width:${pct}%;transition:width .3s"></div>
    </div>
    <span style="font-size:11px;font-weight:600;color:${pct===100?'#16a34a':'#888'}">${done}/${total}</span>
  </div>`;
}

async function renderSchedMgmt(){
  $('sm-year-label').textContent = _smYear;
  const all = await api.get(`/api/engineers/${ENG_ID}/schedules/all?year=${_smYear}`);
  await loadSchedWorkPlans();
  const el  = $('sm-content');

  // 연간 요약 통계 — 현재 탭 기준으로 표시
  const monthly  = all.filter(s=>s.sched_type==='월간');
  const quarterly= all.filter(s=>s.sched_type==='분기');
  const special  = all.filter(s=>s.sched_type==='특별');
  const viewItems= _smTab==='monthly'
    ? all.filter(s=>s.sched_type==='월간'||s.sched_type==='특별')
    : all.filter(s=>s.sched_type==='분기'||s.sched_type==='특별');
  const totalView= viewItems.length;
  const doneView = viewItems.filter(s=>s.status==='완료').length;
  const pctView  = totalView ? Math.round(doneView/totalView*100) : 0;
  const tabLabel = _smTab==='monthly' ? '월간' : '분기';
  const barColor = _smTab==='monthly' ? '#378ADD' : '#7c3aed';

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div class="metric"><div class="metric-label">${tabLabel} 전체 일정</div><div class="metric-value">${totalView}건</div>
        <div class="prog-wrap"><div class="prog-bar" style="width:${pctView}%;background:${pctView===100?'#16a34a':barColor}"></div></div></div>
      <div class="metric"><div class="metric-label">완료</div><div class="metric-value" style="color:#16a34a">${doneView}건</div>
        <div style="font-size:11px;color:#888;margin-top:3px">${pctView}% 달성</div></div>
      <div class="metric"><div class="metric-label">월간 점검</div><div class="metric-value">${monthly.length}건</div>
        <div style="font-size:11px;color:#888;margin-top:3px">${monthly.filter(s=>s.status==='완료').length}건 완료</div></div>
      <div class="metric"><div class="metric-label">분기 점검</div><div class="metric-value">${quarterly.length}건</div>
        <div style="font-size:11px;color:#888;margin-top:3px">${quarterly.filter(s=>s.status==='완료').length}건 완료</div></div>
    </div>`;

  if(_smTab === 'monthly'){
    // 월별 뷰 — 월간 + 특별 유형만 표시
    const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const curM = new Date().getFullYear()===_smYear ? new Date().getMonth() : -1;
    el.innerHTML = summaryHtml + monthNames.map((name,i)=>{
      const ym    = `${_smYear}-${String(i+1).padStart(2,'0')}`;
      // 월별은 월간 + 특별 유형만
      const items = all.filter(s=>s.sched_date.startsWith(ym) && (s.sched_type==='월간'||s.sched_type==='특별'));
      const done  = items.filter(s=>s.status==='완료').length;
      const isCur = i===curM;
      const pct   = items.length ? Math.round(done/items.length*100) : 0;
      return `<div class="card" style="margin-bottom:8px;${isCur?'border-color:#378ADD;box-shadow:0 0 0 2px #dbeafe':''}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${items.length?'10px':'0'}">
          <div style="display:flex;align-items:center;gap:6px;min-width:60px">
            ${isCur?'<span style="width:8px;height:8px;border-radius:50%;background:#378ADD;flex-shrink:0"></span>':'<span style="width:8px;height:8px;flex-shrink:0"></span>'}
            <span style="font-size:14px;font-weight:700;color:${isCur?'#185FA5':'#1a1a1a'}">${name}</span>
          </div>
          ${items.length ? _smProgressBar(done,items.length,'#378ADD') : '<span style="font-size:12px;color:#bbb;flex:1">월간 일정 없음</span>'}
          ${items.length ? `<span class="badge ${pct===100?'b-done':'b-gray'}" style="font-size:10px">${pct===100?'✓ 완료':'진행중'}</span>` : ''}
          ${isCur?'<span class="badge b-blue" style="font-size:10px">이번 달</span>':''}
        </div>
        ${items.length ? `<div style="border-top:1px solid #f0f0ee;padding-top:4px">${items.map(s=>_smRow(s)).join('')}</div>` : ''}
      </div>`;
    }).join('');
  } else {
    // 분기별 뷰 — 분기 + 특별 유형만 표시 (월간 완전 제외)
    const qInfo=[
      {q:1,label:'1분기',sub:'1~3월',cls:'sm-q1',barColor:'#f97316',months:['01','02','03']},
      {q:2,label:'2분기',sub:'4~6월',cls:'sm-q2',barColor:'#22c55e',months:['04','05','06']},
      {q:3,label:'3분기',sub:'7~9월',cls:'sm-q3',barColor:'#a855f7',months:['07','08','09']},
      {q:4,label:'4분기',sub:'10~12월',cls:'sm-q4',barColor:'#3b82f6',months:['10','11','12']},
    ];
    const curQ = Math.ceil((new Date().getMonth()+1)/3);
    el.innerHTML = summaryHtml + qInfo.map(qi=>{
      // 분기별은 분기 + 특별 유형만 — 월간 완전 제외
      const items = all.filter(s=>
        qi.months.some(m=>s.sched_date.startsWith(`${_smYear}-${m}`)) &&
        (s.sched_type==='분기'||s.sched_type==='특별')
      );
      const done   = items.filter(s=>s.status==='완료').length;
      const isCurQ = qi.q===curQ && new Date().getFullYear()===_smYear;
      return `<div class="card" style="margin-bottom:14px;${isCurQ?'border-color:'+qi.barColor+';box-shadow:0 0 0 2px '+qi.barColor+'22':''}">
        <div class="sm-quarter-header ${qi.cls}" style="margin-bottom:${items.length?'12px':'0'}">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:90px">
            <span class="sm-quarter-title">${qi.label} ${isCurQ?'<span style="font-size:11px;font-weight:400;opacity:.7">(현재)</span>':''}</span>
            <span style="font-size:11px;opacity:.7">${qi.sub}</span>
          </div>
          ${items.length ? _smProgressBar(done,items.length,qi.barColor) : '<span style="font-size:12px;color:#bbb;flex:1">분기 일정 없음</span>'}
          ${items.length ? `<span class="badge" style="font-size:10px;background:${qi.barColor}22;color:${qi.barColor};border:1px solid ${qi.barColor}44">${items.length}건</span>` : ''}
        </div>
        ${items.length ? `<div style="border-top:1px solid #f0f0ee;padding-top:4px">${items.map(s=>_smRow(s)).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }
}

async function toggleSchedStatusMgmt(id, currentStatus){
  const newStatus = currentStatus==='완료'?'예정':'완료';
  await api.patch(`/api/engineers/${ENG_ID}/schedules/${id}`,{status:newStatus});
  _schedHistory = [];
  renderSchedMgmt();
  _refreshDash();
}

async function deleteSchedAndRefresh(id){
  if(!confirm('점검 일정을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/schedules/${id}`);
  renderSchedMgmt(); toast('삭제됨');
}

// ── Init ──────────────────────────────────
$('n-date').value=new Date().toISOString().slice(0,10);

(async()=>{
  const me=await api.get('/api/auth/me').catch(()=>null);
  if(me&&me.engineer_id){ENG_ID=me.engineer_id;ENG_NAME=me.engineer_name;initApp()}
})();

// ── PROJECTS ─────────────────────────────────
let _currentProjectId = null;

async function renderProjects(filter='') {
  const projs = await api.get(`/api/engineers/${ENG_ID}/projects`);
  const el = $('project-list');
  const filtered = projs.filter(p => p.name.includes(filter) || (p.customer||'').includes(filter));
  if(!filtered.length) { el.innerHTML = '<div class="empty">프로젝트가 없습니다</div>'; return; }
  
  const statusCls = {'진행 대기':'b-gray', '진행 중':'b-blue', '보류':'b-amber', '완료':'b-green'};
  el.innerHTML = filtered.map(p => `
    <div class="card" style="cursor:pointer" onclick="openProjectDetail('${p.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:#1e293b">${p.name}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:10px">고객사: ${p.customer||'-'} <span style="margin:0 6px">|</span> 기간: ${p.start_date||'-'} ~ ${p.end_date||'-'}</div>
          <div style="font-size:12px;color:#888;margin-bottom:10px">${p.description||''}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge ${statusCls[p.status]||'b-gray'}">${p.status}</span>
            <div style="flex:1;max-width:200px;height:6px;background:#f1f5f9;border-radius:6px;overflow:hidden">
              <div style="width:${p.progress}%;height:100%;background:${p.progress===100?'#22c55e':'#3b82f6'};transition:width 0.3s"></div>
            </div>
            <span style="font-size:11px;color:#888">${p.progress}% (${p.tasks.filter(t=>t.status==='완료').length}/${p.tasks.length})</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditProject(${JSON.stringify(p).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
          <button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteProject('${p.id}')">${ICO_DEL}</button>
        </div>
      </div>
    </div>`).join('');
}

const projectSearch = $('project-search');
if (projectSearch) projectSearch.addEventListener('input', e => renderProjects(e.target.value));

function openAddProject() {
  $('proj-modal-title').textContent = '프로젝트 등록';
  $('p-id').value = '';
  $('p-name').value = '';
  $('p-customer').value = '';
  $('p-start').value = new Date().toISOString().slice(0,10);
  $('p-end').value = '';
  $('p-status').value = '진행 대기';
  $('p-desc').value = '';
  $('p-template').value = '';
  $('p-template').disabled = false;
  openModal('modal-add-project');
}

function openEditProject(p) {
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
    name, customer: $('p-customer').value,
    start_date: $('p-start').value, end_date: $('p-end').value,
    status: $('p-status').value, description: $('p-desc').value
  };
  if(!id) {
    const tmpl = $('p-template').value;
    if(tmpl && !payload.start_date) {
      toast('템플릿을 사용하려면 시작일을 지정해야 합니다.'); return;
    }
    payload.template = tmpl;
  }
  
  if(id) await api.patch(`/api/engineers/${ENG_ID}/projects/${id}`, payload);
  else   await api.post(`/api/engineers/${ENG_ID}/projects`, payload);
  closeModal('modal-add-project');
  renderProjects(); toast(id ? '수정됨' : '등록됨');
}

async function deleteProject(id) {
  if(!confirm('프로젝트를 삭제하시겠습니까? 관련 태스크도 모두 삭제됩니다.')) return;
  await api.del(`/api/engineers/${ENG_ID}/projects/${id}`);
  renderProjects(); toast('삭제됨');
}

// ── PROJECT DETAIL (TASKS) ───────────────────
async function openProjectDetail(id) {
  _currentProjectId = id;
  const projs = await api.get(`/api/engineers/${ENG_ID}/projects`);
  const p = projs.find(x => x.id === id);
  if(!p) return;
  $('detail-proj-name').textContent = p.name;
  renderTasks(p);
  openModal('modal-project-detail');
}

function renderTasks(p) {
  const tasks = p.tasks || [];
  const el = $('task-list');
  if(!tasks.length) { el.innerHTML = '<div class="empty">등록된 태스크가 없습니다.</div>'; return; }
  
  let minDate = new Date(p.start_date || '2099-12-31');
  let maxDate = new Date(p.end_date || '1970-01-01');
  
  tasks.forEach(t => {
    if(t.start_date) { const d = new Date(t.start_date); if(d < minDate) minDate = d; }
    if(t.end_date) { const d = new Date(t.end_date); if(d > maxDate) maxDate = d; }
  });

  if (minDate > maxDate) {
    minDate = new Date();
    maxDate = new Date();
  }

  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
  const weeksCount = Math.max(1, Math.ceil(totalDays / 7));

  const statusCls = {'대기':'b-gray', '진행중':'b-blue', '완료':'b-done'};
  
  let timelineHTML = `<div style="display:flex; margin-bottom: 8px; border-bottom:1px solid #e2e8f0; padding-bottom: 4px;">
    <div style="width: 200px; font-weight: 600; font-size: 12px; color: #64748b;">태스크명</div>
    <div style="flex:1; display:flex;">
      ${Array.from({length: weeksCount}).map((_, i) => {
        const cur = new Date(minDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const getMonthWeek = (d) => {
          const fDay = new Date(d.getFullYear(), d.getMonth(), 1);
          const firstMon = 1 + (8 - fDay.getDay()) % 7;
          if (d.getDate() < firstMon) {
            return getMonthWeek(new Date(d.getFullYear(), d.getMonth(), 0));
          }
          const wNum = Math.floor((d.getDate() - firstMon) / 7) + 1;
          return `${d.getMonth() + 1}월 ${wNum}주차`;
        };
        return `<div style="flex:1; text-align:center; font-size:11px; color:#64748b; border-left:1px solid #e2e8f0;">${getMonthWeek(cur)}</div>`;
      }).join('')}
    </div>
    <div style="width: 70px; text-align:right;"></div>
  </div>`;

  const tasksHTML = tasks.map(t => {
    let barLeft = 0;
    let barWidth = 0;
    if (t.start_date && t.end_date) {
      const s = new Date(t.start_date);
      const e = new Date(t.end_date);
      barLeft = Math.max(0, (s - minDate) / (1000 * 60 * 60 * 24) / totalDays * 100);
      barWidth = Math.max(2, (e - s + (1000*60*60*24)) / (1000 * 60 * 60 * 24) / totalDays * 100);
      if (barLeft + barWidth > 100) barWidth = 100 - barLeft;
    }

    const barColor = t.status === '완료' ? '#10b981' : (t.status === '진행중' ? '#3b82f6' : '#cbd5e1');

    return `
      <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <div style="width: 200px; padding-right: 12px; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:600; font-size:13px; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${t.status==='완료'?'text-decoration:line-through;opacity:.6':''}">${t.name}</div>
          <div style="font-size:11px; color:#94a3b8">${t.start_date||'-'} ~ ${t.end_date||'-'}</div>
          <div style="margin-top:2px"><span class="badge ${statusCls[t.status]||'b-gray'}" style="padding:2px 4px; font-size:10px;">${t.status}</span></div>
        </div>
        <div style="flex:1; position:relative; height: 24px; background:#f8fafc; border-radius:4px; overflow:hidden; display:flex;">
          ${Array.from({length: weeksCount}).map((_, i) => `<div style="flex:1; border-left:1px dashed #e2e8f0; height:100%;"></div>`).join('')}
          ${t.start_date && t.end_date ? `<div style="position:absolute; top:4px; left:${barLeft}%; width:${barWidth}%; height:16px; background:${barColor}; border-radius:4px; transition:all 0.3s;"></div>` : ''}
        </div>
        <div style="width: 70px; display:flex; justify-content:flex-end; gap:4px;">
          <button class="icon-btn edit" onclick="openEditTask(${JSON.stringify(t).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
          <button class="icon-btn del" onclick="deleteTask('${t.id}')">${ICO_DEL}</button>
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = timelineHTML + tasksHTML;
}

function openAddTask() {
  $('task-modal-title').textContent = '태스크 추가';
  $('t-id').value = '';
  $('t-name').value = '';
  $('t-status').value = '대기';
  $('t-start').value = '';
  $('t-end').value = '';
  openModal('modal-add-task');
}

function openEditTask(t) {
  $('task-modal-title').textContent = '태스크 수정';
  $('t-id').value = t.id;
  $('t-name').value = t.name;
  $('t-status').value = t.status;
  $('t-start').value = t.start_date || '';
  $('t-end').value = t.end_date || '';
  openModal('modal-add-task');
}

async function saveTask() {
  const name = $('t-name').value.trim();
  if(!name) { toast('태스크명을 입력해주세요'); return; }
  const payload = { name, status: $('t-status').value, start_date: $('t-start').value, end_date: $('t-end').value };
  const tid = $('t-id').value;
  if(tid) await api.patch(`/api/engineers/${ENG_ID}/projects/${_currentProjectId}/tasks/${tid}`, payload);
  else    await api.post(`/api/engineers/${ENG_ID}/projects/${_currentProjectId}/tasks`, payload);
  closeModal('modal-add-task');
  
  // Refresh detail view
  const projs = await api.get(`/api/engineers/${ENG_ID}/projects`);
  const p = projs.find(x => x.id === _currentProjectId);
  if(p) renderTasks(p);
  if($('page-projects').classList.contains('active')) renderProjects(); // update progress bar
  toast(tid ? '태스크 수정됨' : '태스크 추가됨');
}

async function deleteTask(tid) {
  if(!confirm('태스크를 삭제하시겠습니까?')) return;
  await api.del(`/api/engineers/${ENG_ID}/projects/${_currentProjectId}/tasks/${tid}`);
  const projs = await api.get(`/api/engineers/${ENG_ID}/projects`);
  const p = projs.find(x => x.id === _currentProjectId);
  if(p) renderTasks(p);
  if($('page-projects').classList.contains('active')) renderProjects();
  toast('삭제됨');
}

// ── PROJ STATUS ──────────────────────────────
async function renderProjStatus() {
  const projs = await api.get(`/api/engineers/${ENG_ID}/projects`);
  const el = $('page-proj-status');
  el.innerHTML = `
    <div class="page-title">진행 현황</div>
    <div class="grid3">
      <div class="metric"><div class="metric-label">전체 프로젝트</div><div class="metric-value">${projs.length}</div></div>
      <div class="metric"><div class="metric-label">진행 중</div><div class="metric-value" style="color:#2563eb">${projs.filter(p=>p.status==='진행 중').length}</div></div>
      <div class="metric"><div class="metric-label">완료</div><div class="metric-value" style="color:#16a34a">${projs.filter(p=>p.status==='완료').length}</div></div>
    </div>
    <div style="margin-top:24px">
      <div class="dash-card-title">프로젝트 태스크 진척도</div>
      ${projs.length ? projs.map(p => `
        <div class="card" style="margin-bottom:12px;cursor:pointer" onclick="document.querySelector('.nav-item[data-page=\\'projects\\']').click(); setTimeout(()=>openProjectDetail('${p.id}'), 100);">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:700;color:#1e293b">${p.name} <span style="font-size:12px;font-weight:normal;color:#94a3b8;margin-left:8px">(${p.tasks.length}개 태스크)</span></span>
            <span style="font-size:12px;font-weight:600;color:${p.progress===100?'#16a34a':'#3b82f6'}">${p.progress}%</span>
          </div>
          <div style="width:100%;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="width:${p.progress}%;height:100%;background:${p.progress===100?'#22c55e':'#3b82f6'};transition:width 0.4s"></div>
          </div>
        </div>
      `).join('') : '<div class="empty">프로젝트가 없습니다.</div>'}
    </div>
  `;
}

// ── SCHED HISTORY ─────────────────────────────
let _schedHistory = [];
async function renderSchedHistory(){
  if (!$('sh-search').value) {
     _schedHistory = await api.get(`/api/engineers/${ENG_ID}/schedules/history`);
  }
  const q = $('sh-search').value.toLowerCase().trim();
  const filtered = _schedHistory.filter(s => (s.site_name||'').toLowerCase().includes(q) || (s.title||'').toLowerCase().includes(q));
  
  const el = $('sh-list');
  if(!filtered.length){
    el.innerHTML='<div class="empty">완료된 점검 이력이 없습니다</div>';
    return;
  }
  
  const typCls={월간:'b-monthly',분기:'b-quarterly',특별:'b-special'};
  
  el.innerHTML=`<table class="tbl">
    <thead><tr><th>점검일</th><th>사이트</th><th>제목</th><th>구분</th><th>메모</th><th>상태 변경</th></tr></thead>
    <tbody>
      ${filtered.map(s=>`<tr>
        <td class="mono" style="min-width:90px">${s.sched_date}</td>
        <td style="font-weight:600;min-width:120px">${s.site_name}</td>
        <td style="min-width:150px">${s.title}</td>
        <td><span class="badge ${typCls[s.sched_type]||'b-gray'}">${s.sched_type}</span></td>
        <td style="font-size:12px;color:#666">${s.memo||''}</td>
        <td style="min-width:80px">
          <button class="btn btn-sm" onclick="revertSchedHistory('${s.id}')">예정으로 변경</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function revertSchedHistory(id) {
  if(!confirm('이 점검을 다시 예정 상태로 변경하시겠습니까?')) return;
  await api.patch(`/api/engineers/${ENG_ID}/schedules/${id}`, {status: '예정'});
  _schedHistory = [];
  renderSchedHistory();
  toast('상태가 변경되었습니다');
}

// ── TECH NOTES ──────────────────────────────
let _allTechNotes = [];
let _tnCategoryFilter = '전체';

async function renderTechNotes(searchQ='') {
  // 최초 로드 시 API 호출 시도
  if (!_allTechNotes.length && searchQ === '') {
    try { 
      const res = await api.get(`/api/engineers/${ENG_ID}/technotes`); 
      if (Array.isArray(res)) _allTechNotes = res;
    } catch(e) { _allTechNotes = []; }
  }
  
  let filtered = Array.isArray(_allTechNotes) ? _allTechNotes : [];
  if (_tnCategoryFilter !== '전체') {
    filtered = filtered.filter(n => n.category === _tnCategoryFilter);
  }
  if (searchQ) {
    const q = searchQ.toLowerCase();
    filtered = filtered.filter(n => (n.title||'').toLowerCase().includes(q) || (n.body||'').toLowerCase().includes(q) || (n.tags||'').toLowerCase().includes(q));
  }

  const el = $('technote-list');
  if(!filtered.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1;">등록된 기술 노트가 없습니다.</div>'; return; }
  
  el.innerHTML = filtered.map(n => `
    <div class="card" style="cursor:pointer; display:flex; flex-direction:column; height: 160px" onclick="openViewTechNote('${n.id}')">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span class="badge b-blue">${n.category||'기타'}</span>
        <div style="display:flex; gap:4px;">
          <button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditTechNote('${n.id}')">${ICO_EDIT}</button>
          <button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteTechNote('${n.id}')">${ICO_DEL}</button>
        </div>
      </div>
      <div style="font-weight:700; font-size:15px; margin-bottom:6px; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${n.title}</div>
      <div style="font-size:12px; color:#64748b; line-height:1.4; flex:1; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; margin-bottom:12px;">
        ${(n.body||'').replace(/</g, '&lt;')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:auto">
        <div style="font-size:11px; color:#94a3b8; font-weight:600">${(n.tags||'').split(',').filter(x=>x.trim()).map(t=>`#${t.trim()}`).join(' ')}</div>
        <div style="font-size:11px; color:#94a3b8;">${(n.created_at||'').slice(0,10)}</div>
      </div>
    </div>
  `).join('');
}

if ($('tn-search')) $('tn-search').addEventListener('input', e => renderTechNotes(e.target.value));

function filterTechNotes(cat) {
  _tnCategoryFilter = cat;
  document.querySelectorAll('#tn-category-filters button').forEach(b => {
    if(b.textContent === cat) {
      b.classList.remove('b-gray'); b.classList.add('b-blue', 'active');
    } else {
      b.classList.remove('b-blue', 'active'); b.classList.add('b-gray');
    }
  });
  renderTechNotes($('tn-search').value);
}

function openAddTechNote() {
  $('tn-modal-title').textContent = '기술 노트 작성';
  $('tn-id').value = '';
  $('tn-title').value = '';
  $('tn-category').value = 'OS/서버구축';
  $('tn-tags').value = '';
  $('tn-body').value = '';
  openModal('modal-add-technote');
}

function openEditTechNote(id) {
  const n = _allTechNotes.find(x => x.id === id);
  if(!n) return;
  $('tn-modal-title').textContent = '기술 노트 수정';
  $('tn-id').value = n.id;
  $('tn-title').value = n.title;
  $('tn-category').value = n.category || '기타';
  $('tn-tags').value = n.tags || '';
  $('tn-body').value = n.body || '';
  openModal('modal-add-technote');
}

function openViewTechNote(id) {
  const n = _allTechNotes.find(x => x.id === id);
  if(!n) return;
  $('view-tn-title').textContent = n.title;
  $('view-tn-category').textContent = n.category || '기타';
  $('view-tn-date').textContent = (n.created_at||new Date().toISOString()).slice(0,10);
  $('view-tn-tags').textContent = (n.tags||'').split(',').filter(x=>x.trim()).map(t=>`#${t.trim()}`).join(' ');
  
  if (window.marked && window.hljs) {
    $('view-tn-body').innerHTML = marked.parse(n.body || '');
    document.querySelectorAll('#view-tn-body pre code').forEach(block => hljs.highlightElement(block));
  } else {
    $('view-tn-body').textContent = n.body || '';
  }

  openModal('modal-view-technote');
}

async function saveTechNote() {
  const title = $('tn-title').value.trim();
  if(!title) { toast('제목을 입력해주세요'); return; }
  if(!$('wp-date').value) { toast('작업 일시를 입력해주세요'); return; }
  const payload = { title, category: $('tn-category').value, tags: $('tn-tags').value, body: $('tn-body').value };
  const id = $('tn-id').value;
  
  try {
    if(id) await api.patch(`/api/engineers/${ENG_ID}/technotes/${id}`, payload);
    else   await api.post(`/api/engineers/${ENG_ID}/technotes`, payload);
  } catch (e) {
    // 백엔드 API가 아직 준비되지 않았을 경우를 대비해 화면상 데이터만 갱신
    console.warn("API 호출 실패, 로컬 뷰 데이터를 업데이트합니다.");
    if(!id) _allTechNotes.push({ id: 'tn-'+Date.now(), ...payload, created_at: new Date().toISOString() });
    else { const idx = _allTechNotes.findIndex(x=>x.id===id); if(idx>=0) _allTechNotes[idx] = {..._allTechNotes[idx], ...payload}; }
  }
  
  closeModal('modal-add-technote');
  try { _allTechNotes = await api.get(`/api/engineers/${ENG_ID}/technotes`); } catch(e){}
  renderTechNotes($('tn-search').value);
  toast(id ? '수정되었습니다' : '저장되었습니다');
}

async function deleteTechNote(id) {
  if(!confirm('노트를 삭제하시겠습니까?')) return;
  try { await api.del(`/api/engineers/${ENG_ID}/technotes/${id}`); } catch (e) {}
  if (Array.isArray(_allTechNotes)) {
    _allTechNotes = _allTechNotes.filter(x=>x.id!==id);
  }
  renderTechNotes($('tn-search').value);
  toast('삭제됨');
}

// ── DEVELOPMENT CHECKLIST ─────────────────
let _currentDevTab = 'all';

async function loadDevChecklist() {
  try {
    _devChecklist = await api.get('/api/dev/checklist');
    renderDevChecklist();
  } catch (e) {
    console.error('체크리스트 로드 실패:', e);
  }
}

function switchDevTab(tab) {
  _currentDevTab = tab;
  document.querySelectorAll('[data-devtab]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-devtab') === tab);
  });
  renderDevChecklist();
}

async function renderDevChecklist() {
  const sections = _devChecklist.sections || [];
  const content = $('dev-checklist-content');
  
  let filtered = [];
  sections.forEach(sec => {
    let items = sec.items || [];
    if (_currentDevTab !== 'all') {
      const statusMap = { completed: '완료', 'in-progress': '진행중', planned: '예정' };
      items = items.filter(i => i.status === statusMap[_currentDevTab]);
    }
    if (items.length > 0) {
      filtered.push({ category: sec.category, items });
    }
  });
  
  // 통계 업데이트
  await updateDevStats();
  
  if (filtered.length === 0) {
    content.innerHTML = '<div style="text-align:center;padding:40px;color:#888">항목이 없습니다</div>';
    return;
  }
  
  let html = '';
  filtered.forEach(sec => {
    html += `<div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#378ADD;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0">
        ${sec.category}
      </div>`;
    
    sec.items.forEach(item => {
      const statusColor = item.status === '완료' ? '#22c55e' : 
                         item.status === '진행중' ? '#f59e0b' : '#94a3b8';
      const statusBg = item.status === '완료' ? '#dcfce7' : 
                      item.status === '진행중' ? '#fef3c7' : '#f1f5f9';
      
      html += `<div style="padding:12px;background:#fafaf8;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:4px">${item.task}</div>
          <div style="font-size:12px;color:#666;margin-bottom:6px">${item.notes || '—'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="padding:2px 8px;background:${statusBg};color:${statusColor};font-size:11px;font-weight:600;border-radius:3px">${item.status}</span>
            <span style="padding:2px 8px;background:#f0f0ee;color:#666;font-size:11px;border-radius:3px">${item.priority}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="changeDevItemStatus('${item.id}', '완료')" style="padding:4px 8px;font-size:11px">✅</button>
          <button class="btn btn-sm" onclick="changeDevItemStatus('${item.id}', '진행중')" style="padding:4px 8px;font-size:11px">🔄</button>
          <button class="btn btn-sm" onclick="changeDevItemStatus('${item.id}', '예정')" style="padding:4px 8px;font-size:11px">📋</button>
        </div>
      </div>`;
    });
    html += '</div>';
  });
  
  content.innerHTML = html;
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

async function updateDevStats() {
  try {
    const stats = await api.get('/api/dev/checklist/stats');
    let totalItems = 0, completed = 0, inProgress = 0, planned = 0;
    
    stats.forEach(sec => {
      totalItems += sec.total || 0;
      completed += sec.completed || 0;
      inProgress += sec.in_progress || 0;
      planned += sec.planned || 0;
    });
    
    const rate = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
    
    $('stat-total').textContent = totalItems;
    $('stat-completed').textContent = completed;
    $('stat-in-progress').textContent = inProgress;
    $('stat-planned').textContent = planned;
    $('dev-completion-rate').textContent = `진행률: ${rate}%`;
  } catch (e) {
    console.error('통계 업데이트 실패:', e);
  }
}
