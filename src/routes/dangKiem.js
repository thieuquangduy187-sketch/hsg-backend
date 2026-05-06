// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/dangKiem.js
// Thêm vào index.js:
//   const dangKiemRoutes = require('./routes/dangKiem')
//   app.use('/api/dang-kiem', protect, dangKiemRoutes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router  = require('express').Router()
const DangKiem = require('../models/DangKiem')

const norm = s => (s || '').toUpperCase().replace(/[\s.\-]/g, '')

// GET /api/dang-kiem/:bienSo
router.get('/:bienSo', async (req, res) => {
  try {
    const bs = norm(req.params.bienSo)
    const doc = await DangKiem.findOne({ bienSo: { $regex: `^${bs}$`, $options: 'i' } }).lean()
    if (!doc) return res.status(404).json({ error: 'Chưa có dữ liệu đăng kiểm' })
    res.json(doc)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/dang-kiem  — list all (dùng cho select dropdown + export)
router.get('/', async (req, res) => {
  try {
    const docs = await DangKiem.find({})
      .select('bienSo nhanHieu loaiPhuongTien thoiHanKDHienTai ngayKDGanNhat soSoQuanLy soKhung soMay namSanXuat taiTrongThietKe coLop phiDenHetNgay')
      .sort({ bienSo: 1 }).lean()
    res.json(docs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/dang-kiem/:bienSo/history — cập nhật lịch sử KĐ thủ công
router.put('/:bienSo/history', async (req, res) => {
  try {
    const bs = norm(req.params.bienSo)
    const { lichSuKD } = req.body
    if (!Array.isArray(lichSuKD)) return res.status(400).json({ error: 'lichSuKD phải là array' })

    // Tính lại thoiHanKDHienTai từ lịch sử mới
    const recent = findRecentKD(lichSuKD)
    const doc = await DangKiem.findOneAndUpdate(
      { bienSo: { $regex: `^${bs}$`, $options: 'i' } },
      { lichSuKD, thoiHanKDHienTai: recent?.thoiHanKD || '', ngayKDGanNhat: recent?.ngayKD || '', updatedAt: new Date() },
      { new: true }
    )
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy' })
    res.json(doc)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/dang-kiem/import — batch import từ script local
// Body: { records: [{ bienSo, ... }, ...] }
router.post('/import', async (req, res) => {
  try {
    const { records } = req.body
    if (!Array.isArray(records) || !records.length)
      return res.status(400).json({ error: 'Thiếu records[]' })

    let inserted = 0, updated = 0
    for (const r of records) {
      if (!r.bienSo) continue
      const exists = await DangKiem.findOne({ bienSo: r.bienSo })
      if (exists) {
        await DangKiem.updateOne({ bienSo: r.bienSo }, { ...r, updatedAt: new Date() })
        updated++
      } else {
        await DangKiem.create(r)
        inserted++
      }
    }
    res.json({ ok: true, inserted, updated, total: inserted + updated })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/dang-kiem/export/excel — xuất tất cả ra xlsx
router.get('/export/excel', async (req, res) => {
  try {
    const XLSX = require('xlsx')
    const docs  = await DangKiem.find({}).sort({ bienSo: 1 }).lean()
    if (!docs.length) return res.status(404).json({ error: 'Chưa có dữ liệu' })

    const rows = docs.map(d => ({
      'Biển số':                d.bienSo || '-',
      'Loại phương tiện':       d.loaiPhuongTien || '-',
      'Nhãn hiệu':              d.nhanHieu || '-',
      'Số loại / Model':        d.soLoai || '-',
      'Số khung':               d.soKhung || '-',
      'Số máy':                 d.soMay || '-',
      'Năm sản xuất':           d.namSanXuat || '-',
      'Nơi sản xuất':           d.noiSanXuat || '-',
      'Tải trọng TK (kg)':      d.taiTrongThietKe || '-',
      'Trọng lượng bản thân':   d.trongLuongBanThan || '-',
      'Kích thước bao (mm)':    d.kichThuocBao || '-',
      'Kích thước thùng (mm)':  d.kichThuocThung || '-',
      'Chiều dài cơ sở (mm)':   d.chieuDaiCoSo || '-',
      'Nhiên liệu':             d.nhienLieu || '-',
      'Dung tích (cm³)':        d.dungTich || '-',
      'Công suất':              d.congSuat || '-',
      'Số lốp':                 d.soLop || '-',
      'Cỡ lốp':                 d.coLop || '-',
      'Công thức bánh xe':      d.congThucBanhXe || '-',
      'Kinh doanh vận tải':     d.kinhDoanhVanTai || '-',
      'Số sổ quản lý':          d.soSoQuanLy || '-',
      'Ngày đăng ký':           d.ngayDangKy || '-',
      'Chủ phương tiện':        d.chuPhuongTien || '-',
      'Ngày KĐ gần nhất':       d.ngayKDGanNhat || '-',
      'Thời hạn KĐ hiện tại':   d.thoiHanKDHienTai || '-',
      'Phí KĐ đến hết ngày':    d.phiDenHetNgay || '-',
    }))

    const wb  = XLSX.utils.book_new()
    const ws  = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length, 14) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Đăng kiểm')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Disposition', 'attachment; filename="dang_kiem_xetai.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Helper: tìm lần KĐ gần nhất so với hôm nay ───────────
function findRecentKD(lichSu) {
  if (!lichSu?.length) return null
  const today = new Date()
  const parsed = lichSu.map(l => {
    const parts = (l.ngayKD || '').split('/')
    const d = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) : null
    return { ...l, _date: d }
  }).filter(l => l._date && !isNaN(l._date))

  if (!parsed.length) return lichSu[0]

  // Ưu tiên: lần KĐ có ngày gần hôm nay nhất (cả quá khứ gần và tương lai gần)
  parsed.sort((a, b) => Math.abs(a._date - today) - Math.abs(b._date - today))
  return parsed[0]
}

module.exports = router
