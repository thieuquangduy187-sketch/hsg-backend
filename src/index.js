require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const mongoose = require('mongoose')

const xeRoutes    = require('./routes/xe')
const otoRoutes   = require('./routes/oto')
const statsRoutes = require('./routes/stats')

const app  = express()
const PORT = process.env.PORT || 3000

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins (Netlify, localhost, custom domain)
    callback(null, true)
  },
  credentials: true
}))
app.use(express.json())

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', message: 'HSG Fleet API' }))
app.use('/api/xe',    xeRoutes)
app.use('/api/oto',   otoRoutes)
app.use('/api/stats', statsRoutes)

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

// ── Connect DB → Start server ─────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ MongoDB connected')
    app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`))
  })
  .catch(err => {
    console.error('✗ MongoDB connection failed:', err.message)
    process.exit(1)
  })
