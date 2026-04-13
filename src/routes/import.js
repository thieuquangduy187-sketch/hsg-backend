const router = require('express').Router()
const Xe = require('../models/Xe')

// ── Helper: clean số tiền/số từ string ───────────────────────────────────────
function cleanNum(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

// ── Map tên cột Excel → field MongoDB ────────────────────────────────────────
// Hỗ trợ nhiều tên cột khác nhau (tiếng Việt có dấu/không dấu)
function mapRow(row) {
  // Normalize key: trim + lowercase để so sánh linh hoạt
  const get = (...keys) => {
    for (const key of keys) {
      // Tìm chính xác
      if (row[key] !== undefined && row[key] !== null && row[key] !== '')
        return row[key]
      // Tìm case-insensitive + trim
      const found = Object.keys(row).find(k =>
        k.trim().toLowerCase() === key.trim().toLowerCase()
      )
      if (found && row[found] !== undefined && row[found] !== null && row[found] !== '')
        return row[found]
    }
    return ''
  }

  return {
    'STT':                                    cleanNum(get('STT', 'Stt', 'stt')),
    'BIỂNSỐ':                                 String(get('BIỂNSỐ', 'Biển số', 'bien so', 'BIEN SO')),
    'Hình ảnh':                               String(get('Hình ảnh', 'Hinh anh', 'image')),
    'Mã TS kế toán':                          cleanNum(get('Mã TS kế toán', 'Ma TS ke toan', 'MaTS')),
    'Mã hiện tại':                            String(get('Mã hiện tại', 'Ma hien tai')),
    'BIỂN SỐ':                                String(get('BIỂN SỐ', 'Biển số', 'Bien So')),
    'Biển số không dâu':                      String(get('Biển số không dâu', 'Bien so khong dau')),
    'Pháp nhân đứng tên':                     String(get('Pháp nhân đứng tên', 'Phap nhan')),
    'TÊN TÀI SẢN':                            String(get('TÊN TÀI SẢN', 'Ten tai san', 'Tên tài sản')),
    'Loại Thùng\n(Lửng, mui bạt, có cẩu)':   String(get('Loại Thùng', 'Loai Thung', 'Loại thùng')),
    'Loại xe':                                String(get('Loại xe', 'Loai xe', 'Hãng xe')),
    'Tải trọng \n(Tấn)':                      String(get('Tải trọng (Tấn)', 'Tai trong', 'Tải trọng')),
    'Cưả hàng sử dụng':                       String(get('Cửa hàng sử dụng', 'Cưả hàng sử dụng', 'Cua hang')),
    'Tỉnh Cũ':                                String(get('Tỉnh Cũ', 'Tinh Cu', 'Tỉnh cũ')),
    'Tỉnh mới':                               String(get('Tỉnh mới', 'Tinh moi')),
    'Tỉnh gộp':                               String(get('Tỉnh gộp', 'Tinh gop')),
    'Mã hiện tại2':                           String(get('Mã hiện tại2', 'Ma hien tai 2')),
    'Miền':                                   String(get('Miền', 'Mien')),
    ' Nguyên giá':                            String(get('Nguyên giá', 'Nguyen gia', ' Nguyên giá')),
    ' GTCL':                                  String(get('GTCL', ' GTCL')),
    'Năm SX':                                 cleanNum(get('Năm SX', 'Nam SX', 'Năm sản xuất')),
    'Ngày đưa vào sử dụng':                   String(get('Ngày đưa vào sử dụng', 'Ngay dua vao su dung')),
    'Lịch sử tai nạn':                        String(get('Lịch sử tai nạn', 'Lich su tai nan')),
    'Cây điều động':                          String(get('Cây điều động', 'Cay dieu dong')),
    'Dài':                                    String(get('Dài', 'Dai')),
    'Rộng':                                   String(get('Rộng', 'Rong')),
    'Cao':                                    String(get('Cao')),
  }
}

// ── POST /api/import/xe — import danh sách xe từ Excel (đã parse ở client) ───
router.post('/xe', async (req, res) => {
  try {
    const { rows } = req.body
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import.' })
    }

    const results = { added: 0, updated: 0, skipped: 0, errors: [] }

    for (const rawRow of rows) {
      try {
        const mapped = mapRow(rawRow)
        const maTS = mapped['Mã TS kế toán']

        // Bỏ qua dòng không có mã tài sản
        if (!maTS || maTS === 0) {
          results.skipped++
          continue
        }

        // Upsert: nếu đã có thì update, chưa có thì thêm mới
        const existing = await Xe.findOne({
          $or: [
            { 'Mã TS kế toán': maTS },
            { 'Mã TS kế toán': String(maTS) },
          ]
        })

        if (existing) {
          await Xe.updateOne(
            { _id: existing._id },
            { $set: mapped }
          )
          results.updated++
        } else {
          await Xe.create(mapped)
          results.added++
        }
      } catch(rowErr) {
        results.errors.push({
          row: rawRow['Mã TS kế toán'] || rawRow['BIỂN SỐ'] || '?',
          error: rowErr.message
        })
      }
    }

    res.json({
      success: true,
      message: `Import xong: ${results.added} thêm mới, ${results.updated} cập nhật, ${results.skipped} bỏ qua`,
      ...results
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/import/preview — preview 5 dòng đầu không import thật ───────────
router.post('/preview', async (req, res) => {
  try {
    const { rows } = req.body
    if (!rows?.length) return res.status(400).json({ error: 'Không có dữ liệu.' })

    const preview = rows.slice(0, 5).map(mapRow)
    res.json({ preview, total: rows.length })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
