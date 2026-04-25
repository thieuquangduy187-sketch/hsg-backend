const router = require('express').Router()
const Xe = require('../models/Xe')

// ══════════════════════════════════════════════════════════════════════════════
// TẤT CẢ ROUTES CỐ ĐỊNH PHẢI ĐẶT TRƯỚC /:maTaiSan
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/xe — list có filter, pagination
router.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', mien='', sortBy='STT', sortDir='1' } = req.query
    const filter = {}
    if (search) {
      filter.$or = [
        { 'BIỂN SỐ':          { $regex: search, $options: 'i' } },
        { 'Cưả hàng sử dụng': { $regex: search, $options: 'i' } },
        { 'Tỉnh mới':         { $regex: search, $options: 'i' } },
      ]
    }
    if (mien) filter['Miền'] = mien
    const sort = { STT: 1 }
    const skip  = (parseInt(page)-1) * parseInt(limit)
    const total = await Xe.countDocuments(filter)
    const docs  = await Xe.find(filter).sort(sort).skip(skip).limit(parseInt(limit))
    res.json({ total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), rows: docs.map(d=>d.toAPI()) })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/xe/all — tất cả rows
router.get('/all', async (req, res) => {
  try {
    const docs = await Xe.find({}).sort({ STT: 1 })
    res.json(docs.map(d => d.toAPI()))
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/xe/images?folder=URL — lấy ảnh từ Google Drive folder public
router.get('/images', async (req, res) => {
  try {
    const folderUrl = req.query.folder || ''
    if (!folderUrl) return res.json({ urls: [] })

    // Extract folder ID từ URL
    const m = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (!m) return res.json({ urls: [] })
    const folderId = m[1]

    const apiKey = process.env.GOOGLE_API_KEY

    if (apiKey) {
      // Có API key: dùng Drive API v3
      const apiUrl = `https://www.googleapis.com/drive/v3/files` +
        `?q=%27${folderId}%27+in+parents+and+mimeType+contains+%27image/%27+and+trashed%3Dfalse` +
        `&fields=files(id%2Cname)&pageSize=50&key=${apiKey}`
      const resp = await fetch(apiUrl)
      const data = await resp.json()
      if (!data.error && data.files) {
        const urls = data.files.map(f => `https://lh3.googleusercontent.com/d/${f.id}`)
        return res.json({ urls })
      }
    }

    // Không có API key: scrape HTML của folder public để lấy file IDs
    const html = await fetch(
      `https://drive.google.com/drive/folders/${folderId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' } }
    ).then(r => r.text())

    const fileIds = []
    const regex = /\/file\/d\/([a-zA-Z0-9_-]{25,})/g
    let match
    while ((match = regex.exec(html)) !== null) {
      if (!fileIds.includes(match[1])) fileIds.push(match[1])
    }

    const urls = fileIds.map(id => `https://lh3.googleusercontent.com/d/${id}`)
    res.json({ urls, source: 'scrape', count: urls.length })

  } catch(e) {
    res.status(500).json({ error: e.message, urls: [] })
  }
})

// GET /api/xe/raw — debug: xem 1 document thô
router.get('/raw', async (req, res) => {
  try {
    const doc = await Xe.findOne({}).lean()
    res.json(doc)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/xe/keys — debug: xem tên tất cả fields
router.get('/keys', async (req, res) => {
  try {
    const doc = await Xe.findOne({}).lean()
    const keys = Object.keys(doc).map(k => ({
      repr: JSON.stringify(k),
      val:  String(doc[k]).substring(0, 50)
    }))
    res.json(keys)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE ĐỘNG — ĐẶT SAU TẤT CẢ ROUTES CỐ ĐỊNH
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/xe/:maTaiSan — chi tiết 1 xe
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
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/xe/:maTaiSan — cập nhật 1 xe
router.put('/:maTaiSan', async (req, res) => {
  try {
    const id   = req.params.maTaiSan
    const body = req.body
    const fieldMap = {
      bienSo:    'BIỂN SỐ',
      phapNhan:  'Pháp nhân đứng tên',
      tenTaiSan: 'TÊN TÀI SẢN',
      loaiXe:    'Loại xe',
      cuaHang:   'Cưả hàng sử dụng',
      tinhMoi:   'Tỉnh mới',
      mien:      'Miền',
      namSX:     'Năm SX',
      hinhAnh:   'Hình ảnh',
    }
    const dbField = fieldMap[body.field]
    if (!dbField) return res.status(400).json({ error: 'Invalid field: ' + body.field })
    const result = await Xe.updateOne(
      { $or: [{ 'Mã TS kế toán': id }, { 'Mã TS kế toán': parseInt(id) }] },
      { $set: { [dbField]: body.value } }
    )
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy xe' })
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/xe/upload — Upload Excel to update xetai collection ────────────
const multer = require('multer')
const XLSX   = require('xlsx')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không có file' })

    const ext = req.file.originalname.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext))
      return res.status(400).json({ error: 'Chỉ hỗ trợ file .xlsx, .xls, .csv' })

    // Parse file
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

    if (!rows.length) return res.status(400).json({ error: 'File không có dữ liệu' })

    const mongoose = require('mongoose')
    const db = mongoose.connection.db
    const col = db.collection('xetai')

    let upserted = 0, skipped = 0, errors = 0

    for (const row of rows) {
      try {
        // Try to match by Mã TS kế toán or Biển số
        const maTaiSan = String(row['Mã TS kế toán'] || row['Ma TS ke toan'] || '').trim()
        const bienSo   = String(row['BIỂN SỐ'] || row['Bien So'] || row['Biển Số'] || '').trim()

        if (!maTaiSan && !bienSo) { skipped++; continue }

        const filter = maTaiSan
          ? { 'Mã TS kế toán': maTaiSan }
          : { 'BIỂN SỐ': bienSo }

        await col.updateOne(filter, { $set: row }, { upsert: true })
        upserted++
      } catch(e) { errors++ }
    }

    res.json({
      success: true,
      total:    rows.length,
      upserted, skipped, errors,
      message:  `Đã cập nhật ${upserted} xe, bỏ qua ${skipped}, lỗi ${errors}`,
    })
  } catch(e) {
    console.error('upload error:', e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
