/* BarangayDocs portal (resident + admin dashboards). Requires js/config.js and js/auth.js. */
const SES=(Auth.current()||{}).user||{name:'',role:'resident'};
const initials=n=>(String(n).trim().split(/\s+/).filter(Boolean).map(w=>w[0]).slice(0,2).join('')||'?').toUpperCase();
const firstName=n=>String(n).trim().split(/\s+/)[0]||'there';
const P={
home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
award:'<circle cx="12" cy="8" r="6"/><path d="m15.5 13.5 1.5 8-5-3-5 3 1.5-8"/>',
out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
dash:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
set:'<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
mega:'<path d="m3 11 18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
bar:'<path d="M12 20V10M18 20V4M6 20v-4"/>',
cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
pkg:'<path d="M16.5 9.4 7.5 4.2M21 8v8l-9 5-9-5V8l9-5zM3.3 7 12 12l8.7-5M12 22V12"/>',
chk:'<path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16"/>',
ck2:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
x:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
user:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>'};
const I=(k,c='')=>`<svg class="i ${c}" viewBox="0 0 24 24">${P[k]}</svg>`;
const shell=(role,active,nav,body)=>`<div class="app"><aside class="side">
<div class="logo"><i>${I('award').replace('class="i "','class="i " style="width:20px;height:20px;color:#fff"')}</i><div><b class="h">Barangay<span>Docs</span></b><small>Civic Portal</small></div></div>
<nav>${nav.map(([k,l,ic])=>`<a href="#/${role}${k?'/'+k:''}" class="${k===active?'on':''}">${I(ic)}${l}${k==='residents'&&pendingCount()?`<span class="nbd">${pendingCount()}</span>`:''}</a>`).join('')}</nav>
<div class="acct"><div class="prof" role="button" tabindex="0" title="View my profile" onclick="openProf()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProf()}"><div class="av">${e(initials(SES.name))}</div><div>${e(SES.name)}<small>${SES.role==='admin'?'Barangay Admin':'Resident'}</small></div></div>
<div class="out" onclick="LO=1;render()">${I('out')}Log out</div></div></aside><main>${body}</main></div>`;
const isRes=()=>!location.hash.startsWith('#/admin');
const hdr=(t,s)=>`<div class="top"><div><h1 class="h">${t}</h1><p>${s}</p></div><div class="tr">${hallBadge()}${isRes()?nbell():''}</div></div>`;
const stub=(t)=>`<div class="stub"><b class="h">${t}</b>We couldn’t find this page. Use the menu to get back on track.</div>`;


/* ===================== NOTIFICATIONS (backend-ready) =====================
 Flip CFG.USE_MOCK to false and point API_BASE at your server. Expected endpoints:
   GET   /notifications?status=all&limit=20  -> { data:[Notification], unread_count:Number, next_cursor:String|null }
   PATCH /notifications/:id/read             -> Notification (with read_at set)
   POST  /notifications/read-all             -> { updated:Number }
 Notification = { id, type, title, message, tracking_no|null, created_at(ISO 8601), read_at(ISO|null) }
 type is one of: ready | approved | processing | submitted | rejected | announcement | account
 Auth: cookie session (credentials:'include') or Bearer token via authHeader().
 The server must scope results to the logged-in resident. Polling can be swapped for SSE/WebSocket in initNotif(). */
const CFG={API_BASE:BD_CONFIG.API_BASE,USE_MOCK:BD_CONFIG.USE_MOCK,POLL_MS:BD_CONFIG.POLL_MS};
const authHeader=()=>Auth.authHeader();
async function http(method,path,body){
 if(CFG.USE_MOCK)return mockApi(method,path);
 const form=typeof FormData!=='undefined'&&body instanceof FormData;
 let res;try{res=await fetch(CFG.API_BASE+path,{method,credentials:'include',headers:{...(body&&!form?{'Content-Type':'application/json'}:{}),...authHeader()},body:body?(form?body:JSON.stringify(body)):undefined})}catch(x){throw new Error('Network error')}
 if(res.status===401)Auth.expire();   // session ended on the server
 if(!res.ok){let j={};try{j=await res.json()}catch(x){}throw Object.assign(new Error(j.message||'HTTP '+res.status),{status:res.status,code:j.code,fields:j.fields})}
 return res.status===204?null:res.json();
}
const NotifAPI={
 list:()=>http('GET','/notifications?status=all&limit=20'),
 markRead:id=>http('PATCH','/notifications/'+encodeURIComponent(id)+'/read'),
 markAllRead:()=>http('POST','/notifications/read-all')
};
/* ---- MOCK SERVER: delete this block once the real API exists ---- */
const MOCK_NOTIFS=[
 {id:'ntf_1006',type:'ready',title:'Document Ready for Claim',message:'Your Certificate of Residency (BR-2026-00120) is ready for pickup. Please proceed to the Barangay Hall Express Counter.',tracking_no:'BR-2026-00120',created_at:'2026-01-13T14:30:00+08:00',read_at:null},
 {id:'ntf_1005',type:'approved',title:'Request Approved',message:'Your Barangay Clearance request (BR-2026-00125) has been approved by the administrators and is now queued for printing.',tracking_no:'BR-2026-00125',created_at:'2026-01-13T11:15:00+08:00',read_at:null},
 {id:'ntf_1004',type:'announcement',title:'New Announcement',message:'Barangay Docs Maintenance Schedule: The system will undergo brief server updates on January 15, 2026, from 2:00 AM to 4:00 AM.',tracking_no:null,created_at:'2026-01-12T09:00:00+08:00',read_at:null},
 {id:'ntf_1003',type:'processing',title:'Request being reviewed',message:'Your Business Permit request (BR-2026-00112) is now being reviewed by barangay staff.',tracking_no:'BR-2026-00112',created_at:'2026-01-10T16:20:00+08:00',read_at:'2026-01-10T17:00:00+08:00'},
 {id:'ntf_1002',type:'submitted',title:'Request Submitted Successfully',message:'The application for Certificate of Indigency (BR-2026-00115) was successfully uploaded and submitted for review.',tracking_no:'BR-2026-00115',created_at:'2026-01-10T14:00:00+08:00',read_at:'2026-01-10T14:05:00+08:00'},
 {id:'ntf_1001',type:'account',title:'Account Created Successfully',message:'Welcome to BarangayDocs! Your civic portal account has been verified. You may now start requesting digital clearance forms.',tracking_no:null,created_at:'2026-01-01T09:15:00+08:00',read_at:'2026-01-01T09:20:00+08:00'}];
async function mockApi(m,p){
 await new Promise(r=>setTimeout(r,250));
 const unread=MOCK_NOTIFS.filter(n=>!n.read_at).length,now=new Date().toISOString();let x;
 if(m==='GET'&&p.startsWith('/notifications'))return{data:MOCK_NOTIFS.map(n=>({...n})),unread_count:unread,next_cursor:null};
 if(m==='PATCH'&&(x=p.match(/^\/notifications\/([^/]+)\/read$/))){const n=MOCK_NOTIFS.find(n=>n.id===decodeURIComponent(x[1]));if(!n)throw Object.assign(new Error('Not found'),{status:404});n.read_at=n.read_at||now;return{...n}}
 if(m==='POST'&&p==='/notifications/read-all'){MOCK_NOTIFS.forEach(n=>n.read_at=n.read_at||now);return{updated:unread}}
 throw Object.assign(new Error('Not found'),{status:404});
}
/* ---- state + actions ---- */
const NS={open:0,tab:'All',items:[],unread:0,loading:1,error:'',seen:null,fresh:0,exp:null,full:{}};
const NT={ready:['pkg','#dbeafe','#2563eb'],approved:['ck2','#d1fae5','#059669'],processing:['cog','#fef3c7','#d97706'],submitted:['file','var(--chip)','var(--mute)'],rejected:['x','#fee2e2','#dc2626'],announcement:['mega','#e0f2fe','#0284c7'],account:['award','#ccfbf1','#0f766e']};
function ago(iso){const d=new Date(iso),s=(Date.now()-d)/1000;if(s<60)return'Just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' hr ago';if(s<604800)return Math.floor(s/86400)+'d ago';return d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}
const ntTitle=n=>n.title==='Request Under Processing'?'Request being reviewed':n.title;
const ntMsg=n=>n.title==='Request Under Processing'?String(n.message).replace(/has been (successfully )?verified and is (now|currently) being processed\./,'is now being reviewed by barangay staff.'):n.message;
function nbell(){
 const u=NS.unread,l=NS.items.filter(n=>NS.tab==='All'||!n.read_at),
 body=NS.loading&&!NS.items.length?'<div class="nst">Loading notifications…</div>':NS.error&&!NS.items.length?`<div class="nst">${NS.error}<br><button class="nlink" onclick="loadNotifs()">Try again</button></div>`:
 l.map(n=>{const t=NT[n.type]||NT.account,ann=n.type==='announcement',ex=ann&&NS.exp===n.id,F=NS.full[n.announcement_id],
  txt=ex?(F&&F!=='load'&&F!=='err'?`<p class="nfull"><strong>${e(F.title)}</strong>\n${e(F.message)}</p>`:F==='load'?'<p>Loading the full announcement…</p>':`<p class="nfull">${e(n.message)}</p>`):`<p class="${ann?'nclamp':''}">${e(ntMsg(n))}</p>`;
  return `<button class="ni ${n.read_at?'':'un'}" aria-expanded="${ann?(ex?'true':'false'):''}" onclick="readNotif('${e(n.id)}')"><span class="nic" style="background:${t[1]};color:${t[2]}">${I(t[0])}</span><span><b>${e(ntTitle(n))}</b>${txt}${ann&&(ex||n.message.length>90)?`<small class="nmore">${ex?'Show less':'Read more'}</small>`:''}<small>${ago(n.created_at)}</small></span>${n.read_at?'':'<i class="dot"></i>'}</button>`}).join('')||`<div class="nst">${NS.tab==='Unread'?'You’re all caught up.':'No notifications yet.'}</div>`;
 return `<div class="nwrap" id="nwrap"><button class="nbtn ${u?'has':''} ${NS.open?'on':''}" onclick="toggleNotif()" aria-haspopup="dialog" aria-expanded="${NS.open?'true':'false'}" aria-label="Notifications${u?', '+u+' unread':''}">${I('bell')}${u?`<span class="nbg">${u>9?'9+':u}</span>`:''}</button>${NS.open?`<div class="npn" role="dialog" aria-label="Notifications"><div class="nph"><h3 class="h">Notifications</h3><button class="nlink" onclick="markAllNotif()" ${u?'':'disabled'}>Mark all as read</button></div><div class="npt">${['All','Unread'].map(x=>`<a class="${x===NS.tab?'on':''}" onclick="NS.tab='${x}';paintNotif()">${x}${x==='Unread'&&u?' ('+u+')':''}</a>`).join('')}</div><div class="npl">${body}</div></div>`:''}</div>`;
}
function paintNotif(){const w=document.getElementById('nwrap');if(!w)return;const s=(w.querySelector('.npl')||{}).scrollTop||0;w.outerHTML=nbell();const l=document.querySelector('.npl');if(l)l.scrollTop=s}
async function loadNotifs(silent){
 if(!silent){NS.loading=1;NS.error='';paintNotif()}
 try{const r=await NotifAPI.list();NS.fresh=NS.seen?r.data.some(n=>!n.read_at&&!NS.seen.has(n.id)):0;NS.items=r.data;NS.unread=r.unread_count;NS.seen=new Set(r.data.map(n=>n.id));NS.error=''}
 catch(err){NS.error='Couldn’t load notifications.'}
 NS.loading=0;paintNotif();
}
function toggleNotif(){NS.open=!NS.open;NS.tab='All';paintNotif();const b=document.querySelector('.nbtn');b&&b.focus();if(NS.open)loadNotifs(1)}
async function readNotif(id){
 const n=NS.items.find(x=>x.id===id);if(!n)return;
 if(!n.read_at){n.read_at=new Date().toISOString();NS.unread=Math.max(0,NS.unread-1);paintNotif();
  try{await NotifAPI.markRead(id)}catch(err){if(err.status===404){loadNotifs(1);return}n.read_at=null;NS.unread++;paintNotif()}}   // 404 = the admin just removed it
 if(n.tracking_no){NS.open=0;paintNotif();const to='#/resident/track/'+encodeURIComponent(n.tracking_no);if(location.hash===to)enter();else location.hash=to}   // same page: the URL doesn't change, so reload the request ourselves
 else if(n.type==='announcement'){   // click to read the complete announcement; click again to collapse
  const open=NS.exp!==id,aid=n.announcement_id;NS.exp=open?id:null;if(!open&&aid)delete NS.full[aid];paintNotif();
  if(open&&aid){NS.full[aid]='load';paintNotif();try{NS.full[aid]=await http('GET','/announcements/'+encodeURIComponent(aid))}catch(x){NS.full[aid]='err'}paintNotif()}}
}
async function markAllNotif(){
 const snap=NS.items.map(n=>n.read_at),was=NS.unread,now=new Date().toISOString();
 NS.items.forEach(n=>n.read_at=n.read_at||now);NS.unread=0;paintNotif();
 try{await NotifAPI.markAllRead()}catch(err){NS.items.forEach((n,i)=>n.read_at=snap[i]);NS.unread=was;paintNotif()}
}
function initNotif(){
 loadNotifs();
 setInterval(()=>{if(!document.hidden&&isRes())loadNotifs(1)},CFG.POLL_MS); // swap for SSE/WebSocket if the backend supports push
}
/* ===================== END NOTIFICATIONS ===================== */
/* ===================== REQUESTS, ANNOUNCEMENTS, DOCUMENT TYPES, REPORTS (live data) =====================
 Everything below talks to the real API (see server/routes/requests.js, adminRequests.js, announcements.js).
 Resident:  GET /document-types · POST /requests (multipart) · GET /requests · GET /requests/:trackingNo
 Admin:     GET /admin/dashboard · GET|PATCH /admin/requests[/:id] · GET|POST|PATCH|DELETE /admin/document-types · /admin/announcements · GET /admin/reports */
const e=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RN=[['','Dashboard','home'],['new','New Request','plus'],['history','Request History','file']];
const AN=[['','Dashboard','dash'],['requests','All Requests','folder'],['residents','Residents','user'],['types','Manage Types','set'],['announce','Announcements','mega'],['reports','Reports','bar']];
const STL={pending:'Pending Review',processing:'Processing',ready:'Ready for Claim',completed:'Completed',rejected:'Rejected'};
const SB={pending:'s-pend',processing:'s-proc',ready:'s-ready',completed:'s-done',rejected:'s-rej'};
const AB={pending:'a-y',processing:'a-b',ready:'a-t',completed:'a-g',rejected:'a-r'};
const bd=s=>`<span class="b ${SB[s]||'s-pend'}">${e(STL[s]||s)}</span>`;
const ab=s=>`<span class="b ${AB[s]||'a-y'}">${e(STL[s]||s)}</span>`;
const STO=[['','All Statuses'],...Object.entries(STL)];
const RGO=[['','All time'],['today','Today'],['week','Last 7 days'],['month','Last 30 days']];
const chv='<svg class="i" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
let aq='',MD=null,LO=0,FL='',QT=0;
const fmt=d=>d?new Date(String(d).slice(0,10)+'T00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—';
const sd=i=>i?new Date(i).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}):'—';
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const qs=o=>Object.entries(o).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
function rangeQ(r){if(!r)return'';const d=new Date();d.setHours(0,0,0,0);if(r==='week')d.setDate(d.getDate()-6);if(r==='month')d.setDate(d.getDate()-29);return'&from='+encodeURIComponent(d.toISOString())}
const emsg=(x,d)=>x&&x.status&&x.status<500&&x.message&&!/^HTTP /.test(x.message)?x.message:(x&&!x.status?'Can’t reach the server. Check your connection and try again.':d);
const rk=()=>{const p=location.hash.split('/');return(p[1]||'')+'/'+(p[2]||'')};
const quiet=()=>{const t=document.activeElement&&document.activeElement.tagName;return!MD&&!PF.open&&!LO&&t!=='INPUT'&&t!=='TEXTAREA'&&t!=='SELECT'};
let FT=0;const setFl=m=>{FL=m;clearTimeout(FT);FT=setTimeout(()=>{FL='';if(quiet())render()},8000)};   // success banner: stays until it times out or you leave the page
const flash=()=>FL?`<div class="flash" role="status">${e(FL)}</div>`:'';
const sel=(opts,val,fn)=>`<select class="sel" onchange="${fn}">${opts.map(o=>{const[v,l]=Array.isArray(o)?o:[o,o];return`<option value="${e(v)}" ${v===val?'selected':''}>${e(l)}</option>`}).join('')}</select>`;
/* one loader for every data view: tracks loading/error, never leaves stale errors, and only repaints when it's safe */
async function load(st,key,fn,silent){
 try{await fn();st.err=''}catch(x){if(!silent||!st.loaded)st.err=emsg(x,'Couldn’t load this page. Please try again.')}
 st.loaded=1;if(rk()===key&&(!silent||quiet()))render();
}
const empty=(cols,S,none,retry)=>!S.loaded?`<tr><td colspan="${cols}" class="sub">Loading…</td></tr>`:S.err&&!S.items.length?`<tr><td colspan="${cols}"><span class="er">${e(S.err)}</span> <a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="${retry}()">Try again</a></td></tr>`:`<tr><td colspan="${cols}" class="sub">${e(none)}</td></tr>`;
const pager=(S,k)=>{const a=S.total?(S.page-1)*S.limit+1:0,b=Math.min(S.total,S.page*S.limit),ps=[];
 for(let i=1;i<=S.pages;i++)if(i===1||i===S.pages||Math.abs(i-S.page)<=1)ps.push(i);
 let h='',p=0;ps.forEach(i=>{if(i-p>1)h+='…';h+=`<a class="${i===S.page?'on':''}" onclick="pgTo('${k}',${i})">${i}</a>`;p=i});
 return`<div class="ft"><span>Showing <b>${a}-${b}</b> of <b>${S.total}</b> results</span><div class="pg"><a style="${S.page<=1?'opacity:.4;pointer-events:none':''}" onclick="pgTo('${k}',${S.page-1})">Previous</a>${h}<a style="${S.page>=S.pages?'opacity:.4;pointer-events:none':''}" onclick="pgTo('${k}',${S.page+1})">Next</a></div></div>`};

/* ---- state ---- */
const RV={loaded:0,err:'',items:[],counts:{},status:'',limit:5,page:1,pages:1,total:0};
const RH={loaded:0,err:'',items:[],total:0,pages:1,page:1,limit:10,type:'',status:'',range:'',types:[]};
const TR={loaded:0,err:'',data:null};
const DTS={loaded:0,err:'',items:[],purposes:[],guide:[]};
const AD={loaded:0,err:'',items:[],stats:null,type:'',range:'',types:[],limit:10,page:1,pages:1,total:0};
const AQ={loaded:0,err:'',items:[],total:0,pages:1,page:1,limit:10,type:'',status:'',range:'',types:[]};
const RVW={loaded:0,err:'',id:'',data:null,notes:'',chk:[0,0,0,0],busy:0,msg:''};
const ATY={loaded:0,err:'',items:[]};
const AAN={loaded:0,err:'',items:[]};
const ARP={loaded:0,err:'',data:null,items:[]};
const V={RV,RH,AD,AQ};
/* Barangay Hall open/closed (admins flip it; residents see it) */
const HS={open:true,loaded:0,busy:0,err:''};
const hallQ=()=>http('GET','/hall-status').then(r=>{if(r&&typeof r.open==='boolean'){const ch=!HS.loaded||HS.open!==r.open;HS.open=r.open;HS.loaded=1;return ch}return false},()=>false);   // never blocks or fails the page it rides on
async function setHall(open){
 if(HS.busy)return;HS.busy=1;HS.err='';render();
 try{const r=await http('PATCH','/admin/hall-status',{open});HS.open=r.open;HS.loaded=1}
 catch(x){HS.err=emsg(x,'Couldn’t update the Hall status. Please try again.')}
 HS.busy=0;render();
}
const hallCard=()=>`<div class="hall ${HS.open?'o':'c'}"><div class="ht"><b class="h">Barangay Hall is ${HS.open?'Open':'Closed'}</b><span>${HS.open?'Residents are told the hall is open for walk-in service and pickups.':'Residents are told the hall is closed. Online requests can still be submitted.'}</span>${HS.err?`<span class="er">${e(HS.err)}</span>`:''}</div><button class="swt ${HS.open?'on':''}" role="switch" aria-checked="${HS.open}" aria-label="Barangay Hall is open" ${HS.busy||!HS.loaded?'disabled':''} onclick="setHall(${!HS.open})"><i></i></button></div>`;
const hallBadge=()=>HS.loaded?`<div class="open ${HS.open?'':'closed'}" role="status"><span class="dot"></span>Barangay Hall is ${HS.open?'Open':'Closed'} Today</div>`:'';
const SRV={'resident/history':'RH','admin/':'AD','admin/requests':'AQ'};   // routes whose search box is applied by the server
let PRO=null;

/* ---- loaders ---- */
async function loadRDash(silent){
 await load(RV,'resident/',async()=>{const hp=hallQ(),r=await http('GET','/requests?'+qs({limit:5,status:RV.status}));RV.items=r.data;RV.counts=r.counts;await hp},silent);
}
async function loadHist(silent){
 await load(RH,'resident/history',async()=>{
  const r=await http('GET','/requests?'+qs({page:RH.page,limit:RH.limit,q:aq,type:RH.type,status:RH.status})+rangeQ(RH.range));
  if(RH.page>r.pages){RH.page=r.pages;return loadHist(silent)}
  Object.assign(RH,{items:r.data,total:r.total,pages:r.pages,types:r.types})},silent);
}
async function loadTrack(silent){
 const ref=decodeURIComponent(location.hash.split('/')[3]||'');if(!ref){location.replace('#/resident/history');return}
 await load(TR,'resident/track',async()=>{TR.data=await http('GET','/requests/'+encodeURIComponent(ref))},silent);
}
async function loadTypes(silent){
 if(!PRO)Auth.profile().then(p=>{PRO=p}).catch(()=>{});
 await load(DTS,'resident/new',async()=>{const r=await http('GET','/document-types');DTS.items=r.data;DTS.purposes=r.purposes;DTS.guide=r.guide;
  if(NR.t!=null&&!DTS.items.some(t=>t.id===NR.t)){NR.t=null;NR.step=1}},silent);
}
async function loadADash(silent){
 await load(AD,'admin/',async()=>{
  const[,s,r]=await Promise.all([hallQ(),http('GET','/admin/dashboard?today='+encodeURIComponent(new Date(new Date().setHours(0,0,0,0)).toISOString())),
   http('GET','/admin/requests?'+qs({active:1,limit:AD.limit,page:1,q:aq,type:AD.type,sort:'oldest'})+rangeQ(AD.range))]);
  AD.stats=s;AD.items=r.data;AD.total=r.total;AD.types=r.types},silent);
}
async function loadAReqs(silent){
 await load(AQ,'admin/requests',async()=>{
  const r=await http('GET','/admin/requests?'+qs({page:AQ.page,limit:AQ.limit,q:aq,type:AQ.type,status:AQ.status})+rangeQ(AQ.range));
  if(AQ.page>r.pages){AQ.page=r.pages;return loadAReqs(silent)}
  Object.assign(AQ,{items:r.data,total:r.total,pages:r.pages,types:r.types})},silent);
}
async function loadRev(silent){
 const id=location.hash.split('/')[3]||'';
 if(RVW.id!==id){Object.assign(RVW,{id,data:null,notes:'',chk:[0,0,0,0],loaded:0,err:'',msg:''})}
 await load(RVW,'admin/review',async()=>{const d=await http('GET','/admin/requests/'+encodeURIComponent(id));if(!RVW.data)RVW.notes=d.adminNotes||'';RVW.data=d},silent);
}
const loadATypes=s=>load(ATY,'admin/types',async()=>{ATY.items=(await http('GET','/admin/document-types')).data},s);
const loadAAnn=s=>load(AAN,'admin/announce',async()=>{AAN.items=(await http('GET','/admin/announcements')).data},s);
const loadARep=s=>load(ARP,'admin/reports',async()=>{ARP.data=await http('GET','/admin/reports')},s);
const LDR={RV:loadRDash,RH:loadHist,AD:loadADash,AQ:loadAReqs};
const LD={'resident/':loadRDash,'resident/new':loadTypes,'resident/history':loadHist,'resident/track':loadTrack,'admin/':loadADash,'admin/requests':loadAReqs,'admin/review':loadRev,'admin/types':loadATypes,'admin/announce':loadAAnn,'admin/reports':loadARep,'admin/residents':()=>loadRes(),'admin/resident':()=>loadRes()};
const STS={'resident/':[RV],'resident/new':[DTS],'resident/history':[RH],'resident/track':[TR],'admin/':[AD],'admin/requests':[AQ],'admin/review':[RVW],'admin/types':[ATY],'admin/announce':[AAN],'admin/reports':[ARP]};
function enter(){   // called on every route change: show a loading state, then fetch fresh data
 const k=rk();(STS[k]||[]).forEach(s=>{s.loaded=0;s.err='';if(Array.isArray(s.items))s.items=[];if('data' in s)s.data=null});   // never show a previous visit's data as if it were current
 if(k==='resident/new')NR.err='';if(k==='resident/track')triReset();
 render();hallQ().then(ch=>{if(ch&&quiet())render()});const f=LD[k];if(f)f();
}
const pgTo=(k,n)=>{const S=V[k];if(n<1||n>S.pages||n===S.page)return;S.page=n;LDR[k]()};
const setF=(k,p,v)=>{V[k][p]=v;V[k].page=1;LDR[k]()};
const refresh=()=>{if(document.hidden||!quiet())return;hallQ().then(ch=>{if(ch&&quiet())render()});const f=LD[rk()];if(f&&!/new|residents?$/.test(rk()))f(1)};   // keeps both dashboards in sync without a manual reload

/* ---- resident dashboard ---- */
function residentDash(){
 const M=[['Pending Review','pending','file','var(--chip)'],['In Processing','processing','cog','#fef3c7'],['Ready for Claim','ready','pkg','#dbeafe'],['Completed','completed','chk','#d1fae5'],['Rejected','rejected','x','#fee2e2']];
 const rows=RV.items.map(r=>`<tr><td class="t">${e(r.trackingNo)}</td><td class="d">${e(r.documentType)}</td><td>${sd(r.submittedAt)}</td><td>${bd(r.status)}</td><td class="act"><a onclick="location.hash='#/resident/track/${encodeURIComponent(r.trackingNo)}'">Track</a></td></tr>`).join('');
 return hdr('Magandang araw, '+e(firstName(SES.name))+'!','Keep updated on your active document requests or file a new application below.')+
 `<div class="metrics m5">${M.map(m=>`<div class="metric"><div class="mh">${m[0]}<div class="ib" style="background:${m[3]}">${I(m[2])}</div></div><div class="num h">${RV.loaded&&!RV.err?(RV.counts[m[1]]||0):'–'}</div></div>`).join('')}</div>
 <div class="banner"><div><h3 class="h">Need a new official document?</h3><p>Submit request details online in just three steps and avoid long lines at the Barangay Hall.</p></div><button class="btn" onclick="location.hash='#/resident/new'">${I('plus')}Apply for Document</button></div>
 <div class="card"><div class="ch"><h2 class="h">Recent Applications</h2>${sel(STO.map(o=>o[0]?o:['','All Document Statuses']),RV.status,"setF('RV','status',this.value)")}</div>
 <div class="tw"><table><tr><th>Tracking Number</th><th>Document Type</th><th>Date Submitted</th><th>Status</th><th>Actions</th></tr>${rows||empty(5,RV,RV.status?'No requests match this filter.':'You haven’t submitted any requests yet. Choose “Apply for Document” to start.','loadRDash')}</table></div>
 ${RV.items.length?`<div class="ft"><span></span><div class="pg"><a onclick="location.hash='#/resident/history'">View all requests</a></div></div>`:''}</div>`;
}

/* ---- request history ---- */
function histPg(){
 const rows=RH.items.map(r=>`<tr><td class="t">${e(r.trackingNo)}</td><td class="d">${e(r.documentType)}</td><td>${sd(r.submittedAt)}</td><td>${bd(r.status)}</td><td>${r.claimDate&&(r.status==='ready'||r.status==='completed')?fmt(r.claimDate):r.status==='rejected'?'Not Approved':'--'}</td><td class="act"><a onclick="location.hash='#/resident/track/${encodeURIComponent(r.trackingNo)}'">View Details</a></td></tr>`).join('');
 return hdr('Document Request History','View and track all your submitted document requests.')+`<div class="tool">${srch('Search by tracking number...')}<div>${sel([['','All Types'],...RH.types],RH.type,"setF('RH','type',this.value)")}${sel(STO,RH.status,"setF('RH','status',this.value)")}${sel(RGO.map(o=>o[0]?o:['','Select date range']),RH.range,"setF('RH','range',this.value)")}</div></div>
 <div class="card"><div class="tw"><table><tr><th>Tracking Number</th><th>Document Type</th><th>Date Submitted</th><th>Status</th><th>Claim Date</th><th>Actions</th></tr>${rows||empty(6,RH,aq||RH.type||RH.status||RH.range?'No requests match your search.':'You haven’t submitted any requests yet.','loadHist')}</table></div>${RH.loaded&&!RH.err?pager(RH,'RH'):''}</div>`;
}

/* One line per history entry; a rejection always reads "Rejected: (reason)". */
const hdl=h=>h.label;
const hnote=h=>h.event==='rejected'?(h.note?'Reason: '+h.note:''):h.note;
const TRI={msg:'',file:null,url:'',err:'',fe:{},busy:0,ok:''};
const triReset=()=>{if(TRI.url)URL.revokeObjectURL(TRI.url);Object.assign(TRI,{msg:'',file:null,url:'',err:'',fe:{},busy:0,ok:''})};
function pickInfoImg(inp){const f=inp.files&&inp.files[0];if(TRI.url)URL.revokeObjectURL(TRI.url);TRI.file=null;TRI.url='';delete TRI.fe.image;
 if(f){if(f.size>5*1024*1024)TRI.fe.image='Image is larger than 5 MB.';else if(!/\.(jpe?g|png)$/i.test(f.name))TRI.fe.image='Use a JPG or PNG image.';else{TRI.file=f;TRI.url=URL.createObjectURL(f)}}render()}
async function sendInfo(){
 const d=TR.data;if(TRI.busy||!d)return;TRI.err='';TRI.fe={};
 if(!TRI.msg.trim()&&!TRI.file){TRI.fe.message='Enter the requested information or attach an image.';TRI.err='Please correct the highlighted fields.';return render()}
 TRI.busy=1;render();const fd=new FormData();fd.append('message',TRI.msg);if(TRI.file)fd.append('image',TRI.file,TRI.file.name);
 try{TR.data=await http('POST','/requests/'+encodeURIComponent(d.trackingNo)+'/respond',fd);const ok='Thank you. Your information was sent to barangay staff.';triReset();TRI.ok=ok}
 catch(x){TRI.err=emsg(x,'We couldn’t send your information. Please try again.');if(x.fields)TRI.fe=x.fields;if(x.status===409)loadTrack(1)}
 TRI.busy=0;render();
}
/* ---- track one request ---- */
function trackPg(){
 const h=hdr('Track Request','Inspect the progress of your document request.'),d=TR.data;
 if(!TR.loaded)return h+'<div class="stub">Loading request…</div>';
 if(TR.err||!d)return h+`<div class="stub"><b class="h">${e(TR.err||'Request not found.')}</b><a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="location.hash='#/resident/history'">Back to Request History</a></div>`;
 const T=d.history.map(x=>[hdl(x),dtm(x.at),1,hnote(x)]);
 if(d.status==='pending'||d.status==='processing')T.push(['Ready to Claim','Waiting for staff',0]);
 if(d.status!=='completed'&&d.status!=='rejected')T.push(['Completed',d.status==='ready'?'Pending pickup':'—',0]);
 const note={pending:'Your request is waiting for review by barangay staff.',processing:'Your request is being processed.',ready:'Your document is ready. Please bring one valid government-issued ID to the Express desk window to claim.',completed:'This document has been claimed. Thank you.',rejected:'Your request was not approved.'}[d.status];
 return h+`<div><a class="bk" onclick="location.hash='#/resident/history'">← Back to Request History</a></div><div class="lay"><div class="wiz"><h2 class="h">${e(d.trackingNo)}</h2><span>${bd(d.status)}</span><h3 class="h" style="font-size:16px">Live Timeline Track</h3><div class="trkl">${T.map(x=>`<div class="nt tkr"><i class="dot" style="background:${x[2]?'var(--teal)':'var(--line)'}"></i><div style="min-width:0;overflow-wrap:anywhere"><b>${e(x[0])}</b><small>${e(x[1])}</small>${x[3]?`<p>${e(x[3])}</p>`:''}</div></div>`).join('')}</div>${infoBox(d)}</div>
 <aside class="guide"><div><b>Document Requested</b><p>${e(d.documentType)}</p></div><div><b>Purpose</b><p>${e(d.purpose)}</p></div><div><b>Date Submitted</b><p>${dtm(d.submittedAt)}</p></div>${d.claimDate&&d.status!=='rejected'?`<div><b>Claim Date</b><p>${fmt(d.claimDate)}</p></div>`:''}<div><b>Remarks / Status Note</b><p>${e(d.status==='rejected'&&d.residentNote?'Reason: '+d.residentNote:(d.residentNote||note))}</p></div></aside></div>`;
}

function infoBox(d){
 if(TRI.ok&&!d.infoRequested)return`<div class="sum" role="status"><b>Information sent</b><br>${e(TRI.ok)}</div>`;
 if(!d.infoRequested)return'';
 const er=k=>TRI.fe[k]?`<p class="er" style="font-size:12px;margin-top:6px">${e(TRI.fe[k])}</p>`:'';
 return`<div class="sum" style="display:flex;flex-direction:column;gap:12px"><div><b>Additional information requested</b><p style="margin-top:4px;overflow-wrap:anywhere;white-space:pre-line">${e(d.residentNote)}</p></div>
 <div><label class="lb">Your response</label><textarea class="in" maxlength="500" style="${TRI.fe.message?'border-color:#dc2626':''}" placeholder="Type the information requested by the barangay staff…" oninput="TRI.msg=this.value">${e(TRI.msg)}</textarea>${er('message')}</div>
 <div><label class="lb">Supporting image (optional)</label><label class="in" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;${TRI.fe.image?'border-color:#dc2626':''}"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${TRI.file?e(TRI.file.name)+' · '+Math.max(1,Math.round(TRI.file.size/1024))+' KB':'<span style="color:var(--faint)">No image chosen</span>'}</span><b class="bt" style="padding:4px 14px;font-size:13px">Browse</b><input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" style="display:none" onchange="pickInfoImg(this)"></label><p class="sub" style="font-size:12px;margin-top:6px">JPG or PNG, maximum 5 MB.</p>${er('image')}${TRI.url?`<img src="${e(TRI.url)}" alt="Selected image preview" style="margin-top:10px;max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--line)">`:''}</div>
 ${TRI.err?`<p class="er" role="alert">${e(TRI.err)}</p>`:''}<div><button class="btn p" ${TRI.busy?'disabled':''} onclick="sendInfo()">${TRI.busy?'Sending…':'Send information'}</button></div></div>`}
/* ---- new request wizard (forms come from the server so they always match what is validated) ---- */
const rnd=()=>(window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g,'');
const NR={step:1,t:null,F:{},D:{p:'',c:''},files:{},fpe:{},open:0,err:'',fe:{},busy:0,done:null,token:rnd()};
const rst=()=>Object.assign(NR,{step:1,t:null,F:{},D:{p:'',c:''},files:{},fpe:{},open:0,err:'',fe:{},busy:0,done:null,token:rnd()});
const curT=()=>DTS.items.find(t=>t.id===NR.t)||null;
const pFld=t=>t&&t.fields.find(f=>f.isPurpose)||null;   // a form that already asks for the purpose / reason: don't ask again in the shared step
const ageOf=d=>{if(!d)return'';const b=new Date(d+'T00:00'),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a>0&&a<121?String(a):''};
function pick(id){const t=DTS.items.find(x=>x.id===id);if(!t)return;NR.t=id;NR.open=0;NR.err='';NR.fe={};NR.files={};NR.fpe={};NR.F={};
 t.fields.forEach(f=>{if(f.type!=='file')NR.F[f.key]=''});render()}   // every field starts empty: the resident fills in their own details
function pickFile(inp,k){const f=inp.files&&inp.files[0];delete NR.fe[k];delete NR.fpe[k];delete NR.files[k];   // fpe = problems with the chosen file itself
 if(f){if(f.size>5*1024*1024)NR.fpe[k]='File is larger than 5 MB.';else if(!/\.(jpe?g|png|pdf)$/i.test(f.name))NR.fpe[k]='Use a JPG, PNG or PDF file.';else NR.files[k]=f}render()}
const fileNeeded=(f,F)=>f.required!==false&&(!f.requiredIf||String(F[f.requiredIf]||'').trim());   // e.g. the representative's ID is only needed when a representative is named
function check2(t){const fe={};t.fields.forEach(f=>{if(f.type==='file'){if(NR.fpe[f.key])fe[f.key]=NR.fpe[f.key];else if(!NR.files[f.key]&&fileNeeded(f,NR.F))fe[f.key]='Upload a readable copy.';return}
 if(f.requiredIf&&!String(NR.F[f.requiredIf]||'').trim())return;   // e.g. the representative's age only matters once a representative is named
 const v=String(NR.F[f.key]||'').trim();if(!v){if(f.required)fe[f.key]=f.label+' is required.';return}
 if(f.type==='number'&&(!/^\d{1,3}$/.test(v)||+v<(f.min==null?0:f.min)||+v>(f.max||999)))fe[f.key]=f.minMsg&&/^\d{1,3}$/.test(v)&&+v<f.min?f.minMsg:'Enter a valid number.';
 else if(f.type==='date'&&(isNaN(new Date(v))||(f.max==='today'&&v>todayStr())))fe[f.key]=f.max==='today'?'Date cannot be in the future.':'Enter a valid date.';
 else if(f.pattern&&!new RegExp(f.pattern).test(v.replace(/\s/g,'')))fe[f.key]=f.patternMsg||'Invalid value.'});return fe}
/* A field's red border and message disappear the moment it is fixed (no re-render, so typing is not interrupted). */
function fixF(el,k){NR.F[k]=el.value;if(NR.fe[k]){delete NR.fe[k];el.style.borderColor='';const er=el.parentNode.querySelector('.er');if(er)er.remove()}}
/* What must be complete before leaving step s (the same rules the server enforces when the request is submitted). */
function stepErr(s,t){
 if(s===1)return t?{}:{_:'Please select a document type.'};
 if(s===2)return check2(t);
 if(s===3){const fe={};if(!pFld(t)&&!NR.D.p)fe.purpose='Choose a purpose of request.';return fe}
 return{}}
function go(n){NR.err='';const t=curT();
 if(n>NR.step){   // never skip ahead: every step in between must be complete first
  for(let s=NR.step;s<n;s++){const fe=stepErr(s,t);if(!Object.keys(fe).length)continue;
   NR.step=s;NR.fe=fe;
   const names=Object.keys(fe).filter(k=>k!=='_').map(k=>k==='purpose'?'Purpose of Request':((t.fields.find(f=>f.key===k)||{}).label||k));
   NR.err=fe._||('Please complete: '+names.join(', ')+'.');
   render();setTimeout(()=>{const el=document.querySelector('.in[style*="dc2626"]')||document.querySelector('.er');if(el){el.scrollIntoView({block:'center',behavior:'smooth'});try{el.focus({preventScroll:true})}catch(x){}}},40);return}}
 NR.fe={};NR.step=n;render()}
async function submit(){
 const t=curT();if(NR.busy||!t)return;NR.err='';NR.busy=1;render();
 const fd=new FormData();fd.append('document_type_id',t.id);if(!pFld(t))fd.append('purpose',NR.D.p);fd.append('comments',NR.D.c);fd.append('client_token',NR.token);fd.append('answers',JSON.stringify(NR.F));t.fields.forEach(f=>{if(f.type==='file'&&NR.files[f.key])fd.append(f.key,NR.files[f.key],NR.files[f.key].name)});
 try{const r=await http('POST','/requests',fd);NR.done={id:r.trackingNo,t:t.name,p:pFld(t)?NR.F[pFld(t).key]:NR.D.p,c:NR.D.c};loadNotifs(1);RV.loaded=0;RH.loaded=0}
 catch(x){NR.err=emsg(x,'We couldn’t submit your request. Please try again.');if(x.fields){NR.fe=x.fields;const ks=t.fields.map(f=>f.key);if(Object.keys(x.fields).some(k=>ks.includes(k)))NR.step=2;else if(x.fields.purpose)NR.step=3;else NR.step=1}}
 NR.busy=0;render();
}
function newReq(){
 const n=NR.step,t=curT(),nm=t?(NR.F.full_name||[NR.F.first_name,NR.F.last_name].filter(Boolean).join(' ')||SES.name):'';
 if(!DTS.loaded)return hdr('Apply for Document','File official civic document requests securely. Standard turnaround is 1-2 business days.')+'<div class="stub">Loading document types…</div>';
 if(DTS.err)return hdr('Apply for Document','')+`<div class="stub"><b class="h">${e(DTS.err)}</b><a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="loadTypes()">Try again</a></div>`;
 if(!DTS.items.length)return hdr('Apply for Document','')+'<div class="stub"><b class="h">No documents are available right now</b>The Barangay Hall has not opened any document types for request. Please check back later.</div>';
 const er=k=>NR.fe[k]?`<p class="er" style="font-size:12px;margin-top:6px">${e(NR.fe[k])}</p>`:'',bad=k=>NR.fe[k]?' style="border-color:#dc2626"':'';
 const inp=f=>{const k=f.key,v=NR.F[k]==null?'':NR.F[k],lb=`<label class="lb">${e(f.label)}${f.required===false&&!f.requiredIf?' (optional)':''}</label>`;let c;
  if(f.type==='file'){const fl=NR.files[k],opt=!fileNeeded(f,NR.F);c=`<label class="in" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;${NR.fe[k]||NR.fpe[k]?'border-color:#dc2626':''}"><span>${fl?e(fl.name)+' · '+Math.max(1,Math.round(fl.size/1024))+' KB':'<span style="color:var(--faint)">No file chosen</span>'}</span><b class="bt" style="padding:4px 14px;font-size:13px">Browse</b><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" style="display:none" onchange="pickFile(this,'${e(k)}')"></label>`}
  else if(f.type==='select')c=`<select class="in"${bad(k)} onchange="fixF(this,'${e(k)}')"><option value="">Select…</option>${f.options.map(x=>`<option ${x===v?'selected':''}>${e(x)}</option>`).join('')}</select>`;
  else c=`<input class="in"${bad(k)} type="${f.type==='number'?'number':f.type==='date'?'date':'text'}" ${f.type==='date'&&f.max==='today'?`max="${todayStr()}"`:''} ${f.type==='number'?`min="${f.min==null?0:f.min}" max="${f.max||999}"`:''} maxlength="${f.max&&f.type==='text'?f.max:200}" value="${e(v)}" ${f.placeholder?`placeholder="${e(f.placeholder)}"`:''} oninput="fixF(this,'${e(k)}')">`;
  return`<div class="${f.wide?'w':''}">${lb}${c}${f.help?`<p class="sub" style="font-size:12px;margin-top:6px">${e(f.help)}</p>`:''}${er(k)}</div>`};
 const bn=x=>x?`<div class="sum"><b>${e(x[0])}</b><br>${e(x[1])}</div>`:'';
 let g=DTS.guide.slice(),b='',cr='';
 if(t)t.guide.forEach(x=>g.unshift(x));
 if(n===1)b=`<h2 class="h">Request Details</h2><p class="sub">Choose the official document you need. Each document has its own application form.</p><div><label class="lb">Select Document Type</label><div class="dsel" onclick="NR.open=!NR.open;render()">${t?e(t.name):'<span style="color:var(--faint)">Select Document Type</span>'}${chv}</div>${NR.open?`<div class="dl">${DTS.items.map(d=>`<div onclick="pick('${e(d.id)}')"><b>${e(d.name)}</b><small>${e(d.description)}</small></div>`).join('')}</div>`:''}</div><p class="sub" style="font-size:12px">Your document-specific information will be collected before the common application details.</p>
 <div class="acts"><button class="bt" onclick="rst();location.hash='#/resident'">Cancel</button><button class="btn p" onclick="go(2)">Continue</button></div>`;
 if(n===2){cr=`Document Application · 2 / 4 · ${e(t.name)} → Application Details → Review → Submit → Confirmation`;b=`<h2 class="h">${e(t.name)}</h2><p class="sub">${t.fields.length?'Complete the document-specific information below. Fields marked optional can be left blank.':'No document-specific information is needed for this document. Continue to the application details.'}</p>${bn(t.banner)}<div class="fg">${t.fields.map(inp).join('')}</div>
 <div class="acts"><button class="bt" onclick="go(1)">Back to selection</button><button class="btn p" onclick="go(3)">Application Details</button></div>`}
 if(n===3){cr=`Document Application · 3 / 4 · ${e(t.name)} → Application Details → Review`;g.unshift(['Shared Application Details','This step applies to every document type. Your selected document, document-specific fields and uploaded file stay attached when you continue or go back.']);
  b=`<h2 class="h">Application Details</h2><div class="sum"><b>Selected document: ${e(t.name)}</b><br>${e(nm)} · All information from your dedicated form is preserved.</div>
 ${pFld(t)?'':`<div><label class="lb">Purpose of Request</label><select class="in"${bad('purpose')} onchange="NR.D.p=this.value"><option value="">Select…</option>${DTS.purposes.map(x=>`<option ${x===NR.D.p?'selected':''}>${e(x)}</option>`).join('')}</select>${er('purpose')}</div>`}
 <div><label class="lb">Additional Comments (optional)</label><textarea class="in" maxlength="500" oninput="NR.D.c=this.value">${e(NR.D.c)}</textarea></div>
 <div class="acts"><button class="bt" onclick="go(2)">Back</button><button class="btn p" onclick="go(4)">Review</button></div>`}
 if(n===4){cr=`Document Application · 4 / 4 · ${e(t.name)} · Review → Submit → Confirmation`;g.unshift(['Before You Submit','Review your information carefully. Use Edit to correct either your form or application details. Submission sends this request to barangay staff for review.']);
  const rows=t.fields.map(f=>f.type==='file'?`<span>${e(f.label)}</span><b>${NR.files[f.key]?e(NR.files[f.key].name):'—'}</b>`:`<span>${e(f.label)}</span><b>${e(NR.F[f.key]||'—')}</b>`).join('');
  b=`<h2 class="h">Review your Application</h2><p class="sub">${e(t.name)} · ${e(nm)}</p>
 ${t.fields.length?`<div class="sum"><div style="display:flex;justify-content:space-between"><b>Document-specific Form</b><a style="color:var(--sky);font-weight:600;cursor:pointer" onclick="go(2)">Edit</a></div><div class="rv" style="margin-top:12px">${rows}</div></div>`:''}
 <div class="sum"><div style="display:flex;justify-content:space-between"><b>Application details</b><a style="color:var(--sky);font-weight:600;cursor:pointer" onclick="go(3)">Edit</a></div><div class="rv" style="margin-top:12px">${pFld(t)?'':`<span>Purpose of Request</span><b>${e(NR.D.p)}</b>`}<span>Additional Comments</span><b>${e(NR.D.c||'—')}</b></div></div>
 <p class="sub" style="font-size:12px">By submitting, I confirm that the information provided is true and accurate.</p>
 <div class="acts"><button class="bt" onclick="go(3)" ${NR.busy?'disabled':''}>Back</button><button class="btn p" onclick="submit()" ${NR.busy?'disabled':''}>${NR.busy?'Submitting…':'Submit Request'}</button></div>`}
 const stp=`<div class="steps">${['Select','Form','Details','Review'].map((l,i)=>`<div class="${i<n?'on':''}"><s></s>${i+1}. ${l}</div>`).join('')}</div>`;
 if(NR.done){cr=`Document Application · Complete · ${e(NR.done.t)} → Confirmation`;g=DTS.guide;b=`<h2 class="h">Request Details</h2><div class="rv"><span>Selected Document Type</span><b>${e(NR.done.t)}</b><span>Purpose of Request</span><b>${e(NR.done.p)}</b><span>Additional Comments</span><b>${e(NR.done.c||'—')}</b></div>`}
 return hdr('Apply for Document','File official civic document requests securely. Standard turnaround is 1-2 business days.')+(cr?`<div class="crumb">${cr}</div>`:'')+`<div class="lay"><div class="wiz">${NR.done?'':stp}${b}${NR.err?`<p class="er" role="alert">${e(NR.err)}</p>`:''}</div><aside class="guide"><h3 class="h">Requirements Guide</h3>${g.map(x=>`<div><b>${e(x[0])}</b><p>${e(x[1])}</p></div>`).join('')}</aside></div>`}
const modal=()=>`<div class="ov"><div class="mod"><div class="ck"><svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div><h2 class="h">Your request is now in review</h2><p>Barangay staff will verify your details within one business day. We’ll notify you here whenever your status changes.</p><div class="trk"><div>TRACKING ID<u>${e(NR.done.id)}</u></div><span>Document Type · ${e(NR.done.t)}</span><span>Save this ID. Your next step is to wait for verification; no visit to Barangay Hall is needed yet.</span><span>Visit only after receiving a Ready for Claim notification, and bring your valid ID.</span></div><div class="acts"><button class="bt" onclick="rst();location.hash='#/resident'">Return to dashboard</button><button class="btn p" onclick="const i=NR.done.id;rst();location.hash='#/resident/track/'+encodeURIComponent(i)">Track request</button></div></div></div>`;
const lo=()=>`<div class="ov"><div class="mod"><h2 class="h" style="font-size:22px">Log out of BarangayDocs?</h2><p>You’ll need to sign in again to view requests and notifications.</p><div class="acts"><button class="bt" onclick="LO=0;render()">Stay signed in</button><button class="btn p" onclick="Auth.logout()">Log out</button></div></div></div>`;

/* ---- admin: shared pieces ---- */
const ahdr=(t,s,x)=>`<div class="top"><div><h1 class="h">${t}</h1><p>${s}</p></div>${x||hallBadge()}</div>`;
const srch=ph=>`<input class="search" id="q" placeholder="${ph}" value="${e(aq)}" autocomplete="off">`;
const hit=v=>!aq||v.toLowerCase().includes(aq.toLowerCase());
const retry=(S,fn)=>S.err?`<div class="stub"><b class="h">${e(S.err)}</b><a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="${fn}()">Try again</a></div>`:'';
const rowsA=(S,cols,none,fn,withAct)=>S.items.map(r=>`<tr style="cursor:pointer" onclick="location.hash='#/admin/review/${e(r.id)}'"><td class="t">${e(r.trackingNo)}</td><td class="n">${e(r.residentName)}</td><td class="d">${e(r.documentType)}</td><td>${dtm(r.submittedAt)}</td><td>${ab(r.status)}</td>${withAct?'<td class="act"><a>Review</a></td>':''}</tr>`).join('')||empty(cols,S,none,fn);

function adminDash(){
 const s=AD.stats||{},ok=AD.loaded&&!AD.err&&AD.stats,df=(s.receivedToday||0)-(s.receivedYesterday||0);
 const M=[['Total Received Today',s.receivedToday,df===0?'Same as yesterday':(df>0?'+':'')+df+' vs yesterday','#0284c7'],['Pending Verification',s.pending,'Requires prompt review','#64748b'],['Active Processing Queue',s.processing,'Currently on desk queue','#d97706'],['Approved Pickups Ready',s.ready,'Awaiting resident collection','#059669']];
 return hdr('Barangay Staff Console','Process digital service requests, assign tracking schedules, and trigger citizen alerts.')+pendAlert()+hallCard()+
 `<div class="metrics m4">${M.map(m=>`<div class="metric a"><div class="mh">${m[0]}<i class="dot" style="background:${m[3]}"></i></div><div class="num h">${ok?m[1]:'–'}</div><small>${m[2]}</small></div>`).join('')}</div>
 <div class="tool">${srch('Search resident or tracking code...')}<div>${sel([['','All Document Types'],...AD.types],AD.type,"setF('AD','type',this.value)")}${sel(RGO.map(o=>o[0]?o:['','All dates']),AD.range,"setF('AD','range',this.value)")}</div></div>
 <div class="card"><div class="ch"><h2 class="h">Document Service Queue</h2><span class="live"><i></i>Live update queue active</span></div>
 <div class="tw"><table><tr><th>Tracking #</th><th>Resident Name</th><th>Document Type</th><th>Date Submitted</th><th>Status</th><th>Queue Actions</th></tr>${rowsA(AD,6,aq||AD.type||AD.range?'No requests match.':'No new request to review','loadADash',1)}</table></div>
 ${AD.total>AD.items.length?`<div class="ft"><span>Showing <b>${AD.items.length}</b> of <b>${AD.total}</b> active requests (oldest first)</span><div class="pg"><a onclick="location.hash='#/admin/requests'">View all requests</a></div></div>`:''}</div>`;
}
function reqPg(){
 return ahdr('All Requests','View and manage all resident document requests.')+flash()+`<div class="tool">${srch('Search resident or tracking code...')}<div>${sel([['','All Document Types'],...AQ.types],AQ.type,"setF('AQ','type',this.value)")}${sel(STO,AQ.status,"setF('AQ','status',this.value)")}${sel(RGO.map(o=>o[0]?o:['','All dates']),AQ.range,"setF('AQ','range',this.value)")}</div></div>
 <div class="card"><div class="ch"><h2 class="h">Document Request History</h2></div><div class="tw"><table><tr><th>Tracking #</th><th>Resident Name</th><th>Document Type</th><th>Date Submitted</th><th>Status</th></tr>${rowsA(AQ,5,aq||AQ.type||AQ.status||AQ.range?'No requests match.':'No requests have been submitted yet.','loadAReqs')}</table></div>${AQ.loaded&&!AQ.err?pager(AQ,'AQ'):''}</div>`;
}

/* ---- admin: review one request ---- */
function revPg(){
 const back=`<div><a class="bk" onclick="location.hash='#/admin/requests'">← Back to All Requests</a></div>`,top=ahdr('Review Document Request','Check resident information, uploaded requirements and document details before deciding.'),d=RVW.data;
 if(!RVW.loaded)return back+top+'<div class="stub">Loading request…</div>';
 if(RVW.err||!d)return back+top+`<div class="stub"><b class="h">${e(RVW.err||'Request not found.')}</b></div>`;
 const kv=(l,v)=>`<div><small>${l}</small><p>${v}</p></div>`,ok=I('ck2'),al=d.allowed,r=d.resident,FL2=d.files;
 const all=RVW.chk.every(Boolean),can=a=>al.includes(a),ck=['Resident information matches record','Valid ID checked','Uploaded requirements reviewed','Purpose and document details checked'];
 const acts=al.length?`<div style="display:flex;gap:12px;flex-wrap:wrap">${can('start')?`<button class="btn sm" ${RVW.busy?'disabled':''} onclick="quick('start')">Start Processing</button>`:''}${can('approve')?`<button class="btn sm" onclick="needChk()?0:(MD={k:'ap'},render())">Continue to Approve</button>`:''}${can('reject')?`<button class="bt r" onclick="MD={k:'rj'};render()">Reject</button>`:''}${can('info')?`<button class="bt" onclick="MD={k:'info'};render()">Request Additional Information</button>`:''}${can('complete')?`<button class="btn sm" ${RVW.busy?'disabled':''} onclick="quick('complete')">Mark as Claimed</button>`:''}</div>`:`<p class="note">This request is ${e(STL[d.status])}. No further status changes are available.</p>`;
 return back+top+flash()+`<div class="pc" style="flex-direction:row;justify-content:space-between;align-items:center"><div class="kv" style="grid-template-columns:repeat(3,200px);gap:24px">${kv('Tracking number',e(d.trackingNo))}${kv('Document',e(d.documentType))}${kv('Resident',e(d.residentName))}</div>${ab(d.status)}</div>
 <div class="rg"><div class="col"><div class="pc"><h2 class="h">Resident Information</h2><div class="kv">${kv('Full name',e(r.name))}${kv('Unique ID',e(r.citizenId||'—'))}${kv('Email',e(r.email))}${kv('Phone number',e(r.phone||'—'))}${kv('Date of birth',r.dob?fmt(r.dob):'—')}</div></div>
 <div class="pc"><h2 class="h">Application Form</h2>${d.answers.length?`<div class="kv">${d.answers.map(a=>kv(e(a.label),e(a.value))).join('')}</div>`:'<p class="note">This document type has no document-specific form fields.</p>'}</div>
 <div class="pc"><h2 class="h">Uploaded Requirements</h2>${FL2.map(f=>`<div class="fl"><div style="display:flex;gap:12px;align-items:center"><span style="color:var(--sky)">${I('file')}</span><div><b>${e(f.label)}</b><small>${e(f.name)}</small></div></div><div><a href="${e(f.url)}" target="_blank" rel="noopener">View</a></div></div>`).join('')||'<p class="note">No files were uploaded with this request.</p>'}</div>
 <div class="pc"><h2 class="h">Admin Notes</h2><div><label class="lb">Internal review notes</label><textarea class="in" id="notes" maxlength="1000" style="min-height:80px" oninput="RVW.notes=this.value">${e(RVW.notes)}</textarea></div><p class="note" style="margin-top:-12px">Internal notes are saved with the request; they are never shown to the resident.</p><div><button class="bt" ${RVW.busy?'disabled':''} onclick="saveNotes()">Save notes</button></div>${acts}${RVW.msg?`<p class="er" role="alert">${e(RVW.msg)}</p>`:''}</div></div>
 <div class="col"><div class="pc"><h2 class="h">Document Details</h2><div class="kv one">${kv('Document type',e(d.documentType))}${kv('Purpose',e(d.purpose))}${kv('Submitted',dtm(d.submittedAt))}${d.claimDate?kv('Approved claim date',fmt(d.claimDate)):''}${kv('Resident remarks',e(d.comments||'—'))}${d.residentNote?kv('Message sent to resident',e(d.residentNote)):''}</div></div>
 ${d.status!=='rejected'?`<div class="pc"><h2 class="h">Official Document</h2><p class="note">Generate the official certificate from this resident’s submitted information, preview it, then print. Nothing is printed until you confirm.</p><div><button class="btn sm" ${RVW.busy?'disabled':''} onclick="openDoc()">Generate / Print Document</button></div></div>`:''}
 ${can('approve')?`<div class="pc"><h2 class="h">Verification Checklist</h2>${ck.map((c,i)=>`<label class="vf" style="cursor:pointer"><input type="checkbox" ${RVW.chk[i]?'checked':''} onchange="RVW.chk[${i}]=this.checked?1:0;render()" style="margin-right:8px">${c}</label>`).join('')}${all?'':'<p class="note">Tick every check to continue to approval.</p>'}</div>`:''}
 <div class="pc"><h2 class="h">Request History</h2>${tlist(d.history.slice().reverse().map(h=>({ev:h.event,head:hdl(h),note:hnote(h),at:h.at})))}</div>
 <div class="gd"><b>Decision guidance</b>Approve only after all required checks. Request additional information when a discrepancy can be corrected; include a clear reason when rejecting.</div></div></div>`;
}
/* vertical timeline, newest first: dot + headline + date/time (+ message). Rejections are red and read "Rejected: (reason)". */
const tlist=items=>`<div class="tl">${items.map((x,i)=>`<div class="${i===0?'cur ':''}ev-${e(x.ev)}"><b>${e(x.head)}</b><small>${dtm(x.at)}</small>${x.note?`<p>${e(x.note)}</p>`:''}</div>`).join('')}</div>`;
function needChk(){if(RVW.chk.every(Boolean)){RVW.msg='';return 0}RVW.msg='Tick every item in the verification checklist before approving.';render();return 1}
async function act(action,extra){
 if(RVW.busy)return;RVW.busy=1;RVW.msg='';if(MD)MD.err='';
 try{RVW.data=await http('PATCH','/admin/requests/'+encodeURIComponent(RVW.id),Object.assign({action,notes:RVW.notes},extra||{}));RVW.notes=RVW.data.adminNotes||'';MD=null;
  setFl(action==='note'?'Notes saved.':action==='info'?'Request sent. The resident was notified.':'Status updated to '+STL[RVW.data.status]+'. The resident was notified.');RVW.busy=0;render()}
 catch(x){RVW.busy=0;const m=emsg(x,'Could not update this request. Please try again.');const f=x.fields&&Object.values(x.fields)[0];if(MD){MD.err=f||m}else RVW.msg=m
  if(x.status===409)loadRev(1);render()}
}
const quick=a=>act(a);
const saveNotes=()=>act('note');
function dc(a){const v=gv('f1'),m=a==='approve'?{claim_date:v,message:gv('f2')}:a==='reject'?{reason:v}:{message:v};
 if(!v){MD.err=a==='approve'?'Choose a claim date.':'This field is required.';return render()}act(a,m)}

/* ---- admin: document types ---- */
function typPg(){
 return ahdr('Manage Document Types','Edit or remove available document types for resident requests.')+flash()+
 `<div class="card"><div class="ch"><h2 class="h">Registered Document Forms</h2><span class="note">Active forms are instantly visible to citizens in their request console.</span></div><div class="tw"><table class="ty"><tr><th>Document Type Name</th><th>Description</th><th>Status</th><th>Actions</th></tr>${ATY.items.map((x,i)=>`<tr><td class="d" style="font-weight:600">${e(x.name)}</td><td><div class="ell">${e(x.description)}</div></td><td><span class="b ${x.active?'a-g':'s-pend'}">${x.active?'Active':'Inactive'}</span></td><td class="act"><a onclick="MD={k:'type',i:${i}};render()">Edit Settings</a><a class="r" onclick="MD={k:'dtype',i:${i}};render()">Delete</a></td></tr>`).join('')||empty(4,ATY,'No document types are available.','loadATypes')}</table></div></div>`;
}
async function svT(){
 const n=gv('f1'),d=gv('f2'),active=gv('f3')==='Active';if(!n||!d){MD.err='Enter a name and description.';return render()}
 if(MD.busy)return;MD.busy=1;const t=MD.i!=null?ATY.items[MD.i]:null;
 try{await http(t?'PATCH':'POST','/admin/document-types'+(t?'/'+t.id:''),{name:n,description:d,active});setFl(t?'Document type updated.':'Document type added.');MD=null;await loadATypes(1);render()}
 catch(x){MD.busy=0;MD.err=emsg(x,'Could not save this document type.');render()}
}
async function delT(){
 if(MD.busy)return;MD.busy=1;const t=ATY.items[MD.i];
 try{await http('DELETE','/admin/document-types/'+t.id);setFl('Document type deleted. Existing requests were kept.');MD=null;await loadATypes(1);render()}
 catch(x){MD.busy=0;MD.err=emsg(x,'Could not delete this document type.');render()}
}

/* ---- admin: announcements ---- */
function annPg(){
 const l=AAN.items.map((x,i)=>[x,i]).filter(([x])=>hit(x.title+' '+x.message));
 return ahdr('Announcements','Create and manage announcements for residents.')+flash()+`<div class="tool">${srch('Search announcements...')}<button class="btn" onclick="MD={k:'ann',i:null};render()">${I('plus')}Create Announcement</button></div>
 <div class="card"><div class="ch"><h2 class="h">Announcement Broadcasts</h2><span class="note">Publishing notifies residents in their notification bell. Unpublishing or deleting removes it from there.</span></div>${!AAN.loaded?'<div class="nt">Loading announcements…</div>':AAN.err&&!AAN.items.length?`<div class="nt"><span class="er">${e(AAN.err)}</span> <a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="loadAAnn()">Try again</a></div>`:l.map(([x,i])=>`<div class="an"><div class="r1"><div><h3 class="h">${e(x.title)}</h3><small>${x.status==='published'?'Posted on '+sd(x.publishedAt):'Draft saved on '+sd(x.createdAt)}</small></div><span class="b ${x.status==='published'?'a-g':'s-pend'}">${x.status==='published'?'Published':'Draft'}</span></div><p style="white-space:pre-line">${e(x.message)}</p><div class="act"><a onclick="MD={k:'ann',i:${i}};render()">Edit Content</a><a class="r" onclick="MD={k:'dann',i:${i}};render()">Delete</a></div></div>`).join('')||`<div class="nt">${aq?'No announcements match.':'No announcements yet. Choose “Create Announcement” to post one.'}</div>`}</div>`;
}
async function svA(){
 const n=gv('f1'),d=gv('f2'),status=gv('f3')==='Published'?'published':'draft';MD.v=[n,d,gv('f3')];   // keep what was typed if the form has to be shown again
 if(!n||!d){MD.err='Enter a title and message.';return render()}
 if(n.length>50){MD.err='Title must be 50 characters or fewer.';return render()}
 if(MD.busy)return;MD.busy=1;const a=MD.i!=null?AAN.items[MD.i]:null;
 try{await http(a?'PATCH':'POST','/admin/announcements'+(a?'/'+a.id:''),{title:n,message:d,status});setFl(status==='published'?(a&&a.status==='published'?'Announcement updated.':'Announcement published. Residents were notified.'):'Draft saved. It is not visible to residents.');MD=null;await loadAAnn(1);render()}
 catch(x){MD.busy=0;MD.err=emsg(x,'Could not save this announcement.');render()}
}
async function delA(){
 if(MD.busy)return;MD.busy=1;const a=AAN.items[MD.i];
 try{await http('DELETE','/admin/announcements/'+a.id);setFl('Announcement deleted. It was also removed from residents’ notifications.');MD=null;await loadAAnn(1);render()}
 catch(x){MD.busy=0;MD.err=emsg(x,'Could not delete this announcement.');render()}
}

/* ---- admin: reports ---- */
function repPg(){
 const d=ARP.data,h=ahdr('Reports & Analytics','Overview of document request activity and statistics.');
 if(!ARP.loaded)return h+'<div class="stub">Loading reports…</div>';
 if(ARP.err||!d)return h+retry(ARP,'loadARep');
 const M=[['Total Requests',d.total,'Overall digital submissions','#0284c7'],['Approved',d.approved,'Ready for claim or claimed','#059669'],['Pending',d.pending,'Awaiting admin action','#b45309'],['Rejected',d.rejected,'Not approved','#b91c1c']];
 return h+`<div class="metrics m4">${M.map(m=>`<div class="metric a"><div class="mh">${m[0]}<i class="dot" style="background:${m[3]}"></i></div><div class="num h">${m[1]}</div><small>${m[2]}</small></div>`).join('')}</div>
 <div class="lay" style="grid-template-columns:1fr 1fr"><div class="pc"><h2 class="h">Requests by Document Type</h2><div>${d.byType.map(t=>`<div class="rl">${e(t.name)}<span class="b a-t" style="color:#047857">${t.count} request${t.count===1?'':'s'}</span></div>`).join('')||'<p class="note">No requests yet.</p>'}</div></div><div class="pc"><h2 class="h">Recent Activity Log</h2>${d.activity.map(l=>`<div class="lg">${e(l.text)}<small>${ago(l.at)}</small></div>`).join('')||'<p class="note">No activity yet.</p>'}</div></div>`;
}

/* ---- admin: modals ---- */
const ov2=(t,b,a)=>`<div class="ov"><div class="mod" style="text-align:left;align-items:stretch"><h2 class="h" style="font-size:22px;font-weight:700">${t}</h2>${b}${MD.err?`<p class="er" role="alert">${e(MD.err)}</p>`:''}<div class="acts"><button class="bt" onclick="MD=null;render()">Cancel</button>${a}</div></div></div>`;
const fld=(l,id,v,ta,x)=>`<div><label class="lb">${l}</label>${ta?`<textarea class="in" id="${id}" maxlength="${x||500}">${e(v)}</textarea>`:`<input class="in" id="${id}" value="${e(v)}" maxlength="${x||150}">`}</div>`;
const gv=i=>document.getElementById(i).value.trim();
/* ---- official document: generate -> preview -> print / download (admin only; the server re-checks every call) ---- */
const DOCS={url:'',err:'',warn:[],missing:[],busy:0,word:0};
const docDone=()=>{DOCS.busy=0;if(MD&&MD.k==='doc')render()};
async function openDoc(){
 if(DOCS.url)URL.revokeObjectURL(DOCS.url);
 Object.assign(DOCS,{url:'',err:'',warn:[],missing:[],busy:1,word:0});MD={k:'doc'};render();
 const id=encodeURIComponent(RVW.id);
 try{
  const c=await http('GET','/admin/requests/'+id+'/document');
  DOCS.warn=c.warnings||[];
  if(!c.available||!c.ready){DOCS.err=c.reason||'';DOCS.missing=c.missing||[];return docDone()}
  DOCS.word=1;
  const res=await fetch(CFG.API_BASE+'/admin/requests/'+id+'/document.pdf',{credentials:'include',headers:authHeader()});
  if(!res.ok){let j={};try{j=await res.json()}catch(x){}throw new Error(j.message||'The document could not be generated.')}
  DOCS.url=URL.createObjectURL(await res.blob());
 }catch(x){DOCS.err=emsg(x,'The document could not be generated.')}
 docDone();
}
function printDoc(){const f=document.getElementById('docf');try{f.contentWindow.focus();f.contentWindow.print()}catch(x){window.open(DOCS.url,'_blank')}}
function closeDoc(){if(DOCS.url)URL.revokeObjectURL(DOCS.url);DOCS.url='';MD=null;render()}
async function dlDoc(){
 try{const res=await fetch(CFG.API_BASE+'/admin/requests/'+encodeURIComponent(RVW.id)+'/document.docx',{credentials:'include',headers:authHeader()});
  if(!res.ok){let j={};try{j=await res.json()}catch(x){}throw new Error(j.message||'The Word file could not be created.')}
  const u=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=u;a.download=RVW.data.trackingNo+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);
 }catch(x){DOCS.err=emsg(x,'The Word file could not be created.');render()}
}
function admMd(){const m=MD,t=m.i!=null&&m.k==='type'?ATY.items[m.i]:null,a=m.i!=null&&m.k==='ann'?AAN.items[m.i]:null,d=RVW.data,B=m.busy?'disabled':'';
 if(m.k==='doc'){const d2=RVW.data,okp=!!DOCS.url;
  return `<div class="ov"><div class="mod docm" style="text-align:left;align-items:stretch"><h2 class="h" style="font-size:22px;font-weight:700">Official document</h2><p class="sub">${e(d2.trackingNo)} · ${e(d2.documentType)} · ${e(d2.residentName)}</p>${DOCS.warn.map(w=>`<p class="er" role="alert">${e(w)}</p>`).join('')}${DOCS.busy?'<p class="sub">Preparing the official document…</p>':okp?`<iframe id="docf" class="docf" src="${DOCS.url}" title="Official document preview"></iframe><p class="note">Check the preview carefully. Printing opens your browser’s print dialog. Preview blank? <a style="color:var(--sky);cursor:pointer;font-weight:600" onclick="window.open(DOCS.url,'_blank')">Open it in a new tab</a>.</p>`:`<div class="er" role="alert">${e(DOCS.err||'The document could not be generated.')}${DOCS.missing.length?`<br>Missing from this request: <b>${DOCS.missing.map(e).join(', ')}</b>.<br>Use “Request Additional Information” to ask the resident for the missing details. Nothing was generated.`:''}</div>`}<div class="acts"><button class="bt" onclick="closeDoc()">Close</button>${DOCS.busy||!DOCS.word?'':`<button class="bt" onclick="dlDoc()">Download Word (.docx)</button>`}${okp?'<button class="btn sm" onclick="printDoc()">Print</button>':''}</div></div></div>`}
 if(m.k==='type')return ov2(t?'Edit document type':'Add new type',fld('Document type name','f1',t?t.name:'',0,80)+fld('Description','f2',t?t.description:'',1)+`<div><label class="lb">Status</label><select class="in" id="f3"><option>Active</option><option ${t&&!t.active?'selected':''}>Inactive</option></select></div>${t?'':'<p class="note">New types use the shared application details (purpose, claim date, comments) only.</p>'}`,`<button class="btn sm" ${B} onclick="svT()">${m.busy?'Saving…':'Save changes'}</button>`);
 if(m.k==='dtype')return ov2('Delete document type?',`<p class="sub">${e(ATY.items[m.i].name)} will be removed and residents can no longer request it. Existing requests are kept.</p>`,`<button class="bt r" ${B} onclick="delT()">Delete type</button>`);
 if(m.k==='ann')return ov2(a?'Edit announcement':'Create announcement',(tv=>`<div><label class="lb">Title <span class="cnt" id="tc">${tv.length}/50</span></label><input class="in" id="f1" maxlength="50" value="${e(tv)}" oninput="document.getElementById('tc').textContent=this.value.length+'/50'"></div>`)(m.v?m.v[0]:a?a.title:'')+fld('Message','f2',m.v?m.v[1]:a?a.message:'',1,2000)+`<div><label class="lb">Status</label><select class="in" id="f3"><option>Published</option><option ${(m.v?m.v[2]==='Draft':a&&a.status==='draft')?'selected':''}>Draft</option></select></div>`,`<button class="btn sm" ${B} onclick="svA()">${m.busy?'Saving…':a?'Save changes':'Publish announcement'}</button>`);
 if(m.k==='dann')return ov2('Delete announcement?',`<p class="sub">${e(AAN.items[m.i].title)} will be removed from the resident feed.</p>`,`<button class="bt r" ${B} onclick="delA()">Delete announcement</button>`);
 if(m.k==='ap'){const pc=todayStr();return ov2('Approve document request',`<p class="sub">${e(d.trackingNo)} · ${e(d.residentName)} will be marked Ready for Claim and the resident will be notified.</p><div><label class="lb">Claim date</label><input class="in" type="date" id="f1" min="${todayStr()}" value="${e(pc)}"></div>`+fld('Message to resident (optional)','f2','',1),`<button class="btn sm" ${RVW.busy?'disabled':''} onclick="dc('approve')">Approve request</button>`)}
 if(m.k==='rap')return ov2('Approve resident',`<p class="sub">${e(m.nm)} will be able to sign in and request documents. They are notified once approved.</p>`,`<button class="btn sm" onclick="resDecide('approved')">Approve resident</button>`);
 if(m.k==='rrj')return ov2('Reject registration',`<p class="sub">${e(m.nm)} will not be able to sign in. The reason is sent to the resident, who can register again.</p>`+fld('Reason for rejection','f1','',1),`<button class="bt r" onclick="resDecide('rejected')">Reject registration</button>`);
 if(m.k==='rj')return ov2('Reject document request',`<p class="sub">${e(d.trackingNo)} · ${e(d.residentName)}. The reason is sent to the resident.</p>`+fld('Reason for rejection','f1','',1),`<button class="bt r" ${RVW.busy?'disabled':''} onclick="dc('reject')">Reject request</button>`);
 return ov2('Request additional information',`<p class="sub">Tell ${e(d.residentName)} what is missing. The request stays open.</p>`+fld('Message to resident','f1','',1),`<button class="btn sm" ${RVW.busy?'disabled':''} onclick="dc('info')">Send request</button>`)}
