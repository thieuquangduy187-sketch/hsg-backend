// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/nhatTrinh.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router    = require('express').Router()
const mongoose  = require('mongoose')
const Xe        = require('../models/Xe')
const { protect } = require('../middleware/auth')

// ── Inline NhatTrinh model ────────────────────────────────────────────────────
const ntSchema = new mongoose.Schema({
  bienSo: String, maHienTai: { type: String, required: true },
  thang:  { type: Number, required: true },
  nam:    { type: Number, required: true },
  submittedBy: String, submittedAt: { type: Date, default: Date.now },
  kmDauThang: Number, kmCuoiThang: Number, tongKmDiChuyen: Number,
  kmDuongDeo: { type: Number, default: 0 },
  tgSuDungCau: { type: Number, default: 0 },
  tongLitDau:  { type: Number, default: 0 },
  tongTienDau: { type: Number, default: 0 },
  tongKLChuyen:{ type: Number, default: 0 },
  klNoiBo:     { type: Number, default: 0 },
  soChuyenXe:  { type: Number, default: 0 },
  cpThueNgoai: { type: Number, default: 0 },
  klThueNgoai: { type: Number, default: 0 },
  ghiChu:     { type: String, default: '' },
  updatedAt:  { type: Date },
  updatedBy:  { type: String },
}, { collection: 'ntxt' })
ntSchema.index({ bienSo: 1, thang: 1, nam: 1 }, { unique: true })
const NhatTrinh = mongoose.models.NhatTrinh || mongoose.model('NhatTrinh', ntSchema)

// ── POST /api/nhat-trinh ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const user = req.user
    const body = req.body
    if (user.role !== 'xe' && user.role !== 'admin')
      return res.status(403).json({ error: 'Không có quyền nộp nhật trình.' })

    const now   = new Date()
    const thang = parseInt(body.thang) || now.getMonth() + 1
    const nam   = parseInt(body.nam)   || now.getFullYear()

    // Xác định biển số cho bản ghi này
    // Nếu user có nhiều biển số (bienSoList) → phải chọn (body.bienSoChon)
    // Nếu user có 1 biển số → tự động dùng luôn
    const bienSoList = user.bienSoList || []
    let bienSo = ''

    if (bienSoList.length > 1) {
      // User nhóm — phải chọn biển số
      const chon = body.bienSoChon || ''
      if (!chon) return res.status(400).json({ error: 'Vui lòng chọn biển số xe.' })
      if (!bienSoList.includes(chon))
        return res.status(400).json({ error: `Biển số ${chon} không thuộc tài khoản này.` })
      bienSo = chon
    } else {
      bienSo = bienSoList[0] || user.bienSo || body.bienSo || ''
    }

    const kmDau  = Number(body.kmDauThang)  || 0
    const kmCuoi = Number(body.kmCuoiThang) || 0
    const tongKm = kmCuoi - kmDau
    const kmDeo  = Number(body.kmDuongDeo)  || 0
    const tongKL = Number(body.tongKLChuyen)|| 0
    const klNB   = Number(body.klNoiBo)     || 0

    const errs = []
    if (tongKm <= 0)    errs.push('Số km cuối tháng phải lớn hơn số km đầu tháng.')
    if (kmDeo > tongKm && tongKm > 0) errs.push('Số km đường đèo không thể lớn hơn tổng km di chuyển.')
    if (klNB > tongKL && tongKL > 0)  errs.push('Khối lượng nội bộ không thể lớn hơn tổng khối lượng chuyên chở.')
    if (errs.length) return res.status(400).json({ errors: errs })

    const exists = await NhatTrinh.findOne({ bienSo, thang, nam })
    if (exists) return res.status(409).json({ error: `Xe ${bienSo} đã nộp nhật trình tháng ${thang}/${nam}.` })

    await new NhatTrinh({
      bienSo, maHienTai: user.username, thang, nam,
      submittedBy: user.username, submittedAt: new Date(),
      kmDauThang: kmDau, kmCuoiThang: kmCuoi, tongKmDiChuyen: tongKm,
      kmDuongDeo: kmDeo,
      tgSuDungCau:  Number(body.tgSuDungCau)  || 0,
      tongLitDau:   Number(body.tongLitDau)    || 0,
      tongTienDau:  Number(body.tongTienDau)   || 0,
      tongKLChuyen: tongKL, klNoiBo: klNB,
      soChuyenXe:   Number(body.soChuyenXe)   || 0,
      cpThueNgoai:  Number(body.cpThueNgoai)  || 0,
      klThueNgoai:  Number(body.klThueNgoai)  || 0,
      ghiChu: body.ghiChu || '',
    }).save()

    res.status(201).json({ success: true, message: `Nộp nhật trình tháng ${thang}/${nam} thành công!` })
  } catch(e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Đã nộp nhật trình tháng này rồi.' })
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/nhat-trinh/mine ──────────────────────────────────────────────────
router.get('/mine', async (req, res) => {
  try {
    const docs = await NhatTrinh.find({ maHienTai: req.user.username })
      .sort({ nam: -1, thang: -1 }).limit(24)
    res.json(docs)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/nhat-trinh (admin) ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Chỉ admin mới xem được.' })
    const { thang, nam } = req.query
    const filter = {}
    if (thang) filter.thang = parseInt(thang)
    if (nam)   filter.nam   = parseInt(nam)
    const docs = await NhatTrinh.find(filter).sort({ submittedAt: -1 }).limit(500)
    res.json(docs)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/nhat-trinh/:id — Chỉnh sửa nhật trình đã nộp ──────────────────
router.put('/:id', async (req, res) => {
  try {
    const user = req.user
    const { id } = req.params
    const body = req.body

    // Tìm bản ghi
    const record = await NhatTrinh.findById(id)
    if (!record) return res.status(404).json({ error: 'Không tìm thấy nhật trình' })

    // Chỉ admin hoặc chính xe đó mới sửa được
    // Xe user có thể sửa nếu: maHienTai khớp HOẶC bienSo khớp
    const userBienSos = user.bienSoList || (user.bienSo ? [user.bienSo] : [])
    const canEdit = user.role === 'admin'
      || record.maHienTai === user.maHienTai
      || record.maHienTai === user.username
      || userBienSos.includes(record.bienSo)
      || record.bienSo === user.bienSo
    if (!canEdit)
      return res.status(403).json({ error: 'Không có quyền chỉnh sửa' })

    // Tính lại tongKmDiChuyen
    const kmDau  = Number(body.kmDauThang)  || record.kmDauThang
    const kmCuoi = Number(body.kmCuoiThang) || record.kmCuoiThang
    const tongKm = kmCuoi - kmDau

    // Validate cơ bản
    if (tongKm < 0)
      return res.status(400).json({ error: 'Km cuối tháng phải lớn hơn km đầu tháng' })

    // Cập nhật tất cả các trường
    const fields = [
      'kmDauThang','kmCuoiThang','kmDuongDeo',
      'tgSuDungCau','tongLitDau','tongTienDau',
      'tongKLChuyen','klNoiBo','soChuyenXe',
      'cpThueNgoai','klThueNgoai','ghiChu',
    ]
    fields.forEach(f => {
      if (body[f] !== undefined) record[f] = body[f]
    })
    record.tongKmDiChuyen = tongKm
    record.updatedAt = new Date()
    record.updatedBy = user.username

    await record.save()
    res.json({ success: true, record })
  } catch(e) {
    console.error('PUT nhatTrinh error:', e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
