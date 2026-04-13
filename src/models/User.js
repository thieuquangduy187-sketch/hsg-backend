const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:  { type: String, required: true, minlength: 6 },
  displayName: { type: String, required: true },
  role:      { type: String, enum: ['admin', 'viewer'], default: 'viewer' },
  active:    { type: Boolean, default: true },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'users' })

// Hash password trước khi save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// Verify password
userSchema.methods.verifyPassword = async function (plain) {
  return bcrypt.compare(plain, this.password)
}

// Trả về object an toàn (không có password)
userSchema.methods.toSafe = function () {
  return {
    id:          String(this._id),
    username:    this.username,
    displayName: this.displayName,
    role:        this.role,
    lastLogin:   this.lastLogin,
  }
}

module.exports = mongoose.model('User', userSchema)
