const $ = id => document.getElementById(id);
let ENG_ID='', ENG_NAME='';
let currentSiteId=null, revealedPw={};

// 페이지네이션 상태
const pgState = { issues:1, cl:1 };
const PAGE_SIZE = 5;

// 캐시
let _allIssues=[], _allCLItems=[];

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
function openModal(id){$(id).classList.add('open')}
function closeModal(id){$(id).classList.remove('open')}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open')}));

// ── 페이지네이션 헬퍼 ──────────────────────
function renderPagination(containerId, total, currentPage, onPageFn){
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
  // 항상 이번달(월간) 탭으로 초기화 후 대시보드 렌더
  _dashSchedTab = 'month';
  document.querySelectorAll('.ds-tab').forEach(t=>t.classList.toggle('active', t.dataset.dstab==='month'));
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
    if(page==='logs')           renderLogs();
    if(page==='projects')       renderProjects();
    if(page==='proj-status')    renderProjStatus();
    if(page==='sched-history')  renderSchedHistory();
    if(page==='technotes')      renderTechNotes();
    if(page==='work-plan')      renderWorkPlans();
    // if(page==='report') ...
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
  const d=await api.get(`/api/engineers/${ENG_ID}/dashboard`);
  _allIssues = d.issues_all || d.issues;  // 전체 이슈 캐시

  $('dash-metrics').innerHTML=`
    <div class="metric"><div class="metric-label">내 사이트 수</div><div class="metric-value">${d.site_count}</div></div>
    <div class="metric"><div class="metric-label">전체 장비 수</div><div class="metric-value">${d.device_count}</div></div>
    <div class="metric"><div class="metric-label">이번 달 점검</div><div class="metric-value">${d.schedule_summary.done}/${d.schedule_summary.total}</div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${d.schedule_summary.total?Math.round(d.schedule_summary.done/d.schedule_summary.total*100):0}%"></div></div></div>
    <div class="metric"><div class="metric-label">이번 달 작업 이력</div><div class="metric-value">${d.monthly_log_count}건</div></div>`;

  // 이슈 렌더 (페이지네이션)
  renderIssuesPage(1);

  // 대시보드 체크리스트 (전체 사이트 합산)
  const clData = await api.get(`/api/engineers/${ENG_ID}/site-checklist`);
  _allCLItems = clData.flatMap(s=>s.items.map(i=>({...i, site_name:s.site_name})));
  renderCLPage(1);

  // 점검 일정 - 항상 이번달(월간) 탭으로 강제 초기화 후 로드
  _dashSchedTab = 'month';
  document.querySelectorAll('.ds-tab').forEach(t=>t.classList.toggle('active', t.dataset.dstab==='month'));
  const curQ = _currentQuarter();
  const qLabelEl = $('ds-quarter-label');
  if(qLabelEl) qLabelEl.textContent = `${curQ}분기 (${(curQ-1)*3+1}~${curQ*3}월)`;
  await loadDashScheds();

  // 워런티
  $('dash-warranty').innerHTML=d.expiring_warranties.length?d.expiring_warranties.map(w=>{
    const dd=w.warranty_days, cls=dd<=0?'expired':'';
    const label=dd<=0?'만료됨':'D-'+dd;
    const bc=dd<=0?'b-red':dd<=30?'b-red':'b-amber';
    return `<div class="w-alert ${cls}"><div style="flex:1"><div style="font-weight:500">${w.name}</div><div style="font-size:11px;opacity:.8">${w.site_name} · ${w.warranty}</div></div><span class="badge ${bc}">${label}</span></div>`;
  }).join(''):'<div class="empty" style="padding:14px">만료 임박 장비 없음</div>';

  // 점검 현황 - 제목 옆 인라인
  const mp=d.schedule_summary;
  const summaryEl=$('sched-summary');
  if(summaryEl) summaryEl.textContent=`${mp.done}/${mp.total} 완료`;
}

// ── 이슈 페이지네이션 렌더 ─────────────────
function renderIssuesPage(page){
  pgState.issues=page;
  const sevCls={긴급:'b-red',높음:'b-amber',보통:'b-blue',낮음:'b-gray'};
  const stCls={오픈:'b-red',처리중:'b-amber',완료:'b-green'};
  const total=_allIssues.length;
  const paged=_allIssues.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const el=$('dash-issues');
  if(!total){el.innerHTML='<div class="empty">오픈된 이슈 없음</div>';}
  else{
    el.innerHTML=paged.map(i=>`
      <div style="display:flex;align-items:center;gap:6px;padding:7px 2px;border-bottom:1px solid #f0f0ee;cursor:pointer" onclick="showIssuePopup(${JSON.stringify(i).replace(/"/g,'&quot;')})">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:4px;margin-bottom:3px;flex-wrap:wrap;align-items:center">
            <span class="badge ${sevCls[i.severity]||'b-gray'}">${i.severity}</span>
            <span class="badge ${stCls[i.status]||'b-gray'}">${i.status}</span>
            <span class="badge b-gray" style="font-size:10px;font-weight:600">${i.site_name}</span>
          </div>
          <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.title}</div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button class="icon-btn edit" title="수정" onclick="event.stopPropagation();openEditIssue(${JSON.stringify(i).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
          <button class="icon-btn del"  title="삭제" onclick="event.stopPropagation();deleteIssue('${i.id}')">${ICO_DEL}</button>
        </div>
      </div>`).join('');
  }
  renderPagination('dash-issues-page', total, page, 'renderIssuesPage');
}

