const router = require('express').Router()
const User   = require('../models/User')
const { signToken, protect } = require('../middleware/auth')

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' })
    }

    // Tìm user (case-insensitive vì username đã lowercase)
    const user = await User.findOne({ username: username.trim().toLowerCase() })
    if (!user) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa.' })
    }

    // Verify password
    const isMatch = await user.verifyPassword(password)
    if (!isMatch) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
    }

    // Update lastLogin
    user.lastLogin = new Date()
    await user.save()

    // Tạo JWT
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

// ── GET /api/auth/me — lấy thông tin user hiện tại ───────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user.toSafe() })
})

// ── POST /api/auth/logout — client xóa token, server ghi nhận ────────────────
router.post('/logout', protect, (req, res) => {
  // JWT stateless — logout chỉ cần client xóa token
  // Có thể thêm blacklist nếu cần (Redis), giờ chỉ return success
  res.json({ message: 'Đăng xuất thành công.' })
})

// ── POST /api/auth/change-password — đổi mật khẩu ────────────────────────────
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

    user.password = newPassword // pre-save hook sẽ hash
    await user.save()

    res.json({ message: 'Đổi mật khẩu thành công.' })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/auth/seed — tạo user lần đầu (chỉ dùng 1 lần, xóa sau) ─────────
// Bảo vệ bằng SEED_SECRET env var
router.post('/seed', async (req, res) => {
  try {
    const { secret } = req.body
    if (!secret || secret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Sai secret key.' })
    }

    // Kiểm tra đã có user chưa
    const existing = await User.findOne({ username: 'thieuquangduy' })
    if (existing) {
      return res.json({ message: 'User đã tồn tại.', user: existing.toSafe() })
    }

    // Tạo user mặc định
    const user = new User({
      username:    'thieuquangduy',
      password:    'duy2061997',
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

// ── GET /api/auth/seed-xe — Tạo xe users (dùng biển số cho xe trùng mã) ──
router.get('/seed-xe', async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const User = require('../models/User')
    const db = mongoose.connection.db
    const xeDocs = await db.collection('xetai').find({}).toArray()

    // Đếm số lần xuất hiện của mỗi mã để phát hiện trùng
    const maCount = {}
    xeDocs.forEach(xe => {
      const ma = (xe['Mã hiện tại'] || '').trim().toLowerCase()
      if (ma && ma !== '0') maCount[ma] = (maCount[ma] || 0) + 1
    })

    let created = 0, skipped = 0, errors = []
    for (const xe of xeDocs) {
      const ma     = (xe['Mã hiện tại'] || '').trim()
      const bienSo = (xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || '').trim()

      // Chọn username: nếu mã trùng hoặc rỗng → dùng biển số
      const maNorm = ma.toLowerCase()
      let username
      if (!ma || ma === '0' || (maCount[maNorm] > 1)) {
        // Dùng biển số, bỏ dấu chấm và gạch ngang
        if (!bienSo) { skipped++; continue }
        username = bienSo.replace(/[.\-\s]/g, '').toLowerCase()
      } else {
        username = maNorm
      }

      const existing = await User.findOne({ username })
      if (existing) { skipped++; continue }

      try {
        await new User({
          username,
          password:    '123456',
          displayName: `Xe ${bienSo || ma}`,
          role:        'xe',
          active:      true,
          maHienTai:   ma,
          bienSo,
        }).save()
        created++
      } catch(e) {
        if (e.code === 11000) skipped++
        else errors.push(`${username}: ${e.message}`)
      }
    }
    res.json({ success: true, created, skipped, errors, total: xeDocs.length })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
