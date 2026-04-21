// Chạy 1 lần để tạo users trong MongoDB
// node src/seed.js
require('dotenv').config()
const mongoose = require('mongoose')
const User = require('./models/User')

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  // Xóa users cũ
  await User.deleteMany({})

  // Tạo users
  const users = [
    {
      username: 'thieuquangduy',
      password: 'duy2061997',
      displayName: 'Thiều Quang Duy',
      role: 'admin',
      active: true,
    },
    // Thêm users khác ở đây nếu cần
    // {
    //   username: 'user2',
    //   password: 'password2',
    //   displayName: 'Người dùng 2',
    //   role: 'viewer',
    // }
  ]

  for (const u of users) {
    const user = new User(u)
    await user.save() // pre-save hook tự hash password
    console.log(`✓ Created user: ${u.username} (${u.role})`)
  }

  console.log('\nDone! Users created:')
  const all = await User.find().select('-password')
  all.forEach(u => console.log(`  - ${u.username} | ${u.displayName} | ${u.role}`))

  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
