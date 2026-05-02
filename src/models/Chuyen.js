// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/Chuyen.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const chuyenSchema = new mongoose.Schema({
  bienSo:      { type: String, required: true },
  maHienTai:   String,
  ngay:        { type: String, required: true },  // "23/04/2026"
  thuTu:       { type: Number, required: true },  // số thứ tự chuyến trong ngày
  noiDi:       { type: String, required: true },
  noiDen:      { type: String, required: true },
  mucDich:     { type: String, enum: ['ban_ngoai','noi_bo','bao_duong','do_xang','khac'], default: 'ban_ngoai' },
  coTai:       { type: Boolean, default: true },
  kmBatDau:    { type: Number, required: true },
  kmKetThuc:   { type: Number },
  tongKm:      Number,
  kmDeoDoc:    { type: Number, default: 0 },
  phutCau:     { type: Number, default: 0 },
  hangHoa: [{
    tenHang:   String,
    khoiLuong: Number,
    thanhTien: Number,
  }],
  tongKL:      { type: Number, default: 0 },
  tongTien:    { type: Number, default: 0 },
  ghiChu:      String,
  anhPhieu:    String,
  submittedBy: String,
  createdAt:   { type: Date, default: Date.now },
}, { collection: 'nhat_trinh_ngay' })

chuyenSchema.index({ bienSo: 1, ngay: 1 })
chuyenSchema.index({ maHienTai: 1, ngay: 1 })

module.exports = mongoose.models.Chuyen || mongoose.model('Chuyen', chuyenSchema)
