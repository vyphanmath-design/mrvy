// MRVY: Nút Vzota chỉ hiện với học sinh STUDENT đã đăng nhập.
// Thêm <script src="/vzota-launch.js" defer></script> trước </body> của HTML MRVY.
(function(){
  'use strict';
  const VZOTA_URL='https://web-tai-lieu-toan.vercel.app/';
  let requesting=false;
  async function goVzota(){
    if(requesting)return;
    const token=localStorage.getItem('authToken')||sessionStorage.getItem('authToken')||'';
    let user=null;try{user=JSON.parse(localStorage.getItem('savedUser')||'null');}catch{}
    if(!token||String(user?.role||'').toUpperCase()!=='STUDENT'){
      alert('Hãy đăng nhập tài khoản học sinh MRVY trước.');return;
    }
    requesting=true;
    const b=document.getElementById('mrvy-vzota-link');
    if(b)b.textContent='Đang xác thực...';
    try{
      const res=await fetch('/api/vzota',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({action:'start'})});
      const data=await res.json();
      if(!res.ok||!data.code)throw new Error(data.error||'Không tạo được mã chuyển tiếp.');
      const url=new URL(VZOTA_URL);url.searchParams.set('mrvy_code',data.code);
      location.assign(url.href);
    }catch(e){alert('Không vào được Vzota: '+e.message);}
    finally{requesting=false;if(b)b.textContent='📘 Vzota - Học và kiểm tra';}
  }
  function update(){
    if(!document.body)return;
    let b=document.getElementById('mrvy-vzota-link');
    let user=null;try{user=JSON.parse(localStorage.getItem('savedUser')||'null');}catch{}
    const visible=String(user?.role||'').toUpperCase()==='STUDENT' && !!(localStorage.getItem('authToken')||sessionStorage.getItem('authToken'));
    if(!b){
      b=document.createElement('button');b.type='button';b.id='mrvy-vzota-link';
      b.style.cssText='display:none;margin:7px auto;background:#2563eb;color:white;border:0;border-radius:12px;padding:11px 16px;font-weight:800;width:92%;text-align:center;';
      b.textContent='📘 Vzota - Học và kiểm tra';b.onclick=goVzota;
      const nav=document.getElementById('nav-overview') || document.getElementById('menu-tab-diemdanh');
      (nav?.parentElement||document.querySelector('#dashboardSection')||document.body).appendChild(b);
    }
    b.style.display=visible?'block':'none';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',update);
  else update();
  setInterval(update,1200);
})();
