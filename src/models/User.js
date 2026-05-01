// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/models/User.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

// ── Danh sách tất cả pages trong hệ thống ────────────────
const ALL_PAGES = [
  'overview', 'xe_tai', 'oto_con', 'nhat_trinh', 'nhat_trinh_ngay',
  'gia_dau', 'gps', 'chuyen_doi',
  'bao_cao_nhat_trinh', 'hieu_qua', 'analyze', 'import',
]

// ── Danh sách tất cả permissions ─────────────────────────
const ALL_PERMISSIONS = [
  'view_overview',
  'view_xe_tai',    'edit_xe_tai',
  'view_oto_con',
  'view_nhat_trinh', 'submit_nhat_trinh',
  'view_gia_dau',    'edit_gia_dau',
  'view_gps',
  'view_chuyen_doi', 'edit_chuyen_doi',
  'view_bao_cao',
  'view_hieu_qua',   'edit_hieu_qua',
  'view_analyze',
  'admin_users',
]

// ── Quyền mặc định theo role ──────────────────────────────
const DEFAULT_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  viewer: [
    'view_overview', 'view_xe_tai', 'view_oto_con',
    'view_nhat_trinh', 'view_gia_dau', 'view_gps',
    'view_chuyen_doi', 'view_bao_cao', 'view_hieu_qua', 'view_analyze',
  ],
  xe: ['submit_nhat_trinh', 'view_nhat_trinh'],
}

const DEFAULT_PAGES = {
  admin: ALL_PAGES,
  viewer: ['overview', 'xe_tai', 'oto_con', 'nhat_trinh', 'gia_dau', 'gps',
           'chuyen_doi', 'bao_cao_nhat_trinh', 'hieu_qua', 'analyze'],
  xe: ['nhat_trinh'],
}

// ── Session schema ────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  tokenHash:  { type: String, required: true },     // sha256 of JWT
  ip:         { type: String, default: '' },
  userAgent:  { type: String, default: '' },
  device:     { type: String, default: '' },        // parsed: Mobile/Desktop
  createdAt:  { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt:  { type: Date },
  isActive:   { type: Boolean, default: true },
  revokedAt:  { type: Date },
}, { _id: true })

// ── User schema ───────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:    { type: String, required: true, minlength: 6 },
  displayName: { type: String, required: true },
  role:        { type: String, enum: ['admin', 'viewer', 'xe'], default: 'viewer' },

  // Permission & page access
  permissions:  { type: [String], default: null },  // null = dùng default theo role
  allowedPages: { type: [String], default: null },  // null = dùng default theo role

  // Status
  active:       { type: Boolean, default: true },   // permanent disable
  isLocked:     { type: Boolean, default: false },  // temporary lock
  lockedUntil:  { type: Date, default: null },
  lockedReason: { type: String, default: '' },

  // Login tracking
  loginAttempts: { type: Number, default: 0 },
  lastFailedAt:  { type: Date },
  lastLogin:     { type: Date },
  lastActive:    { type: Date },
  totalVisits:   { type: Number, default: 0 },

  // Sessions
  sessions: { type: [sessionSchema], default: [] },

  createdAt:   { type: Date, default: Date.now },
  createdBy:   { type: String, default: '' },

  // Xe-specific fields
  maHienTai:   { type: String },
  bienSo:      { type: String },
  bienSoList:  { type: [String], default: [] },
}, { collection: 'users' })

// ── Pre-save: hash password ───────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// ── Methods ───────────────────────────────────────────────
userSchema.methods.verifyPassword = async function (plain) {
  return bcrypt.compare(plain, this.password)
}

userSchema.methods.getPermissions = function () {
  return this.permissions ?? DEFAULT_PERMISSIONS[this.role] ?? []
}

userSchema.methods.getAllowedPages = function () {
  return this.allowedPages ?? DEFAULT_PAGES[this.role] ?? []
}

userSchema.methods.hasPermission = function (perm) {
  return this.getPermissions().includes(perm)
}

userSchema.methods.isCurrentlyLocked = function () {
  if (!this.isLocked) return false
  if (this.lockedUntil && new Date() > this.lockedUntil) return false // auto-expire
  return true
}

userSchema.methods.toSafe = function () {
  return {
    id:           String(this._id),
    username:     this.username,
    displayName:  this.displayName,
    role:         this.role,
    permissions:  this.getPermissions(),
    allowedPages: this.getAllowedPages(),
    active:       this.active,
    isLocked:     this.isCurrentlyLocked(),
    lockedReason: this.lockedReason,
    lastLogin:    this.lastLogin,
    lastActive:   this.lastActive,
    totalVisits:  this.totalVisits,
    bienSo:       this.bienSo,
    bienSoList:   this.bienSoList || [],
    maHienTai:    this.maHienTai,
    createdAt:    this.createdAt,
  }
}

module.exports = mongoose.model('User', userSchema)
module.exports.ALL_PAGES = ALL_PAGES
module.exports.ALL_PERMISSIONS = ALL_PERMISSIONS
module.exports.DEFAULT_PERMISSIONS = DEFAULT_PERMISSIONS
module.exports.DEFAULT_PAGES = DEFAULT_PAGES
