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
  ghiChu: { type: String, default: '' },
}, { collection: 'ntxt' })
ntSchema.index({ maHienTai: 1, thang: 1, nam: 1 }, { unique: true })
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

    const xe = await Xe.findOne({
      $or: [{ 'Mã hiện tại': user.maHienTai || user.username },
            { 'Mã hiện tại2': user.maHienTai || user.username }]
    }).lean()

    const bienSo = xe ? (xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || '') : (user.bienSo || body.bienSo || '')

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

    const exists = await NhatTrinh.findOne({ maHienTai: user.username, thang, nam })
    if (exists) return res.status(409).json({ error: `Đã nộp nhật trình tháng ${thang}/${nam}.` })

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

module.exports = router
