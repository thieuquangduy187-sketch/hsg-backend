// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/BDSC.js
// Model bảo dưỡng & sửa chữa
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

// ── Hạng mục con trong 1 phiếu BDSC ─────────────────────
const hangMucSchema = new mongoose.Schema({
  ten:        { type: String, required: true },  // VD: "Thay dầu động cơ"
  loai:       { type: String, enum: ['baoDuong', 'suaChua', 'vatTu', 'giaCong'], default: 'suaChua' },
  donGia:     { type: Number, default: 0 },
  soLuong:    { type: Number, default: 1 },
  donVi:      { type: String, default: 'cái' },
  thanhTien:  { type: Number, default: 0 },
}, { _id: false })

// ── Schema chính ─────────────────────────────────────────
const bdscSchema = new mongoose.Schema({
  bienSo:     { type: String, required: true, index: true },
  loaiXe:     { type: String, enum: ['xeTai', 'xeOto'], default: 'xeTai' },
  ngay:       { type: Date, required: true },
  kmThoiDiem: { type: Number, required: true },      // km lúc vào gara
  gara:       { type: String, default: '' },
  tinhThanh:  { type: String, default: '' },
  hangMuc:    [hangMucSchema],
  tongCong:   { type: Number, default: 0 },          // công + gia công ngoài
  tongVatTu:  { type: Number, default: 0 },          // vật tư
  tongTien:   { type: Number, required: true },      // tổng = công + vật tư
  ghiChu:     { type: String, default: '' },
  anhBaoGia:  [{ type: String }],                    // URLs ảnh/PDF báo giá
  loaiBdsc:   {
    type: String,
    enum: ['baoDuongDinhKy', 'suaChuaPhatSinh', 'suaChuaTaiNan', 'baoHanh'],
    default: 'suaChuaPhatSinh',
  },
  trangThai:  { type: String, enum: ['choPheDuyet', 'daDuyet', 'daThucHien', 'huy'], default: 'daThucHien' },
  nguoiTao:   { type: String, default: '' },
  canhBao:    { type: String, default: '' },         // flag bất thường nếu có
}, { timestamps: true, collection: 'bdsc' })

// ── Lốp xe theo xe ──────────────────────────────────────
const viTriLopSchema = new mongoose.Schema({
  viTri:       { type: String, required: true },     // VD: 'trucTruoc_trai'
  loaiLop:     { type: String, default: '' },        // VD: '900R20-(18PR)'
  boBố:        { type: String, enum: ['nylon', 'kem', ''], default: '' },
  thuongHieu:  { type: String, default: '' },        // Maxxis / Bridgestone / DRC
  ncc:         { type: String, default: '' },
  kmLap:       { type: Number, default: 0 },
  ngayLap:     { type: Date },
  kmThayMoi:   { type: Number, default: 0 },        // km dự kiến thay mới
  kmDaoLop:    { type: Number, default: 0 },        // km dự kiến đảo
  ghiChu:      { type: String, default: '' },
}, { _id: false })

const lopXeSchema = new mongoose.Schema({
  bienSo:       { type: String, required: true, unique: true },
  cauHinh:      { type: String, default: '6' },     // '4','6','10','12'
  viTriLop:     [viTriLopSchema],
  updatedAt:    { type: Date, default: Date.now },
}, { collection: 'lop_xe' })

// ── Giấy tờ xe ──────────────────────────────────────────
const giayToSchema = new mongoose.Schema({
  bienSo:          { type: String, required: true, unique: true },
  dangKy:          { type: Date },
  dangKiem:        { type: Date },
  baoHiemBatBuoc:  { type: Date },
  baoHiemThuHai:   { type: Date },
  phuHieu:         { type: Date },
  kiemDinhCau:     { type: Date },
  ghiChu:          { type: String, default: '' },
  updatedAt:       { type: Date, default: Date.now },
}, { collection: 'giay_to_xe' })

const BDSC    = mongoose.models.BDSC    || mongoose.model('BDSC', bdscSchema)
const LopXe   = mongoose.models.LopXe   || mongoose.model('LopXe', lopXeSchema)
const GiayTo  = mongoose.models.GiayTo  || mongoose.model('GiayTo', giayToSchema)

module.exports = { BDSC, LopXe, GiayTo }
