const router      = require('express').Router()
const rateLimit   = require('express-rate-limit')
const User        = require('../models/User')
const { signToken, protect, adminOnly } = require('../middleware/auth')

// ── [C6] Rate limiting cho login ──────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.' }
})

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' })
    }

    const user = await User.findOne({ username: username.trim().toLowerCase() })
    if (!user) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa.' })
    }

    const isMatch = await user.verifyPassword(password)
    if (!isMatch) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
    }

    user.lastLogin = new Date()
    await user.save()

    const token = signToken(user._id)

    res.json({
      token,
      user: user.toSafe(),
      expiresIn: '7d'
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user.toSafe() })
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Đăng xuất thành công.' })
})

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin.' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' })
    }

    const user = await User.findById(req.user._id)
    const isMatch = await user.verifyPassword(currentPassword)
    if (!isMatch) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' })
    }

    user.password = newPassword
    await user.save()

    res.json({ message: 'Đổi mật khẩu thành công.' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/auth/seed — tạo user lần đầu (chỉ dùng 1 lần) ─────────────────
router.post('/seed', async (req, res) => {
  try {
    const { secret } = req.body
    if (!secret || secret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Sai secret key.' })
    }

    const existing = await User.findOne({ username: 'thieuquangduy' })
    if (existing) {
      return res.json({ message: 'User đã tồn tại.', user: existing.toSafe() })
    }

    // [C2] Dùng ADMIN_PASSWORD từ env, không hardcode
    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD env var chưa được cấu hình.' })
    }

    const user = new User({
      username:    'thieuquangduy',
      password:    adminPassword,
      displayName: 'Thiều Quang Duy',
      role:        'admin',
      active:      true,
    })
    await user.save()

    res.json({
      message: 'Tạo user thành công!',
      user: user.toSafe()
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/auth/seed-xe — [C1] Yêu cầu auth + admin ───────────────────────
router.get('/seed-xe', protect, adminOnly, async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const User = require('../models/User')
    const db = mongoose.connection.db
    const xeDocs = await db.collection('xetai').find({}).toArray()

    function stripBienSo(bs) {
      return String(bs).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    }

    await User.deleteMany({ role: 'xe' })

    const nhomMa = {}
    for (const xe of xeDocs) {
      const ma = String(xe['Mã hiện tại'] || xe['Mã hiện tại2'] || '').trim()
      if (!ma || ma === '0') continue
      if (!nhomMa[ma]) nhomMa[ma] = []
      nhomMa[ma].push(xe)
    }

    let created = 0, errors = 0

    for (const [ma, xeList] of Object.entries(nhomMa)) {
      const bienSoAll = xeList
        .map(x => x['BIỂN SỐ'] || x['BIẼNSỐ'] || '')
        .filter(Boolean).map(b => String(b).trim())

      let username, displayName, bienSoChinh

      if (xeList.length === 1) {
        bienSoChinh = bienSoAll[0] || ma
        username    = bienSoAll[0] ? stripBienSo(bienSoAll[0]) : ma.toLowerCase()
        displayName = `Xe ${bienSoChinh}`
      } else {
        username    = ma.toLowerCase()
        displayName = `Nhóm ${ma} (${bienSoAll.length} xe)`
        bienSoChinh = bienSoAll[0] || ma
      }

      try {
        await new User({
          username, password: '123456', displayName, role: 'xe', active: true,
          maHienTai: ma, bienSo: bienSoChinh, bienSoList: bienSoAll,
        }).save()
        created++
      } catch(e) {
        if (e.code !== 11000) errors++
      }
    }

    res.json({ success: true, created, errors, total: xeDocs.length })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/auth/stats — Online users (admin only)
router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const User = require('../models/User')
    const since5min = new Date(Date.now() - 5 * 60 * 1000)

    const [online, totalVisits, onlineUsers] = await Promise.all([
      User.countDocuments({ lastActive: { $gte: since5min } }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$totalVisits' } } }]),
      User.find({ lastActive: { $gte: since5min } })
        .select('username displayName role lastActive')
        .sort({ lastActive: -1 })
        .limit(20)
        .lean(),
    ])

    res.json({
      online,
      totalVisits: totalVisits[0]?.total || 0,
      onlineUsers,
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
