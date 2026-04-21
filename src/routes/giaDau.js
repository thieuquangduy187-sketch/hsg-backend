const router   = require('express').Router()
const mongoose = require('mongoose')

// ── Cache model ───────────────────────────────────────────────────────────────
const cacheSchema = new mongoose.Schema({
  key:       { type: String, unique: true },
  data:      mongoose.Schema.Types.Mixed,
  fetchedAt: { type: Date, default: Date.now },
}, { collection: 'gia_dau_cache' })

const Cache = mongoose.models.GiaDauCache
  || mongoose.model('GiaDauCache', cacheSchema)

// ── Helpers ───────────────────────────────────────────────────────────────────
function cacheKey(thang, nam) { return `gia_dau_${thang}_${nam}` }

// Parse số từ string "29,110" → 29110
function parsePrice(str) {
  if (!str) return 0
  return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0
}

// Fetch lịch sử điều chỉnh từ giaxanghomnay.com
// Trả về danh sách các lần điều chỉnh DO 0.001S-V trong tháng/năm
async function fetchPriceHistory(thang, nam) {
  // giaxanghomnay.com/lich-su-gia-xang trả về HTML với bảng lịch sử
  const url = `https://giaxanghomnay.com/lich-su-gia-xang`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  // Parse bảng điều chỉnh từ HTML
  // Format: "Điều chỉnh ngày DD/MM/YYYY" rồi table rows với sản phẩm + giá
  const prices = []

  // Tìm tất cả block "Điều chỉnh ngày DD/MM/YYYY"
  const blockRegex = /Điều chỉnh ngày\s+(\d{2})\/(\d{2})\/(\d{4})([\s\S]*?)(?=Điều chỉnh ngày|\s*<\/|$)/g
  let blockMatch

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const day   = parseInt(blockMatch[1])
    const month = parseInt(blockMatch[2])
    const year  = parseInt(blockMatch[3])
    const block = blockMatch[4]

    if (month !== thang || year !== nam) continue

    const ngay = `${day}/${month}/${year}`
    let do001 = null
    let do05  = null

    // Parse từng row trong block: mỗi row là 1 sản phẩm
    // Format HTML: tên sản phẩm | giá mới | thay đổi
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch
    while ((rowMatch = rowRegex.exec(block)) !== null) {
      const row = rowMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

      // Tách số tiền từ row (số lớn nhất trong 5000-200000 range)
      const nums = row.match(/\d[\d,.]+/g) || []
      const validPrices = nums
        .map(n => parsePrice(n))
        .filter(n => n >= 5000 && n <= 200000)

      if (!validPrices.length) continue
      const price = validPrices[0]

      // DO 0,001S-V (Euro 5)
      if (/DO\s*0[,.]001S/i.test(row) && !do001) {
        do001 = price
      }
      // DO 0,05S-II (Euro 2)
      else if (/DO\s*0[,.]05S/i.test(row) && !do05) {
        do05 = price
      }
    }

    // Fallback regex nếu table parse không ra
    if (!do001) {
      const m = block.match(/DO\s*0[,.]001S[-–]?V[^\d]*(\d[\d,.]+)/i)
      if (m) do001 = parsePrice(m[1])
    }
    if (!do05) {
      const m = block.match(/DO\s*0[,.]05S[-–]?II[^\d]*(\d[\d,.]+)/i)
      if (m) do05 = parsePrice(m[1])
    }

    if (do001 || do05) {
      prices.push({ ngay, do001: do001 || null, do05: do05 || null })
    }
  }

  return prices
}

// Fallback: fetch từ API giaxanghomnay.com nếu có
async function fetchFromAPI(thang, nam) {
  // Try JSON endpoint nếu có
  const urls = [
    `https://giaxanghomnay.com/api/history?month=${thang}&year=${nam}`,
    `https://giaxanghomnay.com/lich-su-gia-xang?month=${thang}&year=${nam}`,
  ]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/html' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('json')) {
        const data = await res.json()
        // Parse JSON nếu có cấu trúc phù hợp
        if (data && Array.isArray(data.history)) {
          return data.history
            .filter(h => h.product && h.product.includes('0.001'))
            .map(h => ({ ngay: h.date, gia: parsePrice(h.price) }))
            .filter(h => h.gia > 5000)
        }
      }
    } catch {}
  }
  return []
}

