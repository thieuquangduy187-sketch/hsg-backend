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

module.exports = router
