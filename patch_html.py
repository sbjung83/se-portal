import sys

with open('/opt/se-portal/templates/index.html', 'r') as f:
    code = f.read()

old_html = """    <div class="grid2">
      <div class="form-row"><label>시작일</label><input type="date" id="p-start"></div>
      <div class="form-row"><label>종료일</label><input type="date" id="p-end"></div>
    </div>
    <div class="form-row"><label>상태</label>
      <select id="p-status">
        <option>진행 대기</option>
        <option>진행 중</option>
        <option>보류</option>
        <option>완료</option>
      </select>
    </div>"""

new_html = """    <div class="grid2">
      <div class="form-row"><label>시작일 *</label><input type="date" id="p-start"></div>
      <div class="form-row"><label>종료일</label><input type="date" id="p-end"></div>
    </div>
    <div class="grid2">
      <div class="form-row"><label>일정 템플릿</label>
        <select id="p-template">
          <option value="">— 선택 안함 —</option>
          <option value="storage">기본 스토리지 구축 (5주)</option>
          <option value="server">기본 서버 구축 (5주)</option>
        </select>
      </div>
      <div class="form-row"><label>상태</label>
        <select id="p-status">
          <option>진행 대기</option>
          <option>진행 중</option>
          <option>보류</option>
          <option>완료</option>
        </select>
      </div>
    </div>"""

if old_html in code:
    code = code.replace(old_html, new_html)
    with open('/opt/se-portal/templates/index.html', 'w') as f:
        f.write(code)
    print("PATCH_HTML_DONE")
else:
    print("HTML_NOT_FOUND")

