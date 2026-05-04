require('dotenv').config()

// ── [A5] Validate required env vars trước khi làm gì khác ────────────────────
const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'CRON_SECRET']
const missing = REQUIRED_ENV.filter(k => !process.env[k])
if (missing.length) {
  console.error('FATAL: Missing required env vars:', missing.join(', '))
  process.exit(1)
}

const express  = require('express')
const cors     = require('cors')
const helmet   = require('helmet')
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
const bdscRoutes       = require('./routes/bdsc')

const app  = express()
const PORT = process.env.PORT || 3000

// ── [C4] CORS whitelist — phải đặt TRƯỚC helmet ─────────────────────────────
const ALLOWED_ORIGINS = [
  'https://quanlyxehsh.com',
  'https://www.quanlyxehsh.com',
  'https://gps3.binhanh.vn',
  process.env.FRONTEND_URL,          // thêm bất kỳ URL nào qua env
  process.env.FRONTEND_URL_2,        // URL phụ nếu cần (Netlify preview, v.v.)
  process.env.NODE_ENV === 'development' && 'http://localhost:5173',
  process.env.NODE_ENV === 'development' && 'http://localhost:3000',
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

// ── [M2] Security headers — đặt SAU cors() ───────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Tắt COEP để cho phép load ảnh từ Google Drive (lh3.googleusercontent.com)
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https://drive.google.com', 'https://lh3.googleusercontent.com'],
      // Cho phép Referer khi load ảnh cross-origin
      'referrer': ['no-referrer-when-downgrade'],
    },
  },
  referrerPolicy: { policy: 'no-referrer-when-downgrade' },
}))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Public routes
app.get('/', (req, res) => res.json({ status: 'ok', message: 'HSG Fleet API v2' }))
app.use('/api/auth', authRoutes)

// Internal cron routes — dùng CRON_SECRET thay vì JWT
const CRON_SECRET = process.env.CRON_SECRET

function verifyCronSecret(req) {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  return secret === CRON_SECRET
}

app.post('/internal/gps/auto-login', async (req, res) => {
  if (!verifyCronSecret(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { binahLogin, saveToken } = require('./binahDownloader')
    const token = await binahLogin()
    await saveToken(token)
    res.json({ success: true, message: 'Token renewed' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/internal/gps/sync', async (req, res) => {
  if (!verifyCronSecret(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { syncGPS } = require('./routes/gpsSync')
    const result = await syncGPS()
    res.json(result)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/internal/gps/upload-camera-excel', async (req, res) => {
  if (!verifyCronSecret(req)) return res.status(403).json({ error: 'Forbidden' })
  req.url = '/upload-camera-excel'
  gpsSyncRoutes(req, res)
})

app.post('/internal/gps/sync-camera', async (req, res) => {
  if (!verifyCronSecret(req)) return res.status(403).json({ error: 'Forbidden' })
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
app.use('/api/bdsc',  protect, bdscRoutes)

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

app.use((req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ MongoDB connected')

    // ── [H7] MongoDB indexes ──────────────────────────────────────────────────
    const db = mongoose.connection.db
    Promise.all([
      db.collection('ntxt').createIndex({ bienSo: 1 }),
      db.collection('ntxt').createIndex({ thang: 1, nam: 1 }),
      db.collection('ntxt').createIndex({ maHienTai: 1, thang: 1, nam: 1 }),
      db.collection('xetai').createIndex({ 'BIỂN SỐ': 1 }),
      db.collection('xetai').createIndex({ 'Mã TS kế toán': 1 }),
      db.collection('users').createIndex({ lastActive: 1 }),
    ]).catch(e => console.warn('[Indexes]', e.message))

    app.listen(PORT, () => {
      console.log(`✓ Server on port ${PORT}`)
      startGpsCron()
    })
  })
  .catch(err => { console.error('✗ DB failed:', err.message); process.exit(1) })
