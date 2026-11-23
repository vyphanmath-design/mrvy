// pages/api/rpc.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://sflozzrvmthxaojxqboo.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (!key) {
    throw new Error('Chưa cài đặt SUPABASE_SERVICE_ROLE_KEY trong mục Environment Variables của Vercel!');
  }
  return createClient(url, key);
}

// --- HÀM VƯỢT GIỚI HẠN 1000 DÒNG CỦA SUPABASE (LẤY TOÀN BỘ 100% DỮ LIỆU) ---
async function fetchAllRows(supabase, tableName, orderCol = 'id', ascending = true) {
  let allData = [];
  let from = 0;
  const step = 1000;

  while (true) {
    let query = supabase.from(tableName).select('*');
    if (orderCol) {
      query = query.order(orderCol, { ascending });
    }
    const { data, error } = await query.range(from, from + step - 1);
    if (error || !data || data.length === 0) break;

    allData = allData.concat(data);
    if (data.length < step) break; // Đã lấy hết trang cuối
    from += step;
  }

  return allData;
}

// --- HÀM TRỢ GIÚP DÙNG CHUNG ---
function formatStudentId(id) {
  if (!id && id !== 0) return '';
  const clean = String(id).trim().replace(/\D/g, '').replace(/^0+/, '');
  if (clean === '') return String(id).trim().replace(/'/g, '');
  return ('000' + clean).slice(-3);
}

function formatPhone(val) {
  if (!val && val !== 0) return '';
  const s = String(val).replace(/\D/g, '').trim();
  if (!s) return '';
  return s.startsWith('0') ? s : '0' + s;
}

// ĐĂNG NHẬP HS: ID = SĐT; mã HS vẫn là khóa nội bộ cho điểm danh/học phí.
// Mật khẩu mặc định "123" chỉ hợp lệ trước khi HS đổi mật khẩu.
function studentPasswordDigest_(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function studentPasswordHash_(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + studentPasswordDigest_(password, salt);
}
function verifyStudentPassword_(password, stored) {
  const value = String(stored || '').trim();
  if (!value) return String(password) === '123';
  const m = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/i.exec(value);
  if (!m) return false;
  const actual = Buffer.from(studentPasswordDigest_(password,m[1]), 'hex');
  const expected = Buffer.from(m[2], 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function studentPhone_(value) {
  const p = formatPhone(value);
  return /^0\d{9}$/.test(p) ? p : '';
}

// Nghỉ học: kiểm tra RIÊNG trạng thái và ghi chú. Hồ sơ nghỉ tạm vẫn có trong hoc_sinh.
// Không dùng ghi chú thông thường để xác định nghỉ học (chỉ nhãn nghỉ rõ ràng).
function studentInactive_(row) {
  const plain = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase();
  const status = plain(row?.trang_thai);
  const note = plain(row?.ghi_chu);
  return /NGHI/.test(status) || /\bDA\s+NGHI\s+HOC\b|\bNGHI\s+TU\s+NGAY\b/.test(note);
}

// Thu hồi token khi học sinh nghỉ; mã HS giữ nguyên, không ảnh hưởng hồ sơ/học phí.
async function revokeStudentSessions_(supabase, studentId) {
  const id = formatStudentId(studentId);
  if (!id) return;
  const { error } = await supabase.from('mrvy_sessions').delete()
    .eq('username', id).eq('role', 'STUDENT');
  if (error) throw new Error('Không thu hồi được phiên học sinh đã nghỉ: ' + error.message);
}

function cleanName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function toStandardDateStr(dStr) {
  if (!dStr) return '';
  const str = String(dStr).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${('0' + parts[1]).slice(-2)}-${('0' + parts[0]).slice(-2)}`;
    }
  }
  return str.includes('T') ? str.split('T')[0] : str;
}

function getTodayVN() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

function getNowDateTimeVN() {
  const now = new Date();
  const datePart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  return `${datePart} ${timePart}`;
}

function hashPassword_(password) {
  const rawPass = String(password || '').trim();
  return crypto.createHash('sha256').update(rawPass, 'utf8').digest('hex');
}

// PHIÊN ĐĂNG NHẬP BỀN VỮNG: token ngẫu nhiên lưu trên Supabase, không tự hết hạn.
// Chạy file tao_bang_phien_dang_nhap.sql trong Supabase SQL Editor trước khi triển khai.
async function createPersistentSession_(supabase, userObj) {
  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await supabase.from('mrvy_sessions').insert({
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    username: String(userObj.username || ''),
    name: String(userObj.name || ''),
    role: String(userObj.role || 'STUDENT').toUpperCase().trim()
  });
  if (error) throw new Error('Không tạo được phiên đăng nhập: ' + error.message);
  return token;
}

async function verifySessionToken_(supabase, token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase
    .from('mrvy_sessions')
    .select('username,name,role')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new Error('Không kiểm tra được phiên đăng nhập: ' + error.message);
  if (!data) return null;
  // Mỗi lần kiểm tra phiên HS đều xác minh trạng thái hiện tại: token cũ cũng bị khóa.
  if (String(data.role || '').toUpperCase().trim() === 'STUDENT') {
    const id = formatStudentId(data.username);
    const { data: student, error: stuError } = await supabase.from('hoc_sinh')
      .select('ma_hs,trang_thai,ghi_chu').eq('ma_hs', id).maybeSingle();
    if (stuError) throw new Error('Không xác minh được trạng thái học sinh: ' + stuError.message);
    if (!student || studentInactive_(student)) return null;
  }
  return { username: data.username, name: data.name, role: data.role };
}

async function requireRole_(supabase, token, allowedRoles) {
  const session = await verifySessionToken_(supabase, token);
  if (!session) {
    throw new Error('Từ chối truy cập: Phiên đăng nhập đã hết hạn hoặc không hợp lệ!');
  }
  const role = String(session.role || '').toUpperCase().trim();
  if (allowedRoles.indexOf(role) === -1) {
    throw new Error('Từ chối truy cập: Tài khoản của bạn không có quyền thực hiện hành động này!');
  }
  return session;
}

async function clearStudentDataFromDB_(supabase, studentId) {
  const targetId = formatStudentId(studentId);
  if (!targetId) return;
  await Promise.all([
    supabase.from('diem_danh').delete().eq('ma_hs', targetId),
    supabase.from('hoc_phi').delete().eq('ma_hs', targetId),
    supabase.from('cau_hinh').delete().eq('loai', 'STUDENT').eq('key', targetId)
  ]);
}

// MRVY - Nghỉ học: chốt nợ vào ghi chú rồi giữ nguyên cơ chế xóa lịch sử học phí và điểm danh cũ.
function leaveDateLabel_(dateISO) {
  const m = String(dateISO).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `Nghỉ từ ngày ${m[3]}/${m[2]}/${m[1]}` : '';
}
function stripLeaveDate_(note) {
  return String(note || '').replace(/\n?Nghỉ từ ngày \d{2}\/\d{2}\/\d{4}(?=\s|$)/gi, '').trim();
}
function withLeaveDate_(note) {
  const clean = stripLeaveDate_(note);
  const suffix = leaveDateLabel_(getTodayVN());
  return clean ? clean + '\n' + suffix : suffix;
}
function withDebtSnapshot_(note, debtSnapshot) {
  let s = String(note || '').trim();
  const debt = String(debtSnapshot || '').trim();
  if (!debt) return s;
  if (!/^\[NỢ HP:\s*[\s\S]*\]$/.test(debt) || debt.length > 1500) throw new Error('Dữ liệu chốt nợ không hợp lệ');
  return (s.replace(/\[NỢ HP:[^\]]*\]/g, '').trim() + '\n' + debt).trim();
}
function mapArchiveStudent_(r) {
  return {
    id: String(r.ma_hs || '').trim().replace(/'/g,''),
    date: toStandardDateStr(r.thoi_gian), name: String(r.ho_va_ten || '').trim(),
    grade: String(r.truong_khoi || '').trim(), className: String(r.lop || '').trim(),
    school: String(r.truong || '').trim(), phone: formatPhone(r.sdt_hs),
    parentPhone: formatPhone(r.sdt_phu_huynh),
    parentName: String(r.ten_phu_huynh || '').trim(),
    parentRelation: String(r.quan_he_phu_huynh || '').trim(),
    note: String(r.ghi_chu || '').trim(), statusNghi: String(r.trang_thai || 'ĐÃ NGHỈ HỌC').trim(),
    startMonth: String(r.thang_bat_dau || '').trim(),
    nguoi_gioi_thieu: String(r.nguoi_gioi_thieu || '').trim()
  };
}
async function readArchiveRows_(supabase) {
  const results = [];
  for (let offset = 0; ; offset += 1000) {
    const {data,error} = await supabase.from('hoc_sinh_nghi').select('*')
      .order('id', {ascending:true}).range(offset,offset+999);
    if (error) throw new Error('Không đọc được kho hoc_sinh_nghi: ' + error.message);
    if (!Array.isArray(data)) throw new Error('Dữ liệu kho nghỉ không hợp lệ');
    results.push(...data);
    if (data.length < 1000) break;
  }
  return results;
}
async function archiveOneStudent_(supabase, studentId) {
  const targetId = formatStudentId(studentId);
  if (!targetId) throw new Error('Mã học sinh không hợp lệ');
  const {data:original,error:readErr} = await supabase.from('hoc_sinh')
    .select('*').eq('ma_hs',targetId).maybeSingle();
  if (readErr) throw new Error('Không đọc được hồ sơ: '+readErr.message);
  if (!original) throw new Error('Không tìm thấy học sinh '+targetId+' trong bảng đang học');
  if (!String(original.trang_thai || '').toUpperCase().includes('NGHỈ'))
    throw new Error('Cần chuyển học sinh sang trạng thái nghỉ tạm thời và chốt ghi chú nợ trước khi lưu kho lâu dài');
  const {data:already,error:duplicateErr} = await supabase.from('hoc_sinh_nghi')
    .select('id').eq('ma_hs',targetId).limit(1);
  if (duplicateErr) throw new Error('Không đối chiếu được kho nghỉ: '+duplicateErr.message);
  if (already && already.length) throw new Error('Mã '+targetId+' đã có trong kho nghỉ. Không chuyển trùng hồ sơ.');
  const {id,...copy} = original;
  // Học sinh nghỉ từ trước khi bổ sung tính năng ngày nghỉ thì không tự gán sai ngày hôm nay.
  // Ngày nghỉ chỉ được ghi lúc bấm 'Xóa' -> nghỉ tạm thời.
  const newNote = String(copy.ghi_chu || '');
  const {data:inserted,error:insertErr} = await supabase.from('hoc_sinh_nghi')
    .insert({...copy, ghi_chu:newNote, trang_thai:'ĐÃ NGHỈ HỌC'}).select('ma_hs');
  if (insertErr || !inserted || inserted.length!==1) throw new Error('Chưa sao lưu được hồ sơ '+targetId+': '+(insertErr?.message||'không có xác nhận'));
  // Chỉ xóa HỒ SƠ khỏi hoc_sinh sau khi bản sao tại hoc_sinh_nghi đã được xác nhận.
  const {data:deleted,error:delErr} = await supabase.from('hoc_sinh')
    .delete().eq('ma_hs',targetId).select('ma_hs');
  if (delErr || !deleted || deleted.length!==1) throw new Error('Đã sao lưu nhưng chưa chuyển xong hồ sơ '+targetId+'; kiểm tra bản trùng: '+(delErr?.message||''));
  await revokeStudentSessions_(supabase,targetId);
  // Giữ cơ chế cũ: khi chuyển nghỉ lâu dài cũng không để lịch sử cá nhân trên các bảng đang học.
  await clearStudentDataFromDB_(supabase, targetId);
}
async function restoreArchivedOne_(supabase, studentId, className) {
  const targetId = formatStudentId(studentId);
  const cl = String(className || '').trim();
  if (!targetId || !cl || cl.length>80) throw new Error('Mã học sinh hoặc tên lớp không hợp lệ');
  const {data:archived,error:readErr} = await supabase.from('hoc_sinh_nghi')
    .select('*').eq('ma_hs',targetId).maybeSingle();
  if (readErr || !archived) throw new Error('Không tìm thấy hồ sơ kho nghỉ: '+(readErr?.message||targetId));
  const {data:found,error:checkErr} = await supabase.from('hoc_sinh')
    .select('id').eq('ma_hs',targetId).limit(1);
  if (checkErr) throw new Error(checkErr.message);
  if (found && found.length) throw new Error('Mã '+targetId+' đã có trong danh sách học. Không tạo trùng.');
  const {id,...rest}=archived;
  const m=cl.match(/\d+/);
  const row={...rest, lop:cl, truong_khoi: m ? 'Khối '+m[0] : rest.truong_khoi,
    trang_thai:'', ghi_chu:'', thang_bat_dau:''};
  const {data:created,error:addErr}=await supabase.from('hoc_sinh').insert(row).select('ma_hs');
  if (addErr || !created || created.length!==1) throw new Error('Chưa khôi phục được hồ sơ '+targetId+': '+(addErr?.message||''));
  const {data:deleted,error:delErr}=await supabase.from('hoc_sinh_nghi').delete()
    .eq('ma_hs',targetId).select('ma_hs');
  if (delErr || !deleted || deleted.length!==1) throw new Error('Đã chép vào lớp nhưng chưa xóa bản kho nghỉ. Cần kiểm tra trùng mã '+targetId);
  // Học sinh vào lớp lại như bắt đầu mới: không giữ ghi chú, nợ đã chốt hoặc mốc tháng cũ.
}
function parseFrozenDebt_(note) {
  const raw=String(note||'');
  const match=raw.match(/\[NỢ HP:\s*([^|\]]+)(?:\|\s*([^\]]*))?\]/);
  if (!match) return null;
  return {match:match[0], amount:Number(String(match[1]).replace(/\D/g,''))||0,
    detail:String(match[2]||'').trim()};
}
async function recordLeavePayment_(supabase, table, studentId, amount, user, paymentNote) {
  const targetId=formatStudentId(studentId);
  const money=Number(amount);
  if (!Number.isSafeInteger(money)||money<=0) throw new Error('Số tiền thu phải là số nguyên dương');
  const {data:stu,error:readErr}=await supabase.from(table).select('ghi_chu,trang_thai')
    .eq('ma_hs',targetId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!stu) return false;
  if (table==='hoc_sinh' && !String(stu.trang_thai||'').toUpperCase().includes('NGHỈ'))
    throw new Error('Học sinh chưa nghỉ, hãy dùng quy trình thu học phí bình thường');
  const originalNote=String(stu.ghi_chu||'');
  const debt=parseFrozenDebt_(originalNote);
  if (!debt || debt.amount<=0) throw new Error('Học sinh không có khoản nợ chốt khi nghỉ');
  if (money>debt.amount) throw new Error('Số tiền vượt quá số nợ còn lại');
  const remaining=debt.amount-money;
  const formatted=remaining.toLocaleString('vi-VN');
  const updatedDebt='[NỢ HP: '+formatted+' đ | '+(debt.detail||'Nợ đã chốt khi nghỉ')+']';
  const detail=String(paymentNote||'').replace(/[\r\n\[\]]/g,' ').trim().slice(0,200);
  const ledger='[THU SAU NGHỈ: '+getNowDateTimeVN()+' | '+money.toLocaleString('vi-VN')+' đ | '+String(user.name||user.username||'Admin').slice(0,60)+(detail?' | '+detail:'')+']';
  const base=originalNote.replace(debt.match,updatedDebt).trim();
  const dateLine=base.match(/(?:^|\n)(Nghỉ từ ngày \d{2}\/\d{2}\/\d{4})\s*$/i);
  const newNote=dateLine
    ? base.slice(0, dateLine.index).trim()+'\n'+ledger+'\n'+dateLine[1]
    : base+'\n'+ledger;
  let query=supabase.from(table).update({ghi_chu:newNote}).eq('ma_hs',targetId);
  query=stu.ghi_chu===null ? query.is('ghi_chu',null) : query.eq('ghi_chu',stu.ghi_chu);
  const {data:updated,error:writeErr}=await query.select('ma_hs');
  if (writeErr) throw new Error(writeErr.message);
  if (!updated || updated.length!==1) throw new Error('Ghi chú đã được sửa ở phiên khác; chưa ghi nhận khoản thu. Hãy tải lại.');
  return true;
}

async function getInitialData(supabase, token) {
  let serverRole = null;
  const sess = await verifySessionToken_(supabase, token);
  if (sess) serverRole = sess.role;

  // Lấy toàn bộ dữ liệu ở tất cả các bảng (không bị cắt ở 1.000 dòng)
  const [
    chData,
    hsData,
    ddData,
    hpData,
    cnxData,
    bvData,
    ldData,
    dktData,
    cpData
  ] = await Promise.all([
    fetchAllRows(supabase, 'cau_hinh', 'id', true),
    fetchAllRows(supabase, 'hoc_sinh', 'id', true),
    fetchAllRows(supabase, 'diem_danh', 'id', true),
    fetchAllRows(supabase, 'hoc_phi', 'id', true),
    fetchAllRows(supabase, 'cong_no_xoa', 'id', true),
    fetchAllRows(supabase, 'bai_viet', 'id', false),
    fetchAllRows(supabase, 'lich_day', null, true),
    fetchAllRows(supabase, 'diem_kiem_tra', 'id', true),
    fetchAllRows(supabase, 'chi_phi', 'id', true)
  ]);
  // Kho nghỉ dài hạn - chỉ trả về cho Admin; không nhầm với danh sách nghỉ tạm thời.
  const archivedStudents = String(serverRole || '').toUpperCase() === 'ADMIN'
    ? (await readArchiveRows_(supabase)).map(mapArchiveStudent_) : [];

// Map dữ liệu chi phí trả về client
  const expenses = (cpData || []).map((r) => ({
    id: r.id,
    khoanChi: String(r.khoan_chi || '').trim(),
    noiDung: String(r.noi_dung || '').trim(),
    soTien: Number(r.so_tien) || 0,
    ngayChi: String(r.ngay_chi || '').trim(),
    ghiChu: String(r.ghi_chu || '').trim(),
    thang: String(r.thang || '').trim(),
    maHsDuocGioiThieu: String(r.ma_hs_duoc_gioi_thieu || '').trim(),
    loaiChi: String(r.loai_chi || '').trim() || (/^\d{1,6}$/.test(String(r.ma_hs_duoc_gioi_thieu || '').trim()) ? 'GIOI_THIEU' : 'KHAC')
  }));
  
  let avatarUrl = '';
  const customRates = [];
  (chData || []).forEach((r) => {
    const loai = String(r.loai || '').trim().toUpperCase();
    if (loai === 'AVATARURL' || loai === 'AVATAR') {
      avatarUrl = r.key || '';
    } else if (loai === 'GRADE' || loai === 'CLASS' || loai === 'STUDENT') {
      customRates.push({
        type: loai,
        key: String(r.key || '').trim().replace(/'/g, ''),
        month: String(r.thang || '').trim(),
        amount: Number(r.muc_gia) || 0
      });
    }
  });

  const students = (hsData || []).map((r, idx) => {
    let codeVal = String(r.ma_hs || '').trim().replace(/'/g, '');
    if (!codeVal) codeVal = ('000' + (idx + 1)).slice(-3);
    return {
      date: toStandardDateStr(r.thoi_gian),
      name: String(r.ho_va_ten || '').trim(),
      grade: String(r.truong_khoi || 'Khối 6').trim(),
      className: String(r.lop || '').trim(),
      phone: formatPhone(r.sdt_hs),
      passwordChanged: String(serverRole || '').toUpperCase() === 'ADMIN' ? Boolean(r.mat_khau_hash) : undefined,
      parentPhone: formatPhone(r.sdt_phu_huynh),
      parentName: String(r.ten_phu_huynh || '').trim(),
      parentRelation: String(r.quan_he_phu_huynh || '').trim(),
      id: codeVal,
      school: String(r.truong || '').trim(),
      note: String(r.ghi_chu || '').trim(),
      statusNghi: String(r.trang_thai || '').trim(),
      startMonth: String(r.thang_bat_dau || '').trim(),
      nguoi_gioi_thieu: String(r.nguoi_gioi_thieu || '').trim()
    };
  });

  // Trả về TOÀN BỘ tất cả các ngày điểm danh
  const attendance = [];
  (ddData || []).forEach((r) => {
    const dateStr = toStandardDateStr(r.ngay);
    if (dateStr) {
      attendance.push({
        date: dateStr,
        grade: String(r.lop_khoi || '').trim(),
        status: String(r.trang_thai || 'Có mặt').trim(),
        note: String(r.ghi_chu || '').trim(),
        studentId: formatStudentId(r.ma_hs)
      });
    }
  });

  const tuition = (hpData || []).map((r) => ({
    date: toStandardDateStr(r.ngay_thu),
    amount: Number(r.so_tien) || 0,
    method: String(r.hinh_thuc || 'Tiền mặt').trim(),
    month: String(r.thang || '').trim(),
    className: String(r.lop || '').trim(),
    note: String(r.ghi_chu || '').trim(),
    studentId: formatStudentId(r.ma_hs)
  }));

  const dismissedKeys = (cnxData || []).map((r) => String(r.item_key || '').trim()).filter(Boolean);

  const posts = (bvData || []).map((r) => ({
    id: r.ma_bai,
    date: r.ngay_dang,
    title: r.tieu_de,
    type: r.loai || 'Thông báo',
    content: r.noi_dung || '',
    link: r.link || '',
    author: r.nguoi_dang || 'Thầy Hoài Vy',
    grade: r.khoi || 'Tất cả khối',
    pdfData: r.file_pdf_data || ''
  }));

  const scheduleNote = { tkbData: {}, noteTruong: [], noteNha: [], customStats: [] };
  let wheelPrizes = [];
  (ldData || []).forEach((r) => {
    const key = String(r.key_type || '').trim();
    const val = String(r.content_json || '');
    if (val) {
      try {
        if (key === 'NOTE_TRUONG') scheduleNote.noteTruong = JSON.parse(val);
        else if (key === 'NOTE_NHA') scheduleNote.noteNha = JSON.parse(val);
        else if (key === 'TKB_DATA') scheduleNote.tkbData = JSON.parse(val);
        else if (key === 'CUSTOM_STATS') scheduleNote.customStats = JSON.parse(val);
        else if (key === 'WHEEL_PRIZES') { const parsed = JSON.parse(val); if (Array.isArray(parsed)) wheelPrizes = parsed.filter(p => typeof p === 'string'); }
      } catch (e) {}
    }
  });

  const examScores = (dktData || []).map((r) => ({
    examId: String(r.ma_bai || '').trim(),
    examName: String(r.ten_bai || '').trim(),
    term: String(r.dot || 'Cả năm').trim(),
    examDate: String(r.ngay_kt || '').trim(),
    className: String(r.lop || '').trim(),
    studentId: formatStudentId(r.ma_hs),
    score: String(r.diem !== null && r.diem !== undefined ? r.diem : '').trim(),
    note: String(r.ghi_chu || '').trim(),
    published: r.cong_bo !== false
  }));

  return {
    serverRole,
    students,
    attendance,
    tuition,
    avatarUrl,
    customRates,
    dismissedKeys,
    posts,
    scheduleNote,
    examScores,
    expenses,
    archivedStudents,
    wheelPrizes
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, args = [] } = req.body || {};

  try {
    const supabase = getSupabase();

    if (action === 'createGuestSession') {
      const guestUser = { username: 'guest', name: 'Khách', role: 'GUEST' };
      const token = await createPersistentSession_(supabase, guestUser);
      return res.status(200).json({ result: { success: true, token, user: guestUser } });
    }

    switch (action) {
      case 'checkLogin': {
        const [username, password] = args;
        const u = String(username || '').trim();
        const p = String(password || '');
        const hashedInputPass = hashPassword_(p);

        // Giáo viên / Trợ giảng: giữ nguyên cách đăng nhập đang dùng.
        const accList = await fetchAllRows(supabase, 'tai_khoan', 'id', true);
        for (const acc of accList || []) {
          const sheetUser = String(acc.tai_khoan || '').trim();
          const sheetPass = String(acc.mat_khau || '').trim();
          const sheetName = acc.ho_ten;
          const sheetRole = String(acc.phan_quyen || 'STUDENT').toUpperCase().trim();
          if (sheetRole !== 'ADMIN' && sheetRole !== 'ASSISTANT') continue;
          // SĐT 10 số của HS không được đối chiếu 3 số cuối với ID Admin/Trợ giảng.
          const exactAdminUser = sheetUser.toLowerCase() === u.toLowerCase();
          const legacyShortId = !/^0\d{9}$/.test(u.replace(/\s/g,'')) &&
            formatStudentId(sheetUser) === formatStudentId(u);
          if (exactAdminUser || legacyShortId) {
            const isValid = hashedInputPass === sheetPass ||
              (sheetPass.length >= 16 && hashedInputPass.startsWith(sheetPass)) || p === sheetPass;
            if (!isValid) return res.json({ result: { success:false, message:'Mật khẩu không chính xác!' } });
            const userObj = {username:sheetUser, name:sheetName, role:sheetRole};
            const token = await createPersistentSession_(supabase,userObj);
            return res.json({result:{success:true,token,user:userObj}});
          }
        }

        // Học sinh: chỉ dùng SĐT chính chủ làm ID, không cho đăng nhập vòng bằng mã HS.
        const loginPhone = studentPhone_(u);
        if (!loginPhone || !/^0\d{9}$/.test(u.replace(/\s/g,''))) {
          return res.json({result:{success:false,message:'Học sinh đăng nhập bằng số điện thoại 10 số; tra cứu tên vẫn dùng như cũ.'}});
        }
        // Dữ liệu cũ có thể có SĐT thiếu số 0/định dạng không đồng nhất.
        // Chỉ đọc trên máy chủ, chuẩn hóa trước khi xác định đúng một tài khoản.
        const students = [];
        for (let offset=0;;offset+=1000) {
          const {data,error} = await supabase.from('hoc_sinh')
            .select('ma_hs,ho_va_ten,sdt_hs,mat_khau_hash,trang_thai,ghi_chu')
            .order('id',{ascending:true}).range(offset,offset+999);
          if (error) throw new Error('Không đọc được danh sách xác thực học sinh: '+error.message);
          students.push(...(data || []));
          if (!data || data.length<1000) break;
        }
        // LỌC HS NGHỈ TRƯỚC khi kiểm tra SĐT trùng (kể cả nghỉ ghi trong ghi_chu).
        const matching = students.filter(s => !studentInactive_(s) && studentPhone_(s.sdt_hs) === loginPhone);
        if (matching.length !== 1) {
          return res.json({result:{success:false,message: matching.length === 0 ? 'SĐT này không thuộc học sinh đang học. Hãy kiểm tra lại hoặc liên hệ giáo viên.' : 'SĐT bị trùng giữa các học sinh đang học, cần giáo viên kiểm tra trước khi đăng nhập.'}});
        }
        const stu = matching[0];
        if (!verifyStudentPassword_(p,stu.mat_khau_hash)) {
          return res.json({result:{success:false,message:'Mật khẩu không chính xác!'}});
        }
        const userObj = {username: formatStudentId(stu.ma_hs), name: String(stu.ho_va_ten || '').trim(), role:'STUDENT'};
        const token = await createPersistentSession_(supabase,userObj);
        return res.json({result:{success:true,token,user:userObj}});
      }

      case 'validateSession': {
        const [token] = args;
        const sess = await verifySessionToken_(supabase, token);
        if (!sess) return res.json({ result: { success: false } });
        return res.json({
          result: {
            success: true,
            user: { username: sess.username, name: sess.name, role: sess.role }
          }
        });
      }

      case 'logoutSession': {
        const [token] = args;
        if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const { error } = await supabase.from('mrvy_sessions')
            .delete().eq('token_hash', tokenHash);
          if (error) throw new Error('Không thu hồi được phiên đăng nhập: ' + error.message);
        }
        return res.json({ result: { success: true } });
      }

      case 'changeUserPassword': {
        const [token, username, oldPassword, newPassword] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT', 'STUDENT']);
        const u = String(username || '').trim();
        const oldP = String(oldPassword || '').trim();
        const newP = String(newPassword || '').trim();
        const hashedOld = hashPassword_(oldP);
        const session = await verifySessionToken_(supabase, token);
        if (session && String(session.role).toUpperCase() === 'STUDENT') {
          // Không tin username gửi từ client; ràng buộc theo mã HS nằm trong token.
          const studentId = formatStudentId(session.username);
          if (!newP || newP.length < 6 || newP.length > 128) {
            return res.json({result:{success:false,message:'Mật khẩu mới phải dài 6–128 ký tự.'}});
          }
          const {data:student,error:readErr}=await supabase.from('hoc_sinh')
            .select('ma_hs,mat_khau_hash,trang_thai,ghi_chu').eq('ma_hs',studentId).maybeSingle();
          if (readErr) throw new Error('Không đọc được mật khẩu học sinh: '+readErr.message);
          if (!student || studentInactive_(student))
            return res.json({result:{success:false,message:'Tài khoản học sinh đã nghỉ học không được đăng nhập.'}});
          if (!verifyStudentPassword_(oldP, student.mat_khau_hash))
            return res.json({result:{success:false,message:'Mật khẩu cũ không đúng!'}});
          const newHash = studentPasswordHash_(newP);
          const {data:saved,error:saveErr}=await supabase.from('hoc_sinh')
            .update({mat_khau_hash:newHash}).eq('ma_hs',studentId).select('ma_hs');
          if (saveErr || !saved || saved.length !== 1) throw new Error('Không lưu được mật khẩu học sinh: '+(saveErr?.message || 'Không xác nhận được bản ghi'));
          // Thu hồi các phiên cũ, giữ phiên đang đổi mật khẩu.
          const activeHash=crypto.createHash('sha256').update(String(token)).digest('hex');
          const {error:revokeErr}=await supabase.from('mrvy_sessions').delete()
            .eq('username',studentId).eq('role','STUDENT').neq('token_hash',activeHash);
          if (revokeErr) throw new Error('Đã đổi mật khẩu nhưng không thu hồi được phiên cũ: '+revokeErr.message);
          return res.json({result:{success:true,message:'Đã đổi mật khẩu học sinh thành công!'}});
        }

        const accList = await fetchAllRows(supabase, 'tai_khoan', 'id', true);
        for (const acc of accList || []) {
          const sheetUser = String(acc.tai_khoan).trim();
          const sheetPass = String(acc.mat_khau).trim();
          const sheetRole = String(acc.phan_quyen || 'STUDENT').toUpperCase().trim();

          if (formatStudentId(sheetUser) === formatStudentId(u) || sheetUser.toLowerCase() === u.toLowerCase()) {
            const defaultPass = formatStudentId(sheetUser);
            const isValidOld =
              oldP === sheetPass ||
              hashedOld === sheetPass ||
              (sheetPass.length >= 16 && hashedOld.startsWith(sheetPass)) ||
              oldP === defaultPass ||
              oldP === sheetUser;

            if (!isValidOld) {
              return res.json({ result: { success: false, message: 'Mật khẩu cũ không đúng!' } });
            }

            const finalNewPass = sheetRole === 'ADMIN' || sheetRole === 'ASSISTANT' ? hashPassword_(newP) : newP;
            await supabase.from('tai_khoan').update({ mat_khau: finalNewPass }).eq('id', acc.id);
            return res.json({ result: { success: true, message: 'Đổi mật khẩu thành công!' } });
          }
        }

        await supabase.from('tai_khoan').insert({
          tai_khoan: u,
          mat_khau: newP,
          ho_ten: u,
          phan_quyen: 'STUDENT'
        });
        return res.json({ result: { success: true, message: 'Đã tạo và đổi mật khẩu mới thành công!' } });
      }

      case 'resetStudentPassword': {
        const [token, studentId] = args;
        await requireRole_(supabase,token,['ADMIN']);
        const id=formatStudentId(studentId);
        const {data:student,error:lookupErr}=await supabase.from('hoc_sinh')
          .select('ma_hs,trang_thai,ghi_chu').eq('ma_hs',id).maybeSingle();
        if (lookupErr) throw new Error('Không kiểm tra được học sinh: '+lookupErr.message);
        if (!student) throw new Error('Không tìm thấy học sinh trong danh sách đang học.');
        if (studentInactive_(student)) throw new Error('Học sinh đã nghỉ học, không có tài khoản đăng nhập để đặt lại mật khẩu.');
        const {data,error}=await supabase.from('hoc_sinh')
          .update({mat_khau_hash:null}).eq('ma_hs',id).select('ma_hs');
        if (error || !data || data.length !== 1) throw new Error('Không đặt lại được mật khẩu học sinh: '+(error?.message || 'Không tìm thấy học sinh'));
        await revokeStudentSessions_(supabase,id);
        return res.json({result:{success:true,message:'Đã đặt lại mật khẩu mặc định 123.'}});
      }

      case 'getInitialData': {
        const [token] = args;
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'saveStudent': {
        const [token, payload] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const list = Array.isArray(payload) ? payload : [payload];

        const { data: counterRow } = await supabase
          .from('tai_khoan')
          .select('id, bo_dem_ma_hs')
          .not('bo_dem_ma_hs', 'is', null)
          .limit(1)
          .single();

        let currentIdNum = counterRow && !isNaN(parseInt(counterRow.bo_dem_ma_hs, 10))
          ? parseInt(counterRow.bo_dem_ma_hs, 10)
          : 173;
        let nextIdNum = currentIdNum + 1;
        let finalAssignedId = currentIdNum;

        const todayStr = getTodayVN();
        const rowsToAdd = [];

        list.forEach((item) => {
          if (item && item.name) {
            if (nextIdNum > 999) nextIdNum = 1;
            const idStr = ('000' + nextIdNum).slice(-3);
            finalAssignedId = nextIdNum;
            nextIdNum++;

            rowsToAdd.push({
              thoi_gian: todayStr,
              ho_va_ten: item.name.trim(),
              truong_khoi: item.grade || '',
              lop: item.className || '',
              sdt_hs: formatPhone(item.phone),
              sdt_phu_huynh: formatPhone(item.parentPhone),
              ten_phu_huynh: String(item.parentName || '').trim(),
              quan_he_phu_huynh: String(item.parentRelation || '').trim(),
              ma_hs: idStr,
              truong: item.school || '',
              ghi_chu: item.note || '',
              trang_thai: '',
              thang_bat_dau: '',
              nguoi_gioi_thieu: String(item.nguoi_gioi_thieu || '').trim()
            });
          }
        });

        if (rowsToAdd.length > 0) {
          await supabase.from('hoc_sinh').insert(rowsToAdd);
          if (counterRow) {
            await supabase.from('tai_khoan').update({ bo_dem_ma_hs: finalAssignedId }).eq('id', counterRow.id);
          }
        }

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'updateStudent': {
        let token, studentData;
        if (args.length === 1 && typeof args[0] === 'object') {
          studentData = args[0];
          token = null;
        } else {
          [token, studentData] = args;
          await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        }

        const targetId = formatStudentId(studentData.id);
        const updatePayload = {
          ho_va_ten: studentData.name,
          truong_khoi: studentData.grade,
          lop: studentData.className,
          sdt_hs: formatPhone(studentData.phone),
          sdt_phu_huynh: formatPhone(studentData.parentPhone),
          truong: studentData.school || '',
          ghi_chu: studentData.note || ''
        };

        if (Object.prototype.hasOwnProperty.call(studentData, 'parentName')) {
          updatePayload.ten_phu_huynh = String(studentData.parentName || '').trim();
        }
        if (Object.prototype.hasOwnProperty.call(studentData, 'parentRelation')) {
          updatePayload.quan_he_phu_huynh = String(studentData.parentRelation || '').trim();
        }

        if (studentData.isRestore) {
          updatePayload.trang_thai = '';
          updatePayload.ghi_chu = '';
          updatePayload.thang_bat_dau = '';
        }

        await supabase.from('hoc_sinh').update(updatePayload).eq('ma_hs', targetId);
        if (!studentData.isRestore && studentInactive_({trang_thai:updatePayload.trang_thai,ghi_chu:updatePayload.ghi_chu})) {
          await revokeStudentSessions_(supabase,targetId);
        }

        const isWaiting =
          String(studentData.className || '').toUpperCase().includes('ĐỢI') ||
          String(studentData.className || '').toUpperCase().includes('DOI');
        if (isWaiting) await clearStudentDataFromDB_(supabase, targetId);

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'updateStudentClass': {
        const [token, studentId, studentName, newClass] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const targetId = formatStudentId(studentId);
        await supabase.from('hoc_sinh').update({ lop: newClass }).eq('ma_hs', targetId);

        const isWaiting =
          String(newClass || '').toUpperCase().includes('ĐỢI') ||
          String(newClass || '').toUpperCase().includes('DOI');
        if (isWaiting) await clearStudentDataFromDB_(supabase, targetId);

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'deleteStudentFromSheet': {
        // "Xóa" trên danh sách: nghỉ tạm thời. Ghi nợ vào ghi chú TRƯỚC, sau đó xóa phiếu thu + điểm danh như bản gốc.
        const [token, studentId, debtSnapshot] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const targetId = formatStudentId(studentId);
        const {data:stu,error:readErr}=await supabase.from('hoc_sinh')
          .select('ma_hs,ghi_chu').eq('ma_hs',targetId).maybeSingle();
        if (readErr || !stu) throw new Error('Không tìm thấy học sinh: '+(readErr?.message||targetId));
        const note=withLeaveDate_(withDebtSnapshot_(stu.ghi_chu,debtSnapshot));
        const {data:updated,error:writeErr}=await supabase.from('hoc_sinh')
          .update({trang_thai:'ĐÃ NGHỈ HỌC', ghi_chu:note})
          .eq('ma_hs',targetId).select('ma_hs');
        if (writeErr || !updated || updated.length!==1) throw new Error('Không cập nhật được trạng thái nghỉ: '+(writeErr?.message||''));
        await revokeStudentSessions_(supabase,targetId);
        // GIỮ NGUYÊN LOGIC GỐC: xóa điểm danh, phiếu thu cá nhân và cấu hình mức học phí cá nhân.
        await clearStudentDataFromDB_(supabase, targetId);
        const data=await getInitialData(supabase,token);
        return res.json({result:data});
      }

      case 'restoreTemporaryStudent': {
        const [token, studentId, newClass] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const targetId=formatStudentId(studentId), cl=String(newClass||'').trim();
        if (!targetId || !cl || cl.length>80) throw new Error('Mã học sinh hoặc tên lớp không hợp lệ');
        const {data:stu,error:readErr}=await supabase.from('hoc_sinh')
          .select('ghi_chu,trang_thai').eq('ma_hs',targetId).maybeSingle();
        if (readErr || !stu) throw new Error('Không tìm thấy học sinh');
        if (!String(stu.trang_thai||'').toUpperCase().includes('NGHỈ')) throw new Error('Học sinh chưa ở trạng thái nghỉ');
        const match=cl.match(/\d+/);
        const updated={trang_thai:'', lop:cl, ghi_chu:'', thang_bat_dau:''};
        if (match) updated.truong_khoi='Khối '+match[0];
        const {data:rows,error:writeErr}=await supabase.from('hoc_sinh').update(updated)
          .eq('ma_hs',targetId).select('ma_hs');
        if (writeErr || !rows || rows.length!==1) throw new Error('Không khôi phục được học sinh: '+(writeErr?.message||''));
        return res.json({result:await getInitialData(supabase,token)});
      }

      case 'archiveStudent': {
        const [token,studentId]=args;
        await requireRole_(supabase,token,['ADMIN']);
        await archiveOneStudent_(supabase,studentId);
        return res.json({result:await getInitialData(supabase,token)});
      }

      case 'archiveMultipleStudents': {
        const [token,studentIds]=args;
        await requireRole_(supabase,token,['ADMIN']);
        const uniqueIds=[...new Set((Array.isArray(studentIds)?studentIds:[]).map(formatStudentId))].filter(Boolean);
        if (!uniqueIds.length || uniqueIds.length>100) throw new Error('Danh sách cần chuyển kho không hợp lệ');
        for (const id of uniqueIds) await archiveOneStudent_(supabase,id);
        return res.json({result:await getInitialData(supabase,token)});
      }

      case 'restoreArchivedStudent': {
        const [token,studentId,className]=args;
        await requireRole_(supabase,token,['ADMIN']);
        await restoreArchivedOne_(supabase,studentId,className);
        return res.json({result:await getInitialData(supabase,token)});
      }

      case 'updateArchivedStudent': {
        const [token,payload]=args;
        await requireRole_(supabase,token,['ADMIN']);
        const id=formatStudentId(payload?.id);
        if (!id) throw new Error('Mã học sinh không hợp lệ');
        // Không cho API sửa tay nợ hay lịch sử thu: trường ghi_chu không nằm trong payload.
        const updates={
          ho_va_ten:String(payload.name||'').trim(),
          truong_khoi:String(payload.grade||'').trim(),lop:String(payload.className||'').trim(),
          truong:String(payload.school||'').trim(),
          sdt_hs:formatPhone(payload.phone),sdt_phu_huynh:formatPhone(payload.parentPhone),
          ten_phu_huynh:String(payload.parentName||'').trim(),
          quan_he_phu_huynh:String(payload.parentRelation||'').trim(),
          nguoi_gioi_thieu:String(payload.nguoi_gioi_thieu||'').trim()
        };
        if (!updates.ho_va_ten) throw new Error('Tên học sinh không được trống');
        const {data:updated,error}=await supabase.from('hoc_sinh_nghi').update(updates)
          .eq('ma_hs',id).select('ma_hs');
        if (error || !updated || updated.length!==1) throw new Error('Không cập nhật được hồ sơ nghỉ: '+(error?.message||id));
        return res.json({result:await getInitialData(supabase,token)});
      }

      // MRVY: Chỉ ADMIN được xác nhận xóa ghi chú nợ đã chốt của học sinh nghỉ.
      // Không ghi hoc_phi, không đụng diem_danh, chi_phi hay hoa hồng.
      case 'clearLeaveDebtNote': {
        const [token, studentId, location] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        const targetId = formatStudentId(studentId);
        const table = location === 'archived' ? 'hoc_sinh_nghi' :
                      location === 'temporary' ? 'hoc_sinh' : null;
        if (!targetId || !table) throw new Error('Mã học sinh hoặc nơi lưu hồ sơ không hợp lệ');
        const { data: stu, error: readErr } = await supabase.from(table)
          .select('ma_hs,ghi_chu,trang_thai').eq('ma_hs',targetId).maybeSingle();
        if (readErr || !stu) throw new Error('Không tìm thấy hồ sơ nghỉ: ' + (readErr?.message || targetId));
        if (table === 'hoc_sinh' && !/NGHỈ|NGHI/.test(String(stu.trang_thai || '').toUpperCase()))
          throw new Error('Chỉ được xóa ghi chú nợ cho học sinh đã nghỉ');
        const originalNote = String(stu.ghi_chu || '');
        const debt = parseFrozenDebt_(originalNote);
        if (!debt) throw new Error('Hồ sơ không có ghi chú nợ đã chốt để xóa');
        // Yêu cầu: chỉ còn dòng ngày nghỉ sau khi xóa ghi chú nợ.
        // Không tự tạo ngày mới vì có thể là hồ sơ nghỉ từ lâu.
        const dateMatch = originalNote.match(/Nghỉ từ ngày\s+\d{2}\/\d{2}\/\d{4}/i);
        const keepLeaveDate = dateMatch ? dateMatch[0].trim() : '';
        const { data: rows, error: writeErr } = await supabase.from(table)
          .update({ ghi_chu: keepLeaveDate })
          .eq('ma_hs', targetId).eq('ghi_chu', originalNote).select('ma_hs');
        if (writeErr) throw new Error('Không thể xóa ghi chú nợ: ' + writeErr.message);
        if (!rows || rows.length !== 1) throw new Error('Ghi chú vừa thay đổi ở phiên khác. Hãy tải lại rồi thử lại.');
        return res.json({ result: await getInitialData(supabase, token) });
      }

      case 'recordPostLeavePayment': {
        const [token,studentId,amount,note]=args;
        const user=await requireRole_(supabase,token,['ADMIN']);
        // Ghi vào ghi_chu hồ sơ nghỉ, không ghi hoc_phi, không cần bảng hoc_phi_sau_nghi.
        let recorded=await recordLeavePayment_(supabase,'hoc_sinh_nghi',studentId,amount,user,note);
        if (!recorded) recorded=await recordLeavePayment_(supabase,'hoc_sinh',studentId,amount,user,note);
        if (!recorded) throw new Error('Không tìm thấy học sinh nghỉ để ghi nhận thu nợ');
        return res.json({result:await getInitialData(supabase,token)});
      }

      case 'saveAttendance': {
        const [token, records] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        if (Array.isArray(records) && records.length > 0) {
          const toDelete = [];
          const toUpsert = [];
          const firstMonthUpdates = {};

          records.forEach((r) => {
            const stdDate = toStandardDateStr(r.date);
            const stdId = formatStudentId(r.studentId);
            const status = String(r.status || '').trim();
            const note = String(r.note || '').trim();
            const grade = String(r.grade || '').trim();

            if (!stdDate || !stdId) return;

            if (status.toLowerCase() === 'xoa') {
              toDelete.push({ ngay: stdDate, ma_hs: stdId });
            } else {
              toUpsert.push({
                ngay: stdDate,
                lop_khoi: grade,
                trang_thai: status,
                ghi_chu: note,
                ma_hs: stdId
              });

              if (status === 'Có mặt' || status === 'Học bù') {
                const dParts = stdDate.split('-');
                if (dParts.length === 3) {
                  const monthStr = `Tháng ${parseInt(dParts[1], 10)}/${dParts[0]}`;
                  if (!firstMonthUpdates[stdId]) firstMonthUpdates[stdId] = monthStr;
                }
              }
            }
          });

          for (const del of toDelete) {
            await supabase.from('diem_danh').delete().eq('ngay', del.ngay).eq('ma_hs', del.ma_hs);
          }

          if (toUpsert.length > 0) {
            await supabase.from('diem_danh').upsert(toUpsert, { onConflict: 'ngay,ma_hs' });
          }

          const stuIdsToCheck = Object.keys(firstMonthUpdates);
          if (stuIdsToCheck.length > 0) {
            const { data: hsRows } = await supabase
              .from('hoc_sinh')
              .select('ma_hs, thang_bat_dau')
              .in('ma_hs', stuIdsToCheck);

            for (const row of hsRows || []) {
              if (!row.thang_bat_dau || String(row.thang_bat_dau).trim() === '') {
                await supabase
                  .from('hoc_sinh')
                  .update({ thang_bat_dau: firstMonthUpdates[row.ma_hs] })
                  .eq('ma_hs', row.ma_hs);
              }
            }
          }
        }

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'getAttendanceByMonth': {
        const [token, monthStr] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT', 'STUDENT', 'GUEST']);
        const ddData = await fetchAllRows(supabase, 'diem_danh', 'id', true);
        const result = [];
        const targetMonth = String(monthStr || '').trim();

        (ddData || []).forEach((r) => {
          const dateStr = toStandardDateStr(r.ngay);
          if (!dateStr) return;
          const dParts = dateStr.split('-');
          if (dParts.length === 3) {
            const rowMonthStr = `Tháng ${parseInt(dParts[1], 10)}/${dParts[0]}`;
            if (!targetMonth || rowMonthStr === targetMonth) {
              result.push({
                date: dateStr,
                grade: String(r.lop_khoi || '').trim(),
                status: String(r.trang_thai || 'Có mặt').trim(),
                note: String(r.ghi_chu || '').trim(),
                studentId: formatStudentId(r.ma_hs)
              });
            }
          }
        });
        return res.json({ result });
      }

      case 'saveTuition': {
        const [token, feeData] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        const todayStr = getTodayVN();
        await supabase.from('hoc_phi').insert({
          ngay_thu: todayStr,
          so_tien: Number(feeData.amount) || 0,
          hinh_thuc: feeData.method || 'Tiền mặt',
          thang: feeData.month || '',
          lop: feeData.className || '',
          ghi_chu: feeData.note || '',
          ma_hs: formatStudentId(feeData.studentId)
        });
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'saveCustomTuitionRate': {
        const [token, type, key, month, amount] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        const numAmount = Number(amount) || 0;
        const upperType = String(type).trim().toUpperCase();
        const keyToSave = upperType === 'STUDENT' ? formatStudentId(key) : String(key).trim();
        const targetMonthClean = cleanName(month);

        const { data: existingList } = await supabase.from('cau_hinh').select('*').eq('loai', upperType);
        let foundId = null;
        for (const item of existingList || []) {
          const cellKeyClean = upperType === 'STUDENT' ? formatStudentId(item.key) : cleanName(item.key);
          const targetKeyClean = upperType === 'STUDENT' ? keyToSave : cleanName(keyToSave);
          if (cellKeyClean === targetKeyClean && cleanName(item.thang) === targetMonthClean) {
            foundId = item.id;
            break;
          }
        }

        if (foundId) {
          await supabase.from('cau_hinh').update({ key: keyToSave, muc_gia: numAmount }).eq('id', foundId);
        } else {
          await supabase.from('cau_hinh').insert({
            loai: upperType,
            key: keyToSave,
            thang: String(month).trim(),
            muc_gia: numAmount
          });
        }

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'saveTeacherAvatar': {
        let token = null, avatarDataUrl = '';
        if (args.length === 1) {
          avatarDataUrl = args[0];
        } else {
          [token, avatarDataUrl] = args;
        }
        const { data: existing } = await supabase.from('cau_hinh').select('id').eq('loai', 'AVATARURL').limit(1);
        if (existing && existing.length > 0) {
          await supabase.from('cau_hinh').update({ key: avatarDataUrl }).eq('id', existing[0].id);
        } else {
          await supabase.from('cau_hinh').insert({ loai: 'AVATARURL', key: avatarDataUrl, thang: '', muc_gia: 0 });
        }
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'uploadFileToDrive': {
        const [token, base64Data] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        return res.json({ result: base64Data });
      }

      case 'savePost': {
        const [token, postData] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const todayStr = getNowDateTimeVN();
        const postId = 'POST_' + Date.now();

        await supabase.from('bai_viet').insert({
          ma_bai: postId,
          ngay_dang: todayStr,
          tieu_de: postData.title || '',
          loai: postData.type || 'Thông báo',
          noi_dung: postData.content || '',
          link: postData.link || '',
          nguoi_dang: postData.author || 'Thầy Hoài Vy',
          khoi: postData.grade || 'Tất cả khối',
          file_pdf_data: postData.pdfData || ''
        });

        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'deletePost': {
        const [token, postId] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        await supabase.from('bai_viet').delete().eq('ma_bai', String(postId).trim());
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'saveLichDayAndNotes': {
        let [token, payload] = args;
        if (typeof token === 'object' && !payload) {
          payload = token;
          token = '';
        }
        if (payload) {
          await supabase.from('lich_day').upsert([
            { key_type: 'TKB_DATA', content_json: JSON.stringify(payload.tkbData || {}) },
            { key_type: 'NOTE_TRUONG', content_json: JSON.stringify(payload.noteTruong || []) },
            { key_type: 'NOTE_NHA', content_json: JSON.stringify(payload.noteNha || []) },
            { key_type: 'CUSTOM_STATS', content_json: JSON.stringify(payload.customStats || []) }
          ], { onConflict: 'key_type' });
        }
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }


      case 'saveExamScores': {
        const [token, payload] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        const list = Array.isArray(payload) ? payload : [];
        if (list.length > 0) {
          const rows = list.map((item) => ({
            ma_bai: String(item.examId || '').trim(),
            ten_bai: String(item.examName || '').trim(),
            dot: String(item.term || 'Cả năm').trim(),
            ngay_kt: String(item.examDate || '').trim(),
            lop: String(item.className || '').trim(),
            ma_hs: formatStudentId(item.studentId),
            diem: String(item.score !== undefined && item.score !== null ? item.score : '').trim(),
            ghi_chu: String(item.note || '').trim(),
            cong_bo: item.published !== false
          })).filter((r) => r.ma_bai && r.ma_hs);

          if (rows.length > 0) {
            await supabase.from('diem_kiem_tra').upsert(rows, { onConflict: 'ma_bai,ma_hs' });
          }
        }
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'togglePublishExam': {
        const [token, examId, isPublished] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        await supabase
          .from('diem_kiem_tra')
          .update({ cong_bo: Boolean(isPublished) })
          .eq('ma_bai', String(examId || '').trim());
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }


      // Chỉ ĐỌC tiền chi/hoa hồng trực tiếp từ Supabase. Không cập nhật, xóa hay ghi dữ liệu.
      case 'getExpensesSnapshot': {
        const [token] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        const rows = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await supabase.from('chi_phi')
            .select('id,khoan_chi,noi_dung,so_tien,ngay_chi,ghi_chu,thang,ma_hs_duoc_gioi_thieu,loai_chi')
            .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
          if (error) throw new Error('Không đọc được bảng chi_phi: ' + error.message);
          if (!Array.isArray(data)) throw new Error('Supabase không trả về dữ liệu chi_phi hợp lệ');
          rows.push(...data);
          if (data.length < pageSize) break;
        }
        return res.json({ result: { success: true, expenses: rows.map(r => ({
          id: r.id,
          khoanChi: String(r.khoan_chi || '').trim(),
          noiDung: String(r.noi_dung || '').trim(),
          soTien: Number(r.so_tien) || 0,
          ngayChi: String(r.ngay_chi || '').trim(),
          ghiChu: String(r.ghi_chu || '').trim(),
          thang: String(r.thang || '').trim(),
          maHsDuocGioiThieu: String(r.ma_hs_duoc_gioi_thieu || '').trim(),
          loaiChi: String(r.loai_chi || '').trim() || (/^\d{1,6}$/.test(String(r.ma_hs_duoc_gioi_thieu || '').trim()) ? 'GIOI_THIEU' : 'KHAC')
        })) } });
      }

      // Lưu tập trung qua API máy chủ; không gửi Supabase key xuống trình duyệt.
      case 'saveExpenses': {
        const [token, expenseList] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        if (!Array.isArray(expenseList)) throw new Error('Danh sách khoản chi không hợp lệ');
        if (expenseList.length > 2000) throw new Error('Vượt quá giới hạn 2.000 khoản chi/lần lưu');

        for (const exp of expenseList) {
          if (!exp || typeof exp !== 'object') throw new Error('Dữ liệu khoản chi không hợp lệ');
          const money = Number(exp.soTien);
          if (!Number.isFinite(money) || money < 0) throw new Error('Số tiền chi không hợp lệ');
          const row = {
            khoan_chi: String(exp.khoanChi || '').trim(),
            noi_dung: String(exp.noiDung || '').trim(),
            so_tien: money,
            ngay_chi: exp.ngayChi || null,
            ghi_chu: String(exp.ghiChu || '').trim(),
            thang: String(exp.thang || '').trim(),
            ma_hs_duoc_gioi_thieu: String(exp.maHsDuocGioiThieu || '').trim(),
            loai_chi: exp.loaiChi === 'GIOI_THIEU' ? 'GIOI_THIEU' : 'KHAC'
          };
          if (!row.thang) throw new Error('Thiếu tháng của khoản chi');
          let query;
          if (exp.id !== undefined && exp.id !== null && !String(exp.id).startsWith('CUST_')) {
            query = supabase.from('chi_phi').update(row).eq('id', exp.id).select('id');
          } else {
            query = supabase.from('chi_phi').insert(row).select('id');
          }
          const { data, error } = await query;
          if (error) throw new Error('Không thể lưu khoản chi: ' + error.message);
          if (!data || data.length !== 1) throw new Error('Không xác nhận được bản ghi khoản chi đã lưu');
        }
        const saved = await fetchAllRows(supabase, 'chi_phi', 'id', true);
        return res.json({ result: { success: true, expenses: saved.map(r => ({
          id: r.id,
          khoanChi: String(r.khoan_chi || ''),
          noiDung: String(r.noi_dung || ''),
          soTien: Number(r.so_tien) || 0,
          ngayChi: String(r.ngay_chi || '').slice(0, 10),
          ghiChu: String(r.ghi_chu || ''),
          thang: String(r.thang || ''),
          maHsDuocGioiThieu: String(r.ma_hs_duoc_gioi_thieu || ''),
          loaiChi: String(r.loai_chi || 'KHAC')
        })) } });
      }

      case 'saveWheelPrizes': {
        const [token, payload] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        if (!Array.isArray(payload) || payload.length < 1 || payload.length > 40 ||
            payload.some(p => typeof p !== 'string' || !p.trim() || p.trim().length > 80)) {
          throw new Error('Danh sách phần thưởng phải có 1–40 dòng, mỗi dòng tối đa 80 ký tự');
        }
        const prizes = payload.map(p => p.trim());
        const { error } = await supabase.from('lich_day').upsert({
          key_type: 'WHEEL_PRIZES', content_json: JSON.stringify(prizes)
        }, {onConflict: 'key_type'});
        if (error) throw new Error('Không thể lưu phần thưởng: ' + error.message);
        return res.json({result: {success: true, prizes}});
      }

      case 'deleteExpense': {
        const [token, expenseId] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        if (expenseId === undefined || expenseId === null || String(expenseId).startsWith('CUST_')) {
          throw new Error('ID khoản chi không hợp lệ');
        }
        const { data, error } = await supabase.from('chi_phi').delete().eq('id', expenseId).select('id');
        if (error) throw new Error('Không thể xóa khoản chi: ' + error.message);
        if (!data || data.length !== 1) throw new Error('Không tìm thấy khoản chi để xóa');
        return res.json({ result: { success: true } });
      }

      case 'deleteExamColumn': {
        const [token, examId] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        await supabase
          .from('diem_kiem_tra')
          .delete()
          .eq('ma_bai', String(examId || '').trim());
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }
        
      default:
        return res.status(400).json({ error: `Hàm ${action} chưa được khai báo!` });
    }
  } catch (err) {
    return res.status(200).json({
      result: { success: false, message: err.message || String(err) },
      error: err.message || String(err)
    });
  }
}
