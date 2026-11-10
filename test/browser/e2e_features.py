import re,sys,tempfile,os
from playwright.sync_api import sync_playwright
import subprocess,time,atexit
SRV=subprocess.Popen(['node',os.path.join(os.path.dirname(__file__),'serve.js')],stdout=open('/tmp/bd-serve.log','w'),stderr=subprocess.STDOUT); atexit.register(SRV.kill)
for _ in range(40):
    time.sleep(0.25)
    if 'BASE ' in open('/tmp/bd-serve.log').read(): break
BASE=open('/tmp/bd-serve.log').read().split('BASE ')[1].split()[0]
errs=[];ok=[];bad=[]
def check(name,cond,extra=''):
    (ok if cond else bad).append(name); print(('PASS ' if cond else 'FAIL ')+name+(' '+str(extra) if (extra and not cond) else ''))
def login(ctx,email):
    pg=ctx.new_page()
    pg.on('console',lambda m: errs.append((email,m.text)) if m.type=='error' else None)
    pg.on('pageerror',lambda x: errs.append((email,str(x))))
    pg.goto(BASE+'/index.html#login'); pg.fill('#l-id',email); pg.fill('#l-pw','Str0ng!Pass'); pg.click('#login-btn')
    pg.wait_for_selector('.side',timeout=15000); return pg
JPG=b'\xff\xd8\xff\xe0'+b'0'*200+b'\xff\xd9'
SUBMIT="""async(a)=>{const fd=new FormData();fd.append('document_type_id',a.tid);fd.append('purpose','Employment');fd.append('client_token',a.tok);
 fd.append('answers',JSON.stringify({last_name:'Santos',first_name:'Maria',address:'1 Mabini Street',birth_place:'Quezon City',birth_date:'1995-06-12',gender:'Female',nationality:'Filipino',civil_status:'Single',emergency_name:'Pedro',emergency_no:'09170000000'}));
 fd.append('valid_id',new Blob([new Uint8Array([255,216,255,224,0,0,0,0,0,0])],{type:'image/jpeg'}),'id.jpg');return await http('POST','/requests',fd)}"""
