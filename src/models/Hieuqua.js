// hsg-backend/src/models/HieuQua.js
const mongoose = require('mongoose');

const HieuQuaSchema = new mongoose.Schema({
  bienSo: { type: String, required: true, trim: true, uppercase: true },
  thang: { type: Number, required: true, min: 1, max: 12 },
  nam: { type: Number, required: true },
  km: { type: Number, default: 0 },
  tongKLVC: { type: Number, default: 0 }, // tổng khối lượng vận chuyển (kg)
  klvcNoiBo: { type: Number, default: 0 }, // khối lượng nội bộ (kg)
  source: {
    type: String,
    enum: ['manual', 'ntxt_sync', 'excel_import'],
    default: 'manual'
  },
  ghiChu: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: '' }
}, { collection: 'hieu_qua' });

HieuQuaSchema.index({ bienSo: 1, thang: 1, nam: 1 }, { unique: true });

module.exports = mongoose.model('HieuQua', HieuQuaSchema);
