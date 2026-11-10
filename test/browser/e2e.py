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
with sync_playwright() as p:
    b=p.chromium.launch()
    A=login(b.new_context(viewport={'width':1280,'height':900}),'admin@x.ph')
    M=login(b.new_context(viewport={'width':1280,'height':900}),'maria@x.ph')
    J=login(b.new_context(viewport={'width':390,'height':800}),'juan@x.ph')

    # --- empty states first
    M.wait_for_selector('text=haven’t submitted any requests'); check('resident dashboard has no announcements card','Announcements' not in M.inner_text('main'))
    check('resident dashboard: request empty state','haven’t submitted any requests' in M.inner_text('body'))
    check('resident metrics zero',M.locator('.metric .num').all_inner_texts()==['0']*5,M.locator('.metric .num').all_inner_texts())
    A.wait_for_selector('text=No requests are waiting'); check('admin dashboard: queue empty state',True)

    # --- 1. admin creates & publishes announcement
    A.goto(BASE+'/app.html#/admin/announce'); A.wait_for_selector('text=No announcements yet')
    A.click('text=Create Announcement'); A.click('text=Publish announcement')
    check('announcement validation shows error',A.locator('.er').count()>0 and 'Enter a title' in A.inner_text('.mod'))
    A.fill('#f1','Barangay Clean-Up Drive'); A.fill('#f2','Saturday 6 AM at the plaza.'); A.click('text=Publish announcement')
    A.wait_for_selector('.flash'); check('announcement published flash','Residents were notified' in A.inner_text('.flash'))
    check('announcement listed as Published','Published' in A.inner_text('.an'))
    # --- resident sees it without reload (polling) and gets notification
    M.evaluate("loadNotifs(1)"); M.wait_for_selector('.nbg'); check('bell badge = 1',M.inner_text('.nbg')=='1')
    M.click('.nbtn'); check('bell shows the announcement','Barangay Clean-Up Drive' in M.inner_text('.npl')); M.click('.nbtn')
    # --- draft hidden / unpublish
    A.click('text=Edit Content'); A.select_option('#f3','Draft'); A.click('text=Save changes'); A.wait_for_selector('.flash')
    M.evaluate("loadNotifs(1)"); M.wait_for_function("!document.querySelector('.nbg')"); check('unpublished announcement disappears from the bell',True)
    A.click('text=Edit Content'); A.select_option('#f3','Published'); A.click('text=Save changes'); A.wait_for_selector('.flash')
    M.evaluate("loadNotifs(1)"); M.wait_for_selector('.nbg')
    M.click('.nbtn'); items=M.locator('.ni'); check('only one announcement notification after republish',items.count()==1,items.count())
    # --- notification open -> read
    M.click('.ni'); M.wait_for_timeout(300); M.click('.nbtn') if M.locator('.nbg').count() else None
    check('badge gone after opening notification',M.locator('.nbg').count()==0)
    M.reload(); M.wait_for_selector('.side'); check('read state persists after reload',M.locator('.nbg').count()==0)

    # --- 3. resident submits request (validation first)
    M.goto(BASE+'/app.html#/resident/new'); M.wait_for_selector('.dsel')
    M.click('.dsel'); M.click('.dl >> text=Barangay Clearance'); M.click('text=Continue to form')
    check('prefilled full name from profile',M.input_value('input[value="Maria Santos"]')=='Maria Santos')
    check('no fake prefilled data (address empty)', 'Mabini' not in M.content())
    M.click('button:has-text("Application Details")'); check('step-2 validation blocks',M.locator('.er').count()>3 and M.locator('.wiz .steps').count()==1)
    inputs=M.locator('.fg input.in:not([type=file])'); 
    M.fill('.fg >> nth=0 >> input','Maria Santos')
    M.locator('.fg .in').nth(1).fill('31')
    M.locator('.fg select').nth(0).select_option('Single')
    M.locator('.fg input[type=date]').nth(0).fill('1995-06-12')
    M.locator('.fg .in').nth(4).fill('1 Mabini Street')
    M.locator('.fg select').nth(1).select_option('Female')
    M.locator('.fg .in').nth(6).fill('CTC-1'); M.locator('.fg input[type=date]').nth(1).fill('2026-01-09'); M.locator('.fg .in').nth(8).fill('Quezon City')
    M.click('button:has-text("Application Details")'); check('missing upload blocks step 2','Upload a readable copy' in M.inner_text('.wiz'))
    f=tempfile.mktemp(suffix='.jpg'); open(f,'wb').write(b'\xff\xd8\xff\xe0'+b'0'*200+b'\xff\xd9')
    check('clearance form has two file inputs (Cedula + Valid ID)',M.locator('input[type=file]').count()==2)
    M.locator('input[type=file]').nth(0).set_input_files(f); M.click('button:has-text("Application Details")'); check('valid id still required','Upload a readable copy' in M.inner_text('.wiz'))
    M.locator('input[type=file]').nth(1).set_input_files(f); M.click('button:has-text("Application Details")')
    M.wait_for_selector('text=Shared Application Details')
    M.click('button:has-text("Review application")'); check('step-3 validation (purpose)','Choose a purpose' in M.inner_text('.wiz'))
    M.select_option('.wiz select','Employment'); import datetime
    check('step 3 has no preferred date field', M.locator('.wiz input[type=date]').count()==0 and 'Preferred' not in M.inner_text('.wiz')); M.click('button:has-text("Review application")')
    M.wait_for_selector('text=Review your Application'); check('review shows entered address','1 Mabini Street' in M.inner_text('.wiz'))
    M.click('button:has-text("Submit Request")'); M.wait_for_selector('.trk u'); trk=M.inner_text('.trk u'); check('tracking id generated',re.match(r'^BR-\d{4}-\d{5}-[A-Z2-9]{5}$',trk) is not None,trk)
    check('modal no longer promises SMS','SMS and email' not in M.inner_text('.mod'))
    M.click('text=Return to dashboard'); M.wait_for_selector('.metric')
    M.wait_for_selector('tbody td.t, table td.t'); check('request on resident dashboard',trk in M.inner_text('table'))
    check('resident pending count = 1',M.locator('.metric .num').first.inner_text()=='1')
    M.wait_for_selector('.nbg'); check('submitted notification',M.inner_text('.nbg')=='1')
    # --- appears in admin dashboard with correct info
    A.goto(BASE+'/app.html#/admin'); A.wait_for_selector('table td.t'); txt=A.inner_text('table')
    check('admin dashboard queue shows request',trk in txt and 'Maria Santos' in txt and 'Barangay Clearance' in txt and 'Pending Review' in txt)
    nums=A.locator('.metric .num').all_inner_texts(); check('admin counters match db',nums==['1','1','0','0'],nums)
    # --- other resident sees nothing, cannot open it
    J.wait_for_selector('text=haven’t submitted'); check('other resident sees no request','haven’t submitted' in J.inner_text('body'))
    J.goto(BASE+'/app.html#/resident/track/'+trk); J.wait_for_selector('.stub'); check('other resident cannot open tracking',trk not in J.inner_text('main') or 'not found' in J.inner_text('main').lower(), J.inner_text('main')[:200])
    J.evaluate("loadNotifs(1)"); J.wait_for_timeout(600); J.goto(BASE+'/app.html#/resident'); J.wait_for_selector('.nbtn'); J.click('.nbtn'); J.wait_for_selector('.ni'); check('other resident has no request notification', trk not in J.inner_text('.npl') and J.locator('.ni').count()==1, J.inner_text('.npl')[:200])
    # --- admin review & status flow
    A.click('table tr:has(td.t) >> nth=0'); A.wait_for_selector('text=Application Form')
    body=A.inner_text('main'); check('review: full details present','1 Mabini Street' in body and 'CTC-1' in body and 'Employment' in body)
    check('review: both uploaded files listed',A.locator('a:text("View")').count()==2 and 'Valid ID' in A.inner_text('main'))
    check('review: no placeholder data','24 Mabini' not in body and 'valid-id.pdf' not in body and 'maria.santos@example.com' not in body)
    A.click('text=Continue to Approve'); check('approve blocked until checklist ticked','Tick every item' in A.inner_text('main') and A.locator('.ov').count()==0)
    A.click('text=Start Processing'); A.wait_for_selector('.flash'); check('status -> Processing','Processing' in A.inner_text('.pc >> nth=0'))
    for c in A.locator('input[type=checkbox]').all(): c.check()
    A.click('text=Request Additional Information'); A.click('.mod >> text=Send request'); check('info modal validation','required' in A.inner_text('.mod'))
    A.fill('#f1','Please bring a valid ID.'); A.click('.mod >> text=Send request'); A.wait_for_selector('.flash:has-text("Request sent")')
    M.goto(BASE+'/app.html#/resident/track/'+trk); M.wait_for_selector('text=Additional information requested')
    check('resident sees textbox + image upload for the request', M.locator('.sum textarea').count()==1 and M.locator('.sum input[type=file]').count()==1 and 'Please bring a valid ID.' in M.inner_text('.sum'))
    M.click('button:has-text("Send information")'); check('empty response is rejected','Enter the requested information' in M.inner_text('.sum'))
    M.fill('.sum textarea','Here is my valid ID photo.'); M.set_input_files('.sum input[type=file]',f); M.wait_for_selector('.sum img'); check('image preview shown',True)
    M.click('button:has-text("Send information")'); M.wait_for_selector('text=Information sent'); check('response sent, box replaced by confirmation', M.locator('.sum textarea').count()==0)
    check('timeline shows the resident reply','Additional Information Provided' in M.inner_text('main') and 'Here is my valid ID photo.' in M.inner_text('main'))
    A.evaluate("loadRev(1)"); A.wait_for_selector('.tl'); check('admin sees the reply in history and the image in requirements','Additional Information Provided' in A.inner_text('.tl') and 'Additional information (image)' in A.inner_text('main') and A.locator('a:text("View")').count()==3)
    A.click('text=Continue to Approve'); A.click('.mod >> text=Approve request'); A.wait_for_selector('.flash:has-text("Ready for Claim")')
    check('status -> Ready for Claim','Ready for Claim' in A.inner_text('.pc >> nth=0'))
    check('no stale actions after approve',A.locator('text=Start Processing').count()==0 and A.locator('text=Mark as Claimed').count()==1)
    # resident sees updated status + notifications without logging out
    M.evaluate("loadNotifs(1)"); M.wait_for_timeout(500)
    M.goto(BASE+'/app.html#/resident/track/'+trk); M.evaluate("loadTrack(1)"); M.wait_for_selector('.wiz .b:has-text("Ready for Claim")'); gt=M.inner_text('main')
    check('resident track: status + timeline','Ready for Claim' in gt and 'Under Processing' in gt and 'Additional Information Requested' in gt and 'Please bring a valid ID' in gt)
    check('resident track: no admin notes/placeholder/preferred date','Pasay' not in gt and 'internal' not in gt.lower() and 'Preferred' not in gt)
    M.click('.nbtn'); n=M.locator('.ni'); check('resident has 4 request notifications + announcement', n.count()==5, n.count())
    check('unread badge counts 4',M.inner_text('.nbg')=='4',M.inner_text('.nbg'))
    M.click('.ni >> nth=0'); M.wait_for_timeout(400); M.click('.nbtn'); 
    check('badge decrements to 3 after opening one',M.inner_text('.nbg')=='3',M.inner_text('.nbg') if M.locator('.nbg').count() else 'none')
    M.click('text=Mark all as read') if M.locator('text=Mark all as read').count() else None
    M.wait_for_timeout(300); check('mark all read clears badge',M.locator('.nbg').count()==0)
    A.click('text=Mark as Claimed'); A.wait_for_selector('.flash:has-text("Completed")')
    check('status -> Completed, no further actions',A.locator('text=No further status changes').count()==1)
    # --- history, search, filter, pagination
    M.goto(BASE+'/app.html#/resident/history'); M.wait_for_selector('table td.t')
    check('history row w/ Completed',trk in M.inner_text('table') and 'Completed' in M.inner_text('table'))
    M.fill('#q','BR-9999'); M.wait_for_selector('text=No requests match'); check('history search no match',True)
    M.fill('#q',trk[-5:]); M.wait_for_selector('table td.t'); check('history search by tracking',trk in M.inner_text('table'))
    M.fill('#q',''); M.wait_for_selector('table td.t')
    M.select_option('select >> nth=1','rejected'); M.wait_for_selector('text=No requests match'); check('history status filter',True)
    # admin all requests filters
    A.goto(BASE+'/app.html#/admin/requests'); A.wait_for_selector('table td.t')
    A.select_option('select >> nth=1','completed'); A.wait_for_selector('table td.t'); check('admin status filter',trk in A.inner_text('table'))
    A.select_option('select >> nth=1','pending'); A.wait_for_selector('text=No requests match'); check('admin filter empty',True)
    A.select_option('select >> nth=1',''); A.fill('#q','maria'); A.wait_for_selector('table td.t'); check('admin search by name',trk in A.inner_text('table'))
    A.click('table tr:has(td.t) >> nth=0'); A.wait_for_selector('text=Application Form'); check('row click opens review',True)
    # reports & types
    A.goto(BASE+'/app.html#/admin/reports'); A.wait_for_selector('.rl'); rp=A.inner_text('main'); check('reports from db','Barangay Clearance' in rp and 'Maria Santos requested' in rp and 'Business' not in rp)
    A.goto(BASE+'/app.html#/admin/types'); A.wait_for_selector('table td.d'); check('types from db',A.locator('table td.d').count()==6)
    check('no "Add New Type" button', A.locator('text=Add New Type').count()==0)
    A.click('text=Edit Settings >> nth=0'); A.fill('#f2','Updated description'); A.click('text=Save changes'); A.wait_for_selector('.flash:has-text("updated")'); check('type can still be edited','Updated description' in A.inner_text('table'))
    A.locator('text=Delete').nth(5).click(); A.click('.mod >> text=Delete type'); A.wait_for_selector('.flash:has-text("deleted")'); check('type can still be deleted',A.locator('table td.d').count()==5)
    # profile modal: no redundant Close / Log out buttons
    M.click('.av'); M.wait_for_selector('.pfm'); check('profile modal has no Close/Log out buttons', M.locator('.pfm button:has-text("Log out")').count()==0 and M.locator('.pfm .acts').count()==0)
    M.click('.pfx'); check('profile X closes it', M.locator('.pfm').count()==0)
    # indigency: representative ID only required when a representative is named
    M.goto(BASE+'/app.html#/resident/new'); M.wait_for_selector('.dsel'); M.click('.dsel'); M.click('.dl >> text=Certificate of Indigency'); M.click('text=Continue to form')
    check('indigency has recipient + representative ID inputs', M.locator('input[type=file]').count()==2 and 'Valid ID of the Representative' in M.inner_text('.wiz'))
    M.locator('.fg input.in:not([type=file])').nth(1).fill('31'); M.locator('.fg select').nth(0).select_option('Single'); M.locator('.fg input.in:not([type=file])').nth(2).fill('1 Mabini'); M.locator('.fg select').nth(1).select_option('Medical')
    M.locator('input[type=file]').nth(0).set_input_files(f); M.locator('.fg input.in:not([type=file])').nth(3).fill('Pedro Santos'); M.click('button:has-text("Application Details")')
    check('representative named -> representative ID required', 'Upload a readable copy' in M.inner_text('.wiz'))
    M.locator('.fg input.in:not([type=file])').nth(3).fill(''); M.click('button:has-text("Application Details")'); M.wait_for_selector('text=Shared Application Details'); check('no representative -> not required',True)
    check('Indigency already asked the reason: shared step has no purpose select', M.locator('.wiz select').count()==0 and 'Purpose of Request' not in M.inner_text('.wiz'))
    # admin deletes the announcement -> resident bell loses it
    A.goto(BASE+'/app.html#/admin/announce'); A.wait_for_selector('.an'); M.goto(BASE+'/app.html#/resident'); M.evaluate("loadNotifs(1)"); M.wait_for_timeout(400)
    M.click('.nbtn'); before=M.locator('.ni:has-text("Clean-Up Drive")').count(); M.click('.nbtn')
    A.click('text=Delete'); A.click('.mod button:has-text("Delete announcement")'); A.wait_for_selector('.flash:has-text("deleted")')
    M.evaluate("loadNotifs(1)"); M.wait_for_timeout(500); M.click('.nbtn'); check('deleted announcement removed from bell', before==1 and M.locator('.ni:has-text("Clean-Up Drive")').count()==0, before); M.click('.nbtn')
    # logout/login persistence
    M.click('.out'); M.click('.mod button:has-text("Log out")'); M.wait_for_selector('#landing',timeout=15000)
    M2=login(b.new_context(),'maria@x.ph'); M2.goto(BASE+'/app.html#/resident'); M2.wait_for_selector('table td.t')
    check('after re-login: request + notifications persist',trk in M2.inner_text('table') and M2.locator('.nbg').count()==1 and M2.inner_text('.nbg')=='1', M2.locator('.nbg').count())
    # mobile
    J.goto(BASE+'/app.html#/resident/new'); J.wait_for_selector('.dsel'); w=J.evaluate("document.documentElement.scrollWidth"); check('mobile: no horizontal overflow',w<=392,w)
    # unauthorised
    M.goto(BASE+'/app.html#/admin/requests'); 
    # server error state
    b.close()
print('\nconsole/page errors:',[e for e in errs if '401' not in e[1] and '404' not in e[1] and '403' not in e[1]])
print(len(ok),'passed',len(bad),'failed',bad)
