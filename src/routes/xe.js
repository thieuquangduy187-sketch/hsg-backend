// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/xe.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    const query = { $or: [{ 'Mã TS kế toán': id }, { 'Mã TS kế toán': parseInt(id) }] }
    const setObj = { [dbField]: body.value }

    // ── Khi thay đổi cửa hàng → ghi nhận vào cây điều động ──────────────────
    if (body.field === 'cuaHang' && body.oldValue && body.oldValue !== body.value) {
      const now  = new Date()
      const dd   = String(now.getDate()).padStart(2, '0')
      const mm   = String(now.getMonth() + 1).padStart(2, '0')
      const yyyy = now.getFullYear()
      const entry = `${dd}/${mm}/${yyyy}: ${body.oldValue} → ${body.value}`

      // Lấy cayDieuDong hiện tại của xe
      const xe = await Xe.findOne(query, { 'Cây điều động': 1 }).lean()
      const existing = xe?.['Cây điều động'] ? String(xe['Cây điều động']).trim() : ''
      setObj['Cây điều động'] = existing ? `${existing} // ${entry}` : entry
    }

    const result = await Xe.updateOne(query, { $set: setObj })
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy xe' })
    res.json({ success: true, cayDieuDong: setObj['Cây điều động'] || null })
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

    // Field name mapper: normalize Excel headers → MongoDB field names
    // Handles case/accent variations
    function mapRow(row) {
      const mapped = {}
      // Direct pass-through first (preserve all original fields)
      Object.assign(mapped, row)

      // Normalize common field name variations
      const get = (...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== '') return String(row[k]).trim()
        }
        return undefined
      }

      const bienSo    = get('BIỂN SỐ','Biển số','Biển Số','bien so','BienSo','BIEN SO')
      const maTaiSan  = get('Mã TS kế toán','Ma TS ke toan','Mã TS','MaTaiSan')
      const maHienTai = get('Mã hiện tại','Ma hien tai','MaHienTai')
      const tenTS     = get('TÊN TÀI SẢN','Tên tài sản','Ten tai san','TenTaiSan')
      const loaiThung = get('Loại Thùng','Loại Thùng (Lửng, mui bạt, có cẩu)','Loai Thung','LoaiThung','LOẠI THÙNG')
      const loaiXe    = get('Loại xe','Loại Xe (Hãng)','Loai Xe','loaiXe','LoaiXe','LOẠI XE')
      const taiTrong  = get('Tải trọng','Tai trong','taiTrong','TaiTrong')
      const cuaHang   = get('Cưả hàng sử dụng','Cửa hàng sử dụng','Cửa hàng','Cua hang','cuaHang','CuaHang','Cửa Hàng')
      const tinhMoi   = get('Tỉnh mới','Tinh moi','tinhMoi','Tỉnh','TỈNH MỚI','Tinh Moi')
      const mien      = get('Miền','Mien','mien')
      const namSX     = get('Năm SX','Nam SX','namSX','NamSX','Năm sản xuất')
      const phapNhan  = get('Pháp nhân đứng tên','Phap nhan','phapNhan')
      const nguyenGia = get(' Nguyên giá','Nguyên giá','Nguyen gia','nguyenGia')
      const gtcl      = get(' GTCL','GTCL','gtcl')
      const maHienTai2= get('Mã hiện tại2','Ma hien tai 2')
      const tinhCu    = get('Tỉnh Cũ','Tỉnh cũ','Tinh cu')
      const tinhGop   = get('Tỉnh gộp','Tinh gop')
      const maTaiSanKT= get('Mã TS kế toán','Ma TS ke toan')

      // Write to MongoDB canonical field names
      if (bienSo)    { mapped['BIỂN SỐ'] = bienSo; mapped['BIẼNSỐ'] = bienSo }
      if (maTaiSanKT) mapped['Mã TS kế toán'] = maTaiSanKT
      if (maHienTai)  mapped['Mã hiện tại'] = maHienTai
      if (maHienTai2) mapped['Mã hiện tại2'] = maHienTai2
      if (tenTS)      mapped['TÊN TÀI SẢN'] = tenTS
      if (loaiThung)  { mapped['Loại Thùng\n(Lửng, mui bạt, có cẩu)'] = loaiThung; mapped['Loại Thùng'] = loaiThung }
      if (loaiXe)     mapped['Loại xe'] = loaiXe
      if (taiTrong)   { mapped['Tải trọng \n(Tấn)'] = taiTrong; mapped['Tải trọng'] = taiTrong }
      if (cuaHang)    mapped['Cưả hàng sử dụng'] = cuaHang
      if (tinhMoi)    mapped['Tỉnh mới'] = tinhMoi
      if (tinhCu)     mapped['Tỉnh Cũ'] = tinhCu
      if (tinhGop)    mapped['Tỉnh gộp'] = tinhGop
      if (mien)       mapped['Miền'] = mien
      if (namSX)      mapped['Năm SX'] = namSX
      if (phapNhan)   mapped['Pháp nhân đứng tên'] = phapNhan
      if (nguyenGia)  mapped[' Nguyên giá'] = nguyenGia
      if (gtcl)       mapped[' GTCL'] = gtcl

      return mapped
    }

    let upserted = 0, skipped = 0, errors = 0
    const skippedRows = []

    // Log first row headers for debugging
    if (rows.length > 0) {
      console.log('Upload headers:', Object.keys(rows[0]).join(', '))
    }

    for (const row of rows) {
      try {
        const mapped = mapRow(row)

        // Try to match by Mã TS kế toán or Biển số
        const maTaiSan = String(mapped['Mã TS kế toán'] || '').trim()
        const bienSo   = String(mapped['BIỂN SỐ'] || '').trim()

        if (!maTaiSan && !bienSo) { skipped++; skippedRows.push(row); continue }

        // Match priority: Mã TS kế toán first, then biển số variants
        // Normalize biển số: remove spaces, handle dot/comma variants
        const bienSoNorm = bienSo.replace(/\s/g,'').toUpperCase()

        let filter
        if (bienSo) {
          // Always match by biển số first (most reliable)
          filter = { $or: [
            { 'BIỂN SỐ': bienSo },
            { 'BIẼNSỐ':  bienSo },
            { 'Biển số': bienSo },
          ]}
        } else if (maTaiSan) {
          filter = { 'Mã TS kế toán': maTaiSan }
        } else {
          skipped++
          skippedRows.push({ row: JSON.stringify(row).substring(0,100) })
          continue
        }

        const result = await col.updateOne(filter, { $set: mapped }, { upsert: true })
        if (result.matchedCount === 0 && result.upsertedCount === 0) {
          console.log('No match for:', bienSo, '| Mã TS:', maTaiSan)
        }
        upserted++
      } catch(e) {
        console.error('Upload row error:', e.message)
        errors++
      }
    }

    res.json({
      success: true,
      total:    rows.length,
      upserted, skipped, errors,
      skippedRows: skippedRows.slice(0,10),
      message:  `Đã cập nhật ${upserted} xe, bỏ qua ${skipped}, lỗi ${errors}`,
    })
  } catch(e) {
    console.error('upload error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/xe/upload/preview — Preview Excel headers & mapping ─────────────
router.post('/upload/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không có file' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (!rows.length) return res.status(400).json({ error: 'File trống' })

    res.json({
      headers:   Object.keys(rows[0]),
      sample:    rows.slice(0, 3),
      totalRows: rows.length,
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/xe/debug/:id — Show raw MongoDB doc fields (admin debug)
router.get('/debug/:bienSo', async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const doc = await mongoose.connection.db.collection('xetai')
      .findOne({ 'BIỂN SỐ': req.params.bienSo })
    if (!doc) return res.status(404).json({ error: 'Not found' })
    // Return all field names and values (exclude _id)
    const fields = {}
    Object.entries(doc).forEach(([k,v]) => {
      if (k !== '_id') fields[k] = typeof v === 'string' ? v.substring(0,50) : v
    })
    res.json({ fieldCount: Object.keys(fields).length, fields })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
