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
  // Exact field names from /api/oto/keys:
  // BKS, Đơn vị sử dụng, Pháp nhân đứng tên, Mã tài sản,
  // BKS_1, NHÃN HIỆU, Số chỗ, Năm sản xuất, Nguyên giá, GTCL,
  // GHI CHÚ, Nhân sự sử dụng
  return {
    _id:       String(d._id),
    bienSo:    d['BKS']    || d['BKS_1']  || d['Biển số'] || d['BIỂN SỐ'] || '',
    maTaiSan:  String(d['Mã tài sản'] || d['Mã TS FA'] || d['Mã TS kế toán'] || ''),
    phapNhan:  d['Pháp nhân đứng tên'] || '',
    nhanHieu:  d['NHÃN HIỆU'] || d['Nhãn hiệu'] || '',
    donViSD:   d['Đơn vị sử dụng'] || '',
    nhanSu:    d['Nhân sự sử dụng'] || d['Tài xế /Tỉnh sử dụng'] || '',
    mien:      d['Miền'] || '',
    soCho:     parseInt(d['Số chỗ']) || 0,
    namSX:     parseInt(d['Năm sản xuất'] || d['Năm SX']) || 0,
    nguyenGia: cleanNum(d['Nguyên giá']),
    gtcl:      cleanNum(d['GTCL']),
    ghiChu:    d['GHI CHÚ'] || '',
  }
}

module.exports = mongoose.model('Oto', otoSchema)
