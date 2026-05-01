// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/adminUsers.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router = require('express').Router()
const User   = require('../models/User')
const { protect, adminOnly } = require('../middleware/auth')

// Tất cả routes đều yêu cầu admin
router.use(protect, adminOnly)

// ── GET /api/admin/users — danh sách users ────────────────
router.get('/users', async (req, res) => {
  try {
    const { q, role, active, page = 1, limit = 50 } = req.query
    const filter = {}

    if (q) {
      const re = new RegExp(q.trim(), 'i')
      filter.$or = [{ username: re }, { displayName: re }, { bienSo: re }]
    }
    if (role && role !== 'all') filter.role = role
    if (active !== undefined && active !== '') {
      filter.active = active === 'true'
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -sessions')
        .sort({ createdAt: -1 })
        .skip(skip).limit(parseInt(limit))
        .lean(),
      User.countDocuments(filter),
    ])

    // Enrich with computed fields
    const now = new Date()
    const result = users.map(u => {
      const tempUser = Object.assign(Object.create(User.prototype), u)
      tempUser.permissions = u.permissions ?? User.DEFAULT_PERMISSIONS?.[u.role] ?? []
      tempUser.allowedPages = u.allowedPages ?? User.DEFAULT_PAGES?.[u.role] ?? []
      const locked = u.isLocked && (!u.lockedUntil || new Date(u.lockedUntil) > now)
      return {
        ...u,
        permissions:  tempUser.permissions,
        allowedPages: tempUser.allowedPages,
        isLockedNow:  locked,
      }
    })

    res.json({ users: result, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/admin/users — tạo user mới ─────────────────
router.post('/users', async (req, res) => {
  try {
    const {
      username, password, displayName, role = 'viewer',
      permissions, allowedPages,
      bienSo, bienSoList, maHienTai
    } = req.body

    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'Thiếu username, password hoặc displayName.' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' })
    }

    const exists = await User.findOne({ username: username.trim().toLowerCase() })
    if (exists) return res.status(409).json({ error: `Username "${username}" đã tồn tại.` })

    const user = new User({
      username: username.trim().toLowerCase(),
      password, displayName: displayName.trim(),
      role, active: true,
      permissions:  permissions  ?? null,
      allowedPages: allowedPages ?? null,
      bienSo, bienSoList: bienSoList || [],
      maHienTai, createdBy: req.user.username,
    })
    await user.save()
    res.status(201).json({ ok: true, user: user.toSafe() })
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Username đã tồn tại.' })
    res.status(500).json({ error: e.message })
  }
})

// ── PUT /api/admin/users/:id — cập nhật user ─────────────
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const {
      displayName, role, permissions, allowedPages,
      active, bienSo, bienSoList, maHienTai
    } = req.body

    // Không cho sửa chính mình qua route này (dùng change-password)
    if (String(req.user._id) === id && role && role !== req.user.role) {
      return res.status(400).json({ error: 'Không thể tự thay đổi role của chính mình.' })
    }

    const user = await User.findById(id)
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' })

    if (displayName !== undefined) user.displayName  = displayName.trim()
    if (role        !== undefined) user.role         = role
    if (active      !== undefined) user.active       = active
    if (bienSo      !== undefined) user.bienSo       = bienSo
    if (bienSoList  !== undefined) user.bienSoList   = bienSoList
    if (maHienTai   !== undefined) user.maHienTai    = maHienTai

    // null = reset về default của role
    if (permissions  !== undefined) user.permissions  = permissions
    if (allowedPages !== undefined) user.allowedPages = allowedPages

    await user.save()
    res.json({ ok: true, user: user.toSafe() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/admin/users/:id ───────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (String(req.user._id) === id) {
      return res.status(400).json({ error: 'Không thể xóa tài khoản của chính mình.' })
    }
    const user = await User.findByIdAndDelete(id)
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' })
    res.json({ ok: true, message: `Đã xóa user ${user.username}` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/admin/users/:id/reset-password ─────────────
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' })
    }
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' })
    user.password = newPassword  // pre-save hook hash
    user.loginAttempts = 0
    await user.save()
    res.json({ ok: true, message: `Đã đặt lại mật khẩu cho ${user.username}` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/admin/users/:id/lock ────────────────────────
router.post('/users/:id/lock', async (req, res) => {
  try {
    const { lock, reason, durationMinutes } = req.body
    if (String(req.user._id) === req.params.id) {
      return res.status(400).json({ error: 'Không thể khóa tài khoản của chính mình.' })
    }
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' })

    if (lock) {
      user.isLocked     = true
      user.lockedReason = reason || 'Bị khóa bởi quản trị viên'
      user.lockedUntil  = durationMinutes
        ? new Date(Date.now() + durationMinutes * 60 * 1000)
        : null
    } else {
      user.isLocked     = false
      user.lockedUntil  = null
      user.lockedReason = ''
      user.loginAttempts = 0
    }
    await user.save()

    res.json({
      ok: true,
      message: lock
        ? `Đã khóa tài khoản ${user.username}`
        : `Đã mở khóa tài khoản ${user.username}`,
      user: user.toSafe(),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/admin/sessions — tất cả sessions đang active ─
router.get('/sessions', async (req, res) => {
  try {
    const now = new Date()
    const users = await User.find({
      'sessions.isActive': true,
      'sessions.expiresAt': { $gt: now },
    })
    .select('username displayName role sessions')
    .lean()

    const sessions = []
    users.forEach(u => {
      u.sessions
        .filter(s => s.isActive && (!s.expiresAt || new Date(s.expiresAt) > now))
        .forEach(s => {
          sessions.push({
            sessionId:   s._id,
            userId:      u._id,
            username:    u.username,
            displayName: u.displayName,
            role:        u.role,
            ip:          s.ip,
            device:      s.device,
            createdAt:   s.createdAt,
            lastSeenAt:  s.lastSeenAt,
            expiresAt:   s.expiresAt,
          })
        })
    })

    sessions.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    res.json({ sessions, total: sessions.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/admin/sessions/:userId/:sessionId — revoke ─
router.delete('/sessions/:userId/:sessionId', async (req, res) => {
  try {
    const { userId, sessionId } = req.params
    await User.updateOne(
      { _id: userId, 'sessions._id': sessionId },
      { $set: { 'sessions.$.isActive': false, 'sessions.$.revokedAt': new Date() } }
    )
    res.json({ ok: true, message: 'Đã thu hồi phiên đăng nhập.' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/admin/sessions/:userId — revoke all ───────
router.delete('/sessions/:userId', async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.params.userId },
      { $set: { 'sessions.$[].isActive': false, 'sessions.$[].revokedAt': new Date() } }
    )
    res.json({ ok: true, message: 'Đã thu hồi tất cả phiên đăng nhập.' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/admin/meta — danh sách permissions & pages ───
router.get('/meta', (req, res) => {
  const { ALL_PERMISSIONS, ALL_PAGES, DEFAULT_PERMISSIONS, DEFAULT_PAGES } = require('../models/User')
  res.json({ ALL_PERMISSIONS, ALL_PAGES, DEFAULT_PERMISSIONS, DEFAULT_PAGES })
})

module.exports = router
