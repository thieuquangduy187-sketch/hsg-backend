// Chỉ upsert admin users — KHÔNG xóa xe users
// node src/seed.js
require('dotenv').config()
const mongoose = require('mongoose')
const User = require('./models/User')

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const total = await User.countDocuments()
  console.log(`Total users hiện tại: ${total}`)

  const adminUsers = [
    {
      username: 'thieuquangduy',
      password: 'duy2061997',
      displayName: 'Thiều Quang Duy',
      role: 'admin',
      active: true,
    },
  ]

  for (const u of adminUsers) {
    const existing = await User.findOne({ username: u.username })
    if (existing) {
      // Reset password + đảm bảo role đúng
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
