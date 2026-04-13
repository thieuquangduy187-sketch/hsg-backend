const router = require('express').Router()
const Xe = require('../models/Xe')

// ── GET /api/xe — list với filter, sort, pagination ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', mien='', loaiThung='', sortBy='STT', sortDir='1' } = req.query
    const filter = {}
    if (search) {
      filter.$or = [
        { 'BIỂN SỐ':          { $regex: search, $options: 'i' } },
        { 'Cưả hàng sử dụng': { $regex: search, $options: 'i' } },
        { 'Tỉnh mới':         { $regex: search, $options: 'i' } },
      ]
    }
    if (mien) filter['Miền'] = mien
    const sort = { [sortBy === 'bienSo' ? 'BIỂN SỐ' : 'STT']: 1 }
    const skip  = (parseInt(page)-1) * parseInt(limit)
    const total = await Xe.countDocuments(filter)
    const docs  = await Xe.find(filter).sort(sort).skip(skip).limit(parseInt(limit))
    res.json({ total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)), rows: docs.map(d=>d.toAPI()) })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/xe/all ───────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const docs = await Xe.find({}).sort({ STT: 1 })
    res.json(docs.map(d => d.toAPI()))
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── DEBUG: xem raw keys của document ─────────────────────────────────────────
// PHẢI đặt TRƯỚC route /:maTaiSan
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

router.get('/raw', async (req, res) => {
  try {
    const doc = await Xe.findOne({}).lean()
    res.json(doc)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/xe/:maTaiSan ─────────────────────────────────────────────────────
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

// ── PUT /api/xe/:maTaiSan ─────────────────────────────────────────────────────
router.put('/:maTaiSan', async (req, res) => {
  try {
    const id   = req.params.maTaiSan
    const body = req.body
    const fieldMap = {
      bienSo: 'BIỂN SỐ', phapNhan: 'Pháp nhân đứng tên',
      tenTaiSan: 'TÊN TÀI SẢN', loaiXe: 'Loại xe',
      cuaHang: 'Cưả hàng sử dụng', tinhMoi: 'Tỉnh mới',
      mien: 'Miền', namSX: 'Năm SX', hinhAnh: 'Hình ảnh',
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

// ── GET /api/xe/images?folder=URL ────────────────────────────────────────────
// Lấy ảnh từ public Google Drive folder — không cần API key
router.get('/images', async (req, res) => {
  try {
    const folderUrl = req.query.folder || ''
    if (!folderUrl) return res.json({ urls: [] })

    // Extract folder ID from URL
    const m = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (!m) return res.json({ urls: [] })
    const folderId = m[1]

    // Fetch the public folder page — Google renders file list in HTML
    const pageRes = await fetch(
      `https://drive.google.com/drive/folders/${folderId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HSGBot/1.0)' } }
    )
    const html = await pageRes.text()

    // Extract Google Drive file IDs from page source
    // File IDs are 33-char strings starting with 1 and containing alphanumeric + _-
    const seen = new Set()
    const urls = []
    const regex = /"(1[a-zA-Z0-9_-]{32})"/g
    let match
    while ((match = regex.exec(html)) !== null) {
      const id = match[1]
      if (!seen.has(id)) {
        seen.add(id)
        urls.push(`https://lh3.googleusercontent.com/d/${id}`)
      }
    }

    res.json({ urls: urls.slice(0, 50) })
  } catch(e) {
    res.status(500).json({ error: e.message, urls: [] })
  }
})

module.exports = router
