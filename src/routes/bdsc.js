// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/bdsc.js
// Route quản lý bảo dưỡng sửa chữa + OCR báo giá
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const mongoose = require('mongoose')
const Anthropic = require('@anthropic-ai/sdk')

const db = () => mongoose.connection.db

// ── Schema lưu lịch sử BDSC ──────────────────────────────────────────────
const bdscSchema = new mongoose.Schema({
  bienSo:     { type: String, required: true },
  km:         { type: Number, required: true },
  ngay:       { type: String, required: true },
  garage:     { type: String },
  soRO:       { type: String },
  tongTien:   { type: Number },
  loai:       { type: String, enum: ['baoDuong','suaChua','lopXe','giayTo'] },
  hangMuc: [{
    ten:       String,
    loaiChiPhi: { type: String, enum: ['cong','vatTu','giaCongNgoai'] },
    mucDich:   { type: String, enum: ['baoDuongDinhKy','suaChuaHuHong','giaCong'] },
    thanhTien: Number,
    canhBao:   String,
  }],
  anhURL:     [String],
  ghiChu:     String,
  createdBy:  String,
  createdAt:  { type: Date, default: Date.now },
}, { collection: 'bdsc_history' })

const BDSC = mongoose.models.BDSC || mongoose.model('BDSC', bdscSchema)

// ── GET /api/bdsc — lịch sử BDSC ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { bienSo, limit = 50 } = req.query
    const filter = bienSo ? { bienSo } : {}
    const records = await BDSC.find(filter)
      .sort({ km: -1 })
      .limit(Number(limit))
      .lean()
    res.json(records)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/bdsc — lưu 1 record BDSC ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { bienSo, km, ngay, garage, soRO, tongTien, hangMuc, ghiChu } = req.body
    if (!bienSo || !km) return res.status(400).json({ error: 'Thiếu biển số hoặc km' })

    const record = await BDSC.create({
      bienSo, km: Number(km), ngay, garage, soRO,
      tongTien: Number(String(tongTien||'0').replace(/[^0-9]/g,'')),
      hangMuc: hangMuc || [],
      ghiChu,
      createdBy: req.user?.username,
    })
    res.json({ success: true, record })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/bdsc/ocr — đọc báo giá bằng Claude Vision ─────────────────
router.post('/ocr', async (req, res) => {
  try {
    const { base64, mimeType = 'image/jpeg', filename = '' } = req.body
    if (!base64) return res.status(400).json({ error: 'Thiếu dữ liệu ảnh' })

    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: mimeType === 'application/pdf' ? 'document' : 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          {
            type: 'text',
            text: `Đây là báo giá sửa chữa xe tải. Hãy trích xuất thông tin và trả về JSON theo format sau, không có text nào khác:
{
  "bienSo": "biển số xe",
  "km": "số km hiện tại",
  "ngay": "ngày tháng năm",
  "garage": "tên garage/nhà cung cấp",
  "soRO": "số RO hoặc số báo giá nếu có",
  "tongTien": "tổng tiền (chỉ số, bỏ đơn vị)",
  "hangMuc": [
    {
      "ten": "tên hạng mục",
      "loaiChiPhi": "cong | vatTu | giaCongNgoai",
      "mucDich": "baoDuongDinhKy | suaChuaHuHong | giaCong",
      "thanhTien": số tiền (chỉ số),
      "canhBao": "ghi chú nếu nghi ngờ trùng lặp hoặc bất thường, để trống nếu không"
    }
  ]
}

Phân loại loaiChiPhi:
- "cong": dịch vụ/nhân công (DỊCH VỤ SỬA CHỮA)
- "vatTu": phụ tùng, vật tư (PHỤ TÙNG, VẬT TƯ)
- "giaCongNgoai": cột LHSC là DS hoặc gia công bên ngoài

Phân loại mucDich:
- "baoDuongDinhKy": thay dầu, lọc nhớt, lọc gió, bơm mỡ, bảo dưỡng theo chu kỳ
- "suaChuaHuHong": sửa hư hỏng, thay linh kiện hỏng, hàn sửa
- "giaCong": hàn tiện, gia công cơ khí`
          }
        ]
      }]
    })

    const text = message.content[0]?.text || '{}'
    let data
    try {
      const clean = text.replace(/```json|```/g, '').trim()
      data = JSON.parse(clean)
    } catch {
      data = { bienSo:'', km:'', ngay:'', garage:'', soRO:'', tongTien:'', hangMuc:[] }
    }

    res.json({ ...data, aiRead: true })
  } catch(e) {
    console.error('[OCR] error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/bdsc/tire/:bienSo — lốp xe ──────────────────────────────────
router.get('/tire/:bienSo', async (req, res) => {
  try {
    const cfg = await db().collection('tire_config').findOne({ bienSo: req.params.bienSo })
    res.json(cfg?.tires || {})
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/bdsc/tire/:bienSo — cập nhật lốp ────────────────────────────
router.put('/tire/:bienSo', async (req, res) => {
  try {
    const { tires, axleCfg } = req.body
    await db().collection('tire_config').updateOne(
      { bienSo: req.params.bienSo },
      { $set: { bienSo: req.params.bienSo, tires, axleCfg, updatedAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/bdsc/docs/:bienSo — giấy tờ xe ──────────────────────────────
router.get('/docs/:bienSo', async (req, res) => {
  try {
    const doc = await db().collection('vehicle_docs').findOne({ bienSo: req.params.bienSo })
    res.json(doc || {})
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/bdsc/docs/:bienSo — cập nhật giấy tờ ────────────────────────
router.put('/docs/:bienSo', async (req, res) => {
  try {
    const { dangKiem, baoHiem, phuHieu, kiemDinhCau, gplxNLX } = req.body
    await db().collection('vehicle_docs').updateOne(
      { bienSo: req.params.bienSo },
      { $set: { bienSo: req.params.bienSo, dangKiem, baoHiem, phuHieu, kiemDinhCau, gplxNLX, updatedAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
