const router   = require('express').Router()
const mongoose = require('mongoose')
const multer   = require('multer')
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } })

// ── POST /api/xe-hoat-dong/upload — Upload CSV, save to xedunghoatdong ────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file' })

    const text = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '')

    // CSV parser that handles quoted fields
    function parseCSV(text) {
      return text.split(/\r?\n/).map(line => {
        const fields = []; let cur = '', inQ = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') inQ = !inQ
          else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
          else cur += ch
        }
        fields.push(cur.trim())
        return fields
      })
    }

    const allRows = parseCSV(text)

    // Find header row
    let headerIdx = -1
    for (let i = 0; i < Math.min(5, allRows.length); i++) {
      if (/biển số|bien so|STT/i.test(allRows[i].join(','))) { headerIdx = i; break }
    }
    if (headerIdx < 0) return res.status(400).json({ error: 'Không tìm thấy dòng tiêu đề' })

    const headers = allRows[headerIdx].map(h => h.replace(/["\uFEFF]/g,'').trim())
    const keyTT  = headers.find(h => /tình trạng|tinh trang/i.test(h)) || ''
    const keyBS  = headers.find(h => /biển số|bien so/i.test(h)) || headers[1] || ''
    const keyCH  = headers.find(h => /cửa hàng|cua hang/i.test(h)) || ''
    const keyTinh= headers.find(h => /^tỉnh$|^tinh$/i.test(h)) || ''
    const keyKm  = headers.find(h => /tổng km|km gps/i.test(h)) || ''
    const keyNgay= headers.find(h => /số ngày|ngay hoat/i.test(h)) || ''
    const keyLoai= headers.find(h => /loại xe/i.test(h)) || ''

    const rows = []
    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const vals = allRows[i]
      if (!vals[0] || !/^\d+$/.test(vals[0].trim())) continue
      const obj = {}
      headers.forEach((h, j) => { obj[h] = (vals[j]||'').replace(/"/g,'').trim() })

      const tt = String(obj[keyTT]||'').trim()
      let tinhTrang = 'Hoạt động'
      if (tt === 'Dừng hoạt động' || /^dừng/i.test(tt)) tinhTrang = 'Dừng hoạt động'
      else if (tt === 'Hoạt động kém hiệu quả' || /kém|kem hiệu/i.test(tt)) tinhTrang = 'Hoạt động kém hiệu quả'

      rows.push({
        bienSo:      obj[keyBS]   || '',
        cuaHang:     obj[keyCH]   || '',
        tinh:        obj[keyTinh] || '',
        loaiXe:      obj[keyLoai] || '',
        kmGPS:       parseFloat(String(obj[keyKm]||'').replace(/,/g,'')) || 0,
        soNgayHoatDong: parseInt(obj[keyNgay]) || 0,
        tinhTrang,
        rawTT: tt,
      })
    }

    if (!rows.length) return res.status(400).json({ error: 'Không có dữ liệu' })

    // Save to collection - replace all docs with new upload
    const db  = mongoose.connection.db
    const col = db.collection('xedunghoatdong')

    // Keep history: add uploadedAt
    const uploadedAt = new Date()
    const fileName   = req.file.originalname

    // Delete old records from same upload batch (keep history by period)
    // For simplicity: replace all
    await col.deleteMany({})
    await col.insertMany(rows.map(r => ({ ...r, uploadedAt, fileName })))

    const summary = {
      total:  rows.length,
      dung:   rows.filter(r => r.tinhTrang === 'Dừng hoạt động').length,
      kem:    rows.filter(r => r.tinhTrang === 'Hoạt động kém hiệu quả').length,
      hd:     rows.filter(r => r.tinhTrang === 'Hoạt động').length,
    }

    res.json({ success: true, fileName, uploadedAt, ...summary })
  } catch(e) {
    console.error('xeHoatDong upload error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/xe-hoat-dong — Lấy dữ liệu đã lưu ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db  = mongoose.connection.db
    const col = db.collection('xedunghoatdong')
    const rows = await col.find({}).toArray()

    if (!rows.length) return res.json({ available: false })

    const { uploadedAt, fileName } = rows[0]
    const dung = rows.filter(r => r.tinhTrang === 'Dừng hoạt động')
    const kem  = rows.filter(r => r.tinhTrang === 'Hoạt động kém hiệu quả')
    const hd   = rows.filter(r => r.tinhTrang === 'Hoạt động')

    res.json({
      available: true, fileName, uploadedAt,
      total: rows.length,
      summary: { dung: dung.length, kem: kem.length, hoatDong: hd.length },
      rows: rows.map(r => ({
        bienSo: r.bienSo, cuaHang: r.cuaHang, tinh: r.tinh,
        loaiXe: r.loaiXe, kmGPS: r.kmGPS, soNgay: r.soNgayHoatDong,
        tinhTrang: r.tinhTrang,
      })),
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
