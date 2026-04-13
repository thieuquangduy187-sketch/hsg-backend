const mongoose = require('mongoose')

// Field names match exactly what's in MongoDB (Vietnamese keys)
const xeSchema = new mongoose.Schema({
  STT:                    { type: mongoose.Schema.Types.Mixed },
  'BIỂNSỐ':               String,
  'Hình ảnh':              String,
  'Mã TS kế toán':        mongoose.Schema.Types.Mixed,
  'Mã hiện tại':          String,
  'BIỂN SỐ':              String,
  'Biển số không dâu':    String,
  'Pháp nhân đứng tên':   String,
  'TÊN TÀI SẢN':          String,
  'Loại Thùng (Lửng, mui bạt, có cẩu)': String,
  'Loại xe':              String,
  'Tải trọng (Tấn)':      mongoose.Schema.Types.Mixed,
  'Cửa hàng sử dụng':     String,
  'Tỉnh Cũ':              String,
  'Tỉnh mới':             String,
  'Tỉnh gộp':             String,
  'Mã hiện tại2':         String,
  'Miền':                 String,
  'Nguyên giá':           mongoose.Schema.Types.Mixed,
  'GTCL':                 mongoose.Schema.Types.Mixed,
  'Năm SX':               mongoose.Schema.Types.Mixed,
  'Ngày đưa vào sử dụng': String,
  'Lịch sử tai nạn':      String,
  'Cây điều động':        String,
  'Dài':                  mongoose.Schema.Types.Mixed,
  'Rộng':                 mongoose.Schema.Types.Mixed,
  'Cao':                  mongoose.Schema.Types.Mixed,
}, {
  collection: 'xe',
  strict: false  // allow extra fields
})

// ── Helper: normalize number fields ──────────────────────────────────────────
function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

// ── Transform raw doc → clean API response ────────────────────────────────────
xeSchema.methods.toAPI = function () {
  const d = this.toObject()
  return {
    _id:          String(d._id),
    bienSo:       d['BIỂN SỐ'] || d['BIỂNSỐ'] || '',
    maTaiSan:     String(d['Mã TS kế toán'] || ''),
    maHienTai:    d['Mã hiện tại'] || '',
    maHienTai2:   d['Mã hiện tại2'] || '',
    bienSoKhDau:  d['Biển số không dâu'] || '',
    hinhAnh:      d['Hình ảnh'] || '',
    phapNhan:     d['Pháp nhân đứng tên'] || '',
    tenTaiSan:    d['TÊN TÀI SẢN'] || '',
    loaiThung:    d['Loại Thùng (Lửng, mui bạt, có cẩu)'] || '',
    loaiXe:       d['Loại xe'] || '',
    taiTrong:     cleanNum(d['Tải trọng (Tấn)']),
    cuaHang:      d['Cửa hàng sử dụng'] || '',
    tinhCu:       d['Tỉnh Cũ'] || '',
    tinhMoi:      d['Tỉnh mới'] || '',
    tinhGop:      d['Tỉnh gộp'] || '',
    mien:         d['Miền'] || '',
    nguyenGia:    cleanNum(d['Nguyên giá']),
    gtcl:         cleanNum(d['GTCL']),
    namSX:        parseInt(d['Năm SX']) || 0,
    ngayDuaVaoSD: d['Ngày đưa vào sử dụng'] || '',
    lichSuTaiNan: d['Lịch sử tai nạn'] || '',
    cayDieuDong:  d['Cây điều động'] || '',
    dai:          cleanNum(d['Dài']),
    rong:         cleanNum(d['Rộng']),
    cao:          cleanNum(d['Cao']),
    hasTaiNan:    (d['Lịch sử tai nạn'] || '').length > 3 ? 1 : 0,
    hasDieuDong:  (d['Cây điều động'] || '').replace(/^0$/, '').length > 1 ? 1 : 0,
  }
}

module.exports = mongoose.model('Xe', xeSchema)