/* ===================== END REQUESTS ===================== */


/* ===================== RESIDENT APPROVALS (admin) =====================
 Backend: GET /admin/residents  ->  { data:[Resident] }      PATCH /admin/residents/:id  { status:'approved'|'rejected', reason }
 Resident = { id, citizenId, name, email, phone, dob, createdAt, status:'pending'|'approved'|'rejected', note, decidedAt, idFileName, idUrl|idData } */
const RS={items:[],loaded:0,tab:'Pending',chk:{},msg:'',flash:'',err:''};
const pendingCount=()=>RS.items.filter(r=>r.status==='pending').length;
async function loadRes(silent){
 try{
  const items=await Auth.residents.list(),sig=x=>JSON.stringify(x.map(r=>[r.id,r.status]));
  const changed=sig(items)!==sig(RS.items)||!RS.loaded;RS.items=items;RS.err='';RS.loaded=1;
  const t=document.activeElement&&document.activeElement.tagName;
  if(!silent||(changed&&!MD&&!PF.open&&t!=='INPUT'&&t!=='TEXTAREA'&&t!=='SELECT'))render();
 }catch(x){RS.err='Couldn’t load resident registrations.';RS.loaded=1;if(!silent)render()}
}
const rbd=st=>`<span class="b ${{pending:'a-y',approved:'a-g',rejected:'a-r'}[st]}">${{pending:'Pending Approval',approved:'Approved',rejected:'Rejected'}[st]}</span>`;
const dtm=iso=>iso?new Date(iso).toLocaleString('en-US',{month:'short',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const phn=p=>String(p||'').replace(/^(\d{4})(\d{3})(\d{4})$/,'$1 $2 $3')||'—';
function pendAlert(){const n=pendingCount();return n?`<div class="alert" onclick="location.hash='#/admin/residents'"><div><b>${n} resident registration${n>1?'s':''} waiting for approval</b><span>Check their valid ID so they can start requesting documents. <u>Review now</u></span></div></div>`:''}

function resPg(){
 const q=aq.toLowerCase(),c=s=>RS.items.filter(r=>r.status===s).length,fl=RS.flash;RS.flash='';
 const rows=RS.items.filter(r=>(RS.tab==='All'||r.status===RS.tab.toLowerCase())&&(!q||(r.name+r.email+r.citizenId).toLowerCase().includes(q)));
 if(RS.tab==='Pending')rows.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)); // oldest first: first come, first served
 const M=[['Pending Approval',c('pending'),'Waiting for ID verification','#b45309'],['Approved Residents',c('approved'),'Can sign in and file requests','#059669'],['Rejected',c('rejected'),'Not verified as residents','#b91c1c'],['Total Registrations',RS.items.length,'Email-verified accounts','#0284c7']];
 const tabs=['Pending','Approved','Rejected','All'];
 return ahdr('Resident Approvals','Verify each new registration against the uploaded valid ID before the resident can use the portal.')+
 (fl?`<div class="flash">${e(fl)}</div>`:'')+(RS.err?`<p class="er">${RS.err}</p>`:'')+
 `<div class="metrics m4">${M.map(m=>`<div class="metric a"><div class="mh">${m[0]}<i class="dot" style="background:${m[3]}"></i></div><div class="num h">${m[1]}</div><small>${m[2]}</small></div>`).join('')}</div>
 <div class="tool">${srch('Search name, email or resident ID...')}<div class="rtabs">${tabs.map(t=>`<a class="${t===RS.tab?'on':''}" onclick="RS.tab='${t}';render()">${t}${t==='All'?'':` <span>${c(t.toLowerCase())}</span>`}</a>`).join('')}</div></div>
 <div class="card"><div class="ch"><h2 class="h">Registration Queue</h2><span class="note">Oldest first. Approve only residents whose valid ID checks out.</span></div>
 <div class="tw"><table><tr><th>Resident</th><th>Mobile Number</th><th>Registered</th><th>Valid ID</th><th>Status</th><th>Action</th></tr>
 ${!RS.loaded?'<tr><td colspan="6">Loading registrations…</td></tr>':rows.map(r=>`<tr style="cursor:pointer" onclick="location.hash='#/admin/resident/${encodeURIComponent(r.id)}'"><td class="n">${e(r.name)}<small style="display:block;font-weight:400;color:var(--mute);margin-top:2px">${e(r.email)}</small></td><td style="white-space:nowrap">${phn(r.phone)}</td><td style="white-space:nowrap">${dtm(r.createdAt)}</td><td><div class="ell" style="max-width:200px">${e(r.idFileName||'—')}</div></td><td>${rbd(r.status)}</td><td class="act"><a>${r.status==='pending'?'Review':'View'}</a></td></tr>`).join('')||`<tr><td colspan="6">${RS.tab==='Pending'&&!q?'No registrations are waiting for approval. You’re all caught up.':'No registrations match.'}</td></tr>`}</table></div>
 <div class="ft"><span>Showing <b>${rows.length}</b> of <b>${RS.items.length}</b> registrations</span></div></div>`}