function showIssuePopup(i){
  const sevCls={긴급:'b-red',높음:'b-amber',보통:'b-blue',낮음:'b-gray'};
  const stCls={오픈:'b-red',처리중:'b-amber',완료:'b-green'};
  $('issue-popup-content').innerHTML=`
    <div class="modal-head">
      <div class="issue-popup-title">${i.title}</div>
      <button class="icon-btn" style="width:24px;height:24px;flex-shrink:0" onclick="closeModal('modal-issue-popup')">${ICO_CLOSE}</button>
    </div>
    <div class="issue-popup-meta">
      <span class="badge ${sevCls[i.severity]||'b-gray'}">${i.severity}</span>
      <span class="badge ${stCls[i.status]||'b-gray'}">${i.status}</span>
      <span style="font-size:12px;color:#888">${i.site_name}</span>
      <span style="font-size:11px;color:#bbb;margin-left:auto">${i.created_at||''}</span>
    </div>
    <div class="issue-popup-body">${i.body||'(내용 없음)'}</div>
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid #f0f0ee">
      <button class="icon-btn edit" title="수정" style="width:32px;height:32px" onclick="closeModal('modal-issue-popup');openEditIssue(${JSON.stringify(i).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
      <button class="btn" onclick="closeModal('modal-issue-popup')">닫기</button>
    </div>`;
  openModal('modal-issue-popup');
}

// ── 대시보드 체크리스트 페이지네이션 ─────────
function renderCLPage(page){
  pgState.cl=page;
  const total=_allCLItems.length;
  const paged=_allCLItems.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const el=$('dash-cl');
  if(!total){el.innerHTML='<div class="empty">체크리스트 항목 없음</div>';}
  else{
    el.innerHTML=paged.map(i=>`
      <div style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid #f0f0ee">
        <input type="checkbox" ${i.done?'checked':''} onchange="dashToggleCL('${i.id}',this.checked)" style="width:14px;height:14px;cursor:pointer;accent-color:#378ADD;flex-shrink:0">
        <span style="flex:1;font-size:13px;${i.done?'text-decoration:line-through;color:#bbb':''}">${i.text}</span>
        <span class="badge b-gray" style="font-size:10px;font-weight:600">${i.site_name}</span>
        <span class="badge b-gray" style="font-size:10px">${i.category}</span>
      </div>`).join('');
  }
  renderPagination('dash-cl-page', total, page, 'renderCLPage');
}

async function dashToggleCL(id, checked){
  await api.patch(`/api/engineers/${ENG_ID}/site-checklist/${id}`,{done:checked});
  const item=_allCLItems.find(i=>i.id===id);
  if(item) item.done=checked;
  renderCLPage(pgState.cl);
}

// ── 점검 일정 CRUD ────────────────────────
async function fillSiteSel(selId, selectedId=''){
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  $(selId).innerHTML='<option value="">— 선택 —</option>'+
    sites.map(s=>`<option value="${s.id}" ${s.id===selectedId?'selected':''}>${s.name}</option>`).join('');
}

$('btn-sm-add') && $('btn-sm-add').addEventListener('click', async()=>{
  $('sched-modal-title').textContent='점검 일정 등록';
  $('sched-id').value='';
  ['sched-title','sched-memo','sched-worker','sched-reviewer','sched-mop'].forEach(id=>$(id).value='');
  $('sched-date').value=new Date().toISOString().slice(0,10);
  $('sched-type').value='월간'; $('sched-status').value='예정';
  $('btn-sched-excel').style.display='none';
  await fillSiteSel('sched-site');
  openModal('modal-add-sched');
});

$('btn-add-sched').addEventListener('click', async()=>{
  $('sched-modal-title').textContent='점검 일정 등록';
  $('sched-id').value='';
  ['sched-title','sched-memo','sched-worker','sched-reviewer','sched-mop'].forEach(id=>$(id).value='');
  $('sched-date').value=new Date().toISOString().slice(0,10);
  $('sched-type').value='월간'; $('sched-status').value='예정';
  $('btn-sched-excel').style.display='none';
  await fillSiteSel('sched-site');
  openModal('modal-add-sched');
});

