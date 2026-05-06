// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/DangKiem.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const lichSuSchema = new mongoose.Schema({
  tramKD:    { type: String, default: '' },
  soPhieu:   { type: String, default: '' },
  ngayKD:    { type: String, default: '' },
  lanKD:     { type: String, default: '' },
  soTem:     { type: String, default: '' },
  thoiHanKD: { type: String, default: '' },  // dd/mm/yyyy
}, { _id: false })

const dangKiemSchema = new mongoose.Schema({
  bienSo:            { type: String, required: true, unique: true, index: true },

  // Đăng ký
  ngayDangKy:        { type: String, default: '' },
  soSoKiemDinh:      { type: String, default: '' },
  soSoQuanLy:        { type: String, default: '' },
  chuPhuongTien:     { type: String, default: '' },
  diaChiChu:         { type: String, default: '' },

  // Kỹ thuật
  loaiPhuongTien:    { type: String, default: '' },
  nhanHieu:          { type: String, default: '' },
  soLoai:            { type: String, default: '' },
  soMay:             { type: String, default: '' },
  soKhung:           { type: String, default: '' },
  namSanXuat:        { type: String, default: '' },
  noiSanXuat:        { type: String, default: '' },

  // Trọng lượng
  taiTrongThietKe:   { type: String, default: '' },
  trongLuongBanThan: { type: String, default: '' },
  soNguoi:           { type: String, default: '' },
  taiTrongKeo:       { type: String, default: '' },

  // Kích thước
  kichThuocBao:      { type: String, default: '' },  // DxRxC mm
  kichThuocThung:    { type: String, default: '' },
  chieuDaiCoSo:      { type: String, default: '' },

  // Động cơ
  kieuDC:            { type: String, default: '' },
  nhienLieu:         { type: String, default: '' },
  dungTich:          { type: String, default: '' },
  congSuat:          { type: String, default: '' },

  // Khác
  congThucBanhXe:    { type: String, default: '' },
  vetBanhXe:         { type: String, default: '' },
  phanh:             { type: String, default: '' },
  soLop:             { type: String, default: '' },
  coLop:             { type: String, default: '' },
  kinhDoanhVanTai:   { type: String, default: '' },
  lapGSHT:           { type: String, default: '' },

  // Phí kiểm định
  ngayNopPhi:        { type: String, default: '' },
  donViThuPhi:       { type: String, default: '' },
  soBienLai:         { type: String, default: '' },
  phiDenHetNgay:     { type: String, default: '' },

  // Thời hạn hiện tại (lấy từ lịch sử gần nhất)
  thoiHanKDHienTai:  { type: String, default: '' },
  ngayKDGanNhat:     { type: String, default: '' },

  // Lịch sử đầy đủ
  lichSuKD:          [lichSuSchema],

  // Meta
  importedAt:        { type: Date, default: Date.now },
  updatedAt:         { type: Date, default: Date.now },
}, { collection: 'dang_kiem' })

module.exports = mongoose.models.DangKiem || mongoose.model('DangKiem', dangKiemSchema)
