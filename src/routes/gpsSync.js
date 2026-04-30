// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/gpsSync.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const mongoose = require('mongoose')

const BINHANH_BASE = 'https://gps3.binhanh.vn/api/v1'

// ── Helper: lấy token ─────────────────────────────────────
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

// ── Helper: tính GPS status dựa trên daysSince + km history
// kmHistory: Map { plateRaw → [{ date, km }] }
function calcGpsStatus(vehicle, kmHistory) {
  const gpsTime = vehicle.gpsTime // "2026-04-28T19:57:39"
  if (!gpsTime) return { code: 'no_signal', label: 'Không có tín hiệu', color: '#8E8E93' }

  const gpsDate  = new Date(gpsTime.split('T')[0]) // lấy phần date
  const today    = new Date(new Date().toISOString().split('T')[0])
  const daysSince = Math.floor((today - gpsDate) / (1000 * 60 * 60 * 24))

  // Lấy km history của xe này
  const history = kmHistory.get(vehicle.plateRaw) || []

  // Tính tổng km trong N ngày trước gpsDate
  const sumKm = (daysBack) => {
    const from = new Date(gpsDate)
    from.setDate(from.getDate() - daysBack)
    const fromStr = from.toISOString().split('T')[0]
    const toStr   = gpsDate.toISOString().split('T')[0]
    return history
      .filter(r => r.date >= fromStr && r.date <= toStr)
      .reduce((acc, r) => acc + (r.km || 0), 0)
  }

  // Case 2.1: mất 3–4 ngày VÀ km 15 ngày > 600
  if (daysSince >= 3 && daysSince <= 4) {
    const km15 = sumKm(15)
    if (km15 > 600) return { code: 'gps_lost_active', label: 'Mất tín hiệu GPS (xe vẫn HĐ)', color: '#FF9500', daysSince, km15 }
  }

  // Case 2.2: mất > 4 ngày VÀ km 15 ngày < 50
  if (daysSince > 4) {
    const km15 = sumKm(15)
    if (km15 < 50) return { code: 'stopped', label: 'Xe dừng hoạt động', color: '#FF3B30', daysSince, km15 }
  }

  // Case 2.3: mất < 2 ngày VÀ km 30 ngày < 50
  if (daysSince < 2) {
    const km30 = sumKm(30)
    if (km30 < 50) return { code: 'stopped', label: 'Xe dừng hoạt động', color: '#FF3B30', daysSince, km30 }
  }

  return { code: 'normal', label: 'Bình thường', color: '#34C759', daysSince }
}

// ── Helper: tính camera status từ cameras array + camCount
function calcCamStatus(vehicle) {
  const camCount = vehicle.camCount || 0
  const cameras  = vehicle.cameras  || []

  if (camCount === 0 || cameras.length === 0)
    return { code: 'no_cam', label: 'Không có cam', color: '#8E8E93', active: 0, total: 0 }

  // Đếm tất cả record:true trong cameras array
  const active = cameras.filter(c => c.record === true).length
  const lost   = camCount - active

  // lost = 0           → tất cả cam OK
  // 0 < lost < camCount → mất 1 số cam
  // lost = camCount     → mất hoàn toàn
  if (lost <= 0)        return { code: 'ok',       label: `${active}/${camCount} cam OK`,  color: '#34C759', active, total: camCount }
  if (lost >= camCount) return { code: 'lost_all', label: `Mất hết ${camCount} cam`,     color: '#FF3B30', active, total: camCount }
  return                       { code: 'partial',  label: `Mất ${lost}/${camCount} cam`, color: '#FF9500', active, total: camCount }
}

// ── POST /api/gps/set-token ────────────────────────────────
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