function resDetail(){
 const id=decodeURIComponent(location.hash.split('/')[3]||''),back=`<div><a class="bk" onclick="location.hash='#/admin/residents'">← Back to Resident Approvals</a></div>`;
 if(!RS.loaded)return back+ahdr('Review Resident Registration','')+'<div class="stub">Loading…</div>';
 const r=RS.items.find(x=>x.id===id);
 if(!r)return back+ahdr('Review Resident Registration','')+'<div class="stub"><b class="h">Registration not found</b>It may have been removed.</div>';
 const kv=(l,v)=>`<div><small>${l}</small><p>${v}</p></div>`,ok=I('ck2'),src=r.idUrl||r.idData,pdf=/\.pdf$/i.test(r.idFileName)||/^data:application\/pdf/.test(src||'');
 const CK=['Name on the ID matches the registration','Photo and details are clear and readable','ID is valid and not expired','Address on the ID is within this barangay'];
 const ck=RS.chk[id]||(RS.chk[id]=[0,0,0,0]),all=ck.every(Boolean),pend=r.status==='pending';
 const prev=!src?`<div class="idph">${I('file')}<b>${e(r.idFileName||'No file')}</b><small>Preview isn’t available for this upload.</small></div>`:
  pdf?`<iframe class="idpv" src="${e(src)}" title="Valid ID"></iframe>`:`<img class="idimg" src="${e(src)}" alt="Valid ID uploaded by ${e(r.name)}">`;
 return back+ahdr('Review Resident Registration','Compare the uploaded valid ID with the registration details before deciding.')+
 `<div class="pc" style="flex-direction:row;justify-content:space-between;align-items:center"><div class="kv" style="grid-template-columns:repeat(3,200px);gap:24px">${kv('Resident ID',e(r.citizenId))}${kv('Resident',e(r.name))}${kv('Registered',dtm(r.createdAt))}</div>${rbd(r.status)}</div>
 <div class="rg"><div class="col">
  <div class="pc"><h2 class="h">Registration Details</h2><div class="kv">${kv('Full name',e(r.name))}${kv('Email',e(r.email))}${kv('Mobile number',phn(r.phone))}${kv('Date of birth',r.dob?fmt(r.dob):'—')}</div><div class="vf">${ok}Email address verified with a one-time code</div></div>
  <div class="pc"><h2 class="h">Valid ID</h2>${prev}<p class="note">${e(r.idFileName||'')} · Check the name, photo, expiry date and address against the details above.</p></div>
 </div><div class="col">
  <div class="pc"><h2 class="h">Verification Checklist</h2>${CK.map((t,i)=>`<label class="ckr"><input type="checkbox" ${ck[i]?'checked':''} ${pend?'':'disabled'} onchange="RS.chk['${e(id)}'][${i}]=this.checked?1:0;RS.msg='';render()"><span>${t}</span></label>`).join('')}</div>
  ${pend?`<div class="pc"><h2 class="h">Decision</h2>${RS.msg?`<p class="er">${RS.msg}</p>`:''}<div class="acts" style="margin:0"><button class="bt r" onclick="resAsk('rrj')">Reject</button><button class="btn" onclick="resAsk('rap')" style="opacity:${all?1:.55}">Approve resident</button></div><p class="note">Approving lets this person sign in and request documents. Rejecting sends your reason to the resident.</p></div>
  <div class="gd"><b>Decision guidance</b>Approve only after all four checks are ticked. If the ID is blurry or expired, reject with a clear reason so the resident can register again with a better photo.</div>`:
  `<div class="pc"><h2 class="h">Decision</h2><div class="kv one">${kv('Status',rbd(r.status))}${kv('Decided',dtm(r.decidedAt))}${r.status==='rejected'?kv('Reason sent to resident',e(r.note||'—')):''}</div></div>`}
 </div></div>`}
