// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/DieselPrice.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const priceSchema = new mongoose.Schema({
  key:       { type: String, unique: true }, // "5/2026"
  thang:     Number,
  nam:       Number,
  do001_v1:  Number,
  do001_v2:  Number,
  do05_v1:   Number,
  do05_v2:   Number,
  avg4:      Number,
  minDo001:  Number,
  maxDo001:  Number,
  updatedAt: { type: Date, default: Date.now },
  source:    String,
}, { collection: 'diesel_prices' })

module.exports = mongoose.models.DieselPrice || mongoose.model('DieselPrice', priceSchema)
