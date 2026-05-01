// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/auth.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router = require('express').Router()
const User   = require('../models/User')
const { signToken, hashToken, parseDevice, protect, adminOnly } = require('../middleware/auth')

const MAX_LOGIN_ATTEMPTS = 5
const LOCK_DURATION_MIN  = 15

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req, res) => {
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
      return res.status(403).json({
        error: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.'
      })
    }

    // Check lock status
    if (user.isCurrentlyLocked()) {
      const remaining = user.lockedUntil
        ? Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000)
        : null
      return res.status(403).json({
        error: remaining
          ? `Tài khoản tạm thời bị khóa. Thử lại sau ${remaining} phút.`
          : `Tài khoản tạm thời bị khóa. Lý do: ${user.lockedReason || 'Liên hệ quản trị viên.'}`,
        lockedUntil: user.lockedUntil,
      })
    }

    // Check failed attempts — auto-lock after MAX_LOGIN_ATTEMPTS
    const isMatch = await user.verifyPassword(password)
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1
      user.lastFailedAt = new Date()

      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.isLocked    = true
        user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000)
        user.lockedReason = `Nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần liên tiếp`
        await user.save()
        return res.status(403).json({
          error: `Tài khoản bị tạm khóa ${LOCK_DURATION_MIN} phút do nhập sai mật khẩu quá nhiều lần.`
        })
      }

      await user.save()
      const remaining = MAX_LOGIN_ATTEMPTS - user.loginAttempts
      return res.status(401).json({
        error: `Mật khẩu không đúng. Còn ${remaining} lần thử trước khi bị khóa.`,
        attemptsLeft: remaining,
      })
    }

    // Login thành công — reset attempts
    user.loginAttempts = 0
    user.lastLogin = new Date()
    user.isLocked  = false

    const token = signToken(user._id)
    const tHash  = hashToken(token)

    // Track session (giữ tối đa 10 sessions gần nhất)
    const ua = req.headers['user-agent'] || ''
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
              || req.connection?.remoteAddress || ''
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    user.sessions.push({
      tokenHash: tHash, ip, userAgent: ua,
      device: parseDevice(ua),
      createdAt: new Date(), lastSeenAt: new Date(),
      expiresAt, isActive: true,
    })

    // Trim old sessions — keep only 10 most recent active
    user.sessions = user.sessions
      .filter(s => s.isActive)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)

    await user.save()

    res.json({ token, user: user.toSafe(), expiresIn: '30d' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user.toSafe() })
})

// ── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const tHash = hashToken(token)
      await User.updateOne(
        { _id: req.user._id, 'sessions.tokenHash': tHash },
        { $set: { 'sessions.$.isActive': false, 'sessions.$.revokedAt': new Date() } }
      )
    }
    res.json({ message: 'Đăng xuất thành công.' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/auth/change-password ───────────────────────
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

// ── POST /api/auth/seed ───────────────────────────────────
router.post('/seed', async (req, res) => {
  try {
    const { secret } = req.body
    if (!secret || secret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Sai secret key.' })
    }
    const existing = await User.findOne({ username: 'thieuquangduy' })
    if (existing) return res.json({ message: 'User đã tồn tại.', user: existing.toSafe() })
    const user = new User({
      username: 'thieuquangduy', password: 'duy2061997',
      displayName: 'Thiều Quang Duy', role: 'admin', active: true,
    })
    await user.save()
    res.json({ message: 'Tạo user thành công!', user: user.toSafe() })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/auth/seed-xe ─────────────────────────────────
router.get('/seed-xe', async (req, res) => {
  try {
    const mongoose = require('mongoose')
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

// ── GET /api/auth/stats ───────────────────────────────────
router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const since5min = new Date(Date.now() - 5 * 60 * 1000)
    const [online, totalVisits, onlineUsers] = await Promise.all([
      User.countDocuments({ lastActive: { $gte: since5min } }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$totalVisits' } } }]),
      User.find({ lastActive: { $gte: since5min } })
        .select('username displayName role lastActive')
        .sort({ lastActive: -1 }).limit(20).lean(),
    ])
    res.json({ online, totalVisits: totalVisits[0]?.total || 0, onlineUsers })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
