const mongoose = require('mongoose')

const nhatTrinhSchema = new mongoose.Schema({
  // Auto-filled
  bienSo:       { type: String, required: true },
  maHienTai:    { type: String, required: true }, // username của xe
  thang:        { type: Number, required: true },  // 1-12
  nam:          { type: Number, required: true },  // e.g. 2025
  submittedBy:  { type: String },                  // username
  submittedAt:  { type: Date, default: Date.now },

  // Nhóm 1: Số km
  kmDauThang:   { type: Number, required: true, min: 0 },
  kmCuoiThang:  { type: Number, required: true, min: 0 },
  // Computed: kmCuoiThang - kmDauThang
  tongKmDiChuyen: { type: Number },
  kmDuongDeo:   { type: Number, default: 0, min: 0 },

  // Nhóm 2: Cẩu & nhiên liệu
  tgSuDungCau:  { type: Number, default: 0, min: 0 }, // phút
  tongLitDau:   { type: Number, default: 0, min: 0 }, // lít
  tongTienDau:  { type: Number, default: 0, min: 0 }, // đồng

  // Nhóm 3: Vận chuyển
  tongKLChuyen: { type: Number, default: 0, min: 0 }, // kg - tổng khối lượng
  klNoiBo:      { type: Number, default: 0, min: 0 }, // kg - nội bộ
  soChuyenXe:   { type: Number, default: 0, min: 0 }, // chuyến

  // Nhóm 4: Thuê ngoài
  cpThueNgoai:  { type: Number, default: 0, min: 0 }, // đồng
  klThueNgoai:  { type: Number, default: 0, min: 0 }, // kg

  // Trường mở rộng (3 trường chưa xác định)
  truongMoRong1: { type: mongoose.Schema.Types.Mixed },
  truongMoRong2: { type: mongoose.Schema.Types.Mixed },
  truongMoRong3: { type: mongoose.Schema.Types.Mixed },

  ghiChu: { type: String, default: '' },
}, { collection: 'ntxt' })

// Unique: mỗi xe chỉ có 1 bản ghi/tháng/năm
nhatTrinhSchema.index({ maHienTai: 1, thang: 1, nam: 1 }, { unique: true })

module.exports = mongoose.model('NhatTrinh', nhatTrinhSchema)
