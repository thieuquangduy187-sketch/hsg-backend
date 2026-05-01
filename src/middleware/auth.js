// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/middleware/auth.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const jwt    = require('jsonwebtoken')
const crypto = require('crypto')
const User   = require('../models/User')

const JWT_SECRET  = process.env.JWT_SECRET || 'hsg-fleet-secret-change-in-production'
const JWT_EXPIRES = '30d'

// ── Helpers ───────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function parseDevice(ua = '') {
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'Mobile'
  return 'Desktop'
}

// ── Main protect middleware ───────────────────────────────
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.' })
    }

    const token = authHeader.split(' ')[1]
    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' })
      }
      return res.status(401).json({ error: 'Token không hợp lệ.' })
    }

    const user = await User.findById(decoded.id).select('-password')
    if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại.' })
    if (!user.active) return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa.' })

    // Check lock
    if (user.isCurrentlyLocked()) {
      const reason = user.lockedReason ? ` Lý do: ${user.lockedReason}` : ''
      const until  = user.lockedUntil
        ? ` (đến ${new Date(user.lockedUntil).toLocaleString('vi-VN')})`
        : ''
      return res.status(403).json({ error: `Tài khoản tạm thời bị khóa.${reason}${until}` })
    }

    // Check session revocation (only for non-admin or if session tracking enabled)
    const tokenHash = hashToken(token)
    const session = user.sessions.find(s => s.tokenHash === tokenHash)
    if (session && !session.isActive) {
      return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.' })
    }

    req.user = user

    // Background updates (non-blocking)
    const now = new Date()
    const updateOps = {
      $set: { lastActive: now },
      $inc: { totalVisits: 1 }
    }
    // Update session lastSeen if found
    if (session) {
      User.updateOne(
        { _id: user._id, 'sessions.tokenHash': tokenHash },
        { $set: { lastActive: now, 'sessions.$.lastSeenAt': now }, $inc: { totalVisits: 1 } }
      ).exec().catch(() => {})
    } else {
      User.updateOne({ _id: user._id }, updateOps).exec().catch(() => {})
    }

    next()
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── adminOnly middleware ──────────────────────────────────
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền thực hiện thao tác này.' })
  }
  next()
}

// ── requirePermission middleware factory ──────────────────
function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next() // admin bypass
    if (!req.user?.hasPermission(permission)) {
      return res.status(403).json({ error: `Bạn không có quyền: ${permission}` })
    }
    next()
  }
}

module.exports = { signToken, hashToken, parseDevice, protect, adminOnly, requirePermission, JWT_SECRET }
