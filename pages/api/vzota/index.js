// MRVY - pages/api/vzota/index.js. KHÔNG sửa /api/rpc hiện tại.
// Cài trên MRVY (Supabase A), dùng biến đã có SUPABASE_URL và SERVICE_ROLE_KEY.
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const digits = v => String(v || '').replace(/\D/g, '');
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const inactive = s => /(?:da\s*nghi\s*hoc|nghi\s*hoc|thoi\s*hoc)/.test(norm(`${s.trang_thai||''} ${s.ghi_chu||''}`));
const normalizeClass = v => String(v||'').trim().replace(/^lớp\s+/i,'').replace(/\s+/g,' ').replace(/^(10|11|12)\s+([a-zA-Z])/, '$1$2').toUpperCase();
function db() {
  const url=process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('MRVY chưa cấu hình Supabase server.');
  return createClient(url,key,{auth:{persistSession:false}});
}
function checkServer(req) {
  const expected=process.env.MRVY_VZOTA_SHARED_SECRET||'';
  const actual=String(req.headers['x-vzota-secret']||'');
  if(expected.length<32||actual.length!==expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
async function getStudentById(supabase,studentId) {
  const {data,error}=await supabase.from('hoc_sinh')
   .select('ma_hs,ho_va_ten,truong_khoi,lop,trang_thai,ghi_chu,sdt_hs')
   .eq('ma_hs',studentId).limit(2);
  if(error)throw error;
  if(!data||data.length!==1||inactive(data[0]))throw new Error('Học sinh không còn trong danh sách đang học MRVY.');
  return data[0];
}
async function getStudentByLogin(supabase,username){
  const raw=String(username||'').trim();
  if(!/^\d{1,12}$/.test(raw)) throw new Error('Tài khoản học sinh không có mã/SĐT hợp lệ.');
  const phone=digits(raw);
  const [byCode,byPhone]=await Promise.all([
   supabase.from('hoc_sinh').select('ma_hs').eq('ma_hs',raw).limit(3),
   supabase.from('hoc_sinh').select('ma_hs').eq('sdt_hs',phone).limit(3)
  ]);
  if(byCode.error)throw byCode.error;
  if(byPhone.error)throw byPhone.error;
  const ids=[...new Set([...(byCode.data||[]),...(byPhone.data||[])].map(x=>String(x.ma_hs)))];
  if(ids.length!==1)throw new Error(ids.length?'Một tài khoản khớp nhiều học sinh, cần kiểm tra SĐT.':'Không tìm thấy học sinh đang học.');
  return getStudentById(supabase,ids[0]);
}
function publicProfile(s){
  const className=normalizeClass(s.lop);
  const match=String(s.truong_khoi||'').match(/(?:^|\D)(10|11|12)(?:\D|$)/)
       || className.match(/^(10|11|12)(?:\D|$)/);
  return {studentId:String(s.ma_hs),name:String(s.ho_va_ten||'').trim(),
    grade:match?Number(match[1]):0,sourceGrade:String(s.truong_khoi||''),
    className,category:'home'};
}
async function allActiveClasses(supabase){
  let from=0, result=[];
  while(true){
    const {data,error}=await supabase.from('hoc_sinh')
      .select('truong_khoi,lop,trang_thai,ghi_chu').order('ma_hs',{ascending:true}).range(from,from+999);
    if(error)throw error;
    result.push(...(data||[]));
    if(!data||data.length<1000)break;
    from+=1000;
  }
  const map=new Map();
  for(const r of result){
    if(inactive(r))continue;
    const p=publicProfile({...r,ma_hs:'x'});
    if(!p.className)continue;
    const k=`${p.grade}\u0000${p.className}`;
    if(!map.has(k))map.set(k,{grade:p.grade,class_name:p.className,count:0});
    map.get(k).count++;
  }
  return [...map.values()].sort((a,b)=>a.grade-b.grade||a.class_name.localeCompare(b.class_name,'vi'));
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const action=String(req.body?.action||'');
    const supabase=db();
    if(action==='start'){
      const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
      if(!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Chưa đăng nhập MRVY.'});
      const {data:session,error}=await supabase.from('mrvy_sessions')
        .select('username,role').eq('token_hash',sha(token)).maybeSingle();
      if(error)throw error;
      if(!session||String(session.role).toUpperCase()!=='STUDENT')
        return res.status(403).json({error:'Chỉ học sinh đang đăng nhập MRVY được chuyển sang Vzota.'});
      const st=await getStudentByLogin(supabase,session.username);
      if(!String(st.lop||'').trim())return res.status(403).json({error:'Chưa xác định được lớp của học sinh MRVY.'});
      const code=crypto.randomBytes(32).toString('hex');
      const expires=new Date(Date.now()+90*1000).toISOString();
      const {error:writeErr}=await supabase.from('vzota_sso_codes').insert({code_hash:sha(code),ma_hs:st.ma_hs,expires_at:expires});
      if(writeErr)throw writeErr;
      return res.json({code,expiresInSeconds:90});
    }
    if(!checkServer(req))return res.status(403).json({error:'Không có quyền kết nối MRVY.'});
    if(action==='exchange'){
      const code=String(req.body?.code||'');
      if(!/^[a-f0-9]{64}$/.test(code))return res.status(400).json({error:'Mã chuyển tiếp không hợp lệ.'});
      // DELETE ... RETURNING: một mã chỉ đổi được 1 lần, trong tối đa 90 giây.
      const {data,error}=await supabase.from('vzota_sso_codes').delete()
        .eq('code_hash',sha(code)).gt('expires_at',new Date().toISOString()).select('ma_hs').maybeSingle();
      if(error)throw error;
      if(!data)return res.status(401).json({error:'Mã chuyển tiếp đã dùng hoặc hết hạn.'});
      const student=await getStudentById(supabase,data.ma_hs);
      return res.json({student:publicProfile(student)});
    }
    if(action==='classes')return res.json({classes:await allActiveClasses(supabase)});
    if(action==='score'){
      const d=req.body||{};
      const id=String(d.studentId||'').trim();
      const examId=String(d.examId||'').trim();
      const value=Number(d.score);
      if(!/^\d{1,12}$/.test(id)||!/^[-\w]{1,100}$/.test(examId)||!Number.isFinite(value)||value<0||value>10)
        return res.status(422).json({error:'Thông tin điểm không hợp lệ.'});
      const stu=await getStudentById(supabase,id);
      const name=String(d.examName||'Bài kiểm tra Vzota').slice(0,180);
      const maBai='VZOTA_'+examId;
      const gradeRow={ma_bai:maBai,ma_hs:String(stu.ma_hs),ten_bai:name,
        lop:String(stu.lop||''),diem:String(value),
        dot:'Cả năm',ngay_kt:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),
        ghi_chu:`Từ Vzota - mã đề ${String(d.examCode||'').slice(0,12)}`,cong_bo:true};
      const {error}=await supabase.from('diem_kiem_tra').upsert(gradeRow,{onConflict:'ma_bai,ma_hs'});
      if(error)throw error;
      return res.json({success:true,examId:maBai,studentId:id});
    }
    return res.status(400).json({error:'Hành động không được hỗ trợ.'});
  }catch(e){
    return res.status(400).json({error:e?.message||'Không xử lý được yêu cầu.'});
  }
}