LONG="Long notice. "+("Please read this carefully. "*40)+"\n\n"+("ABCDEFGHIJKLMNOPQRSTUVWXYZ"*8)+"\n\nEND-OF-MESSAGE-MARKER"
with sync_playwright() as p:
    b=p.chromium.launch()
    A=login(b.new_context(viewport={'width':1280,'height':900}),'admin@x.ph')
    M=login(b.new_context(viewport={'width':1280,'height':900}),'maria@x.ph')
    P=b.new_context(viewport={'width':1280,'height':900}).new_page()
    PM=b.new_context(viewport={'width':390,'height':800}).new_page()

    # ---------- announcements: 50-char title, long text contained ----------
    A.goto(BASE+'/app.html#/admin/announce'); A.wait_for_selector('text=Create Announcement'); A.click('text=Create Announcement')
    A.fill('#f1','T'*60); check('title input stops at 50 characters', len(A.input_value('#f1'))==50 and A.inner_text('#tc')=='50/50')
    A.fill('#f2',LONG[:2000]); box=A.evaluate("(()=>{const t=document.getElementById('f2'),m=document.querySelector('.mod');return {tw:t.getBoundingClientRect().right<=m.getBoundingClientRect().right,sw:t.scrollWidth<=t.clientWidth+1,h:t.getBoundingClientRect().height}})()")
    check('textbox stays inside the dialog (no overflow)', box['tw'] and box['sw'], box)
    A.screenshot(path='/tmp/bd-ann-modal.png')
    A.click('text=Publish announcement'); A.wait_for_selector('.flash:has-text("published")')
    ov=A.evaluate("(()=>{const a=document.querySelector('.an'),p=a.querySelector('p'),c=a.parentElement;return {pw:p.scrollWidth<=a.clientWidth,doc:document.documentElement.scrollWidth<=window.innerWidth,inside:a.getBoundingClientRect().right<=c.getBoundingClientRect().right+1}})()")
    check('long message stays inside the announcement card', ov['pw'] and ov['doc'] and ov['inside'], ov); A.screenshot(path='/tmp/bd-ann-list.png',full_page=True)
    # server-side limit as well
    r=A.evaluate("async()=>{try{await http('POST','/admin/announcements',{title:'x'.repeat(51),message:'m',status:'draft'});return 200}catch(x){return x.status+':'+x.message}}"); check('server also rejects >50-char title', str(r).startswith('422'), r)

    # ---------- resident bell: collapsed clamp, click to expand, full text, no overlap ----------
    M.evaluate("loadNotifs(1)"); M.wait_for_selector('.nbg'); M.click('.nbtn'); M.wait_for_selector('.ni')
    collapsed=M.evaluate("(()=>{const p=document.querySelector('.ni p.nclamp'),n=document.querySelector('.npn');return {h:p.getBoundingClientRect().height,fits:p.scrollWidth<=p.clientWidth+1,pan:n.scrollWidth<=n.clientWidth+1}})()")
    check('collapsed announcement is a short preview that fits', collapsed['h']<70 and collapsed['fits'] and collapsed['pan'], collapsed)
    check('"Read more" hint shown','Read more' in M.inner_text('.npl') and 'END-OF-MESSAGE-MARKER' not in M.inner_text('.npl'))
    M.screenshot(path='/tmp/bd-bell-collapsed.png')
    M.click('.ni:has(.nclamp)'); M.wait_for_selector('.ni p.nfull strong'); txt=M.inner_text('.npl')
    check('expanded announcement shows the complete message', 'END-OF-MESSAGE-MARKER' in txt and 'Show less' in txt and txt.count('Please read this carefully.')==40)
    ex=M.evaluate("(()=>{const l=document.querySelector('.npl'),p=document.querySelector('.ni p.nfull'),n=document.querySelector('.npn');return {noX:l.scrollWidth<=l.clientWidth+1&&p.scrollWidth<=p.clientWidth+1,pan:n.scrollWidth<=n.clientWidth+1,full:p.getBoundingClientRect().height>150}})()")
    check('expanded text wraps inside the panel (no overlap/side scroll)', ex['noX'] and ex['pan'] and ex['full'], ex); M.screenshot(path='/tmp/bd-bell-expanded.png')
    M.click('.ni:has(.nfull)'); M.wait_for_selector('.ni p.nclamp'); check('click again collapses', M.locator('.ni p.nfull').count()==0)
    M.click('.nbtn')

    # ---------- rejected request: Reason: (resident) / Rejected: reason (admin, public) ----------
    tid=M.evaluate("async()=>(await http('GET','/document-types')).data.find(t=>t.name==='Barangay ID').id")
    req=M.evaluate(SUBMIT,{'tid':tid,'tok':'tok-reject-'+str(abs(hash(BASE)))[:8]}); code=req['trackingNo']; rid=req['id']
    check('Barangay ID needs no second purpose and no preferred date', req['purpose']=='Employment' and 'preferredClaimDate' not in req)
    A.evaluate("async(i)=>{await http('PATCH','/admin/requests/'+i,{action:'info',message:'Please upload a clearer ID.'});await http('PATCH','/admin/requests/'+i,{action:'reject',reason:'ID photo is unreadable.',notes:'INTERNAL-ONLY-NOTE'})}",rid)
    M.goto(BASE+'/app.html#/resident/track/'+code); M.evaluate("loadTrack(1)"); M.wait_for_selector('.wiz .b:has-text("Rejected")'); t=M.inner_text('main')
    check('resident: Remarks box starts with "Reason:"','Reason: ID photo is unreadable.' in t)
    check('resident: history line reads "Rejected: (reason)"','Rejected: ID photo is unreadable.' in t and 'INTERNAL-ONLY-NOTE' not in t)
    check('resident: no response box once rejected', M.locator('.sum textarea').count()==0)
    A.goto(BASE+'/app.html#/admin/review/'+rid); A.wait_for_selector('.tl'); at=A.inner_text('.tl')
    check('admin history: newest first, "Rejected: (reason)" in red', at.index('Rejected: ID photo is unreadable.')<at.index('Additional Information Requested')<at.index('Request Submitted') if 'Request Submitted' in at else at.index('Rejected: ID photo')<at.index('Submitted'))
    colour=A.evaluate("getComputedStyle(document.querySelector('.tl .ev-rejected b')).color"); check('rejection headline is red', colour=='rgb(185, 28, 28)', colour); A.screenshot(path='/tmp/bd-admin-history.png',full_page=True)

    # ---------- public tracking on the landing page ----------
    P.goto(BASE+'/index.html#track'); P.wait_for_selector('#track-form'); P.fill('#code',code.lower()); P.click('#track-btn'); P.wait_for_selector('.tr-card .tr-head')
    pt=P.inner_text('#track-result'); P.screenshot(path='/tmp/bd-public.png',full_page=True)
    check('public: shows the code, status and timeline', code in pt and 'Rejected' in pt and 'Request Submitted' in pt and 'Additional Information Requested' in pt and 'Please upload a clearer ID.' in pt)
    check('public: "Rejected: (reason)"','Rejected: ID photo is unreadable.' in pt)
    for secret in ['Maria','Santos','maria@x.ph','0917','Mabini','Quezon','Barangay ID','Employment','INTERNAL','id.jpg','RES-2026']:
        if secret in pt: check('public page must not show '+secret, False)
    check('public: no personal data on the page', not any(x in pt for x in ['Maria','maria@x.ph','Mabini','Barangay ID','INTERNAL']))
    P.fill('#code','BR-2026-00001-AAAAA'); P.click('#track-btn'); P.wait_for_selector('.tr-msg.err'); check('public: unknown code -> clear message, nothing else','couldn’t find' in P.inner_text('#track-result') and 'Rejected' not in P.inner_text('#track-result'))
    P.fill('#code','BR-2026-00001'); P.click('#track-btn'); P.wait_for_function("document.querySelector('.tr-msg')&&!document.querySelector('.tr-card .tr-head')"); check('public: guessable old-style code is not tracked', True)
    # the completed Clearance request from earlier: shows approved/ready/completed, never the resident's own reply text
    PM.goto(BASE+'/index.html#track'); PM.wait_for_selector('#track-form'); PM.fill('#code',code); PM.click('#track-btn'); PM.wait_for_selector('.tr-card .tr-head')
    fit=PM.evaluate("(()=>{const c=document.querySelector('#track-result .tr-card').getBoundingClientRect(),l=document.querySelector('.tr-list');return {inside:c.left>=0&&c.right<=window.innerWidth,list:l.scrollWidth<=l.clientWidth+1}})()"); check('public tracking result fits a phone screen', fit['inside'] and fit['list'], fit); PM.screenshot(path='/tmp/bd-public-mobile.png',full_page=True)
    b.close()
print(len(ok),'passed',bad)
print('page errors:',[e for e in errs if not any(c in e[1] for c in ('401','403','404','409','422','429'))])
