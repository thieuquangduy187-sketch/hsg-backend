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
  thoiHanKD: { type: String, default: '' },
}, { _id: false })

const dangKiemSchema = new mongoose.Schema({
  bienSo:            { type: String, required: true, unique: true, index: true },
  ngayDangKy:        { type: String, default: '' },
  ngayDangKyLanDau:  { type: String, default: '' },
  soSoKiemDinh:      { type: String, default: '' },
  soSoQuanLy:        { type: String, default: '' },
  chuPhuongTien:     { type: String, default: '' },
  diaChiChu:         { type: String, default: '' },
  loaiPhuongTien:    { type: String, default: '' },
  nhanHieu:          { type: String, default: '' },
  soLoai:            { type: String, default: '' },
  soMay:             { type: String, default: '' },
  soKhung:           { type: String, default: '' },
  namSanXuat:        { type: String, default: '' },
  noiSanXuat:        { type: String, default: '' },
  taiTrongThietKe:   { type: String, default: '' },
  trongLuongBanThan: { type: String, default: '' },
  soNguoi:           { type: String, default: '' },
  taiTrongKeo:       { type: String, default: '' },
  kichThuocBao:      { type: String, default: '' },
  kichThuocThung:    { type: String, default: '' },
  chieuDaiCoSo:      { type: String, default: '' },
  kieuDC:            { type: String, default: '' },
  kyHieu:            { type: String, default: '' },
  nhienLieu:         { type: String, default: '' },
  dungTich:          { type: String, default: '' },
  congSuat:          { type: String, default: '' },
  phanhChinh:        { type: String, default: '' },
  phanhDo:           { type: String, default: '' },
  congThucBanhXe:    { type: String, default: '' },
  vetBanhXe:         { type: String, default: '' },
  soLop:             { type: String, default: '' },
  coLop:             { type: String, default: '' },
  kinhDoanhVanTai:   { type: String, default: '' },
  lapGSHT:           { type: String, default: '' },
  thayDoiKetCau:     { type: String, default: '' },
  chuyenDoiCongNang: { type: String, default: '' },
  ngayNopPhi:        { type: String, default: '' },
  donViThuPhi:       { type: String, default: '' },
  soBienLai:         { type: String, default: '' },
  phiDenHetNgay:     { type: String, default: '' },
  thoiHanKDHienTai:  { type: String, default: '' },
  ngayKDGanNhat:     { type: String, default: '' },
  // ── Phù hiệu (nhập tay) ────────────────────────────────
  thoiHanPhuHieu:    { type: String, default: '' },
  // ── Quản lý trễ hạn ───────────────────────────────────
  ghiChuTreTre:      { type: String, default: '' },
  tienDoXuLy:        { type: String, default: '' },
  trangThaiXe:       { type: String, enum: ['hoatDong','dungHoatDong','choXuLy'], default: 'hoatDong' },
  lichSuKD:          [lichSuSchema],
  importedAt:        { type: Date, default: Date.now },
  updatedAt:         { type: Date, default: Date.now },
}, { collection: 'dang_kiem' })

module.exports = mongoose.models.DangKiem || mongoose.model('DangKiem', dangKiemSchema)
