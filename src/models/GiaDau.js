// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/GiaDau.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const priceSchema = new mongoose.Schema({
  key:       { type: String, unique: true },  // "3/2026"
  thang:     Number,
  nam:       Number,
  available: { type: Boolean, default: true },
  min:       Number,
  max:       Number,
  avg:       Number,
  soLanDieuChinh: Number,
  do001:     mongoose.Schema.Types.Mixed,  // { v1, v2, list }
  do05:      mongoose.Schema.Types.Mixed,
  chiTiet:   [mongoose.Schema.Types.Mixed], // [{ ngay, do001, do05 }]
  nguon:     String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'gia_dau_cache' })

module.exports = mongoose.models.GiaDau || mongoose.model('GiaDau', priceSchema)
