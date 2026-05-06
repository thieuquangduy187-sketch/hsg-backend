// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/xeKD.js
// Thêm vào index.js:
//   const xeKDRoutes = require('./routes/xeKD')
//   app.use('/api/xe-kd', protect, xeKDRoutes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router = require('express').Router()
const XeKD   = require('../models/XeKD')
const XLSX   = require('xlsx')

const normBS = s => (s || '').toString().toUpperCase()
  .replace(/\s+/g,'').replace(/[-\.]/g,'').replace(/V$/,'')

// ── GET /api/xe-kd/list  — danh sách biển số có data KĐ ──
router.get('/list', async (req, res) => {
  try {
    const docs = await XeKD.find({}, { bienSo:1, bienSoRaw:1, 'kdHienHanh.thoiHanKD':1 }).lean()
    res.json(docs)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/xe-kd/:bienSo ────────────────────────────────
router.get('/:bienSo', async (req, res) => {
  try {
    const bs  = normBS(req.params.bienSo)
    // Tìm flex: so sánh normalized
    const all = await XeKD.find({}).lean()
    const doc = all.find(d => normBS(d.bienSo) === bs || normBS(d.bienSoRaw) === bs)
    if (!doc) return res.status(404).json({ error: 'Không có dữ liệu KĐ cho xe này' })
    res.json(doc)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/xe-kd/:bienSo  — cập nhật kdHienHanh ────────
router.put('/:bienSo', async (req, res) => {
  try {
    const bs  = normBS(req.params.bienSo)
    const all = await XeKD.find({}, { bienSo:1, bienSoRaw:1 }).lean()
    const doc = all.find(d => normBS(d.bienSo) === bs || normBS(d.bienSoRaw) === bs)
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy' })

    const { kdHienHanh } = req.body
    const updated = await XeKD.findByIdAndUpdate(
      doc._id,
      { $set: { kdHienHanh, updatedAt: new Date() } },
      { new: true }
    )
    res.json(updated)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /api/xe-kd/import-bulk  — nhận array records ────
// Dùng bởi importXeKD.js hoặc nội bộ
router.post('/import-bulk', async (req, res) => {
  try {
    const { records } = req.body
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records phải là array' })
    let inserted = 0, updated = 0
    for (const rec of records) {
      const result = await XeKD.findOneAndUpdate(
        { bienSoRaw: rec.bienSoRaw },
        { $set: { ...rec, updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
      if (!result.createdAt || Date.now() - result.createdAt < 5000) updated++
      else inserted++
    }
    res.json({ ok: true, inserted, updated, total: records.length })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/xe-kd/export-excel  — xuất toàn bộ ─────────
router.get('/export-excel', async (req, res) => {
  try {
    const all = await XeKD.find({}).lean()

    const rows = all.map(d => ({
      'Biển số':               d.bienSo          || '-',
      'Chủ phương tiện':       d.chuPhuongTien   || '-',
      'Địa chỉ chủ PT':       d.diaChiChu       || '-',
      'Ngày đăng ký':          d.ngayDangKy      || '-',
      'Số sổ KĐ':             d.soSoKiemDinh    || '-',
      'Số sổ quản lý':         d.soSoQuanLy      || '-',
      'Loại phương tiện':      d.loaiPhuongTien  || '-',
      'Nhãn hiệu':             d.nhanHieu        || '-',
      'Số loại':               d.soLoai          || '-',
      'Số khung':              d.soKhungThucTe   || '-',
      'Số máy':                d.soMayThucTe     || '-',
      'Năm SX':                d.namSanXuat      || '-',
      'Nơi SX':                d.noiSanXuat      || '-',
      'Tải trọng TK (kG)':    d.taiTrongThietKe || '-',
      'TL bản thân (kG)':     d.trongLuongBanThan|| '-',
      'Số người':              d.soNguoiChoPhep  || '-',
      'Công thức bánh xe':     d.congThucBanhXe  || '-',
      'Vết bánh xe':           d.vetBanhXe       || '-',
      'Kích thước bao (mm)':   d.kichThuocBao    || '-',
      'Kích thước thùng (mm)': d.kichThuocThung  || '-',
      'Chiều dài cơ sở (mm)': d.chieuDaiCoSo    || '-',
      'Nhiên liệu':            d.nhieuLieu       || '-',
      'Dung tích (cm3)':       d.dungTich        || '-',
      'Công suất':             d.congSuatLonNhat || '-',
      'Số lốp':                d.soLop           || '-',
      'Cỡ lốp':               d.coLop           || '-',
      'KD - Trạm':            d.kdHienHanh?.tramKD    || '-',
      'KD - Số phiếu':        d.kdHienHanh?.soPhieu   || '-',
      'KD - Ngày KĐ':         d.kdHienHanh?.ngayKD    || '-',
      'KD - Số tem':          d.kdHienHanh?.soTem     || '-',
      'KD - Thời hạn':        d.kdHienHanh?.thoiHanKD || '-',
      'Phí nộp đến':           d.phiNopDenHetNgay     || '-',
      'Kinh doanh vận tải':    d.kinhDoanhVanTai  || '-',
      'Lắp GSHT':              d.lapThietBiGSHT   || '-',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    // Column widths
    ws['!cols'] = [
      {wch:12},{wch:30},{wch:28},{wch:12},{wch:14},{wch:14},{wch:16},{wch:14},{wch:16},
      {wch:20},{wch:20},{wch:8},{wch:10},{wch:14},{wch:14},{wch:8},{wch:12},{wch:12},
      {wch:20},{wch:20},{wch:16},{wch:10},{wch:12},{wch:16},{wch:10},{wch:16},
      {wch:10},{wch:12},{wch:12},{wch:14},{wch:14},{wch:12},{wch:14},{wch:10},
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dữ liệu đăng kiểm')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const ts  = new Date().toISOString().slice(0,10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="DangKiem_${ts}.xlsx"`)
    res.send(buf)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
