// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/XeKD.js
// Dữ liệu kiểm định xe — nguồn từ file HTML cục bộ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const lichSuKDSchema = new mongoose.Schema({
  tramKD:    { type: String, default: '' },
  soPhieu:   { type: String, default: '' },
  ngayKD:    { type: String, default: '' },   // dd/mm/yyyy string — giữ nguyên format gốc
  lanKD:     { type: String, default: '' },
  soTem:     { type: String, default: '' },
  thoiHanKD: { type: String, default: '' },   // dd/mm/yyyy
}, { _id: false })

const kdHienHanhSchema = new mongoose.Schema({
  tramKD:    { type: String, default: '' },
  soPhieu:   { type: String, default: '' },
  ngayKD:    { type: String, default: '' },
  lanKD:     { type: String, default: '' },
  soTem:     { type: String, default: '' },
  thoiHanKD: { type: String, default: '' },
}, { _id: false })

const xeKDSchema = new mongoose.Schema({
  bienSo:    { type: String, required: true, index: true },
  bienSoRaw: { type: String, index: true },   // tên file gốc (61C15541V)

  // Đăng ký
  ngayDangKy:        String,
  ngayDangKyLanDau:  String,
  soSoKiemDinh:      String,
  soSoQuanLy:        String,
  chuPhuongTien:     String,
  diaChiChu:         String,

  // Kỹ thuật
  loaiPhuongTien:    String,
  nhanHieu:          String,
  soLoai:            String,
  soMayThucTe:       String,
  soKhungThucTe:     String,
  namSanXuat:        String,
  noiSanXuat:        String,
  taiTrongThietKe:   String,
  trongLuongBanThan: String,
  soNguoiChoPhep:    String,
  taiTrongKeoTheoTK: String,
  thayDoiKetCau:     String,
  chuyenDoiCongNang: String,
  kinhDoanhVanTai:   String,
  lapThietBiGSHT:    String,
  congThucBanhXe:    String,
  vetBanhXe:         String,
  kichThuocBao:      String,
  kichThuocThung:    String,
  chieuDaiCoSo:      String,
  nhieuLieu:         String,
  dungTich:          String,
  congSuatLonNhat:   String,
  soLop:             String,
  coLop:             String,

  // Phí KĐ
  ngayNopPhi:       String,
  donViThuPhi:      String,
  soBienLai:        String,
  phiNopDenHetNgay: String,

  // Lịch sử KĐ
  lichSuKD:   [lichSuKDSchema],
  kdHienHanh: kdHienHanhSchema,

  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'xe_kd' })

const XeKD = mongoose.models.XeKD || mongoose.model('XeKD', xeKDSchema)
module.exports = XeKD
