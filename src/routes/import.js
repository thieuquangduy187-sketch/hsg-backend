const router   = require('express').Router()
const mongoose = require('mongoose')

function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

// Lấy document đầu tiên để map field
function mapRow(row) {
  const get = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]
      const found = Object.keys(row).find(k =>
        k.trim().toLowerCase() === key.trim().toLowerCase()
      )
      if (found && row[found] !== undefined && row[found] !== null && row[found] !== '')
        return row[found]
    }
    return ''
  }
  // Map tất cả keys từ row, không filter
  const mapped = {}
  Object.keys(row).forEach(k => { mapped[k] = row[k] })
  return mapped
}

// ── GET /api/import/collections — danh sách collections hiện có ───────────────
router.get('/collections', async (req, res) => {
  try {
    const db = mongoose.connection.db
    const collections = await db.listCollections().toArray()
    const names = collections.map(c => c.name).sort()
    res.json({ collections: names })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/import/xe — import vào collection chỉ định ─────────────────────
// Body: { rows: [...], collection: "xetai", mode: "upsert"|"replace"|"append" }
router.post('/xe', async (req, res) => {
  try {
    const {
      rows,
      collection: colName = 'xetai',
      mode = 'upsert',        // upsert | replace | append
      keyField = 'Mã TS kế toán'  // field dùng để xác định trùng
    } = req.body

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import.' })
    }

    // Validate collection name
    const safeCol = colName.replace(/[^a-zA-Z0-9_\-àáâãèéêìíòóôõùúăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi, '')
    if (!safeCol) return res.status(400).json({ error: 'Tên collection không hợp lệ.' })

    const db  = mongoose.connection.db
    const col = db.collection(safeCol)

    const results = { added: 0, updated: 0, skipped: 0, errors: [], collection: safeCol }

    // Mode: replace — xóa hết rồi import lại
    if (mode === 'replace') {
      await col.deleteMany({})
      const docs = rows.map(r => mapRow(r)).filter(r => Object.keys(r).length > 0)
      if (docs.length > 0) await col.insertMany(docs)
      results.added = docs.length
      return res.json({
        success: true,
        message: `Đã xóa và import lại ${docs.length} dòng vào "${safeCol}"`,
        ...results
      })
    }

    // Mode: append — thêm mới tất cả không kiểm tra trùng
    if (mode === 'append') {
      const docs = rows.map(r => mapRow(r)).filter(r => Object.keys(r).length > 0)
      if (docs.length > 0) await col.insertMany(docs)
      results.added = docs.length
      return res.json({
        success: true,
        message: `Đã thêm ${docs.length} dòng mới vào "${safeCol}"`,
        ...results
      })
    }

    // Mode: upsert — thêm mới hoặc cập nhật nếu trùng keyField
    for (const rawRow of rows) {
      try {
        const mapped = mapRow(rawRow)
        const keyVal = mapped[keyField]

        if (!keyVal && keyVal !== 0) {
          results.skipped++
          continue
        }

        const filter = { [keyField]: keyVal }
        // Thử thêm cả dạng number
        const numVal = parseFloat(String(keyVal).replace(/[^0-9.]/g, ''))
        if (!isNaN(numVal) && numVal !== keyVal) {
          filter[keyField] = { $in: [keyVal, numVal, String(numVal)] }
        }

        const existing = await col.findOne(filter)
        if (existing) {
          await col.updateOne({ _id: existing._id }, { $set: mapped })
          results.updated++
        } else {
          await col.insertOne(mapped)
          results.added++
        }
      } catch(rowErr) {
        results.errors.push({
          row: String(rawRow[keyField] || rawRow['BIỂN SỐ'] || rawRow['Biển số'] || '?').substring(0,20),
          error: rowErr.message
        })
      }
    }

    res.json({
      success: true,
      message: `Import xong vào "${safeCol}": ${results.added} thêm mới, ${results.updated} cập nhật, ${results.skipped} bỏ qua`,
      ...results
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/import/preview ──────────────────────────────────────────────────
router.post('/preview', async (req, res) => {
  try {
    const { rows } = req.body
    if (!rows?.length) return res.status(400).json({ error: 'Không có dữ liệu.' })
    res.json({ preview: rows.slice(0, 5), total: rows.length, columns: Object.keys(rows[0] || {}) })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