function resAsk(k){
 const r=RS.items.find(x=>x.id===decodeURIComponent(location.hash.split('/')[3]||''));if(!r)return;
 if(k==='rap'&&!(RS.chk[r.id]||[]).every(Boolean)){RS.msg='Tick every item in the verification checklist before approving.';return render()}
 RS.msg='';MD={k,id:r.id,nm:r.name};render()}
async function resDecide(st){
 const id=MD.id,nm=MD.nm;let note='';
 if(st==='rejected'){note=gv('f1');if(!note){MD.err='Enter a reason for rejection.';return render()}}
 let r;try{r=await Auth.residents.decide(id,st,note);const i=RS.items.findIndex(x=>x.id===id);if(i>-1)RS.items[i]=r}
 catch(x){MD.err='Couldn’t save the decision. Please try again.';return render()}
 RS.tab='Pending';RS.flash=nm+(st==='approved'?' was approved and can now sign in.':' was rejected. The reason was sent to the resident.')+(r&&r.emailSent===false?' (The notification email could not be sent. Please inform the resident directly.)':'');
 location.hash='#/admin/residents'}
/* ===================== END RESIDENT APPROVALS ===================== */

/* ===================== MY PROFILE POPUP (resident + admin) =====================
 Click the name/avatar at the bottom of the sidebar. Data: Auth.profile()  (real API: GET /auth/me)
 -> { id, citizenId, name, email, role, phone, dob, createdAt, status, idFileName } */
