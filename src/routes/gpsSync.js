// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/gpsSync.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const mongoose = require('mongoose')

const BINHANH_BASE = 'https://gps3.binhanh.vn/api/v1'
const COMPANY_ID   = 46140

// ── Helper: lấy token từ DB ───────────────────────────────
async function getToken() {
  const col = mongoose.connection.db.collection('gps_config')
  const cfg = await col.findOne({ key: 'binhanh_token' })
  return cfg?.value || null
}

// ── Helper: gọi Binhanh API ───────────────────────────────
async function binahCall(path, body, token) {
  const res = await fetch(`${BINHANH_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/json, text/plain, */*',
      'Origin':        'https://gps3.binhanh.vn',
      'Referer':       'https://gps3.binhanh.vn/',
    },
    body: JSON.stringify(body)
  })
  if (res.status === 401) throw new Error('TOKEN_EXPIRED')
  if (!res.ok) throw new Error(`Binhanh API error: ${res.status}`)
  return res.json()
}

// ── Normalize biển số: "61H07623_C" → "61H-076.23" ────────
function normalizePlate(plate) {
  if (!plate) return ''
  // Binhanh dùng format "61H07623_C", HSG dùng "61H-076.23"
  // Bỏ hậu tố _C/_B, giữ phần chính
  const s = plate.replace(/_[A-Z]$/, '').toUpperCase()
  return s
}

// ── POST /api/gps/set-token — Admin lưu JWT token ─────────
router.post('/set-token', async (req, res) => {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'Thiếu token' })
    const col = mongoose.connection.db.collection('gps_config')
    await col.updateOne(
      { key: 'binhanh_token' },
      { $set: { key: 'binhanh_token', value: token, updatedAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true, message: 'Đã lưu token' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/gps/sync — Sync toàn bộ xe từ Binhanh ───────
router.post('/sync', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token. Vào Cài đặt GPS để thêm token.' })

    // 1. Lấy danh sách xe online từ Binhanh
    const data = await binahCall('/vehicleonline/list', {
      filterCondition:        5,
      hasPermissionAsAdmin:   false,
      skipVehiclePlateChanged: false,
      languageId:             1
    }, token)

    // data có thể là array hoặc { data: [...] }
    const vehicles = Array.isArray(data) ? data : (data?.data || data?.vehicles || [])
    if (!vehicles.length) return res.json({ success: true, synced: 0, message: 'Không có dữ liệu xe' })

    // 2. Batch upsert vào collection gps_status
    const col    = mongoose.connection.db.collection('gps_status')
    const now    = new Date()
    const today  = now.toISOString().split('T')[0]

    const bulkOps = vehicles.map(v => {
      const plateRaw  = v.vehiclePlate || v.plate || ''
      const plateNorm = normalizePlate(plateRaw)
      const isOnline  = v.isOnline ?? v.online ?? false
      const totalKm   = parseFloat(v.totalKm || v.totalKmToday || 0)
      const lastSeen  = v.vTime || v.lastTime || null
      const vehicleId = v.vehicleId || v.id || null

      return {
        updateOne: {
          filter: { plateRaw },
          update: {
            $set: {
              plateRaw,
              plateNorm,
              vehicleId,
              isOnline,
              totalKm,
              lastSeen,
              syncedAt: now,
              syncDate: today,
              lat: v.lat || null,
              lng: v.lng || null,
              speed: v.speed || 0,
              isEnableAcc: v.isEnableAcc ?? null,
              stopTime: v.stopTime || 0,
            }
          },
          upsert: true
        }
      }
    })

    await col.bulkWrite(bulkOps)

    // 3. Lưu lịch sử km theo ngày (để phát hiện xe không hoạt động)
    const kmCol = mongoose.connection.db.collection('gps_km_history')
    const kmOps = vehicles.map(v => {
      const plateRaw = v.vehiclePlate || v.plate || ''
      return {
        updateOne: {
          filter: { plateRaw, date: today },
          update: { $set: { plateRaw, date: today, totalKm: parseFloat(v.totalKm || 0), recordedAt: now } },
          upsert: true
        }
      }
    })
    await kmCol.bulkWrite(kmOps)

    // 4. Thống kê
    const online  = vehicles.filter(v => v.isOnline ?? v.online).length
    const offline = vehicles.length - online

    // Lưu lastSync
    await mongoose.connection.db.collection('gps_config').updateOne(
      { key: 'last_sync' },
      { $set: { key: 'last_sync', value: now.toISOString(), total: vehicles.length, online, offline } },
      { upsert: true }
    )

    res.json({ success: true, total: vehicles.length, online, offline, synced: bulkOps.length })
  } catch(e) {
    if (e.message === 'TOKEN_EXPIRED')
      return res.status(401).json({ error: 'Token hết hạn. Vui lòng cập nhật token mới.' })
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/gps/status — Trả status tất cả xe cho frontend
router.get('/status', async (req, res) => {
  try {
    const col    = mongoose.connection.db.collection('gps_status')
    const cfgCol = mongoose.connection.db.collection('gps_config')

    const [vehicles, lastSync] = await Promise.all([
      col.find({}).toArray(),
      cfgCol.findOne({ key: 'last_sync' })
    ])

    // Xe inactive = mất tín hiệu > 24h (không phụ thuộc km)
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const inactive = vehicles.filter(v => {
      if (v.isOnline) return false
      if (!v.lastSeen) return true // không có tín hiệu lần nào
      return new Date(v.lastSeen) < now24h
    })

    res.json({
      vehicles,
      lastSync:    lastSync?.value || null,
      summary: {
        total:    vehicles.length,
        online:   vehicles.filter(v => v.isOnline).length,
        offline:  vehicles.filter(v => !v.isOnline).length,
        inactive: inactive.length
      }
    })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/gps/camera/:vehicleId — Camera status 1 xe ───
router.get('/camera/:vehicleId', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token' })

    const { vehicleId } = req.params
    const { plate } = req.query

    const today = new Date().toISOString().split('T')[0]

    const data = await binahCall('/image', {
      companyId:    COMPANY_ID,
      vehicleId:    parseInt(vehicleId),
      vehiclePlate: plate || '',
      channels:     [],
      startTime:    `${today}T00:00:00`,
      endTime:      `${today}T23:59:59`,
      sortTimeAsc:  false,
      languageId:   1,
    }, token)

    // Parse trạng thái camera từ response
    const images   = Array.isArray(data) ? data : (data?.data || [])
    const hasSignal = images.length > 0
    const channels  = [...new Set(images.map(i => i.channel || i.channelId).filter(Boolean))]

    res.json({ hasSignal, imageCount: images.length, channels, lastImage: images[0] || null })
  } catch(e) {
    if (e.message === 'TOKEN_EXPIRED') return res.status(401).json({ error: 'Token hết hạn' })
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/gps/inactive — Xe nghi ngờ không hoạt động ──
router.get('/inactive', async (req, res) => {
  try {
    const kmCol  = mongoose.connection.db.collection('gps_km_history')
    const days   = parseInt(req.query.days || 3)

    // Lấy lịch sử km 7 ngày gần nhất
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const sinceStr = since.toISOString().split('T')[0]

    const history = await kmCol.find({ date: { $gte: sinceStr } }).toArray()

    // Group theo xe
    const byPlate = {}
    for (const r of history) {
      if (!byPlate[r.plateRaw]) byPlate[r.plateRaw] = []
      byPlate[r.plateRaw].push({ date: r.date, km: r.totalKm })
    }

    // Tìm xe có km = 0 liên tiếp >= days ngày
    const inactive = []
    for (const [plate, records] of Object.entries(byPlate)) {
      const sorted = records.sort((a,b) => b.date.localeCompare(a.date))
      const zeroStreak = sorted.findIndex(r => r.km > 0)
      const streak = zeroStreak === -1 ? sorted.length : zeroStreak
      if (streak >= days) {
        inactive.push({ plate, streak, records: sorted.slice(0, 7) })
      }
    }

    res.json({ inactive, days, total: inactive.length })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
