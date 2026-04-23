const router = require('express').Router()
const mongoose = require('mongoose')

// Schema cho chuyến đi trong ngày
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
  // Hàng hoá (từ OCR hoặc nhập tay)
  hangHoa: [{
    tenHang:   String,
    khoiLuong: Number,
    thanhTien: Number,
  }],
  tongKL:      { type: Number, default: 0 },
  tongTien:    { type: Number, default: 0 },
  ghiChu:      String,
  // Ảnh phiếu BH
  anhPhieu:    String,
  submittedBy: String,
  createdAt:   { type: Date, default: Date.now },
}, { collection: 'nhat_trinh_ngay' })

chuyenSchema.index({ bienSo: 1, ngay: 1 })
chuyenSchema.index({ maHienTai: 1, ngay: 1 })

const Chuyen = mongoose.models.Chuyen || mongoose.model('Chuyen', chuyenSchema)

// ── GET /api/nhat-trinh-ngay?ngay=23/04/2026 ─────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const user = req.user
    const ngay = req.query.ngay || new Date().toLocaleDateString('vi-VN')
    const query = user.role === 'admin'
      ? { ngay }
      : { $or: [{ bienSo: user.bienSo }, { maHienTai: user.maHienTai }], ngay }

    const chuyens = await Chuyen.find(query).sort({ thuTu: 1 }).lean()
    res.json({ chuyens, ngay })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/nhat-trinh-ngay/mine — lịch sử các ngày ─────────────────────────
router.get('/mine', async (req, res) => {
  try {
    const user = req.user
    const query = { $or: [{ bienSo: user.bienSo }, { maHienTai: user.maHienTai }] }
    // Group by ngay
    const days = await Chuyen.aggregate([
      { $match: query },
      { $group: {
          _id: '$ngay',
          tongKm:    { $sum: '$tongKm' },
          tongKL:    { $sum: '$tongKL' },
          tongTien:  { $sum: '$tongTien' },
          phutCau:   { $sum: '$phutCau' },
          soChuyens: { $sum: 1 },
        }},
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ])
    res.json(days)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/nhat-trinh-ngay ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const user = req.user
    const body = req.body

    const bienSo = body.bienSoChon || user.bienSo || ''
    if (!bienSo) return res.status(400).json({ error: 'Thiếu biển số xe' })
    if (!body.ngay) return res.status(400).json({ error: 'Thiếu ngày' })
    if (!body.noiDi || !body.noiDen) return res.status(400).json({ error: 'Thiếu nơi đi/đến' })
    if (body.kmBatDau === undefined) return res.status(400).json({ error: 'Thiếu km bắt đầu' })

    // Auto tính thuTu
    const lastChuyen = await Chuyen.findOne({
      $or: [{ bienSo }, { maHienTai: user.maHienTai }],
      ngay: body.ngay
    }).sort({ thuTu: -1 }).lean()

    const thuTu = (lastChuyen?.thuTu || 0) + 1

    // Tính tongKm và tongKL
    const kmBatDau = Number(body.kmBatDau) || 0
    const kmKetThuc = body.kmKetThuc ? Number(body.kmKetThuc) : null
    const tongKm = kmKetThuc ? kmKetThuc - kmBatDau : 0

    const hangHoa = Array.isArray(body.hangHoa) ? body.hangHoa : []
    const tongKL = hangHoa.reduce((s, h) => s + (Number(h.khoiLuong) || 0), 0)
    const tongTien = hangHoa.reduce((s, h) => s + (Number(h.thanhTien) || 0), 0)

    const chuyen = await Chuyen.create({
      bienSo, maHienTai: user.maHienTai,
      ngay: body.ngay, thuTu,
      noiDi: body.noiDi, noiDen: body.noiDen,
      mucDich: body.mucDich || 'ban_ngoai',
      coTai: body.coTai !== false,
      kmBatDau, kmKetThuc, tongKm,
      kmDeoDoc: Number(body.kmDeoDoc) || 0,
      phutCau:  Number(body.phutCau)  || 0,
      hangHoa, tongKL, tongTien,
      ghiChu: body.ghiChu || '',
      submittedBy: user.username,
    })

    res.status(201).json({ success: true, chuyen })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── PATCH /api/nhat-trinh-ngay/:id — cập nhật km kết thúc ────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const user = req.user
    const chuyen = await Chuyen.findById(req.params.id)
    if (!chuyen) return res.status(404).json({ error: 'Không tìm thấy chuyến' })

    // Chỉ user sở hữu hoặc admin
    if (user.role !== 'admin' && chuyen.bienSo !== user.bienSo && chuyen.maHienTai !== user.maHienTai)
      return res.status(403).json({ error: 'Không có quyền' })

    const updates = {}
    if (req.body.kmKetThuc !== undefined) {
      updates.kmKetThuc = Number(req.body.kmKetThuc)
      updates.tongKm = updates.kmKetThuc - chuyen.kmBatDau
    }
    if (req.body.phutCau !== undefined) updates.phutCau = Number(req.body.phutCau)
    if (req.body.kmDeoDoc !== undefined) updates.kmDeoDoc = Number(req.body.kmDeoDoc)
    if (req.body.hangHoa) {
      updates.hangHoa = req.body.hangHoa
      updates.tongKL  = req.body.hangHoa.reduce((s,h) => s + (Number(h.khoiLuong)||0), 0)
      updates.tongTien = req.body.hangHoa.reduce((s,h) => s + (Number(h.thanhTien)||0), 0)
    }
    if (req.body.ghiChu !== undefined) updates.ghiChu = req.body.ghiChu

    await Chuyen.findByIdAndUpdate(req.params.id, updates)
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/nhat-trinh-ngay/:id ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const user = req.user
    const chuyen = await Chuyen.findById(req.params.id)
    if (!chuyen) return res.status(404).json({ error: 'Không tìm thấy' })
    if (user.role !== 'admin' && chuyen.bienSo !== user.bienSo)
      return res.status(403).json({ error: 'Không có quyền' })
    await chuyen.deleteOne()
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