const PF={open:0,data:null,err:''};
async function openProf(){
 PF.open=1;PF.err='';render();
 try{PF.data=await Auth.profile()}catch(x){PF.err='Couldn’t load your profile details.'}
 if(PF.open)render()}
function closeProf(){PF.open=0;render()}
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&PF.open)closeProf()});
const dts=iso=>iso?new Date(iso).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—';
const pkv=(l,v)=>`<div><small>${l}</small><p>${v||'—'}</p></div>`;
function profMd(){
 const d=PF.data,ad=SES.role==='admin',ss=Auth.current()||{};
 const det=PF.err?`<p class="er">${PF.err}</p>`:!d?'<p class="sub">Loading profile…</p>':
 `<div class="pfs">Personal Information</div><div class="kv">${pkv('Full name',e(d.name))}${pkv('Email address',e(d.email))}${pkv('Mobile number',d.phone?phn(d.phone):'')}${pkv('Date of birth',d.dob?fmt(d.dob):'')}</div>
 <div class="pfs">Account</div><div class="kv">${ad?pkv('Staff ID',e(d.citizenId))+pkv('Role','Barangay Admin')+pkv('Office','Barangay Hall')+pkv('Signed in',dtm(ss.iat?new Date(ss.iat).toISOString():null))
 :pkv('Resident ID',e(d.citizenId))+pkv('Account status',d.status?rbd(d.status):'')+pkv('Member since',dts(d.createdAt))+pkv('Valid ID on file',e(d.idFileName))}</div>`;
 return `<div class="ov" onclick="if(event.target===this)closeProf()"><div class="mod pfm" role="dialog" aria-modal="true" aria-label="My profile">
 <button class="pfx" onclick="closeProf()" aria-label="Close profile">×</button>
 <div class="pfh"><div class="av pfav">${e(initials(SES.name))}</div><div><h2 class="h">${e(SES.name)}</h2><span class="pfr">${ad?'Barangay Admin':'Resident'}</span></div></div>
 ${det}</div></div>`}
