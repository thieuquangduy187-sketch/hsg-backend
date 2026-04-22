const jwt  = require('jsonwebtoken')
const User = require('../models/User')

const JWT_SECRET = process.env.JWT_SECRET || 'hsg-fleet-secret-change-in-production'
const JWT_EXPIRES = '7d'

// Tạo JWT token
function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

// Middleware: verify JWT từ Authorization header
async function protect(req, res, next) {
  try {
    // Lấy token từ header: "Bearer <token>"
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.' })
    }

    const token = authHeader.split(' ')[1]

    // Verify token
    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' })
      }
      return res.status(401).json({ error: 'Token không hợp lệ.' })
    }

    // Tìm user
    const user = await User.findById(decoded.id).select('-password')
    if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại.' })
    if (!user.active) return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa.' })

    // Gắn user vào request
    req.user = user
    next()
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// Middleware: chỉ admin
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền thực hiện thao tác này.' })
  }
  next()
}

module.exports = { signToken, protect, adminOnly, JWT_SECRET }
