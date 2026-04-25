const router   = require('express').Router()
const mongoose = require('mongoose')
const { protect, adminOnly } = require('../middleware/auth')

// ── Cache/DB model ────────────────────────────────────────────────────────────
const priceSchema = new mongoose.Schema({
  key:       { type: String, unique: true },  // "3/2026"
  thang:     Number,
  nam:       Number,
  available: { type: Boolean, default: true },
  min:       Number,
  max:       Number,
  avg:       Number,
  soLanDieuChinh: Number,
  do001:     mongoose.Schema.Types.Mixed,  // { v1, v2, list }
  do05:      mongoose.Schema.Types.Mixed,
  chiTiet:   [mongoose.Schema.Types.Mixed], // [{ ngay, do001, do05 }]
  nguon:     String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'gia_dau_cache' })

const GiaDau = mongoose.models.GiaDau
  || mongoose.model('GiaDau', priceSchema)

// ── Dữ liệu hardcode đã xác minh từ giaxanghomnay.com + moit.gov.vn ──────────
const HARDCODE = {
  '1/2026': {
    thang: 1, nam: 2026, available: true,
    min: 17850, max: 20200, avg: 18700, soLanDieuChinh: 3,
    do001: { v1: 18500, v2: 18870 },
    do05:  { v1: 17700, v2: 18054 },
    chiTiet: [],
    nguon: 'hardcode / giaxanghomnay.com',
  },
  '2/2026': {
    thang: 2, nam: 2026, available: true,
    min: 19500, max: 21500, avg: 20300, soLanDieuChinh: 3,
    do001: { v1: 20300, v2: 20706 },
    do05:  { v1: 19400, v2: 19788 },
    chiTiet: [],
    nguon: 'hardcode / giaxanghomnay.com',
  },
  '3/2026': {
    thang: 3, nam: 2026, available: true,
    // 10 kỳ: 5/3,7/3,10/3,11/3,12/3,19/3,24/3,25/3,26/3,27/3
    min: 26900, max: 39860, avg: 32144, soLanDieuChinh: 10,
    do001: { v1: 32144, v2: 32787 },
    do05:  { v1: 30778, v2: 31394 },
    chiTiet: [
      { ngay: '5/3/2026',  do001: 26900, do05: 26480 },
      { ngay: '7/3/2026',  do001: 30620, do05: 30239 },
      { ngay: '10/3/2026', do001: 27025, do05: 27025 },
      { ngay: '11/3/2026', do001: 27025, do05: 27025 },
      { ngay: '12/3/2026', do001: 27025, do05: 27025 },
      { ngay: '19/3/2026', do001: 33620, do05: 33420 },
      { ngay: '24/3/2026', do001: 39860, do05: 39660 },
      { ngay: '25/3/2026', do001: 38090, do05: 37890 },
      { ngay: '26/3/2026', do001: 35640, do05: 35440 },
      { ngay: '27/3/2026', do001: 35640, do05: 35440 },
    ],
    nguon: 'giaxanghomnay.com + moit.gov.vn (xác minh)',
  },
  '4/2026': {
    thang: 4, nam: 2026, available: true,
    // 6 kỳ: 2/4,3/4,8/4,9/4,16/4,21/4
    min: 29110, max: 44980, avg: 37397, soLanDieuChinh: 6,
    do001: { v1: 37397, v2: 38145 },
    do05:  { v1: 35780, v2: 36496 },
    chiTiet: [
      { ngay: '2/4/2026',  do001: 41020, do05: 40820 },
      { ngay: '3/4/2026',  do001: 44980, do05: 44780 },
      { ngay: '8/4/2026',  do001: 43240, do05: 42840 },
      { ngay: '9/4/2026',  do001: 33730, do05: 32960 },
      { ngay: '16/4/2026', do001: 32300, do05: 31040 },
      { ngay: '21/4/2026', do001: 29110, do05: 27850 },
    ],
    nguon: 'giaxanghomnay.com (xác minh)',
  },
}

