// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/bdsc.js
// Routes: bảo dưỡng sửa chữa, lốp xe, giấy tờ xe
// Thêm vào index.js:
//   const bdscRoutes = require('./routes/bdsc')
//   app.use('/api/bdsc', protect, bdscRoutes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router  = require('express').Router()
const mongoose = require('mongoose')
const { BDSC, LopXe, GiayTo } = require('../models/BDSC')

// ── Helpers ──────────────────────────────────────────────
const normBienSo = s => (s || '').toUpperCase().replace(/\s+/g, '').replace(/[.\-]/g, '')

// Phát hiện cảnh báo bất thường cho 1 phiếu mới
async function detectAnomaly(bienSo, kmMoi, tongTienMoi, hangMucMoi) {
  const warnings = []

  // 1. Kiểm tra trùng hạng mục trong khoảng km ngắn
  const MIN_KM_INTERVAL = {
    'thay dầu': 4000, 'thay nhớt': 4000, 'lọc dầu': 4000,
    'lọc gió': 15000, 'thay lốp': 30000, 'dầu hộp số': 25000,
  }
  const recent = await BDSC.find({ bienSo, kmThoiDiem: { $gte: kmMoi - 30000 } })
    .sort({ kmThoiDiem: -1 }).limit(10).lean()

  for (const hm of hangMucMoi) {
    const key = Object.keys(MIN_KM_INTERVAL).find(k => hm.ten.toLowerCase().includes(k))
    if (!key) continue
    const minInterval = MIN_KM_INTERVAL[key]
    for (const prev of recent) {
      const dupHM = (prev.hangMuc || []).find(h => h.ten.toLowerCase().includes(key))
      if (dupHM && Math.abs(kmMoi - prev.kmThoiDiem) < minInterval) {
        warnings.push(`${hm.ten}: đã thực hiện ở ${prev.kmThoiDiem.toLocaleString()}km (cách ${Math.abs(kmMoi - prev.kmThoiDiem).toLocaleString()}km)`)
      }
    }
  }

  // 2. Tổng tiền lệch >50% so với trung bình 3 lần gần nhất
  if (recent.length >= 2) {
    const avg = recent.slice(0, 3).reduce((s, r) => s + (r.tongTien || 0), 0) / Math.min(3, recent.length)
    if (avg > 0 && tongTienMoi > avg * 1.5) {
      warnings.push(`Tổng tiền ${tongTienMoi.toLocaleString()}đ — cao hơn 50% trung bình (${Math.round(avg).toLocaleString()}đ)`)
    }
  }

  return warnings.join(' | ')
}

// ═══════════════════════════════════════════════════════
// BDSC — Phiếu bảo dưỡng sửa chữa
// ═══════════════════════════════════════════════════════

