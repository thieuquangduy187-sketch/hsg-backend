require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const mongoose = require('mongoose')

const authRoutes  = require('./routes/auth')
const xeRoutes    = require('./routes/xe')
const otoRoutes   = require('./routes/oto')
const statsRoutes = require('./routes/stats')
const { protect } = require('./middleware/auth')
const nhatTrinhRoutes    = require('./routes/nhatTrinh')
const nhatTrinhNgayRoutes = require('./routes/nhatTrinhNgay')
const giaDauRoutes      = require('./routes/giaDau')
const xeHoatDongRoutes = require('./routes/xeHoatDong')
const analyzeRoutes = require('./routes/analyze')
const gpsSyncRoutes  = require('./routes/gpsSync')
const cuaHangRoutes  = require('./routes/cuaHang')
const { startGpsCron } = require('./gpsCron')
const importRoutes = require('./routes/import')
const hieuQuaRoutes = require('./routes/hieuqua')
const adminUsersRoutes = require('./routes/adminUsers')

const app  = express()
const PORT = process.env.PORT || 3000

// CORS — allow all origins
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Public routes
app.get('/', (req, res) => res.json({ status: 'ok', message: 'HSG Fleet API v2' }))
app.use('/api/auth', authRoutes)

// Internal cron routes — dùng CRON_SECRET thay vì JWT
app.post('/internal/gps/auto-login', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== (process.env.CRON_SECRET || 'hsg-cron-2026')) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { binahLogin, saveToken } = require('./binahDownloader')
    const token = await binahLogin()
    await saveToken(token)
    res.json({ success: true, message: 'Token renewed' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/internal/gps/sync', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== (process.env.CRON_SECRET || 'hsg-cron-2026')) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { syncGPS } = require('./routes/gpsSync')
    const result = await syncGPS()
    res.json(result)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/internal/gps/upload-camera-excel', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== (process.env.CRON_SECRET || 'hsg-cron-2026')) return res.status(403).json({ error: 'Forbidden' })
  // Forward sang route xử lý
  req.url = '/upload-camera-excel'
  gpsSyncRoutes(req, res)
})

app.post('/internal/gps/sync-camera', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== (process.env.CRON_SECRET || 'hsg-cron-2026')) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { syncCameraStatus } = require('./binahDownloader')
    const result = await syncCameraStatus()
    res.json(result)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// Protected routes — cần JWT
app.use('/api/xe',    protect, xeRoutes)
app.use('/api/oto',   protect, otoRoutes)
app.use('/api/stats', protect, statsRoutes)
app.use('/api/nhat-trinh',       protect, nhatTrinhRoutes)
app.use('/api/nhat-trinh-ngay',  protect, nhatTrinhNgayRoutes)
app.use('/api/xe-hoat-dong', protect, xeHoatDongRoutes)
app.use('/api/gia-dau', protect, giaDauRoutes)
app.use('/api/import', protect, importRoutes)
app.use('/api/analyze', protect, analyzeRoutes)
app.use('/api/gps', protect, gpsSyncRoutes)
app.use('/api/cua-hang', protect, cuaHangRoutes)
app.use('/api/hieu-qua', protect, hieuQuaRoutes)
app.use('/api/admin', adminUsersRoutes)

// Temporary debug route - no auth needed
app.get('/debug/xe/:bienSo', async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const doc = await mongoose.connection.db.collection('xetai')
      .findOne({ $or: [
        { 'BIỂN SỐ': req.params.bienSo },
        { 'BIẼNSỐ': req.params.bienSo },
      ]})
    if (!doc) return res.json({ error: 'Not found', tried: req.params.bienSo })
    const fields = {}
    Object.entries(doc).forEach(([k,v]) => {
      if (k !== '_id') fields[k] = typeof v === 'string' ? v.substring(0,80) : v
    })
    res.json({ fieldCount: Object.keys(fields).length, fields })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// Health check — dùng cho keep-alive ping
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

// ── Migration endpoint (chạy 1 lần, xóa sau khi dùng) ────
// POST /migrate/users?secret=hsg-cron-2026
app.post('/migrate/users', async (req, res) => {
  const secret = req.query.secret || req.headers['x-cron-secret']
  if (secret !== (process.env.CRON_SECRET || 'hsg-cron-2026')) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const mongoose = require('mongoose')
    const db = mongoose.connection.db
    const col = db.collection('users')

    // Thêm các field mới vào tất cả user chưa có
    const result = await col.updateMany(
      {},
      {
        $set: {
          isLocked:      false,
          loginAttempts: 0,
          lockedReason:  '',
          sessions:      [],
        },
        // Chỉ set nếu chưa có (dùng $setOnInsert không được với updateMany,
        // nên dùng $set với điều kiện check bên dưới)
      }
    )

    // permissions và allowedPages để null (dùng default theo role)
    await col.updateMany(
      { permissions: { $exists: false } },
      { $set: { permissions: null } }
    )
    await col.updateMany(
      { allowedPages: { $exists: false } },
      { $set: { allowedPages: null } }
    )
    await col.updateMany(
      { lastFailedAt: { $exists: false } },
      { $set: { lastFailedAt: null } }
    )
    await col.updateMany(
      { lockedUntil: { $exists: false } },
      { $set: { lockedUntil: null } }
    )
    await col.updateMany(
      { createdBy: { $exists: false } },
      { $set: { createdBy: '' } }
    )

    const total = await col.countDocuments()
    res.json({
      ok: true,
      message: `Migration hoàn tất. Đã cập nhật ${result.modifiedCount}/${total} users.`,
      modified: result.modifiedCount,
      total
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.use((req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ MongoDB connected')
    app.listen(PORT, () => {
      console.log(`✓ Server on port ${PORT}`)
      startGpsCron()
    })
  })
  .catch(err => { console.error('✗ DB failed:', err.message); process.exit(1) })
