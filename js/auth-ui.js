/* Sign in / register / OTP / password reset screens (index.html) */
(function(){
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const state={email:'',password:'',resetToken:null,fileOk:false,mode:'register'};
  const views={login:'view-login',reg1:'view-reg1',reg2:'view-reg2',otp:'view-otp',done:'view-done',forgot:'view-forgot',reset:'view-reset'};
  const progress=$('#progress');
  const landing=$('#landing'),authEl=$('#auth');
  const LANDING_TITLE='BarangayDocs · Request barangay documents online';
  const hashFor={login:'login',reg1:'register',forgot:'forgot'};
  const steps={reg1:'REGISTRATION · 1 / 3',reg2:'REGISTRATION · 2 / 3',forgot:'PASSWORD RESET · 1 / 3',done:'REGISTRATION · SUBMITTED · Waiting for admin approval',reset:'PASSWORD RESET · 3 / 3'};
  const stepText=n=>n==='otp'?(state.mode==='reset'?'PASSWORD RESET · 2 / 3 · Email → OTP Verification → New password':'REGISTRATION · 3 / 3 · Register → OTP Verification → Admin Approval'):steps[n];

  function show(name){
    landing.hidden=true;authEl.hidden=false;
    if(hashFor[name]&&location.hash!=='#'+hashFor[name])history.replaceState(null,'','#'+hashFor[name]);
    Object.values(views).forEach(id=>$('#'+id).classList.remove('active'));
    $('#'+views[name]).classList.add('active');
    const st=stepText(name); progress.hidden=!st; progress.textContent=st||'';
    const resetFlow=['forgot','reset'].includes(name)||(name==='otp'&&state.mode==='reset');
    $('#intro-p').textContent=resetFlow?'Securely access your community residency records, file requests, review transaction histories, and communicate with local officials directly.':'Securely register your community residency records today to file requests, review transaction histories, and communicate with local officials directly.';
    if(name==='otp'){$('#change-email').textContent='Change Email';$('#back-reg').textContent=state.mode==='reset'?'Back to Sign In':'Back to registration'}
    document.title='BarangayDocs · '+({login:'Sign in',reg1:'Register',reg2:'Register',otp:'Verify email',done:'Verified',forgot:'Forgot password',reset:'Reset password'})[name];
    const h=$('#'+views[name]).querySelector('input'); if(h&&name!=='otp') h.focus({preventScroll:true});
    if(name==='otp'){startOtp()} else {stopTimers()}
  }
  $$('[data-go]').forEach(b=>b.addEventListener('click',()=>{state.mode='register';show(b.dataset.go==='register'?'reg1':'login')}));
  $('#view-reg2 [data-go="register"]').addEventListener('click',e=>{e.stopPropagation();show('reg1')},true);

  // helpers
  function setErr(id,on){const i=$('#'+id);const f=i.closest('.field');f.classList.toggle('has-error',on);i.setAttribute('aria-invalid',on)}
  function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  $$('[data-toggle]').forEach(b=>b.addEventListener('click',()=>{
    const i=$('#'+b.dataset.toggle);const s=i.type==='password';i.type=s?'text':'password';b.setAttribute('aria-label',s?'Hide password':'Show password')}));
  $$('.input input').forEach(i=>i.addEventListener('input',()=>{const f=i.closest('.field');f&&f.classList.remove('has-error')}));

  // LOGIN
  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const a=$('#l-id').value.trim(), p=$('#l-pw').value, btn=$('#login-btn');
    setErr('l-id',!a); setErr('l-pw',!p);
    $('#login-banner').classList.remove('show','warn');
    if(!a||!p) return;
    btn.disabled=true;
    try{
      const s=await Auth.login(a,p);
      window.location.href=Auth.takeNext(s.user)||Auth.dashboardUrl(s.user);   // role-based redirect
    }catch(err){
      const B=$('#login-banner');
      if(err.code==='unverified'){   // correct password, email never verified -> send a fresh code and continue verification
        btn.disabled=false;state.mode='register';state.email=err.email||a;$('#otp-email').textContent=state.email;
        try{await Auth.resendOtp(state.email,'register')}catch(_){}
        show('otp');toast('Please verify your email to continue.');return;
      }
      B.classList.toggle('warn',err.code==='pending');
      B.querySelector('span').textContent=
        err.code==='pending'?'Your registration is still waiting for barangay admin approval. We’ll notify you by email or SMS once it’s approved.':
        err.code==='rejected'?'Your registration was not approved'+(err.reason?': '+err.reason:'.')+' You can register again with a clearer valid ID.':
        err.status===429?'Too many attempts. Please wait '+(err.retryAfter?Math.ceil(err.retryAfter/60)+' minute(s)':'a few minutes')+' and try again.':
        err.status&&err.status!==401?'Something went wrong. Please try again.':'Incorrect email or password. Check your details and try again.';
      B.classList.add('show'); btn.disabled=false;
    }
  });
  $('#forgot').addEventListener('click',()=>{state.mode='reset';$('#f-email').value=($('#l-id').value.includes('@')?$('#l-id').value:'');show('forgot')});
  $$('[data-back-login]').forEach(b=>b.addEventListener('click',()=>{state.mode='register';show('login')}));
  $('#forgot-form').addEventListener('submit',async e=>{
    e.preventDefault();const em=$('#f-email').value.trim();const ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
    setErr('f-email',!ok);if(!ok)return;
    const fb=$('#forgot-form button[type=submit]');fb.disabled=true;
    try{await Auth.forgotPassword(em)}catch(err){
      if(err.status===503){fb.disabled=false;toast(err.message||'Email delivery is not available right now.');return}   // server-wide problem, not account-specific
    } // otherwise: same response whether or not the account exists
    fb.disabled=false;
    state.email=em;state.mode='reset';$('#otp-email').textContent=em;show('otp');
  });
  $('#reset-form').addEventListener('submit',async e=>{
    e.preventDefault();const p=$('#n-pw').value,p2=$('#n-pw2').value;
    const okP=strong(p),okM=p&&p===p2;setErr('n-pw',!okP);setErr('n-pw2',!okM);
    if(!okP||!okM)return;
    const rb=$('#reset-form button[type=submit]');rb.disabled=true;
    try{await Auth.resetPassword(state.email,p,state.resetToken)}
    catch(err){rb.disabled=false;toast('Couldn’t reset your password. Request a new code and try again.');return}
    rb.disabled=false;
    $('#reset-modal').classList.add('show');$('#rs-login').focus();
  });
  $('#rs-login').addEventListener('click',()=>{$('#reset-modal').classList.remove('show');$('#n-pw').value='';$('#n-pw2').value='';state.mode='register';show('login')});

  // REGISTER 1
  const strong=p=>p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p)&&/[^A-Za-z0-9]/.test(p);
  $('#reg1-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const em=$('#r-email').value.trim(), p=$('#r-pw').value, p2=$('#r-pw2').value;
    let okE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em), okP=strong(p), okM=p&&p===p2;
    $('#r-email-err').textContent='Enter a valid email address.';
    if(okE&&await Auth.emailTaken(em)){okE=false;$('#r-email-err').textContent='An account with this email already exists. Try signing in.'}
    setErr('r-email',!okE); setErr('r-pw',!okP); setErr('r-pw2',!okM);
    if(okE&&okP&&okM){state.email=em;state.password=p;show('reg2')}
  });

  // REGISTER 2
  const adultOn=()=>{const n=new Date();return new Date(n.getFullYear()-18,n.getMonth(),n.getDate())};   // latest birth date that is 18 or older
  const isoLocal=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  $('#r-dob').max=isoLocal(adultOn());
  const dobMsg=m=>{const el=document.querySelector('[data-for="r-dob"]');if(el)el.textContent=m};
  $('#r-phone').addEventListener('input',e=>{
    let d=e.target.value.replace(/\D/g,'').slice(0,11);
    e.target.value=[d.slice(0,4),d.slice(4,7),d.slice(7,11)].filter(Boolean).join(' ');
  });
  $('#r-id').addEventListener('change',e=>{
    const f=e.target.files[0], n=$('#id-name'), fld=$('#id-field'); fld.classList.remove('has-error');
    if(!f){n.textContent='Choose a file';n.classList.add('empty');state.fileOk=false;return}
    const okType=/\.(jpe?g|png|pdf)$/i.test(f.name), okSize=f.size<=5*1024*1024;
    if(!okType||!okSize){
      $('#id-error').textContent=!okType?'Use a JPG, PNG or PDF file.':'File is larger than 5 MB. Choose a smaller file.';
      fld.classList.add('has-error'); e.target.value=''; n.textContent='Choose a file'; n.classList.add('empty'); state.fileOk=false; return;
    }
    n.textContent=f.name; n.classList.remove('empty'); state.fileOk=true;
  });
  $('#reg2-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=$('#r-name').value.trim().split(/\s+/).length>=2;
    const dv=$('#r-dob').value,dobDate=dv?new Date(dv+'T00:00'):null;
    const dob=!!dobDate&&!isNaN(dobDate)&&dobDate<=adultOn();
    dobMsg(!dv||isNaN(dobDate)||dobDate>new Date()?'Enter a valid date of birth.':'You must be at least 18 years old to register.');
    const ph=/^09\d{9}$/.test($('#r-phone').value.replace(/\s/g,''));
    setErr('r-name',!name); setErr('r-dob',!dob); setErr('r-phone',!ph);
    if(!state.fileOk){$('#id-error').textContent='Upload a valid ID.';$('#id-field').classList.add('has-error')}
    if(name&&dob&&ph&&state.fileOk){
      const sb=$('#reg2-form button[type=submit]');if(sb)sb.disabled=true;
      try{
        await Auth.register({email:state.email,password:state.password,name:$('#r-name').value.trim(),
          dob:$('#r-dob').value,phone:$('#r-phone').value.replace(/\s/g,''),idFile:$('#r-id').files[0]});
      }catch(err){
        if(sb)sb.disabled=false;
        const f=err.fields||{};
        if(f.valid_id){$('#id-error').textContent=f.valid_id;$('#id-field').classList.add('has-error')}
        if(f.name)setErr('r-name',true);if(f.dob){dobMsg(f.dob);setErr('r-dob',true)}if(f.phone)setErr('r-phone',true);
        if(f.email||f.password){$('#r-email-err').textContent=f.email||'Check your email and password.';setErr('r-email',!!f.email);setErr('r-pw',!!f.password);show('reg1')}
        toast(err.status===409?'An account with this email already exists.':err.status===429?'Please wait '+(err.retryAfter||30)+' seconds before trying again.':
          [422,502,503].includes(err.status)&&err.message&&!/^HTTP/.test(err.message)?err.message:'Registration failed. Please try again.');
        return;
      }
      if(sb)sb.disabled=false;
      state.mode='register'; $('#otp-email').textContent=state.email; show('otp');
    }
  });

  // OTP
  const otpWrap=$('#otp'); const boxes=[];
  for(let i=0;i<6;i++){
    const b=document.createElement('input');
    b.inputMode='numeric';b.maxLength=1;b.autocomplete=i===0?'one-time-code':'off';b.setAttribute('aria-label','Digit '+(i+1));
    otpWrap.appendChild(b);boxes.push(b);
    b.addEventListener('input',()=>{b.value=b.value.replace(/\D/g,'');otpWrap.classList.remove('invalid');$('#otp-error').style.display='none';if(b.value&&boxes[i+1])boxes[i+1].focus()});
    b.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!b.value&&boxes[i-1]){boxes[i-1].focus()}if(e.key==='ArrowLeft'&&boxes[i-1])boxes[i-1].focus();if(e.key==='ArrowRight'&&boxes[i+1])boxes[i+1].focus()});
    b.addEventListener('paste',e=>{
      const d=(e.clipboardData.getData('text')||'').replace(/\D/g,'').slice(0,6);if(!d)return;e.preventDefault();
      d.split('').forEach((c,k)=>boxes[k].value=c);boxes[Math.min(d.length,5)].focus();
    });
  }
  let expT,resT,exp=300,res=30;
  const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  function stopTimers(){clearInterval(expT);clearInterval(resT)}
  function startOtp(){
    stopTimers();exp=300;res=30;boxes.forEach(b=>b.value='');otpWrap.classList.remove('invalid');$('#otp-error').style.display='none';
    $('#verify').disabled=false;$('#exp').classList.remove('expired');$('#exp').textContent=mmss(exp);
    setResend();boxes[0].focus();
    expT=setInterval(()=>{exp--;$('#exp').textContent=mmss(Math.max(exp,0));if(exp<=0){clearInterval(expT);$('#exp').classList.add('expired');$('#exp').textContent='Expired';$('#verify').disabled=true;showOtpErr('This code has expired. Request a new one.')}},1000);
    resT=setInterval(()=>{res--;setResend();if(res<=0)clearInterval(resT)},1000);
  }
  function setResend(){
    const b=$('#resend'),h=$('#resend-hint');
    if(res>0){b.disabled=true;b.className='btn ghost-disabled';h.textContent='You can resend a new code in '+mmss(res)+'.'}
    else{b.disabled=false;b.className='btn secondary';h.textContent='Didn’t get it? Check your spam folder or resend.'}
  }
  function showOtpErr(m){const e=$('#otp-error');e.textContent=m;e.style.display='block';otpWrap.classList.add('invalid')}
  $('#resend').addEventListener('click',async()=>{
    const b=$('#resend');b.disabled=true;
    try{await Auth.resendOtp(state.email,state.mode);startOtp();toast('New code sent to '+state.email)}
    catch(err){b.disabled=false;toast(err.status===429?'Please wait before requesting another code.':err.status===503||err.status===502?(err.message||'We could not send the email.'):'Could not send a new code. Please try again.')}
  });
  $('#otp-form').addEventListener('submit',async e=>{
    e.preventDefault();const code=boxes.map(b=>b.value).join('');
    if(code.length<6){showOtpErr('Enter all 6 digits.');return}
    const vb=$('#verify');vb.disabled=true;
    try{
      const r=await Auth.verifyOtp(state.email,code,state.mode==='reset'?'reset':'register');
      stopTimers();
      if(state.mode==='reset'){state.resetToken=r.resetToken;show('reset')}else show('done');
    }catch(err){vb.disabled=exp<=0;showOtpErr(err.code==='otp_expired'?'This code has expired. Request a new one.':err.code==='otp_locked'||(err.code==='otp_invalid'&&err.attemptsLeft===0)?'Too many incorrect attempts. Request a new code.':err.status===429?'Too many attempts. Please wait a few minutes.':'That code is incorrect. Check the email and try again.')}
  });
  $('#change-email').addEventListener('click',()=>show(state.mode==='reset'?'forgot':'reg1'));
  $('#back-reg').addEventListener('click',()=>{if(state.mode==='reset'){state.mode='register';show('login')}else show('reg2')});
  $('#to-login').addEventListener('click',()=>{state.mode='register';show('login')});
  $('#to-home').addEventListener('click',()=>{location.hash='#home'});


  // demo helper (only when BD_CONFIG.USE_MOCK is true): shows which OTP code is accepted
  if(BD_CONFIG.USE_MOCK){
    $('#demo-otp').hidden=false;$('#demo-otp').textContent='Demo mode: use code '+BD_CONFIG.MOCK_OTP+'.';
  }

  function route(){
    const h=location.hash.slice(1);
    if(h==='register'){state.mode='register';show('reg1')}
    else if(h==='login'){state.mode='register';show('login')}
    else if(h==='forgot'){state.mode='reset';show('forgot')}
    else{
      stopTimers();authEl.hidden=true;landing.hidden=false;document.title=LANDING_TITLE;
      if(h==='home'||h===''){window.scrollTo(0,0)}
    }
  }
  window.addEventListener('hashchange',route);
  route();
})();