// GET /api/bdsc/alerts  — tất cả xe cần bảo dưỡng sớm
router.get('/alerts', async (req, res) => {
  try {
    // Lấy km hiện tại từ gps_km_history
    const gpsData = await mongoose.connection.db.collection('gps_km_history')
      .find({}).sort({ ngay: -1 }).toArray()

    // Map bienSo -> km mới nhất
    const kmMap = {}
    for (const g of gpsData) {
      const bs = normBienSo(g.bienSo)
      if (!kmMap[bs]) kmMap[bs] = g.totalKm || 0
    }

    // Lần cuối BDSC định kỳ mỗi xe
    const lastBD = await BDSC.aggregate([
      { $match: { loaiBdsc: 'baoDuongDinhKy' } },
      { $sort: { kmThoiDiem: -1 } },
      { $group: { _id: '$bienSo', kmCuoi: { $first: '$kmThoiDiem' }, ngayCuoi: { $first: '$ngay' } } },
    ])
    const lastBDMap = {}
    for (const l of lastBD) lastBDMap[normBienSo(l._id)] = l

    const CHU_KY_XE_TAI = 5000
    const alerts = []

    for (const [bs, kmHienTai] of Object.entries(kmMap)) {
      if (!kmHienTai) continue
      const last = lastBDMap[bs]
      const kmCuoi = last?.kmCuoi || 0
      const kmDaChay = kmHienTai - kmCuoi

      const MOC = [5000, 10000, 15000, 20000, 25000, 30000]
      const chuKy = 30000
      const kmTrongChu = kmDaChay % chuKy
      const mocTiepTheo = MOC.find(m => m > kmTrongChu) || chuKy
      const conLai = mocTiepTheo - kmTrongChu
      const pct = kmTrongChu / mocTiepTheo

      if (pct >= 0.9) {
        alerts.push({
          bienSo: bs, kmHienTai, kmCuoi, kmDaChay,
          mocTiepTheo: kmCuoi + mocTiepTheo,
          conLai, pct,
          status: pct >= 1 ? 'crit' : 'warn',
          ngayCuoiBD: last?.ngayCuoi || null,
        })
      }
    }

    alerts.sort((a, b) => a.conLai - b.conLai)
    res.json(alerts)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bdsc?bienSo=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const { bienSo, page = 1, limit = 20, loai } = req.query
    const filter = {}
    if (bienSo) filter.bienSo = { $regex: normBienSo(bienSo), $options: 'i' }
    if (loai)   filter.loaiBdsc = loai
    const total = await BDSC.countDocuments(filter)
    const data  = await BDSC.find(filter)
      .sort({ ngay: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean()
    res.json({ data, total, page: +page, limit: +limit })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bdsc/history/:bienSo
router.get('/history/:bienSo', async (req, res) => {
  try {
    const bs = normBienSo(req.params.bienSo)
    const data = await BDSC.find({ bienSo: { $regex: bs, $options: 'i' } })
      .sort({ kmThoiDiem: 1 }).lean()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/bdsc  — tạo phiếu mới
router.post('/', async (req, res) => {
  try {
    const body = req.body
    if (!body.bienSo || !body.ngay || !body.kmThoiDiem)
      return res.status(400).json({ error: 'Thiếu bienSo, ngay, hoặc kmThoiDiem' })

    const canhBao = await detectAnomaly(
      normBienSo(body.bienSo),
      body.kmThoiDiem,
      body.tongTien,
      body.hangMuc || []
    )
    const doc = new BDSC({ ...body, bienSo: normBienSo(body.bienSo), canhBao,
      nguoiTao: req.user?.username || '' })
    await doc.save()
    res.status(201).json(doc)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/bdsc/:id
router.put('/:id', async (req, res) => {
  try {
    const doc = await BDSC.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy' })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bdsc/:id
router.delete('/:id', async (req, res) => {
  try {
    await BDSC.findByIdAndDelete(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Stats: tổng chi phí theo xe, theo gara ───────────────
router.get('/stats/cost', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query
    const match = {}
    if (fromDate || toDate) {
      match.ngay = {}
      if (fromDate) match.ngay.$gte = new Date(fromDate)
      if (toDate)   match.ngay.$lte = new Date(toDate)
    }
    const [byXe, byGara] = await Promise.all([
      BDSC.aggregate([
        { $match: match },
        { $group: { _id: '$bienSo', total: { $sum: '$tongTien' }, count: { $sum: 1 },
            lastKm: { $max: '$kmThoiDiem' } } },
        { $sort: { total: -1 } }, { $limit: 20 },
      ]),
      BDSC.aggregate([
        { $match: { ...match, gara: { $ne: '' } } },
        { $group: { _id: '$gara', total: { $sum: '$tongTien' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } }, { $limit: 10 },
      ]),
    ])
    res.json({ byXe, byGara })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════
// LỐP XE
// ═══════════════════════════════════════════════════════

// GET /api/bdsc/tire/:bienSo
router.get('/tire/:bienSo', async (req, res) => {
  try {
    const bs = normBienSo(req.params.bienSo)
    const doc = await LopXe.findOne({ bienSo: bs }).lean()
    res.json(doc || { bienSo: bs, cauHinh: '6', viTriLop: [] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/bdsc/tire/:bienSo  — upsert cấu hình lốp
router.put('/tire/:bienSo', async (req, res) => {
  try {
    const bs = normBienSo(req.params.bienSo)
    const doc = await LopXe.findOneAndUpdate(
      { bienSo: bs },
      { ...req.body, bienSo: bs, updatedAt: new Date() },
      { new: true, upsert: true }
    )
    res.json(doc)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bdsc/tire-alerts — xe cần đảo/thay lốp sớm
router.get('/tire-alerts', async (req, res) => {
  try {
    const gpsData = await mongoose.connection.db.collection('gps_km_history')
      .find({}).sort({ ngay: -1 }).toArray()
    const kmMap = {}
    for (const g of gpsData) {
      const bs = normBienSo(g.bienSo)
      if (!kmMap[bs]) kmMap[bs] = g.totalKm || 0
    }
    const lopDocs = await LopXe.find({}).lean()
    const alerts = []
    for (const lop of lopDocs) {
      const km = kmMap[normBienSo(lop.bienSo)] || 0
      for (const vt of (lop.viTriLop || [])) {
        if (!vt.kmLap) continue
        const kmChay = km - vt.kmLap
        const chuKyThay = vt.boBố === 'kem' ? 80000 : 50000
        const chuKyDao = 10000
        const kmDenDao = chuKyDao - (kmChay % chuKyDao)
        const kmDenThay = chuKyThay - kmChay
        if (kmDenDao < 2000 || kmDenThay < 5000) {
          alerts.push({ bienSo: lop.bienSo, viTri: vt.viTri, loaiLop: vt.loaiLop,
            kmChay, kmDenDao, kmDenThay, boBố: vt.boBố,
            type: kmDenThay < 5000 ? 'thay' : 'dao' })
        }
      }
    }
    res.json(alerts.sort((a, b) => a.kmDenDao - b.kmDenDao))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════
// GIẤY TỜ XE
// ═══════════════════════════════════════════════════════

// GET /api/bdsc/docs/:bienSo
router.get('/docs/:bienSo', async (req, res) => {
  try {
    const bs = normBienSo(req.params.bienSo)
    const doc = await GiayTo.findOne({ bienSo: bs }).lean()
    res.json(doc || { bienSo: bs })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bdsc/docs-alerts  — xe có giấy tờ sắp hết hạn
router.get('/docs-alerts', async (req, res) => {
  try {
    const ngayNay = new Date()
    const sap30 = new Date(ngayNay.getTime() + 30 * 86400000)
    const FIELDS = ['dangKy', 'dangKiem', 'baoHiemBatBuoc', 'baoHiemThuHai', 'phuHieu', 'kiemDinhCau']
    const docs = await GiayTo.find({}).lean()
    const alerts = []
    for (const doc of docs) {
      for (const f of FIELDS) {
        if (!doc[f]) continue
        const d = new Date(doc[f])
        const diffDays = Math.ceil((d - ngayNay) / 86400000)
        if (diffDays <= 30) {
          alerts.push({ bienSo: doc.bienSo, field: f, ngayHetHan: doc[f], diffDays,
            status: diffDays < 0 ? 'expired' : diffDays <= 15 ? 'crit' : 'warn' })
        }
      }
    }
    res.json(alerts.sort((a, b) => a.diffDays - b.diffDays))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/bdsc/docs/:bienSo  — upsert giấy tờ
router.put('/docs/:bienSo', async (req, res) => {
  try {
    const bs = normBienSo(req.params.bienSo)
    const doc = await GiayTo.findOneAndUpdate(
      { bienSo: bs },
      { ...req.body, bienSo: bs, updatedAt: new Date() },
      { new: true, upsert: true }
    )
    res.json(doc)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
