// Chỉ upsert admin users — KHÔNG xóa xe users
// node src/seed.js
// Yêu cầu: MONGODB_URI và ADMIN_PASSWORD trong env
require('dotenv').config()
const mongoose = require('mongoose')
const User = require('./models/User')

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is required')
    process.exit(1)
  }
  // [C2] Không hardcode password — phải set ADMIN_PASSWORD trong env
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    console.error('FATAL: ADMIN_PASSWORD env var is required to run seed')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const total = await User.countDocuments()
  console.log(`Total users hiện tại: ${total}`)

  const adminUsers = [
    {
      username:    'thieuquangduy',
      password:    adminPassword,
      displayName: 'Thiều Quang Duy',
      role:        'admin',
      active:      true,
    },
  ]

  for (const u of adminUsers) {
    const existing = await User.findOne({ username: u.username })
    if (existing) {
      existing.password = u.password  // pre-save hook sẽ hash lại
      existing.role     = u.role
      existing.active   = true
      await existing.save()
      console.log(`↻ Updated: ${u.username} (${u.role})`)
    } else {
      await new User(u).save()
      console.log(`✓ Created: ${u.username} (${u.role})`)
    }
  }

  const after = await User.countDocuments()
  console.log(`\nTotal users sau seed: ${after} (xe users còn nguyên)`)
  const admin = await User.findOne({ username: 'thieuquangduy' }).select('-password')
  console.log('Admin:', JSON.stringify(admin))

  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
