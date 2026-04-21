require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const mongoose = require('mongoose')

const authRoutes  = require('./routes/auth')
const xeRoutes    = require('./routes/xe')
const otoRoutes   = require('./routes/oto')
const statsRoutes = require('./routes/stats')
const { protect } = require('./middleware/auth')
const nhatTrinhRoutes = require('./routes/nhatTrinh')
const analyzeRoutes = require('./routes/analyze')
const importRoutes = require('./routes/import')

const app  = express()
const PORT = process.env.PORT || 3000

// CORS — allow all origins
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Public routes
app.get('/', (req, res) => res.json({ status: 'ok', message: 'HSG Fleet API v2' }))
app.use('/api/auth', authRoutes)

// Protected routes — cần JWT
app.use('/api/xe',    protect, xeRoutes)
app.use('/api/oto',   protect, otoRoutes)
app.use('/api/stats', protect, statsRoutes)
app.use('/api/nhat-trinh', protect, nhatTrinhRoutes)
app.use('/api/import', protect, importRoutes)
app.use('/api/analyze', protect, analyzeRoutes)

app.use((req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ MongoDB connected')
    app.listen(PORT, () => console.log(`✓ Server on port ${PORT}`))
  })
  .catch(err => { console.error('✗ DB failed:', err.message); process.exit(1) })
