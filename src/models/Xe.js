const mongoose = require('mongoose')

const xeSchema = new mongoose.Schema({}, {
  collection: 'xetai',
  strict: false
})

function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

// Find field by trying multiple name variants (handles spaces, newlines, typos)
function f(doc, ...keys) {
  for (const key of keys) {
    if (doc[key] !== undefined && doc[key] !== null && doc[key] !== '') 
      return doc[key]
  }
  // Also try trimmed keys — scan all doc keys
  const docKeys = Object.keys(doc)
  for (const key of keys) {
    const trimKey = key.trim()
    const found = docKeys.find(k => k.trim() === trimKey || 
                                    k.replace(/\s+/g,' ').trim() === trimKey.replace(/\s+/g,' '))
    if (found && doc[found] !== undefined && doc[found] !== null && doc[found] !== '')
      return doc[found]
  }
  return ''
}

xeSchema.methods.toAPI = function () {
  const d = this.toObject()
  return {
    _id:          String(d._id),
    bienSo:       f(d,'BIỂN SỐ','BIỂNSỐ'),
    maTaiSan:     String(d['Mã TS kế toán'] || ''),
    maHienTai:    f(d,'Mã hiện tại'),
    maHienTai2:   f(d,'Mã hiện tại2'),
    bienSoKhDau:  f(d,'Biển số không dâu'),
    hinhAnh:      f(d,'Hình ảnh'),
    phapNhan:     f(d,'Pháp nhân đứng tên'),
    tenTaiSan:    f(d,'TÊN TÀI SẢN'),
    loaiThung:    f(d,'Loại Thùng\n(Lửng, mui bạt, có cẩu)','Loại Thùng (Lửng, mui bạt, có cẩu)'),
    loaiXe:       f(d,'Loại xe'),
    taiTrong:     cleanNum(f(d,'Tải trọng \n(Tấn)','Tải trọng \n(Tấn)','Tải trọng (Tấn)')),
    cuaHang:      f(d,'Cưả hàng sử dụng','Cửa hàng sử dụng'),
    tinhCu:       f(d,'Tỉnh Cũ'),
    tinhMoi:      f(d,'Tỉnh mới'),
    tinhGop:      f(d,'Tỉnh gộp'),
    mien:         f(d,'Miền'),
    nguyenGia:    cleanNum(f(d,' Nguyên giá','Nguyên giá')),
    gtcl:         cleanNum(f(d,' GTCL','GTCL')),
    namSX:        parseInt(d['Năm SX']) || 0,
    ngayDuaVaoSD: f(d,'Ngày đưa vào sử dụng'),
    lichSuTaiNan: f(d,'Lịch sử tai nạn'),
    cayDieuDong:  f(d,'Cây điều động'),
    dai:          cleanNum(d['Dài']),
    rong:         cleanNum(d['Rộng']),
    cao:          cleanNum(d['Cao']),
    hasTaiNan:    (f(d,'Lịch sử tai nạn') || '').length > 3 ? 1 : 0,
    hasDieuDong:  String(f(d,'Cây điều động') || '').replace(/^0$/, '').length > 1 ? 1 : 0,
  }
}

module.exports = mongoose.model('Xe', xeSchema)