// Tính bình quân 4 mức giá từ danh sách các kỳ điều chỉnh
// adjustments: [{ ngay, do001, do05 }]
function calcAverage(adjustments) {
  if (!adjustments.length) return null

  const do001List = adjustments.map(a => a.do001).filter(Boolean)
  const do05List  = adjustments.map(a => a.do05).filter(Boolean)

  if (!do001List.length && !do05List.length) return null

  // Bình quân từng loại qua tất cả kỳ điều chỉnh
  const avg001V1 = do001List.length
    ? Math.round(do001List.reduce((a,b)=>a+b,0) / do001List.length)
    : null

  const avg05V1  = do05List.length
    ? Math.round(do05List.reduce((a,b)=>a+b,0) / do05List.length)
    : (avg001V1 ? Math.round(avg001V1 * 0.957) : null)  // fallback: 95.7%

  // Vùng 2 = Vùng 1 × 1.02
  const avg001V2 = avg001V1 ? Math.round(avg001V1 * 1.02) : null
  const avg05V2  = avg05V1  ? Math.round(avg05V1  * 1.02) : null

  // Bình quân 4 mức
  const fourPrices = [avg001V1, avg001V2, avg05V1, avg05V2].filter(Boolean)
  const avg4 = Math.round(fourPrices.reduce((a,b)=>a+b,0) / fourPrices.length)

  return {
    avg:    avg4,
    // 4 mức: [DO0.001S V1, V2, DO0.05S V1, V2]
    v:           [avg001V1 || 0, avg001V2 || 0, avg05V1 || 0, avg05V2 || 0],
    // DO 0.001S-V
    do001: {
      avg:  avg001V1,
      v1:   avg001V1,
      v2:   avg001V2,
      min:  do001List.length ? Math.min(...do001List) : null,
      max:  do001List.length ? Math.max(...do001List) : null,
      list: do001List,
    },
    // DO 0.05S-II
    do05: {
      avg:  avg05V1,
      v1:   avg05V1,
      v2:   avg05V2,
      min:  do05List.length  ? Math.min(...do05List)  : null,
      max:  do05List.length  ? Math.max(...do05List)  : null,
      list: do05List,
    },
    min:   avg001V1 ? Math.min(...do001List) : (avg05V1 ? Math.min(...do05List) : 0),
    max:   avg001V1 ? Math.max(...do001List) : (avg05V1 ? Math.max(...do05List) : 0),
    count: adjustments.length,
  }
}

// ── GET /api/gia-dau?thang=4&nam=2026 ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1
    const nam   = parseInt(req.query.nam)   || new Date().getFullYear()

    if (thang < 1 || thang > 12 || nam < 2024) {
      return res.status(400).json({ error: 'Tháng/năm không hợp lệ' })
    }

    const key = cacheKey(thang, nam)

    // Kiểm tra cache (TTL: tháng hiện tại = 6 tiếng, tháng cũ = vĩnh viễn)
    const now      = new Date()
    const isCurrentMonth = (now.getMonth() + 1 === thang && now.getFullYear() === nam)
    const cacheTTL = isCurrentMonth ? 6 * 60 * 60 * 1000 : 99 * 24 * 60 * 60 * 1000

    const cached = await Cache.findOne({ key }).lean()
    if (cached && (Date.now() - new Date(cached.fetchedAt).getTime()) < cacheTTL) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt })
    }

    // Fetch mới
    console.log(`Fetching diesel prices T${thang}/${nam}...`)

    let adjustments = []
    try {
      adjustments = await fetchPriceHistory(thang, nam)
    } catch(e) {
      console.warn('fetchPriceHistory failed:', e.message)
    }

    // Fallback nếu scrape không ra data
    if (!adjustments.length) {
      try {
        adjustments = await fetchFromAPI(thang, nam)
      } catch {}
    }

    if (!adjustments.length) {
      // Trả về null — frontend sẽ bỏ qua cảnh báo
      return res.json({
        thang, nam,
        available: false,
        message: `Chưa có dữ liệu giá dầu tháng ${thang}/${nam}`,
      })
    }

    const result = calcAverage(adjustments)

    const data = {
      thang, nam,
      available:      true,
      avg:            result.avg,        // bình quân 4 mức
      v:              result.v,          // [DO001_V1, V2, DO05_V1, V2]
      min:            result.min,        // min DO 0.001S-V trong tháng
      max:            result.max,        // max DO 0.001S-V trong tháng
      soLanDieuChinh: result.count,      // số kỳ điều chỉnh trong tháng
      // Chi tiết từng loại dầu
      do001: result.do001,  // { avg, v1, v2, min, max, list }
      do05:  result.do05,   // { avg, v1, v2, min, max, list }
      chiTiet: adjustments, // [{ ngay, do001, do05 }]
      nguon:   'giaxanghomnay.com / Petrolimex',
    }

    // Lưu cache
    await Cache.findOneAndUpdate(
      { key },
      { key, data, fetchedAt: new Date() },
      { upsert: true }
    )

    res.json({ ...data, cached: false, fetchedAt: new Date() })

  } catch(e) {
    console.error('giaDau error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/gia-dau/cache — Xóa cache (admin) ────────────────────────────
router.delete('/cache', async (req, res) => {
  try {
    const { thang, nam } = req.query
    if (thang && nam) {
      await Cache.deleteOne({ key: cacheKey(parseInt(thang), parseInt(nam)) })
    } else {
      await Cache.deleteMany({})
    }
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
