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

// --- TẠO & GIẢI MÃ TOKEN TỰ THÂN ---
function createSelfToken_(userObj) {
  const payload = {
    username: String(userObj.username || ''),
    name: String(userObj.name || ''),
    role: String(userObj.role || 'STUDENT').toUpperCase().trim(),
    exp: Date.now() + 12 * 60 * 60 * 1000 // 12 tiếng
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

async function verifySessionToken_(supabase, token) {
  if (!token) return null;
  const cleanToken = String(token).trim();

  try {
    const decoded = Buffer.from(cleanToken, 'base64').toString('utf8');
    if (decoded.startsWith('{')) {
      const obj = JSON.parse(decoded);
      if (obj && obj.username && obj.role) {
        if (obj.exp && Date.now() > Number(obj.exp)) return null;
        return obj;
      }
    }
  } catch (e) {}

  try {
    const { data: sess } = await supabase
      .from('sessions')
      .select('*')
      .eq('token', cleanToken)
      .single();
    if (sess && (!sess.expires_at || Date.now() <= Number(sess.expires_at))) {
      return { username: sess.username, name: sess.name, role: sess.role };
    }
  } catch (e) {}

  return null;
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
    ldData
  ] = await Promise.all([
    fetchAllRows(supabase, 'cau_hinh', 'id', true),
    fetchAllRows(supabase, 'hoc_sinh', 'id', true),
    fetchAllRows(supabase, 'diem_danh', 'id', true),
    fetchAllRows(supabase, 'hoc_phi', 'id', true),
    fetchAllRows(supabase, 'cong_no_xoa', 'id', true),
    fetchAllRows(supabase, 'bai_viet', 'id', false),
    fetchAllRows(supabase, 'lich_day', null, true)
  ]);

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
      parentPhone: formatPhone(r.sdt_phu_huynh),
      id: codeVal,
      school: String(r.truong || '').trim(),
      note: String(r.ghi_chu || '').trim(),
      statusNghi: String(r.trang_thai || '').trim(),
      startMonth: String(r.thang_bat_dau || '').trim()
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
  (ldData || []).forEach((r) => {
    const key = String(r.key_type || '').trim();
    const val = String(r.content_json || '');
    if (val) {
      try {
        if (key === 'NOTE_TRUONG') scheduleNote.noteTruong = JSON.parse(val);
        else if (key === 'NOTE_NHA') scheduleNote.noteNha = JSON.parse(val);
        else if (key === 'TKB_DATA') scheduleNote.tkbData = JSON.parse(val);
        else if (key === 'CUSTOM_STATS') scheduleNote.customStats = JSON.parse(val);
      } catch (e) {}
    }
  });

  return {
    serverRole,
    students,
    attendance,
    tuition,
    avatarUrl,
    customRates,
    dismissedKeys,
    posts,
    scheduleNote
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, args = [] } = req.body || {};

  try {
    if (action === 'createGuestSession') {
      const guestUser = { username: 'guest', name: 'Khách', role: 'GUEST' };
      const token = createSelfToken_(guestUser);
      return res.status(200).json({ result: { success: true, token, user: guestUser } });
    }

    const supabase = getSupabase();

    switch (action) {
      case 'checkLogin': {
        const [username, password] = args;
        const u = String(username || '').trim();
        const p = String(password || '').trim();
        const hashedInputPass = hashPassword_(p);

        const accList = await fetchAllRows(supabase, 'tai_khoan', 'id', true);
        for (const acc of accList || []) {
          const sheetUser = String(acc.tai_khoan).trim();
          const sheetPass = String(acc.mat_khau).trim();
          const sheetName = acc.ho_ten;
          const sheetRole = String(acc.phan_quyen || 'STUDENT').toUpperCase().trim();

          if (formatStudentId(sheetUser) === formatStudentId(u) || sheetUser.toLowerCase() === u.toLowerCase()) {
            const defaultPass = formatStudentId(sheetUser);
            let isValid = false;
            if (sheetRole === 'ADMIN' || sheetRole === 'ASSISTANT') {
              isValid =
                hashedInputPass === sheetPass ||
                (sheetPass.length >= 16 && hashedInputPass.startsWith(sheetPass)) ||
                p === sheetPass;
            } else {
              isValid = p === defaultPass || p === sheetPass || p === sheetUser;
            }

            if (isValid) {
              const userObj = { username: sheetUser, name: sheetName, role: sheetRole || 'STUDENT' };
              const token = createSelfToken_(userObj);
              return res.json({ result: { success: true, token, user: userObj } });
            } else {
              return res.json({ result: { success: false, message: 'Mật khẩu không chính xác!' } });
            }
          }
        }

        const stuList = await fetchAllRows(supabase, 'hoc_sinh', 'id', true);
        for (const stu of stuList || []) {
          const stuId = String(stu.ma_hs || '').trim();
          const stuName = String(stu.ho_va_ten || '').trim();
          if (stuId !== '' && formatStudentId(stuId) === formatStudentId(u)) {
            const defaultPass = formatStudentId(stuId);
            if (p === defaultPass || p === stuId) {
              const userObj2 = { username: defaultPass, name: stuName, role: 'STUDENT' };
              const token2 = createSelfToken_(userObj2);
              return res.json({ result: { success: true, token: token2, user: userObj2 } });
            } else {
              return res.json({ result: { success: false, message: 'Mật khẩu không chính xác!' } });
            }
          }
        }

        return res.json({ result: { success: false, message: 'Tài khoản hoặc mã học sinh không tồn tại!' } });
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
        return res.json({ result: { success: true } });
      }

      case 'changeUserPassword': {
        const [token, username, oldPassword, newPassword] = args;
        await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT', 'STUDENT']);
        const u = String(username || '').trim();
        const oldP = String(oldPassword || '').trim();
        const newP = String(newPassword || '').trim();
        const hashedOld = hashPassword_(oldP);

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
              ma_hs: idStr,
              truong: item.school || '',
              ghi_chu: item.note || '',
              trang_thai: '',
              thang_bat_dau: ''
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

        if (studentData.isRestore) updatePayload.trang_thai = '';

        await supabase.from('hoc_sinh').update(updatePayload).eq('ma_hs', targetId);

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
        let token, studentId;
        if (args.length === 1) {
          studentId = args[0];
          token = null;
        } else {
          [token, studentId] = args;
          await requireRole_(supabase, token, ['ADMIN', 'ASSISTANT']);
        }

        const targetId = formatStudentId(studentId);
        await supabase
          .from('hoc_sinh')
          .update({ trang_thai: 'ĐÃ NGHỈ HỌC', thang_bat_dau: '' })
          .eq('ma_hs', targetId);

        await clearStudentDataFromDB_(supabase, targetId);
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'archiveStudent': {
        const [token, studentId] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        const targetId = formatStudentId(studentId);

        const { data: stu } = await supabase.from('hoc_sinh').select('*').eq('ma_hs', targetId).single();
        if (stu) {
          const { id, ...rest } = stu;
          await supabase.from('hoc_sinh_nghi').insert(rest);
          await supabase.from('hoc_sinh').delete().eq('ma_hs', targetId);
        }

        await clearStudentDataFromDB_(supabase, targetId);
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
      }

      case 'archiveMultipleStudents': {
        const [token, studentIds] = args;
        await requireRole_(supabase, token, ['ADMIN']);
        if (Array.isArray(studentIds) && studentIds.length > 0) {
          const cleanIds = studentIds.map((id) => formatStudentId(id));
          const { data: stus } = await supabase.from('hoc_sinh').select('*').in('ma_hs', cleanIds);
          if (stus && stus.length > 0) {
            const toInsert = stus.map(({ id, ...rest }) => rest);
            await supabase.from('hoc_sinh_nghi').insert(toInsert);
            await supabase.from('hoc_sinh').delete().in('ma_hs', cleanIds);
          }
          for (const id of cleanIds) {
            await clearStudentDataFromDB_(supabase, id);
          }
        }
        const data = await getInitialData(supabase, token);
        return res.json({ result: data });
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
