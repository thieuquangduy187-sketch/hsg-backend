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

module.exports = router
