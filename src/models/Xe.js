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

xeSchema.methods.toAPI = function () {
  const d = this.toObject()
  return {
    _id:          String(d._id),
    bienSo:       d['BIỂN SỐ']           || d['BIẼNSỐ']          || '',
    maTaiSan:     String(d['Mã TS kế toán'] || ''),
    maHienTai:    d['Mã hiện tại']        || '',
    maHienTai2:   d['Mã hiện tại2']       || '',
    bienSoKhDau:  d['Biển số không dâu']  || '',
    hinhAnh:      d['Hình ảnh']           || '',
    phapNhan:     d['Pháp nhân đứng tên'] || '',
    tenTaiSan:    d['TÊN TÀI SẢN']        || '',
    loaiThung:    d['Loại Thùng\n(Lửng, mui bạt, có cẩu)'] || '',
    loaiXe:       d['Loại xe']            || '',
    taiTrong:     cleanNum(d['Tải trọng \n(Tấn)']),
    cuaHang:      d['Cưả hàng sử dụng']  || '',
    tinhCu:       d['Tỉnh Cũ']           || '',
    tinhMoi:      d['Tỉnh mới']          || '',
    tinhGop:      d['Tỉnh gộp']          || '',
    mien:         d['Miền']              || '',
    nguyenGia:    cleanNum(d[' Nguyên giá']),
    gtcl:         cleanNum(d[' GTCL']),
    namSX:        parseInt(d['Năm SX'])  || 0,
    ngayDuaVaoSD: d['Ngày đưa vào sử dụng'] || '',
    lichSuTaiNan: d['Lịch sử tai nạn']   || '',
    cayDieuDong:  d['Cây điều động']     || '',
    dai:          cleanNum(d['Dài']),
    rong:         cleanNum(d['Rộng']),
    cao:          cleanNum(d['Cao']),
    hasTaiNan:    (d['Lịch sử tai nạn'] || '').length > 3 ? 1 : 0,
    hasDieuDong:  String(d['Cây điều động'] || '').replace(/^0$/, '').length > 1 ? 1 : 0,
    loaiHinh: (() => {
      const ma = String(d['Mã hiện tại'] || '')
      if (!ma) return 'Cửa hàng'
      const isTK = /TK/i.test(ma) && !/^TK04$/i.test(ma)
      return isTK ? 'Tổng kho' : 'Cửa hàng'
    })(),
  }
}



module.exports = mongoose.model('Xe', xeSchema)
