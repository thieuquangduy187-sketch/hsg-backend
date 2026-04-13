const mongoose = require('mongoose')

const otoSchema = new mongoose.Schema({}, {
  collection: 'xeoto',
  strict: false
})

function cleanNum(val) {
  if (!val && val !== 0) return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

otoSchema.methods.toAPI = function () {
  const d = this.toObject()
  // Try common field name variants
  return {
    _id:       String(d._id),
    bienSo:    d['Biển số'] || d['BIỂN SỐ'] || d['bienSo'] || '',
    phapNhan:  d['Pháp nhân đứng tên'] || d['Pháp nhân'] || '',
    nhanHieu:  d['Nhãn hiệu'] || d['Loại xe'] || d['nhanHieu'] || '',
    donViSD:   d['Đơn vị sử dụng'] || d['donViSD'] || '',
    nhanSu:    d['Tài xế /Tỉnh sử dụng'] || d['Nhân sự'] || '',
    mien:      d['Miền'] || '',
    soCho:     parseInt(d['Số chỗ']) || 0,
    namSX:     parseInt(d['Năm Sản xuất'] || d['Năm SX']) || 0,
    gtcl:      cleanNum(d['GTCL'] || d['Giá trị']),
    nguyenGia: cleanNum(d['Nguyên giá'] || d['Giá trị']),
    maTaiSan:  String(d['Mã TS FA'] || d['Mã TS kế toán'] || ''),
  }
}

module.exports = mongoose.model('Oto', otoSchema)
