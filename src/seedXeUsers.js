// Seed xe users theo logic mới:
// - Xe có biển số unique → username = biển số stripped (vd: "51C-123.45" → "51c12345")
// - Nhiều xe cùng mã hiện tại → username = mã hiện tại, bienSoList = [tất cả biển số]
// - Password mặc định: 123456
// node src/seedXeUsers.js

require('dotenv').config()
const mongoose = require('mongoose')
const User = require('./models/User')

function stripBienSo(bs) {
  // "51C-123.45" → "51c12345"
  return String(bs).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

async function seedXeUsers() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✓ Connected to MongoDB')

  // Xóa toàn bộ xe users cũ
  const deleted = await User.deleteMany({ role: 'xe' })
  console.log(`Đã xóa ${deleted.deletedCount} xe users cũ`)

  const db = mongoose.connection.db
  const xeDocs = await db.collection('xetai').find({}).toArray()
  console.log(`Tìm thấy ${xeDocs.length} xe trong collection xetai`)

  // Nhóm xe theo Mã hiện tại
  const nhomMa = {}  // { maHienTai: [xe, xe, ...] }
  let skip = 0

  for (const xe of xeDocs) {
    const ma = String(xe['Mã hiện tại'] || xe['Mã hiện tại2'] || '').trim()
    if (!ma || ma === '0' || ma === '') { skip++; continue }
    if (!nhomMa[ma]) nhomMa[ma] = []
    nhomMa[ma].push(xe)
  }

  console.log(`Bỏ qua ${skip} xe không có mã`)
  console.log(`Số nhóm mã hiện tại: ${Object.keys(nhomMa).length}`)

  let created = 0, errors = 0

  for (const [ma, xeList] of Object.entries(nhomMa)) {
    const bienSoAll = xeList
      .map(x => x['BIỂN SỐ'] || x['BIẼNSỐ'] || '')
      .filter(Boolean)
      .map(b => String(b).trim())

    // username: nếu chỉ có 1 xe → dùng biển số stripped, nếu nhiều xe → dùng mã
    let username, displayName, bienSoChinh

    if (xeList.length === 1) {
      // Xe unique: username = biển số
      bienSoChinh = bienSoAll[0] || ma
      username    = bienSoAll[0] ? stripBienSo(bienSoAll[0]) : ma.toLowerCase()
      displayName = `Xe ${bienSoChinh}`
    } else {
      // Nhiều xe cùng mã: username = mã hiện tại
      username    = ma.toLowerCase()
      displayName = `Nhóm ${ma} (${bienSoAll.length} xe)`
      bienSoChinh = bienSoAll[0] || ma
    }

    try {
      const user = new User({
        username,
        password:    '123456',
        displayName,
        role:        'xe',
        active:      true,
        maHienTai:   ma,
        bienSo:      bienSoChinh,
        bienSoList:  bienSoAll,
      })
      await user.save()
      created++

      if (created <= 15 || created % 50 === 0) {
        if (xeList.length > 1) {
          console.log(`  ✓ [NHÓM] ${username} → ${bienSoAll.join(', ')}`)
        } else {
          console.log(`  ✓ ${username} (${ma})`)
        }
      }
    } catch(e) {
      console.log(`  ✗ Lỗi ${username} (${ma}): ${e.message}`)
      errors++
    }
  }

  console.log(`\n=== KẾT QUẢ ===`)
  console.log(`Tạo thành công: ${created}`)
  console.log(`Lỗi: ${errors}`)

  const nhomNhieu = Object.values(nhomMa).filter(x => x.length > 1)
  console.log(`Nhóm có nhiều biển số: ${nhomNhieu.length}`)
  if (nhomNhieu.length > 0) {
    console.log('Các nhóm:')
    nhomNhieu.forEach(list => {
      const ma = list[0]['Mã hiện tại']
      const bs = list.map(x => x['BIỂN SỐ'] || '?').join(', ')
      console.log(`  ${ma}: ${bs}`)
    })
  }

  const sample = await User.find({ role: 'xe' }).limit(5).select('-password')
  console.log('\nSample:')
  sample.forEach(u => console.log(`  ${u.username} | ${u.displayName} | bienSoList: [${u.bienSoList.join(', ')}]`))

  process.exit(0)
}

seedXeUsers().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