async function openEditSched(s){
  $('sched-modal-title').textContent='점검 일정 수정';
  $('sched-id').value=s.id;
  await fillSiteSel('sched-site', s.site_id);   // ← site_id 미리 선택
  $('sched-title').value=s.title;
  $('sched-date').value=s.sched_date;
  $('sched-type').value=s.sched_type;
  $('sched-status').value=s.status;
  $('sched-memo').value=s.memo||'';
  
  ['sched-worker','sched-reviewer','sched-mop'].forEach(id=>$(id).value='');
  $('btn-sched-excel').style.display='none';
  
  if(!_allWorkPlans.length) { try { _allWorkPlans = await api.get(`/api/engineers/${ENG_ID}/workplans`); } catch(e){} }
  const wp = _allWorkPlans.find(p => p.id === s.id);
  if(wp) {
    $('sched-worker').value = wp.worker || '';
    $('sched-reviewer').value = wp.reviewer || '';
    $('sched-mop').value = wp.mop_content || '';
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
  const mop = $('sched-mop').value.trim();
  if(worker || reviewer || mop || id) {
    const wpPayload = {
      id: schedId, title: title, work_date: $('sched-date').value,
      site: $('sched-site').options[$('sched-site').selectedIndex].text,
      worker: worker, reviewer: reviewer, mop_content: mop,
      status: $('sched-status').value === '완료' ? '작업완료' : '계획중'
    };
    await api.post(`/api/engineers/${ENG_ID}/workplans`, wpPayload);
    try { _allWorkPlans = await api.get(`/api/engineers/${ENG_ID}/workplans`); } catch(e){}
  }

  closeModal('modal-add-sched');
  // 즉시 갱신 - 등록된 일정 타입에 맞는 탭으로 자동 전환
  const savedType = $('sched-type').value;
  const targetTab = savedType === '분기' ? 'quarter' : 'month';
  if(_dashSchedTab !== targetTab){
    _dashSchedTab = targetTab;
    document.querySelectorAll('.ds-tab').forEach(t=>t.classList.toggle('active', t.dataset.dstab===targetTab));
  }
  await loadDashScheds();
  // 대시보드 상단 메트릭도 갱신
  const d2 = await api.get(`/api/engineers/${ENG_ID}/dashboard`);
  $('dash-metrics').innerHTML=`
    <div class="metric"><div class="metric-label">내 사이트 수</div><div class="metric-value">${d2.site_count}</div></div>
    <div class="metric"><div class="metric-label">전체 장비 수</div><div class="metric-value">${d2.device_count}</div></div>
    <div class="metric"><div class="metric-label">이번 달 점검</div><div class="metric-value">${d2.schedule_summary.done}/${d2.schedule_summary.total}</div>
      <div class="prog-wrap"><div class="prog-bar" style="width:${d2.schedule_summary.total?Math.round(d2.schedule_summary.done/d2.schedule_summary.total*100):0}%"></div></div></div>
    <div class="metric"><div class="metric-label">이번 달 작업 이력</div><div class="metric-value">${d2.monthly_log_count}건</div></div>`;
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
  toast(id?'일정 수정됨':'일정 등록됨');
}

async function deleteSched(id){
  if(!confirm('점검 일정을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/schedules/${id}`);
  await loadDashScheds();
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
  toast('삭제됨');
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
  renderDashboard(); toast(id?'이슈 수정됨':'이슈 등록됨');
}

async function deleteIssue(id){
  if(!confirm('이슈를 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/issues/${id}`);
  renderDashboard(); toast('삭제됨');
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
  const cats=['일반','월간','분기'];
  el.innerHTML=cats.map(cat=>{
    const its=items.filter(i=>i.category===cat);
    const done=its.filter(i=>i.done).length;
    return `<div class="card">
      <div class="card-title"><span>${cat} 점검</span><span style="font-weight:400;text-transform:none;letter-spacing:0">${done}/${its.length}</span></div>
      ${its.length?`<div class="prog-wrap" style="margin-bottom:10px"><div class="prog-bar" style="width:${its.length?Math.round(done/its.length*100):0}%"></div></div>`:''}
      ${its.map(i=>`
        <div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #f0f0ee">
          <input type="checkbox" ${i.done?'checked':''} onchange="toggleCL('${i.id}',this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:#378ADD">
          <span style="flex:1;${i.done?'text-decoration:line-through;color:#bbb':''}">${i.text}</span>
          <span class="badge b-gray" style="font-size:10px">${i.category}</span>
          <button class="icon-btn edit" title="수정" onclick="openEditCL(${JSON.stringify(i).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
          <button class="icon-btn del"  title="삭제" onclick="deleteCL('${i.id}')">${ICO_DEL}</button>
        </div>`).join('')}
      ${!its.length?'<div class="empty" style="padding:12px">항목 없음</div>':''}
    </div>`;
  }).join('');
}

function openAddCLItem(){
  $('cl-modal-title').textContent='체크리스트 항목 추가';
  $('cl-item-id').value=''; $('cl-text').value=''; $('cl-cat').value='일반';
  openModal('modal-cl-item');
}
function openEditCL(item){
  $('cl-modal-title').textContent='항목 수정';
  $('cl-item-id').value=item.id; $('cl-text').value=item.text; $('cl-cat').value=item.category;
  openModal('modal-cl-item');
}
async function saveCLItem(){
  const text=$('cl-text').value.trim(), siteId=$('cl-site-sel').value;
  if(!text){toast('내용을 입력해주세요');return}
  if(!siteId){toast('사이트를 먼저 선택해주세요');return}
  const id=$('cl-item-id').value;
  if(id) await api.patch(`/api/engineers/${ENG_ID}/site-checklist/${id}`,{text,category:$('cl-cat').value});
  else   await api.post(`/api/engineers/${ENG_ID}/site-checklist`,{site_id:siteId,text,category:$('cl-cat').value});
  closeModal('modal-cl-item');
  renderChecklist(); toast(id?'항목 수정됨':'항목 추가됨');
}
async function toggleCL(id,checked){
  await api.patch(`/api/engineers/${ENG_ID}/site-checklist/${id}`,{done:checked});
  renderChecklist();
}
async function deleteCL(id){
  if(!confirm('항목을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/site-checklist/${id}`);
  renderChecklist(); toast('삭제됨');
}

// ── SITES ─────────────────────────────────
async function renderSites(filter=''){
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  const el=$('site-list');
  const filtered=sites.filter(s=>s.name.includes(filter)||(s.location||'').includes(filter));
  if(!filtered.length){el.innerHTML='<div class="empty">사이트가 없습니다</div>';return}
  el.innerHTML=filtered.map(s=>`
    <div class="site-card" id="site-card-${s.id}" onclick="openSiteDetail('${s.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:15px;font-weight:600;margin-bottom:3px">${s.name}</div>
          <div style="font-size:12px;color:#888">${s.location||'-'} · 담당: ${s.manager||'-'}${s.contact?' · '+s.contact:''}</div>
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          ${s.expiring_count?`<span class="badge b-amber">⚠ 워런티 ${s.expiring_count}건</span>`:''}
          <span class="badge b-blue" id="dev-count-${s.id}">장비 ${s.device_count}대</span>
          <button class="icon-btn del" title="삭제" onclick="event.stopPropagation();deleteSite('${s.id}')">${ICO_DEL}</button>
        </div>
      </div>
    </div>`).join('');
}
$('site-search').addEventListener('input',e=>renderSites(e.target.value));

async function saveSite(){
  const name=$('s-name').value.trim();
  if(!name){toast('사이트명을 입력해주세요');return}
  await api.post(`/api/engineers/${ENG_ID}/sites`,{name,location:$('s-loc').value,manager:$('s-mgr').value,contact:$('s-contact').value,memo:$('s-memo').value});
  closeModal('modal-add-site');
  ['s-name','s-loc','s-mgr','s-contact','s-memo'].forEach(id=>$(id).value='');
  renderSites(); toast('사이트 추가됨');
}
async function deleteSite(id){
  if(!confirm('사이트를 삭제하시겠습니까?\n(장비, 접속정보, 파일 모두 삭제됩니다)'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${id}`);
  renderSites(); toast('삭제됨');
}

async function openSiteDetail(siteId){
  currentSiteId=siteId; revealedPw={};
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  const site=sites.find(s=>s.id===siteId);
  $('detail-site-name').textContent=site?site.name:'';
  document.querySelectorAll('.tab[data-dtab]').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('[id^="dtab-"]').forEach(t=>t.classList.remove('active'));
  document.querySelector('.tab[data-dtab="devices"]').classList.add('active');
  $('dtab-devices').classList.add('active');
  await Promise.all([loadDevices(),loadAccesses(),loadReports(),loadNotes()]);
  openModal('modal-site-detail');
}

// ── Devices ───────────────────────────────
async function loadDevices(){
  const devs=await api.get(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/devices`);
  const el=$('device-table');
  const cntEl=$(`dev-count-${currentSiteId}`);
  if(cntEl) cntEl.textContent=`장비 ${devs.length}대`;
  if(!devs.length){el.innerHTML='<div class="empty">장비가 없습니다</div>';return}
  const wBadge=d=>{
    const dd=d.warranty_days;
    if(dd===null||dd===undefined) return `<span class="badge b-gray">-</span>`;
    if(dd<=0) return `<span class="badge b-red">만료됨</span>`;
    if(dd<=30) return `<span class="badge b-red">D-${dd}</span>`;
    if(dd<=90) return `<span class="badge b-amber">D-${dd}</span>`;
    return `<span class="badge b-green">${d.warranty}</span>`;
  };
  const sCls={'운영중':'b-green','점검중':'b-amber','교체예정':'b-red','철수':'b-gray'};
  el.innerHTML=`<table class="tbl"><thead><tr><th>장비명</th><th>모델</th><th>유형</th><th>OS</th><th>S/N</th><th>워런티</th><th>상태</th><th></th></tr></thead><tbody>
    ${devs.map(d=>`<tr>
      <td style="font-weight:600;min-width:100px">${d.name}</td><td style="min-width:110px">${d.model||'-'}</td><td style="min-width:60px">${d.dev_type}</td>
      <td style="min-width:120px">${d.os||'-'}</td><td class="mono" style="min-width:90px">${d.serial_no||'-'}</td>
      <td style="min-width:80px">${wBadge(d)}</td><td style="min-width:70px"><span class="badge ${sCls[d.status]||'b-gray'}">${d.status}</span></td>
      <td style="display:flex;gap:3px">
        <button class="icon-btn edit" title="수정" onclick="openEditDevice(${JSON.stringify(d).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
        <button class="icon-btn del"  title="삭제" onclick="deleteDevice('${d.id}')">${ICO_DEL}</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}
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
  loadDevices(); toast('장비 추가됨');
}
function openEditDevice(d){
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
  closeModal('modal-edit-device'); loadDevices(); toast('장비 수정됨');
}
async function deleteDevice(id){
  if(!confirm('장비를 삭제하시겠습니까?'))return;
  const r=await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/devices/${id}`);
  const cntEl=$(`dev-count-${currentSiteId}`);
  if(cntEl&&r.site_device_count!==undefined) cntEl.textContent=`장비 ${r.site_device_count}대`;
  loadDevices(); toast('삭제됨');
}

// ── Access ────────────────────────────────
async function loadAccesses(){
  const items=await api.get(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses`);
  const el=$('access-table');
  if(!items.length){el.innerHTML='<div class="empty">접속 정보가 없습니다</div>';return}
  el.innerHTML=`<table class="tbl"><thead><tr><th>구분</th><th>IP</th><th>포트</th><th>프로토콜</th><th>계정</th><th>비밀번호</th><th>메모</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr>
      <td style="font-weight:600;min-width:100px">${a.name}</td><td class="mono" style="min-width:120px">${a.ip||'-'}</td><td style="min-width:50px">${a.port||'-'}</td>
      <td><span class="badge b-blue">${a.protocol}</span></td><td class="mono" style="min-width:80px">${a.username||'-'}</td>
      <td style="min-width:80px"><span class="pw-cell" onclick="togglePw('${a.id}',this,'${a.password}')">${revealedPw[a.id]?a.password:'••••••'}</span></td>
      <td style="font-size:12px;color:#888;min-width:80px">${a.memo||'-'}</td>
      <td><button class="icon-btn del" title="삭제" onclick="deleteAccess('${a.id}')">${ICO_DEL}</button></td>
    </tr>`).join('')}
  </tbody></table>`;
}
function togglePw(id,el,pass){revealedPw[id]=!revealedPw[id];el.textContent=revealedPw[id]?pass:'••••••'}
async function saveAccess(){
  const name=$('a-name').value.trim();
  if(!name){toast('구분명을 입력해주세요');return}
  await api.post(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses`,{
    name,ip:$('a-ip').value,port:$('a-port').value,protocol:$('a-proto').value,
    username:$('a-user').value,password:$('a-pass').value,memo:$('a-memo').value
  });
  closeModal('modal-add-access');
  ['a-name','a-ip','a-port','a-user','a-pass','a-memo'].forEach(id=>$(id).value='');
  loadAccesses(); toast('접속 정보 추가됨');
}
async function deleteAccess(id){
  if(!confirm('접속 정보를 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/accesses/${id}`);
  loadAccesses(); toast('삭제됨');
}

// ── Reports ───────────────────────────────
async function loadReports(){
  const items=await api.get(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports`);
  const el=$('report-table');
  if(!items.length){el.innerHTML='<div class="empty">업로드된 파일 없음</div>';return}
  el.innerHTML=`<table class="tbl"><thead><tr><th>파일명</th><th>업로드일</th><th>크기</th><th></th></tr></thead><tbody>
    ${items.map(r=>`<tr>
      <td>📄 ${r.filename}</td>
      <td style="color:#888;font-size:12px">${r.uploaded_at}</td>
      <td style="color:#888;font-size:12px">${r.size}</td>
      <td style="display:flex;gap:4px">
        <a href="/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports/${r.id}/download" class="btn btn-sm" download>↓ 다운로드</a>
        <button class="icon-btn del" title="삭제" onclick="deleteReport('${r.id}')">${ICO_DEL}</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function uploadReport(event){
  const file=event.target.files[0]; if(!file)return;
  const fd=new FormData(); fd.append('file',file);
  await fetch(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports`,{method:'POST',body:fd});
  event.target.value=''; loadReports(); toast('파일 업로드 완료');
}
async function deleteReport(id){
  if(!confirm('파일을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/reports/${id}`);
  loadReports(); toast('삭제됨');
}

// ── Notes ─────────────────────────────────
async function loadNotes(){
  const items=await api.get(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes`);
  const el=$('notes-list');
  if(!items.length){el.innerHTML='<div class="empty">특이사항 없음</div>';return}
  el.innerHTML=items.map(n=>`
    <div style="display:flex;gap:12px;padding:9px 2px;border-bottom:1px solid #f0f0ee">
      <div style="font-size:11px;color:#aaa;min-width:78px;padding-top:2px">${n.date||''}</div>
      <div style="flex:1"><div style="font-weight:500;margin-bottom:2px">${n.title||'(제목 없음)'}</div><div style="font-size:13px;color:#666">${n.body}</div></div>
      <button class="icon-btn del" title="삭제" onclick="deleteNote('${n.id}')">${ICO_DEL}</button>
    </div>`).join('');
}
async function saveNote(){
  const body=$('n-body').value.trim(); if(!body){toast('내용을 입력해주세요');return}
  await api.post(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes`,{date:$('n-date').value,title:$('n-title').value,body});
  closeModal('modal-add-note');
  ['n-title','n-body'].forEach(id=>$(id).value='');
  loadNotes(); toast('특이사항 추가됨');
}
async function deleteNote(id){
  if(!confirm('특이사항을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/sites/${currentSiteId}/notes/${id}`);
  loadNotes(); toast('삭제됨');
}

// ── LOGS ──────────────────────────────────
async function renderLogs(filter=''){
  const url=filter?`/api/engineers/${ENG_ID}/logs?q=${encodeURIComponent(filter)}`:`/api/engineers/${ENG_ID}/logs`;
  const logs=await api.get(url);
  const el=$('log-list');
  if(!logs.length){el.innerHTML='<div class="empty">작업 이력이 없습니다</div>';return}
  const tc={정기점검:'b-blue',장애처리:'b-red',변경작업:'b-amber','설치/교체':'b-green',기타:'b-gray'};
  el.innerHTML=logs.map(l=>`
    <div class="log-row">
      <div class="log-date">${l.date}</div>
      <div style="flex:1">
        <div style="margin-bottom:3px">${l.site?`<span style="font-size:11px;color:#888">${l.site} · </span>`:''}<span class="badge ${tc[l.log_type]||'b-gray'}">${l.log_type}</span></div>
        <div style="font-weight:500">${l.title}</div>
        ${l.body?`<div style="font-size:12px;color:#888;margin-top:2px">${l.body}</div>`:''}
      </div>
      <div style="display:flex;gap:3px;flex-shrink:0">
        <button class="icon-btn edit" title="수정" onclick="openEditLog(${JSON.stringify(l).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
        <button class="icon-btn del"  title="삭제" onclick="deleteLog('${l.id}')">${ICO_DEL}</button>
      </div>
    </div>`).join('');
}
$('log-search').addEventListener('input',e=>renderLogs(e.target.value));

async function fillLogSiteSel(selectedSite=''){
  const sites=await api.get(`/api/engineers/${ENG_ID}/sites`);
  $('l-site').innerHTML='<option value="">-</option>'+
    sites.map(s=>`<option ${s.name===selectedSite?'selected':''}>${s.name}</option>`).join('');
}

$('btn-add-log').addEventListener('click', async()=>{
  $('log-modal-title').textContent='작업 이력 추가';
  $('l-id').value='';
  ['l-title','l-body'].forEach(id=>$(id).value='');
  $('l-date').value=new Date().toISOString().slice(0,10);
  $('l-type').value='정기점검';
  await fillLogSiteSel();
  openModal('modal-add-log');
});
document.querySelector('.nav-item[data-page="logs"]').addEventListener('click',()=>fillLogSiteSel());

async function openEditLog(l){
  $('log-modal-title').textContent='작업 이력 수정';
  $('l-id').value=l.id;
  $('l-date').value=l.date;
  $('l-type').value=l.log_type;
  $('l-title').value=l.title;
  $('l-body').value=l.body||'';
  await fillLogSiteSel(l.site||'');
  openModal('modal-add-log');
}

async function saveLog(){
  const title=$('l-title').value.trim(); if(!title){toast('제목을 입력해주세요');return}
  const id=$('l-id').value;
  const payload={date:$('l-date').value,site:$('l-site').value,log_type:$('l-type').value,title,body:$('l-body').value};
  if(id) await api.patch(`/api/engineers/${ENG_ID}/logs/${id}`,payload);
  else   await api.post(`/api/engineers/${ENG_ID}/logs`,payload);
  closeModal('modal-add-log');
  ['l-title','l-body'].forEach(id=>$(id).value='');
  renderLogs(); toast(id?'이력 수정됨':'작업 이력 추가됨');
}

async function deleteLog(id){
  if(!confirm('작업 이력을 삭제하시겠습니까?'))return;
  await api.del(`/api/engineers/${ENG_ID}/logs/${id}`);
  renderLogs(); toast('삭제됨');
}

// ── WORK PLANS ──────────────────────────────
let _allWorkPlans = [];
async function renderWorkPlans(filter='') {
  const el = $('wp-list');
  let plans = [];
  try {
    plans = await api.get(`/api/engineers/${ENG_ID}/workplans`);
    _allWorkPlans = plans;
  } catch (e) {
    console.error("Failed to load work plans:", e);
    el.innerHTML = '<div class="empty" style="color:#dc2626; line-height:1.6;">작업 계획을 불러오는 중 오류가 발생했습니다.<br>백엔드 서버가 재시작되었는지 확인해주세요.</div>';
    return;
  }

  const q = filter.toLowerCase().trim();
  const filtered = plans.filter(p => (p.title||'').toLowerCase().includes(q) || (p.site||'').toLowerCase().includes(q));
  if(!filtered.length) { el.innerHTML = '<div class="empty">등록된 작업 계획이 없습니다</div>'; return; }
  
  const stCls = {'계획중':'b-gray', '결재대기':'b-amber', '승인완료':'b-blue', '작업완료':'b-green'};
  el.innerHTML = filtered.map(p => `
    <div style="display:flex; gap:12px; padding:12px 6px; border-bottom:1px solid #f0f0ee;">
      <div style="flex:1;">
        <div style="margin-bottom:4px">
          <span class="badge ${stCls[p.status]||'b-gray'}">${p.status}</span>
          <span style="font-size:12px;color:#888;margin-left:6px">${p.work_date?p.work_date.replace('T', ' '):'-'}</span>
        </div>
        <div style="font-weight:700; font-size:14px; margin-bottom:4px">${p.title}</div>
        <div style="font-size:12px; color:#666;">사이트: <span style="font-weight:600">${p.site||'-'}</span> | 작업자: ${p.worker||'-'} | 결재/공유: ${p.reviewer||'-'}</div>
      </div>
      <div style="display:flex; gap:4px; align-items:flex-start;">
        <button class="btn btn-sm btn-primary" onclick="downloadWorkPlanExcel('${p.id}')">Excel 다운로드</button>
        <button class="icon-btn edit" title="수정" onclick="openEditWorkPlan(${JSON.stringify(p).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
        <button class="icon-btn del" title="삭제" onclick="deleteWorkPlan('${p.id}')">${ICO_DEL}</button>
      </div>
    </div>
  `).join('');
}
if($('wp-search')) $('wp-search').addEventListener('input', e => renderWorkPlans(e.target.value));

async function fillWpSiteSel(selectedSite=''){
  const sites = await api.get(`/api/engineers/${ENG_ID}/sites`);
  $('wp-site').innerHTML = '<option value="">-</option>' + sites.map(s => `<option ${s.name===selectedSite?'selected':''}>${s.name}</option>`).join('');
}

async function openAddWorkPlan() {
  $('wp-modal-title').textContent = '작업 계획 작성';
  $('wp-id').value = '';
  ['wp-title', 'wp-worker', 'wp-reviewer', 'wp-purpose', 'wp-prerequisites', 'wp-mop', 'wp-verification', 'wp-rollback'].forEach(id => $(id).value='');
  $('wp-date').value = '';
  $('wp-status').value = '계획중';
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
  $('wp-modal-title').textContent = '작업 계획 수정';
  $('wp-id').value = p.id;
  $('wp-title').value = p.title;
  $('wp-date').value = p.work_date || '';
  $('wp-worker').value = p.worker || '';
  $('wp-reviewer').value = p.reviewer || '';
  $('wp-status').value = p.status;
  $('wp-purpose').value = p.purpose || '';
  $('wp-impact').value = p.impact || '없음';
  $('wp-prerequisites').value = p.prerequisites || '';
  $('wp-mop').value = p.mop_content || '';
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
  const payload = { 
    title, 
    work_date: $('wp-date').value, 
    site: $('wp-site').value, 
    worker: $('wp-worker').value, 
    reviewer: $('wp-reviewer').value, 
    status: $('wp-status').value,
    purpose: $('wp-purpose').value,
    impact: $('wp-impact').value,
    prerequisites: $('wp-prerequisites').value,
    mop_content: $('wp-mop').value,
    verification: $('wp-verification').value,
    rollback_plan: $('wp-rollback').value
  };
  const id = $('wp-id').value;
  if(id) await api.patch(`/api/engineers/${ENG_ID}/workplans/${id}`, payload);
  else await api.post(`/api/engineers/${ENG_ID}/workplans`, payload);
  closeModal('modal-add-workplan');
  renderWorkPlans(); toast(id ? '계획 수정됨' : '계획 저장됨');
}

async function deleteWorkPlan(id) {
  if(!confirm('해당 작업 계획을 삭제하시겠습니까?')) return;
  await api.del(`/api/engineers/${ENG_ID}/workplans/${id}`);
  renderWorkPlans(); toast('삭제됨');
}

function downloadWorkPlanExcel(id) {
  const p = _allWorkPlans.find(x => x.id === id);
  if(!p) {
    toast('데이터를 찾을 수 없습니다.');
    return;
  }
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
  const mop = $('sched-mop').value;
  
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

// ── 대시보드 점검일정 탭 ──────────────────
let _dashSchedTab = 'month';

function _currentQuarter(){
  return Math.ceil((new Date().getMonth()+1)/3);
}

async function switchDashSchedTab(tab){
  _dashSchedTab = tab;
  document.querySelectorAll('.ds-tab').forEach(t=>t.classList.toggle('active', t.dataset.dstab===tab));
  await loadDashScheds();
}

async function loadDashScheds(){
  const now  = new Date();
  const q    = _currentQuarter();
  const year = now.getFullYear();
  const ym   = now.toISOString().slice(0,7);

  // 탭 레이블 업데이트
  const qLabel = `${q}분기 (${(q-1)*3+1}~${q*3}월)`;
  const qBtn = $('ds-quarter-label');
  if(qBtn) qBtn.textContent = qLabel;
  
  if(!_allWorkPlans.length) { try { _allWorkPlans = await api.get(`/api/engineers/${ENG_ID}/workplans`); } catch(e){} }

  // 유형 필터: 이번달탭=월간유형, 분기탭=분기유형
  const typeFilter = _dashSchedTab === 'month' ? '월간' : '분기';

  // API: 이번달탭→이번달전체, 분기탭→현재분기전체 (유형필터는 프론트)
  let all;
  if(_dashSchedTab === 'month'){
    all = await api.get(`/api/engineers/${ENG_ID}/schedules?month=${ym}`);
  } else {
    all = await api.get(`/api/engineers/${ENG_ID}/schedules?quarter=${q}&year=${year}`);
  }
  // 유형 필터 적용
  const scheds = all.filter(s => s.sched_type === typeFilter);
  const done   = scheds.filter(s=>s.status==='완료').length;
  const total  = scheds.length;
  const pct    = total ? Math.round(done/total*100) : 0;

  // 카운트 뱃지
  const mCnt = $('ds-month-cnt');
  const qCnt = $('ds-quarter-cnt');
  if(_dashSchedTab==='month' && mCnt) mCnt.textContent = total ? `${total}건` : '';
  if(_dashSchedTab==='quarter' && qCnt) qCnt.textContent = total ? `${total}건` : '';

  // 요약 & 프로그레스
  const summaryEl = $('sched-summary');
  if(summaryEl) summaryEl.textContent = `${done}/${total} 완료`;
  const bar = $('ds-prog-bar');
  if(bar){ bar.style.width=pct+'%'; bar.style.background = pct===100?'#16a34a':'#378ADD'; }

  // 목록 렌더
  const stCls = {예정:'b-planned',완료:'b-done'};
  $('dash-schedules').innerHTML = scheds.length ? scheds.map(s=>`
    <div class="sched-item" id="dsi-${s.id}">
      <div class="sched-date-label">
        <div style="font-size:10px;opacity:.7">${s.sched_date.slice(5,7)}월</div>
        <div style="font-size:15px;line-height:1">${s.sched_date.slice(8)}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:${s.status==='완료'?'#aaa':'#1a1a1a'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;${s.status==='완료'?'text-decoration:line-through':''}">${s.site_name}</div>
        <div style="font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.title}</div>
      </div>
      <button class="ds-check-btn ${s.status==='완료'?'checked':''}" onclick="toggleSchedStatus('${s.id}','${s.status}')" title="${s.status==='완료'?'완료 취소':'완료 처리'}">
        ${s.status==='완료'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:.3"><polyline points="20 6 9 17 4 12"/></svg>'}
      </button>
      <div style="display:flex;gap:2px;flex-shrink:0">
        ${_allWorkPlans.some(p => p.id === s.id) ? `<button class="btn btn-sm" style="padding:2px 4px;font-size:10px;color:#16a34a;border-color:#16a34a;margin-right:4px;" title="계획서 엑셀 다운로드" onclick="downloadWorkPlanExcel('${s.id}')">Excel</button>` : ''}
        <button class="icon-btn edit" title="수정" onclick="openEditSched(${JSON.stringify(s).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
        <button class="icon-btn del"  title="삭제" onclick="deleteSched('${s.id}')">${ICO_DEL}</button>
      </div>
    </div>`).join('') : `<div class="empty">${typeFilter} 유형 일정 없음</div>`;
}

async function toggleSchedStatus(id, currentStatus){
  const newStatus = currentStatus==='완료' ? '예정' : '완료';
  await api.patch(`/api/engineers/${ENG_ID}/schedules/${id}`, {status: newStatus});
  await loadDashScheds();
  if($('page-schedule-mgmt').classList.contains('active')) renderSchedMgmt();
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
      ${_allWorkPlans.some(p => p.id === s.id) ? `<button class="btn btn-sm" style="padding:2px 4px;font-size:10px;color:#16a34a;border-color:#16a34a;margin-right:4px;" title="계획서 엑셀 다운로드" onclick="downloadWorkPlanExcel('${s.id}')">Excel</button>` : ''}
      <button class="icon-btn edit" title="수정" onclick="openEditSched(${JSON.stringify(s).replace(/"/g,'&quot;')})">${ICO_EDIT}</button>
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
  if(!_allWorkPlans.length) { try { _allWorkPlans = await api.get(`/api/engineers/${ENG_ID}/workplans`); } catch(e){} }
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
  if($('page-dashboard').classList.contains('active')) loadDashScheds();
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