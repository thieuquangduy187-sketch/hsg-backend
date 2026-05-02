// GET /api/diesel-price?thang=5&nam=2026
// Tự động fetch giá dầu diesel từ giaxanghomnay.com và cache vào MongoDB
const router = require('express').Router()
// [H2] Model tập trung
const DieselPrice = require('../models/DieselPrice')

// ── Fetch giá từ web ──────────────────────────────────────────────────────────
async function fetchPriceFromWeb(thang, nam) {
  // Thử scrape giaxanghomnay.com lịch sử
  const url = `https://giaxanghomnay.com/lich-su-gia-xang`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HSG-Fleet/1.0)' }
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const html = await resp.text()

  // Parse giá DO 0.001S-V từ bảng tháng cần
  // Tìm tất cả các dòng có "DO 0,001S-V" và giá
  const prices = []
  const regex = /DO 0[,.]001S-V[\s\S]*?([\d]{2}[,.][\d]{3})/g
  let m
  while ((m = regex.exec(html)) !== null) {
    const val = parseInt(m[1].replace(',', '').replace('.', ''))
    if (val > 10000 && val < 100000) prices.push(val)
  }

  if (prices.length === 0) return null

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const avg = Math.round(prices.reduce((a, b) => a + b) / prices.length)

  // DO 0.05S ≈ 95.7% của DO 0.001S
  const do05 = Math.round(avg * 0.957)
  const v2   = Math.round(avg * 1.02)   // Vùng 2 +2%
  const do05_v2 = Math.round(do05 * 1.02)

  const avg4 = Math.round((avg + v2 + do05 + do05_v2) / 4)

  return {
    do001_v1: avg, do001_v2: v2,
    do05_v1: do05, do05_v2,
    avg4, minDo001: min, maxDo001: max,
    source: 'giaxanghomnay.com'
  }
}

// ── Hardcoded fallback (2026) ─────────────────────────────────────────────────
const HARDCODED = {
  '1/2026': { do001_v1:17850, do001_v2:18200, do05_v1:17082, do05_v2:17424, avg4:17639, minDo001:17500, maxDo001:18200 },
  '2/2026': { do001_v1:19500, do001_v2:19870, do05_v1:18662, do05_v2:19035, avg4:19267, minDo001:18900, maxDo001:20100 },
  '3/2026': { do001_v1:29253, do001_v2:29838, do05_v1:27995, do05_v2:28555, avg4:28910, minDo001:27220, maxDo001:39860 },
  '4/2026': { do001_v1:34450, do001_v2:35139, do05_v1:32969, do05_v2:33628, avg4:34046, minDo001:29110, maxDo001:44980 },
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1
    const nam   = parseInt(req.query.nam)   || new Date().getFullYear()
    const key   = `${thang}/${nam}`

    // 1. Check cache trong MongoDB (hết hạn sau 1 ngày)
    const cached = await DieselPrice.findOne({ key })
    const oneDay = 24 * 60 * 60 * 1000
    if (cached && (Date.now() - cached.updatedAt.getTime()) < oneDay) {
      return res.json({ ...cached.toObject(), fromCache: true })
    }

    // 2. Check hardcoded
    if (HARDCODED[key]) {
      const d = HARDCODED[key]
      await DieselPrice.findOneAndUpdate({ key }, {
        key, thang, nam, ...d, updatedAt: new Date(), source: 'hardcoded'
      }, { upsert: true })
      return res.json({ ...d, key, fromCache: false, source: 'hardcoded' })
    }

    // 3. Fetch từ web
    let data = null
    try {
      data = await fetchPriceFromWeb(thang, nam)
    } catch(e) {
      console.log('Web fetch failed:', e.message)
    }

    if (!data) {
      // 4. Fallback: dùng tháng gần nhất có data
      const prev = await DieselPrice.findOne({ nam }).sort({ thang: -1 })
      if (prev) {
        return res.json({
          ...prev.toObject(),
          key, thang, nam,
          note: `Dùng giá tháng ${prev.thang}/${prev.nam} (chưa có dữ liệu T${thang}/${nam})`,
          fromCache: false
        })
      }
      return res.status(404).json({ error: `Chưa có dữ liệu giá dầu tháng ${thang}/${nam}` })
    }

    // Lưu vào cache
    await DieselPrice.findOneAndUpdate({ key }, {
      key, thang, nam, ...data, updatedAt: new Date()
    }, { upsert: true })

    res.json({ ...data, key, fromCache: false })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/diesel-price — Admin cập nhật giá thủ công ─────────────────────
router.post('/', async (req, res) => {
  try {
    const { thang, nam, do001_v1, do001_v2, do05_v1, do05_v2 } = req.body
    if (!thang || !nam || !do001_v1) {
      return res.status(400).json({ error: 'Thiếu thông tin' })
    }
    const key  = `${thang}/${nam}`
    const avg4 = Math.round((do001_v1 + (do001_v2||do001_v1*1.02) +
                             (do05_v1||do001_v1*0.957) + (do05_v2||do001_v1*0.977)) / 4)

    await DieselPrice.findOneAndUpdate({ key }, {
      key, thang, nam,
      do001_v1, do001_v2: do001_v2 || Math.round(do001_v1*1.02),
      do05_v1:  do05_v1  || Math.round(do001_v1*0.957),
      do05_v2:  do05_v2  || Math.round(do001_v1*0.977),
      avg4,
      minDo001: do001_v1,
      maxDo001: do001_v1,
      updatedAt: new Date(),
      source: 'manual'
    }, { upsert: true })

    res.json({ success: true, key, avg4 })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
