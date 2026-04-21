// Tạo user cho tất cả xe trong collection xetai
// Mỗi xe → 1 user, username = Mã hiện tại, password = 123456
// node src/seedXeUsers.js
require('dotenv').config()
const mongoose = require('mongoose')
const User = require('./models/User')

async function seedXeUsers() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✓ Connected to MongoDB')

  const db = mongoose.connection.db
  const xeDocs = await db.collection('xetai').find({}).toArray()
  console.log(`Found ${xeDocs.length} xe documents`)

  let created = 0, skipped = 0, errors = 0

  for (const xe of xeDocs) {
    const maHienTai = xe['Mã hiện tại'] || xe['Mã hiện tại2'] || ''
    const bienSo    = xe['BIỂN SỐ'] || xe['BIỂNSỐ'] || ''

    if (!maHienTai || maHienTai === '0' || maHienTai === '') {
      skipped++
      continue
    }

    // username = mã hiện tại lowercase, trim
    const username = String(maHienTai).trim().toLowerCase()

    // Kiểm tra đã có chưa
    const existing = await User.findOne({ username })
    if (existing) {
      skipped++
      continue
    }

    try {
      const user = new User({
        username,
        password:    '123456',
        displayName: `Xe ${bienSo || maHienTai}`,
        role:        'xe',
        active:      true,
        maHienTai:   String(maHienTai).trim(),
        bienSo:      bienSo,
      })
      await user.save()
      created++
      if (created <= 10 || created % 50 === 0) {
        console.log(`  ✓ Created: ${username} (${bienSo})`)
      }
    } catch(e) {
      if (e.code !== 11000) {
        console.log(`  ✗ Error for ${username}: ${e.message}`)
        errors++
      } else {
        skipped++
      }
    }
  }

  console.log(`\nDone!`)
  console.log(`  Created: ${created}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Errors:  ${errors}`)

  // Show sample
  const sample = await User.find({ role: 'xe' }).limit(5).select('-password')
  console.log('\nSample xe users:')
  sample.forEach(u => console.log(`  ${u.username} | ${u.displayName} | ${u.bienSo}`))

  process.exit(0)
}

seedXeUsers().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
