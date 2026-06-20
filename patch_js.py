import sys

with open('/opt/se-portal/static/js/app.js', 'r') as f:
    code = f.read()

old_edit = """function openEditProject(p) {
  $('proj-modal-title').textContent = '프로젝트 수정';
  $('p-id').value = p.id;
  $('p-name').value = p.name;
  $('p-customer').value = p.customer || '';
  $('p-start').value = p.start_date || '';
  $('p-end').value = p.end_date || '';
  $('p-status').value = p.status;
  $('p-desc').value = p.description || '';
  openModal('modal-add-project');
}

async function saveProject() {
  const name = $('p-name').value.trim();
  if(!name) { toast('프로젝트명을 입력해주세요'); return; }
  const payload = {
    name, customer: $('p-customer').value,
    start_date: $('p-start').value, end_date: $('p-end').value,
    status: $('p-status').value, description: $('p-desc').value
  };
  const id = $('p-id').value;
  if(id) await api.patch(`/api/engineers/${ENG_ID}/projects/${id}`, payload);
  else   await api.post(`/api/engineers/${ENG_ID}/projects`, payload);
  closeModal('modal-add-project');
  renderProjects(); toast(id ? '수정됨' : '등록됨');
}"""

new_edit = """function openAddProject() {
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
}"""

if old_edit in code:
    code = code.replace(old_edit, new_edit)
    with open('/opt/se-portal/static/js/app.js', 'w') as f:
        f.write(code)
    print("PATCH_JS_DONE")
else:
    print("JS_NOT_FOUND")