// ── POST /api/gps/sync ────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token. Vào Cài đặt GPS để thêm token.' })

    // 1. Gọi Binhanh lấy toàn bộ xe
    const data = await binahCall('/vehicleonline/list', {
      filterCondition:         5,
      hasPermissionAsAdmin:    false,
      skipVehiclePlateChanged: false,
      languageId:              1
    }, token)

    const vehicles = Array.isArray(data) ? data : (data?.data || data?.vehicles || [])
    if (!vehicles.length) return res.json({ success: true, synced: 0, message: 'Không có dữ liệu xe' })

    const now   = new Date()
    const today = now.toISOString().split('T')[0]

    // 2. Lưu km theo ngày vào gps_km_history (dùng cho GPS status logic sau này)
    const kmCol  = mongoose.connection.db.collection('gps_km_history')
    const kmOps  = vehicles
      .filter(v => (v.vehiclePlate || v.plate))
      .map(v => ({
        updateOne: {
          filter: { plateRaw: v.vehiclePlate || v.plate, date: today },
          update: { $set: {
            plateRaw: v.vehiclePlate || v.plate,
            date:     today,
            totalKm:  parseFloat(v.totalKm || 0),
            recordedAt: now
          }},
          upsert: true
        }
      }))
    if (kmOps.length) await kmCol.bulkWrite(kmOps)

    // 3. Lưu snapshot xe vào gps_status
    const statusCol = mongoose.connection.db.collection('gps_status')
    const statusOps = vehicles.map(v => {
      const plateRaw = v.vehiclePlate || v.plate || ''
      // camCount nằm trong packageBAP.serverServiceInfo.camcount
      // cameras nằm trong cameraDevice.cameras
      const camCount = v.packageBAP?.serverServiceInfo?.camcount ?? v.serverServiceInfo?.camcount ?? v.camCount ?? 0
      return {
        updateOne: {
          filter: { plateRaw },
          update: { $set: {
            plateRaw,
            vehicleId:   v.vehicleId || v.id || null,
            isOnline:    v.isOnline  ?? v.online ?? false,
            totalKm:     parseFloat(v.totalKm || 0),
            gpsTime:     v.gpsTime   || null,
            camCount,
            cameras:     v.cameraDevice?.cameras || v.cameras || [],
            speed:       v.speed     || 0,
            lat:         v.lat       || null,
            lng:         v.lng       || null,
            syncedAt:    now,
            syncDate:    today,
          }},
          upsert: true
        }
      }
    })
    await statusCol.bulkWrite(statusOps)

    // 4. Thống kê
    const online  = vehicles.filter(v => v.isOnline ?? v.online).length
    const offline = vehicles.length - online
    await mongoose.connection.db.collection('gps_config').updateOne(
      { key: 'last_sync' },
      { $set: { key: 'last_sync', value: now.toISOString(), total: vehicles.length, online, offline } },
      { upsert: true }
    )

    res.json({ success: true, total: vehicles.length, online, offline, synced: statusOps.length })
  } catch(e) {
    if (e.message === 'TOKEN_EXPIRED')
      return res.status(401).json({ error: 'Token hết hạn. Vui lòng cập nhật token mới.' })
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/gps/status ───────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const statusCol = mongoose.connection.db.collection('gps_status')
    const kmCol     = mongoose.connection.db.collection('gps_km_history')
    const cfgCol    = mongoose.connection.db.collection('gps_config')

    // Lấy km history 30 ngày gần nhất (dùng cho GPS status logic)
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)
    const since30Str = since30.toISOString().split('T')[0]

    const [vehicles, kmDocs, lastSync] = await Promise.all([
      statusCol.find({}).toArray(),
      kmCol.find({ date: { $gte: since30Str } }).toArray(),
      cfgCol.findOne({ key: 'last_sync' })
    ])

    // Build km history Map: { plateRaw → [{ date, km }] }
    const kmHistory = new Map()
    for (const r of kmDocs) {
      if (!kmHistory.has(r.plateRaw)) kmHistory.set(r.plateRaw, [])
      kmHistory.get(r.plateRaw).push({ date: r.date, km: r.totalKm })
    }

    // Tính GPS status + Camera status cho từng xe
    const enriched = vehicles.map(v => {
      const gpsStatus = calcGpsStatus(v, kmHistory)
      const camStatus = calcCamStatus(v)
      return { ...v, gpsStatus, camStatus }
    })

    // Summary
    const summary = {
      total:       enriched.length,
      online:      enriched.filter(v => v.isOnline).length,
      offline:     enriched.filter(v => !v.isOnline).length,
      gpsLost:     enriched.filter(v => v.gpsStatus.code === 'gps_lost_active').length,
      stopped:     enriched.filter(v => v.gpsStatus.code === 'stopped').length,
      camPartial:  enriched.filter(v => v.camStatus.code === 'partial').length,
      camLostAll:  enriched.filter(v => v.camStatus.code === 'lost_all').length,
    }

    res.json({ vehicles: enriched, lastSync: lastSync?.value || null, summary })
  } catch(e) { res.status(500).json({ error: e.message }) }
})