/* ===================== END MY PROFILE ===================== */

const AP={residents:resPg,resident:resDetail,requests:reqPg,types:typPg,announce:annPg,reports:repPg,review:revPg};
function render(){
 // route guard: every user only sees their own area (residents never reach #/admin and vice versa)
 const want=SES.role==='admin'?'admin':'resident';
 if(location.hash.split('/')[1]!==want){location.replace('#/'+want);return}
 if(location.hash==='#/resident/notif'){location.replace('#/resident');return}
 const [,role='resident',sub=''] = location.hash.split('/');
 const r=role==='admin'?'admin':'resident';
 const nav=r==='admin'?AN:RN, label=(nav.find(n=>n[0]===sub)||[])[1]||'Page';
 const body=(r==='admin'&&AP[sub])?AP[sub]():sub===''?(r==='admin'?adminDash():residentDash()):(sub==='new'&&r==='resident')?newReq():(r==='resident'&&sub==='history')?histPg():(r==='resident'&&sub==='track')?trackPg():hdr(label,'')+stub(label);
 const f=document.activeElement,keep=f&&f.id==='q'?f.selectionStart:null,sy=window.scrollY;
 document.getElementById('root').innerHTML=shell(r,sub==='review'?'requests':sub==='resident'?'residents':sub,nav,body)+(r==='resident'&&sub==='new'&&NR.done?modal():'')+(r==='admin'&&MD?admMd():'')+(PF.open?profMd():'')+(LO?lo():'');
 const q=document.getElementById('q');
 if(q){q.oninput=ev=>{aq=ev.target.value;const k=SRV[rk()],p=ev.target.selectionStart;clearTimeout(QT);
   if(k)QT=setTimeout(()=>{V[k].page=1;LDR[k]()},300);   // searched on the server, after the typing pause
   else{render();const n=document.getElementById('q');n.focus();n.setSelectionRange(p,p)}};
  if(keep!=null){q.focus();q.setSelectionRange(keep,keep)}}
 if(window.scrollY!==sy)window.scrollTo(0,sy);
}
addEventListener('hashchange',()=>{if(DOCS.url){URL.revokeObjectURL(DOCS.url);DOCS.url=''}MD=null;aq='';FL='';NS.open=0;RS.msg='';enter()});
document.addEventListener('click',ev=>{if(NS.open&&!ev.composedPath().some(n=>n.id==='nwrap')){NS.open=0;paintNotif()}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&NS.open){NS.open=0;paintNotif();const b=document.querySelector('.nbtn');b&&b.focus()}});
enter();
if(SES.role==='resident')initNotif(); // notification bell is resident-only
if(SES.role==='admin')loadRes(); // sidebar badge
setInterval(()=>{if(!document.hidden){refresh();if(SES.role==='admin')loadRes(1)}},CFG.POLL_MS); // both dashboards re-sync with the database on a timer
