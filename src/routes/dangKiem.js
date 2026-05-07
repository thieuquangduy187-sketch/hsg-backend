// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/dangKiem.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const DangKiem = require('../models/DangKiem')

const norm = s => (s || '').toUpperCase().replace(/[\s.\-]/g, '')

// ── Ngày nghỉ lễ Việt Nam 2025–2026 ─────────────────────
const VN_HOLIDAYS = new Set([
  // 2025
  '2025-01-01','2025-01-27','2025-01-28','2025-01-29',
  '2025-01-30','2025-01-31','2025-02-01','2025-02-02',
  '2025-04-07','2025-04-30','2025-05-01','2025-05-02',
  '2025-09-01','2025-09-02',
  // 2026
  '2026-01-01','2026-01-25','2026-01-26','2026-01-27',
  '2026-01-28','2026-01-29','2026-01-30','2026-01-31',
  '2026-03-27','2026-04-30','2026-05-01','2026-05-04',
  '2026-09-02','2026-09-03',
])

// Đếm ngày làm việc (T2–T7, bỏ CN và lễ) từ today đến deadline
function countWorkingDays(today, deadline) {
  let count = 0
  const cur = new Date(today)
  cur.setHours(0,0,0,0)
  const end = new Date(deadline)
  end.setHours(0,0,0,0)
  if (cur >= end) return 0
  while (cur < end) {
    const dow = cur.getDay()           // 0=CN, 6=T7
    const iso = cur.toISOString().slice(0,10)
    if (dow !== 0 && !VN_HOLIDAYS.has(iso)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// Parse dd/mm/yyyy → Date
function parseVNDate(s) {
  if (!s) return null
  const [d, m, y] = s.split('/')
  if (!d || !m || !y) return null
  const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`)
  return isNaN(dt) ? null : dt
}

// Tính mức cảnh báo đăng kiểm
function alertKD(thoiHanStr) {
  const deadline = parseVNDate(thoiHanStr)
  if (!deadline) return { level: 'none', daysLeft: null, workingDaysLeft: null }
  const today    = new Date(); today.setHours(0,0,0,0)
  const daysLeft = Math.ceil((deadline - today) / 86400000)
  const wDays    = daysLeft > 0 ? countWorkingDays(today, deadline) : 0
  let level
  if (daysLeft < 0)     level = 'red'
  else if (wDays <= 7)  level = 'orange'
  else if (daysLeft <= 30) level = 'yellow'
  else                  level = 'green'
  return { level, daysLeft, workingDaysLeft: wDays }
}

// Tính mức cảnh báo phù hiệu
function alertPH(thoiHanStr) {
  const deadline = parseVNDate(thoiHanStr)
  if (!deadline) return { level: 'none', daysLeft: null }
  const today    = new Date(); today.setHours(0,0,0,0)
  const daysLeft = Math.ceil((deadline - today) / 86400000)
  let level
  if (daysLeft < 0)      level = 'red'
  else if (daysLeft <= 30) level = 'yellow'
  else                   level = 'green'
  return { level, daysLeft }
}

// ── GET /api/dang-kiem/alerts — cảnh báo tất cả xe ───────
router.get('/alerts', async (req, res) => {
  try {
    const docs = await DangKiem.find({})
      .select('bienSo nhanHieu thoiHanKDHienTai ngayKDGanNhat thoiHanPhuHieu ghiChuTreTre tienDoXuLy trangThaiXe')
      .sort({ bienSo: 1 }).lean()

    const result = docs.map(d => {
      const kd = alertKD(d.thoiHanKDHienTai)
      const ph = alertPH(d.thoiHanPhuHieu)
      return { ...d, alertKD: kd, alertPH: ph }
    })
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/dang-kiem/:bienSo ────────────────────────────
router.get('/:bienSo', async (req, res) => {
  try {
    const bs  = norm(req.params.bienSo)
    const doc = await DangKiem.findOne({ bienSo: { $regex: `^${bs}$`, $options: 'i' } }).lean()
    if (!doc) return res.status(404).json({ error: 'Chưa có dữ liệu đăng kiểm' })
    res.json({ ...doc, alertKD: alertKD(doc.thoiHanKDHienTai), alertPH: alertPH(doc.thoiHanPhuHieu) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/dang-kiem — list all ────────────────────────
router.get('/', async (req, res) => {
  try {
    const docs = await DangKiem.find({})
      .select('bienSo nhanHieu loaiPhuongTien thoiHanKDHienTai ngayKDGanNhat thoiHanPhuHieu soSoQuanLy soKhung soMay namSanXuat taiTrongThietKe coLop phiDenHetNgay trangThaiXe')
      .sort({ bienSo: 1 }).lean()
    res.json(docs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/dang-kiem/:bienSo — cập nhật phù hiệu, ghi chú, tiến độ ─
router.put('/:bienSo', async (req, res) => {
  try {
    const bs = norm(req.params.bienSo)
    const allowed = ['thoiHanPhuHieu','ghiChuTreTre','tienDoXuLy','trangThaiXe',
                     'thoiHanKDHienTai','ngayKDGanNhat','lichSuKD']
    const update = {}
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k] })
    update.updatedAt = new Date()
    const doc = await DangKiem.findOneAndUpdate(
      { bienSo: { $regex: `^${bs}$`, $options: 'i' } },
      update, { new: true }
    )
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy' })
    res.json({ ...doc.toObject(), alertKD: alertKD(doc.thoiHanKDHienTai), alertPH: alertPH(doc.thoiHanPhuHieu) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── PUT /api/dang-kiem/:bienSo/history ───────────────────
router.put('/:bienSo/history', async (req, res) => {
  try {
    const bs = norm(req.params.bienSo)
    const { lichSuKD } = req.body
    if (!Array.isArray(lichSuKD)) return res.status(400).json({ error: 'lichSuKD phải là array' })
    const recent = findRecentKDFromList(lichSuKD)
    const doc = await DangKiem.findOneAndUpdate(
      { bienSo: { $regex: `^${bs}$`, $options: 'i' } },
      { lichSuKD, thoiHanKDHienTai: recent?.thoiHanKD || '', ngayKDGanNhat: recent?.ngayKD || '', updatedAt: new Date() },
      { new: true }
    )
    if (!doc) return res.status(404).json({ error: 'Không tìm thấy' })
    res.json(doc)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

function findRecentKDFromList(lichSu) {
  if (!lichSu?.length) return null
  const today = Date.now()
  const parsed = lichSu.map(l => {
    const [d,m,y] = (l.thoiHanKD||'').split('/')
    const ts = (d&&m&&y) ? new Date(`${y}-${m}-${d}`).getTime() : NaN
    return { ...l, _ts: isNaN(ts) ? null : ts }
  }).filter(l => l._ts !== null)
  if (!parsed.length) return lichSu[0]
  const future = parsed.filter(l => l._ts >= today).sort((a,b) => a._ts - b._ts)
  return future.length ? future[0] : parsed.sort((a,b) => b._ts - a._ts)[0]
}

// ── POST /api/dang-kiem/import — batch import ─────────────
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
        // Giữ nguyên các field nhập tay khi re-import
        const keep = {}
        if (exists.thoiHanPhuHieu) keep.thoiHanPhuHieu = exists.thoiHanPhuHieu
        if (exists.ghiChuTreTre)   keep.ghiChuTreTre   = exists.ghiChuTreTre
        if (exists.tienDoXuLy)     keep.tienDoXuLy     = exists.tienDoXuLy
        if (exists.trangThaiXe && exists.trangThaiXe !== 'hoatDong') keep.trangThaiXe = exists.trangThaiXe
        await DangKiem.updateOne({ bienSo: r.bienSo }, { ...r, ...keep, updatedAt: new Date() })
        updated++
      } else {
        await DangKiem.create(r)
        inserted++
      }
    }
    res.json({ ok: true, inserted, updated, total: inserted + updated })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── GET /api/dang-kiem/export/excel ──────────────────────
router.get('/export/excel', async (req, res) => {
  try {
    const XLSX  = require('xlsx')
    const docs  = await DangKiem.find({}).sort({ bienSo: 1 }).lean()
    if (!docs.length) return res.status(404).json({ error: 'Chưa có dữ liệu' })
    const rows = docs.map(d => {
      const kd = alertKD(d.thoiHanKDHienTai)
      const ph = alertPH(d.thoiHanPhuHieu)
      return {
        'Biển số':                d.bienSo || '-',
        'Nhãn hiệu':              d.nhanHieu || '-',
        'Loại PT':                d.loaiPhuongTien || '-',
        'Số khung':               d.soKhung || '-',
        'Số máy':                 d.soMay || '-',
        'Năm SX':                 d.namSanXuat || '-',
        'Tải trọng (kg)':         d.taiTrongThietKe || '-',
        'Cỡ lốp':                 d.coLop || '-',
        'Ngày KĐ gần nhất':       d.ngayKDGanNhat || '-',
        'Thời hạn KĐ':            d.thoiHanKDHienTai || '-',
        'Cảnh báo KĐ':            kd.level === 'red' ? 'HẾT HẠN' : kd.level === 'orange' ? 'Sắp hết (<7 ngày LV)' : kd.level === 'yellow' ? 'Chú ý (<30 ngày)' : 'An toàn',
        'Còn (ngày lịch)':        kd.daysLeft ?? '-',
        'Còn (ngày LV)':          kd.workingDaysLeft ?? '-',
        'Thời hạn phù hiệu':      d.thoiHanPhuHieu || '-',
        'Cảnh báo phù hiệu':      ph.level === 'red' ? 'HẾT HẠN' : ph.level === 'yellow' ? 'Sắp hết (<30 ngày)' : ph.level === 'green' ? 'An toàn' : '-',
        'Trạng thái xe':          d.trangThaiXe || 'hoatDong',
        'Ghi chú trễ hạn':        d.ghiChuTreTre || '',
        'Tiến độ xử lý':          d.tienDoXuLy || '',
        'Số sổ quản lý':          d.soSoQuanLy || '-',
      }
    })
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length + 2, 14) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Đăng kiểm & Phù hiệu')
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' })
    res.setHeader('Content-Disposition', 'attachment; filename="dang_kiem_xetai.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router

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