// ── POST /api/gps/backfill-history ───────────────────────
// Lấy km từng ngày 30 ngày qua cho tất cả xe (chạy 1 lần khi setup)
router.post('/backfill-history', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token' })

    const statusCol = mongoose.connection.db.collection('gps_status')
    const kmCol     = mongoose.connection.db.collection('gps_km_history')

    // Lấy danh sách xe có vehicleId
    const vehicles = await statusCol.find({ vehicleId: { $ne: null } }, {
      projection: { vehicleId: 1, plateRaw: 1 }
    }).toArray()

    if (!vehicles.length) return res.status(400).json({ error: 'Chưa có dữ liệu xe. Hãy Sync trước.' })

    // Date range: 30 ngày trước → hôm nay
    const toDate   = new Date()
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 30)
    const fromStr = fromDate.toISOString().split('T')[0] + 'T00:00:00'
    const toStr   = toDate.toISOString().split('T')[0]   + 'T23:59:59'

    // Trả về ngay, chạy backfill nền
    res.json({ success: true, message: `Bắt đầu backfill ${vehicles.length} xe. Mất ~${Math.ceil(vehicles.length * 0.3 / 60)} phút.`, total: vehicles.length })

    // Chạy nền — không block response
    ;(async () => {
      let done = 0, errors = 0
      const BATCH = 5 // xử lý 5 xe cùng lúc

      for (let i = 0; i < vehicles.length; i += BATCH) {
        const batch = vehicles.slice(i, i + BATCH)
        await Promise.all(batch.map(async (v) => {
          try {
            const data = await binahCall(
              '/temperature-report/temperature/chart',
              {
                vehicleId:  v.vehicleId,
                fromDate:   fromStr,
                toDate:     toStr,
                numberRow:  2000,
                getAddress: false,
              },
              token
            )

            // Response: { data: [...points] } hoặc array trực tiếp
            const points = Array.isArray(data) ? data
              : (data?.data || data?.result || [])

            if (!points.length) { done++; return }

            // Group points theo ngày → km/ngày = max(km) - min(km)
            const byDay = {}
            for (const p of points) {
              if (!p.dateTime || p.km == null) continue
              const day = p.dateTime.split('T')[0] // "2026-04-28"
              if (!byDay[day]) byDay[day] = []
              byDay[day].push(parseFloat(p.km || 0))
            }

            // Upsert từng ngày vào gps_km_history
            const ops = Object.entries(byDay).map(([date, kms]) => {
              const kmDay = Math.max(...kms) - Math.min(...kms)
              return {
                updateOne: {
                  filter: { plateRaw: v.plateRaw, date },
                  update: { $set: { plateRaw: v.plateRaw, date, totalKm: Math.max(0, parseFloat(kmDay.toFixed(2))), source: 'backfill' } },
                  upsert: true
                }
              }
            })
            if (ops.length) await kmCol.bulkWrite(ops)
            done++
          } catch(e) {
            console.error(`[Backfill] ${v.plateRaw}: ${e.message}`)
            errors++
          }
        }))

        // Delay 300ms giữa các batch để tránh rate limit
        await new Promise(r => setTimeout(r, 300))
      }
      console.log(`[Backfill] Xong: ${done} xe thành công, ${errors} lỗi`)

      // Lưu trạng thái backfill
      await mongoose.connection.db.collection('gps_config').updateOne(
        { key: 'last_backfill' },
        { $set: { key: 'last_backfill', value: new Date().toISOString(), done, errors } },
        { upsert: true }
      )
    })()

  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/gps/backfill-status — kiểm tra tiến trình backfill
router.get('/backfill-status', async (req, res) => {
  try {
    const cfg = await mongoose.connection.db.collection('gps_config')
      .findOne({ key: 'last_backfill' })
    const kmCount = await mongoose.connection.db.collection('gps_km_history')
      .countDocuments()
    res.json({ lastBackfill: cfg?.value || null, done: cfg?.done, errors: cfg?.errors, kmRecords: kmCount })
  } catch(e) { res.status(500).json({ error: e.message }) }
})


