import re
import os

with open('/opt/se-portal/templates/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract CSS
style_match = re.search(r'<style>\n(.*?)\n</style>', content, re.DOTALL)
if style_match:
    css_content = style_match.group(1)
    os.makedirs('/opt/se-portal/static/css', exist_ok=True)
    with open('/opt/se-portal/static/css/style.css', 'w', encoding='utf-8') as f:
        f.write(css_content)
    
    # Replace in HTML
    content = content[:style_match.start()] + '<link rel="stylesheet" href="/static/css/style.css">' + content[style_match.end():]

# Extract JS
script_match = re.search(r'<script>\n(.*?)\n</script>', content, re.DOTALL)
if script_match:
    js_content = script_match.group(1)
    os.makedirs('/opt/se-portal/static/js', exist_ok=True)
    with open('/opt/se-portal/static/js/app.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    
    # Replace in HTML
    content = content[:script_match.start()] + '<script src="/static/js/app.js"></script>' + content[script_match.end():]

with open('/opt/se-portal/templates/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Split completed successfully.")
