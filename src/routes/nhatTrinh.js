const router     = require('express').Router()
const NhatTrinh  = require('../models/NhatTrinh')
const Xe         = require('../models/Xe')
const { protect } = require('../middleware/auth')

// ── POST /api/nhat-trinh — Cửa hàng nộp nhật trình ──────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const user = req.user
    const body = req.body

    // Validate quyền: chỉ role 'xe' mới được nộp
    if (user.role !== 'xe' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền nộp nhật trình.' })
    }

    const now   = new Date()
    const thang = parseInt(body.thang) || now.getMonth() + 1
    const nam   = parseInt(body.nam)   || now.getFullYear()

    // Tìm xe theo maHienTai (username của xe user)
    const xe = await Xe.findOne({
      $or: [
        { 'Mã hiện tại': user.username },
        { 'Mã hiện tại2': user.username },
      ]
    }).lean()

    if (!xe && user.role !== 'admin') {
      return res.status(404).json({ error: 'Không tìm thấy xe tương ứng.' })
    }

    const bienSo = xe ? (xe['BIỂN SỐ'] || xe['BIỂNSỐ'] || '') : (body.bienSo || '')

    // Validate số liệu
    const kmDau    = Number(body.kmDauThang)  || 0
    const kmCuoi   = Number(body.kmCuoiThang) || 0
    const tongKm   = kmCuoi - kmDau
    const kmDeo    = Number(body.kmDuongDeo)  || 0
    const litDau   = Number(body.tongLitDau)  || 0
    const tienDau  = Number(body.tongTienDau) || 0
    const tongKL   = Number(body.tongKLChuyen)|| 0
    const klNoiBo  = Number(body.klNoiBo)     || 0

    const errors = []
    if (tongKm <= 0)        errors.push('Số km cuối tháng phải lớn hơn số km đầu tháng.')
    if (kmDeo > tongKm)     errors.push('Số km đường đèo không thể lớn hơn tổng km di chuyển.')
    if (klNoiBo > tongKL)   errors.push('Khối lượng nội bộ không thể lớn hơn tổng khối lượng chuyên chở.')

    if (errors.length) return res.status(400).json({ errors })

    // Kiểm tra đã nộp chưa
    const exists = await NhatTrinh.findOne({ maHienTai: user.username, thang, nam })
    if (exists) {
      return res.status(409).json({ error: `Đã nộp nhật trình tháng ${thang}/${nam}. Liên hệ admin để sửa.` })
    }

    const doc = new NhatTrinh({
      bienSo,
      maHienTai:    user.username,
      thang, nam,
      submittedBy:  user.username,
      submittedAt:  new Date(),
      kmDauThang:   kmDau,
      kmCuoiThang:  kmCuoi,
      tongKmDiChuyen: tongKm,
      kmDuongDeo:   kmDeo,
      tgSuDungCau:  Number(body.tgSuDungCau)  || 0,
      tongLitDau:   litDau,
      tongTienDau:  tienDau,
      tongKLChuyen: tongKL,
      klNoiBo,
      soChuyenXe:   Number(body.soChuyenXe)   || 0,
      cpThueNgoai:  Number(body.cpThueNgoai)   || 0,
      klThueNgoai:  Number(body.klThueNgoai)   || 0,
      ghiChu:       body.ghiChu || '',
    })

    await doc.save()
    res.status(201).json({ success: true, message: `Nộp nhật trình tháng ${thang}/${nam} thành công!` })

  } catch(e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Đã nộp nhật trình tháng này rồi.' })
    }
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/nhat-trinh/mine — Lịch sử nộp của xe hiện tại ──────────────────
router.get('/mine', protect, async (req, res) => {
  try {
    const docs = await NhatTrinh
      .find({ maHienTai: req.user.username })
      .sort({ nam: -1, thang: -1 })
      .limit(24)
    res.json(docs)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/nhat-trinh — Admin xem tất cả ───────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Chỉ admin mới xem được.' })
    }
    const { thang, nam } = req.query
    const filter = {}
    if (thang) filter.thang = parseInt(thang)
    if (nam)   filter.nam   = parseInt(nam)

    const docs = await NhatTrinh.find(filter).sort({ submittedAt: -1 }).limit(500)
    res.json(docs)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