// ── GET /api/gps/debug-raw — xem raw response 1 xe từ Binhanh
router.get('/debug-raw', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token' })
    const data = await binahCall('/vehicleonline/list', {
      filterCondition: 5, hasPermissionAsAdmin: false,
      skipVehiclePlateChanged: false, languageId: 1
    }, token)
    const vehicles = Array.isArray(data) ? data : (data?.data || data?.vehicles || [])
    // Trả về 2 xe đầu để xem structure
    const sample = vehicles.slice(0, 2).map(v => ({
      plateRaw:          v.vehiclePlate || v.plate,
      // Top-level fields
      camCount_top:      v.camCount,
      cameras_top:       v.cameras,
      serverServiceInfo: v.serverServiceInfo,
      // Tất cả keys của xe
      allKeys:           Object.keys(v),
    }))
    res.json({ total: vehicles.length, sample })
  } catch(e) { res.status(500).json({ error: e.message }) }
})


// ══════════════════════════════════════════════════════════
// GET /api/gps/camera-report — Báo cáo camera từ Binhanh
// Gọi /api/v1/image/latest-by-channel với tất cả xe+kênh
// Logic: kênh có URL ảnh (field "u") → Hoạt động
//        Tổng kênh hoạt động >= 2 → Bình thường
// ══════════════════════════════════════════════════════════
router.get('/camera-report', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token' })

    const col      = mongoose.connection.db.collection('gps_status')
    const vehicles = await col.find(
      { vehicleId: { $ne: null }, camCount: { $gt: 0 } }
    ).sort({ plateRaw: 1 }).toArray()

    if (!vehicles.length) return res.json({ error: 'Chưa có dữ liệu xe. Hãy Sync trước.' })

    // Build vehicleChannels: [{vehicleId, channel}] cho tất cả xe
    // Mỗi xe gửi camCount kênh (thường là 2, có xe 3-4)
    const vehicleChannels = []
    for (const v of vehicles) {
      const count = Math.min(v.camCount || 2, 4) // tối đa 4 kênh
      for (let ch = 1; ch <= count; ch++) {
        vehicleChannels.push({ vehicleId: v.vehicleId, channel: ch })
      }
    }

    // Gọi Binhanh API
    const data = await binahCall('/image/latest-by-channel', {
      languageId: 1,
      vehicleChannels
    }, token)

    // data.data = { "29C93228_C": { "1": { u, k, ... }, "2": {...} }, ... }
    const channelData = data?.data || {}

    const now = new Date()
    const dateStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`

    const rows = vehicles.map((v, idx) => {
      const plate    = v.plateRaw || ''
      const camCount = v.camCount || 2
      const vData    = channelData[plate] || {}

      // Kênh 1-4: có URL ảnh (field "u") → Hoạt động
      const kenh = [1,2,3,4].map(ch => {
        if (ch > camCount) return '' // xe này không có kênh này
        const chData = vData[String(ch)]
        if (!chData) return 'Không hoạt động'
        return chData.u ? 'Hoạt động' : 'Không hoạt động'
      })

      const activeCount = kenh.filter(k => k === 'Hoạt động').length
      const status = activeCount >= 2       ? 'Bình thường'
        : activeCount === 0                 ? 'Mất hết cam'
        : `Mất ${camCount - activeCount}/${camCount} cam`

      return {
        stt:    idx + 1,
        bienSo: plate.replace(/_[A-Z]$/, ''),
        kenh1:  kenh[0],
        kenh2:  kenh[1],
        kenh3:  kenh[2],
        kenh4:  kenh[3],
        active: activeCount,
        camCount,
        status,
        ok:     activeCount >= 2
      }
    })

    const total   = rows.length
    const ok      = rows.filter(r => r.ok).length
    const warning = rows.filter(r => !r.ok).length

    res.json({ dateStr, total, ok, warning, noCam: 0, rows })
  } catch(e) {
    if (e.message === 'TOKEN_EXPIRED')
      return res.status(401).json({ error: 'Token hết hạn. Vui lòng cập nhật.' })
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
