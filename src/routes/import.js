const router   = require('express').Router()
const mongoose = require('mongoose')

function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

// [H6] Chặn NoSQL injection: loại bỏ keys bắt đầu bằng $ hoặc chứa dấu .
function mapRow(row) {
  const mapped = {}
  for (const k of Object.keys(row)) {
    if (k.startsWith('$') || k.includes('.')) continue
    const val = row[k]
    // Không cho phép nested objects (NoSQL injection vector)
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) continue
    mapped[k] = val
  }
  return mapped
}

// ── GET /api/import/collections ───────────────────────────────────────────────
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

// ── POST /api/import/xe ───────────────────────────────────────────────────────
router.post('/xe', async (req, res) => {
  try {
    const {
      rows,
      collection: colName = 'xetai',
      mode = 'upsert',
      keyField = 'Mã TS kế toán'
    } = req.body

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import.' })
    }
    // [H6] Giới hạn số rows
    if (rows.length > 5000) {
      return res.status(400).json({ error: 'Quá nhiều dòng. Tối đa 5000 dòng/lần import.' })
    }

    const safeCol = colName.replace(/[^a-zA-Z0-9_\-àáâãèéêìíòóôõùúăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi, '')
    if (!safeCol) return res.status(400).json({ error: 'Tên collection không hợp lệ.' })

    const db  = mongoose.connection.db
    const col = db.collection(safeCol)

    const results = { added: 0, updated: 0, skipped: 0, errors: [], collection: safeCol }

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

    // Mode: upsert
    for (const rawRow of rows) {
      try {
        const mapped = mapRow(rawRow)
        const keyVal = mapped[keyField]

        if (keyVal === undefined || keyVal === null || keyVal === '') {
          results.skipped++
          continue
        }

        const numVal = parseFloat(String(keyVal).replace(/[^0-9.]/g, ''))
        const filter = isNaN(numVal)
          ? { [keyField]: keyVal }
          : { [keyField]: { $in: [keyVal, numVal, String(numVal), String(Math.round(numVal))] } }

        const res2 = await col.updateOne(filter, { $set: mapped }, { upsert: true })

        if (res2.upsertedCount > 0) results.added++
        else if (res2.modifiedCount > 0) results.updated++
        else results.skipped++

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