// ── GET /api/gia-dau?thang=X&nam=Y ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1
    const nam   = parseInt(req.query.nam)   || new Date().getFullYear()
    const key   = `${thang}/${nam}`

    // 1. Thử lấy từ DB (admin đã cập nhật)
    const dbRecord = await GiaDau.findOne({ key }).lean()
    if (dbRecord) {
      return res.json({ ...dbRecord, _id: undefined, source: 'db', fetchedAt: dbRecord.updatedAt })
    }

    // 2. Dùng hardcode nếu có
    if (HARDCODE[key]) {
      return res.json({ ...HARDCODE[key], source: 'hardcode', fetchedAt: new Date() })
    }

    // 3. Tháng chưa có dữ liệu
    res.json({
      thang, nam, available: false,
      message: `Chưa có dữ liệu tháng ${thang}/${nam}. Admin cần nhập thủ công.`,
      source: 'none',
    })
  } catch(e) {
    console.error('giaDau GET error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/gia-dau/all — Danh sách tất cả tháng đã có ─────────────────────
router.get('/all', adminOnly, async (req, res) => {
  try {
    const dbRecords = await GiaDau.find({}).lean()
    const dbKeys = dbRecords.map(r => r.key)

    const hardcodeList = Object.entries(HARDCODE).map(([k, v]) => ({
      key: k, thang: v.thang, nam: v.nam,
      soLanDieuChinh: v.soLanDieuChinh,
      min: v.min, max: v.max, avg: v.avg,
      source: dbKeys.includes(k) ? 'db' : 'hardcode',
    }))

    const dbOnly = dbRecords
      .filter(r => !Object.keys(HARDCODE).includes(r.key))
      .map(r => ({ key: r.key, thang: r.thang, nam: r.nam,
        soLanDieuChinh: r.soLanDieuChinh, min: r.min, max: r.max, avg: r.avg,
        source: 'db' }))

    res.json([...hardcodeList, ...dbOnly].sort((a,b) =>
      (a.nam*100+a.thang) - (b.nam*100+b.thang)
    ))
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/gia-dau — Admin nhập/cập nhật giá tháng mới ───────────────────
router.post('/', adminOnly, async (req, res) => {
  try {
    const { thang, nam, chiTiet, nguon } = req.body
    if (!thang || !nam || !Array.isArray(chiTiet) || !chiTiet.length) {
      return res.status(400).json({ error: 'Thiếu thang, nam, hoặc chiTiet' })
    }

    const key = `${thang}/${nam}`

    // Merge với data đã có trong DB (nếu có) — tránh mất kỳ cũ
    const existing = await GiaDau.findOne({ key }).lean()
    const existingChiTiet = existing?.chiTiet || []

    // Merge: giữ kỳ cũ, thêm kỳ mới, dedup theo ngày
    const mergedMap = {}
    existingChiTiet.forEach(r => { mergedMap[r.ngay] = r })
    chiTiet.forEach(r => { mergedMap[r.ngay] = r })  // kỳ mới ghi đè nếu cùng ngày
    const mergedChiTiet = Object.values(mergedMap)
      .sort((a, b) => {
        // Sort by date DD/MM/YYYY
        const [da,ma,ya] = (a.ngay||'').split('/').map(Number)
        const [db,mb,yb] = (b.ngay||'').split('/').map(Number)
        return (ya*10000+ma*100+da) - (yb*10000+mb*100+db)
      })

    // Cũng merge với hardcode nếu chưa có trong DB
    const HARDCODE_DETAIL = {
      '3/2026': [
        { ngay:'5/3/2026',  do001:26900, do05:26480 }, { ngay:'7/3/2026',  do001:30620, do05:30239 },
        { ngay:'10/3/2026', do001:27025, do05:27025 }, { ngay:'11/3/2026', do001:27025, do05:27025 },
        { ngay:'12/3/2026', do001:27025, do05:27025 }, { ngay:'19/3/2026', do001:33620, do05:33420 },
        { ngay:'24/3/2026', do001:39860, do05:39660 }, { ngay:'25/3/2026', do001:38090, do05:37890 },
        { ngay:'26/3/2026', do001:35640, do05:35440 }, { ngay:'27/3/2026', do001:35640, do05:35440 },
      ],
      '4/2026': [
        { ngay:'2/4/2026',  do001:41020, do05:40820 }, { ngay:'3/4/2026',  do001:44980, do05:44780 },
        { ngay:'8/4/2026',  do001:43240, do05:42840 }, { ngay:'9/4/2026',  do001:33730, do05:32960 },
        { ngay:'16/4/2026', do001:32300, do05:31040 }, { ngay:'21/4/2026', do001:29110, do05:27850 },
        { ngay:'23/4/2026', do001:26697, do05:25530 },
      ],
    }
    if (!existing && HARDCODE_DETAIL[key]) {
      HARDCODE_DETAIL[key].forEach(r => { if (!mergedMap[r.ngay]) mergedMap[r.ngay] = r })
      // Re-sort merged
      Object.assign(mergedChiTiet, Object.values(mergedMap).sort((a,b) => {
        const [da,ma,ya] = (a.ngay||'').split('/').map(Number)
        const [db,mb,yb] = (b.ngay||'').split('/').map(Number)
        return (ya*10000+ma*100+da) - (yb*10000+mb*100+db)
      }))
      mergedChiTiet.length = 0
      Object.values(mergedMap).sort((a,b) => {
        const [da,ma,ya] = (a.ngay||'').split('/').map(Number)
        const [db,mb,yb] = (b.ngay||'').split('/').map(Number)
        return (ya*10000+ma*100+da) - (yb*10000+mb*100+db)
      }).forEach(r => mergedChiTiet.push(r))
    }

    // Tính toán từ mergedChiTiet (toàn bộ kỳ sau khi merge)
    const allChiTiet = mergedChiTiet
    const do001List = allChiTiet.map(c => c.do001).filter(Boolean)
    const do05List  = chiTiet.map(c => c.do05).filter(Boolean)

    if (!do001List.length) return res.status(400).json({ error: 'Thiếu giá DO 0.001S' })

    const avg001V1 = Math.round(do001List.reduce((a,b)=>a+b,0) / do001List.length)
    const avg001V2 = Math.round(avg001V1 * 1.02)
    const avg05V1  = do05List.length
      ? Math.round(do05List.reduce((a,b)=>a+b,0) / do05List.length)
      : Math.round(avg001V1 * 0.957)
    const avg05V2  = Math.round(avg05V1 * 1.02)
    const avg4     = Math.round((avg001V1+avg001V2+avg05V1+avg05V2)/4)

    const data = {
      key, thang, nam, available: true,
      min: Math.min(...do001List),
      max: Math.max(...do001List),
      avg: avg4,
      soLanDieuChinh: allChiTiet.length,
      do001: { v1: avg001V1, v2: avg001V2, list: do001List },
      do05:  { v1: avg05V1,  v2: avg05V2,  list: do05List },
      chiTiet: allChiTiet,
      nguon: nguon || 'admin input',
      updatedAt: new Date(),
    }

    await GiaDau.findOneAndUpdate({ key }, data, { upsert: true, new: true })
    res.json({ success: true, ...data })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/gia-dau/cache — Xóa DB record (về lại hardcode) ──────────────
router.delete('/cache', adminOnly, async (req, res) => {
  try {
    const { thang, nam } = req.query
    if (thang && nam) {
      await GiaDau.deleteOne({ key: `${thang}/${nam}` })
    } else {
      await GiaDau.deleteMany({})
    }
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
