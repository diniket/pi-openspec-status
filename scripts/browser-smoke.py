from pathlib import Path
from playwright.sync_api import sync_playwright
import functools
import http.server
import threading
repo = Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(repo)))
threading.Thread(target=server.serve_forever, daemon=True).start()
root = repo / 'fixtures/os-partial'
tree={}; contents={}
for p in root.rglob('*'):
 rel=p.relative_to(root).as_posix(); tree[rel]={'type':'directory' if p.is_dir() else 'file','size':p.stat().st_size}
 if p.is_file(): contents[rel]=p.read_text()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844}); errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{server.server_port}/')
 page.evaluate('''async ({tree,contents}) => {
 const {OpenspecPanelElement}=await import('/src/pi-web-plugin.js');
 customElements.define('openspec-status-panel',OpenspecPanelElement);
 const norm=p=>p.replace(/\\/$/,'');
 const files={async listFiles(path){path=norm(path);if(tree[path]?.type!=='directory')throw Error('Not found'); return {entries:Object.entries(tree).filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(([k,v])=>({name:k.slice(path.length+1),...v,modifiedAt:1})),truncated:false};},async readFile(path){if(!(path in contents))throw Error('Not found');return {content:contents[path],binary:false,truncated:false};}};
 const el=document.createElement('openspec-status-panel');document.body.replaceChildren(el);
 el.context={machine:{id:'local'},workspace:{id:'browser'},files};
 }''',{'tree':tree,'contents':contents})
 page.locator('openspec-status-panel').locator('.os-change-toggle').first.click()
 page.get_by_role('tab',name='Tasks').click()
 page.get_by_text('tasks done (7 left, 50%)',exact=False).wait_for()
 page.get_by_role('tab',name='Proposal').click()
 page.locator('openspec-status-panel').locator('article').wait_for()
 page.get_by_role('tab',name='Proposal').focus();page.keyboard.press('End')
 assert page.get_by_role('tab',name='Tasks').get_attribute('aria-selected')=='true'
 page.get_by_role('button',name='Reload OpenSpec data').click()
 page.get_by_text('tasks done (7 left, 50%)',exact=False).wait_for()
 assert page.locator('openspec-status-panel').locator('[role=tabpanel]').get_attribute('aria-busy') is None
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 page.screenshot(path='/tmp/openspec-browser-mobile.png',full_page=True)
 assert not errors, errors
 print('Chromium',browser.version,'PASS: fixture render, documents, tasks 7/14, keyboard End, refresh, aria-busy, 390px overflow, no page errors')
 browser.close()
