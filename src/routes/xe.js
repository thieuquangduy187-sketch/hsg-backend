const router = require('express').Router()
const Xe = require('../models/Xe')

// ── GET /api/xe — list với filter, sort, pagination ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      search = '', mien = '', loaiThung = '',
      sortBy = 'STT', sortDir = '1'
    } = req.query

    // Build filter
    const filter = {}
    if (search) {
      filter.$or = [
        { 'BIỂN SỐ':            { $regex: search, $options: 'i' } },
        { 'Cửa hàng sử dụng':   { $regex: search, $options: 'i' } },
        { 'Tỉnh mới':           { $regex: search, $options: 'i' } },
        { 'Mã TS kế toán':      { $regex: search, $options: 'i' } },
      ]
    }
    if (mien)      filter['Miền'] = mien
    if (loaiThung) filter['Loại Thùng (Lửng, mui bạt, có cẩu)'] = loaiThung

    // Sort
    const sortField = {
      bienSo: 'BIỂN SỐ', maTaiSan: 'Mã TS kế toán',
      mien: 'Miền', cuaHang: 'Cửa hàng sử dụng',
      tinhMoi: 'Tỉnh mới', namSX: 'Năm SX',
      nguyenGia: 'Nguyên giá', gtcl: 'GTCL',
      loaiXe: 'Loại xe', taiTrong: 'Tải trọng (Tấn)',
    }[sortBy] || 'STT'
    const sort = { [sortField]: parseInt(sortDir) === -1 ? -1 : 1 }

    const skip  = (parseInt(page) - 1) * parseInt(limit)
    const total = await Xe.countDocuments(filter)
    const docs  = await Xe.find(filter).sort(sort).skip(skip).limit(parseInt(limit))

    res.json({
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      rows:  docs.map(d => d.toAPI())
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/xe/all — tất cả rows (cho client cache) ─────────────────────────
router.get('/all', async (req, res) => {
  try {
    const docs = await Xe.find({}).sort({ STT: 1 })
    res.json(docs.map(d => d.toAPI()))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/xe/:maTaiSan — chi tiết 1 xe ─────────────────────────────────────
router.get('/:maTaiSan', async (req, res) => {
  try {
    const id = req.params.maTaiSan
    const doc = await Xe.findOne({
      $or: [
        { 'Mã TS kế toán': id },
        { 'Mã TS kế toán': parseInt(id) },
      ]
    })
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy xe: ' + id })
    res.json(doc.toAPI())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── PUT /api/xe/:maTaiSan — cập nhật 1 xe ─────────────────────────────────────
router.put('/:maTaiSan', async (req, res) => {
  try {
    const id = req.params.maTaiSan
    const body = req.body // { field, value }

    // Map API field → MongoDB field name
    const fieldMap = {
      bienSo:      'BIỂN SỐ',
      phapNhan:    'Pháp nhân đứng tên',
      tenTaiSan:   'TÊN TÀI SẢN',
      loaiThung:   'Loại Thùng (Lửng, mui bạt, có cẩu)',
      loaiXe:      'Loại xe',
      taiTrong:    'Tải trọng (Tấn)',
      cuaHang:     'Cửa hàng sử dụng',
      tinhMoi:     'Tỉnh mới',
      mien:        'Miền',
      namSX:       'Năm SX',
      hinhAnh:     'Hình ảnh',
    }

    const dbField = fieldMap[body.field]
    if (!dbField) return res.status(400).json({ error: 'Invalid field: ' + body.field })

    const result = await Xe.updateOne(
      { $or: [{ 'Mã TS kế toán': id }, { 'Mã TS kế toán': parseInt(id) }] },
      { $set: { [dbField]: body.value } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy xe' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
