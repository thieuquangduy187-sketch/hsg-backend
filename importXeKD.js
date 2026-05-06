#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/importXeKD.js  (script chạy 1 lần)
// Cách dùng:
//   node importXeKD.js --dir "/path/to/XE TAI/LUU TRU"
//   node importXeKD.js --dir "/path/to/XE TAI/LUU TRU" --dry-run
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config()
const fs       = require('fs')
const path     = require('path')
const mongoose = require('mongoose')

const args    = process.argv.slice(2)
const dirIdx  = args.indexOf('--dir')
const HTML_DIR = dirIdx >= 0 ? args[dirIdx + 1] : './html_data'
const DRY_RUN  = args.includes('--dry-run')

// ── Minimal parser — không dùng jsdom để tránh phụ thuộc ─
function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
}

function parseTRs(html) {
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRe.exec(html)) !== null) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdMatch
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      cells.push(stripTags(tdMatch[1]).trim())
    }
    if (cells.some(c => c.length > 0)) rows.push(cells)
  }
  return rows
}

// Lấy value từ cell kế tiếp sau cell chứa label
function findVal(rows, label) {
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      if (row[i].toLowerCase().includes(label.toLowerCase())) {
        // Tìm cell không rỗng tiếp theo
        for (let j = i + 1; j < row.length; j++) {
          if (row[j].trim()) return row[j].trim()
        }
      }
    }
  }
  // Thử tìm trong row tiếp theo
  for (let r = 0; r < rows.length - 1; r++) {
    const row = rows[r]
    for (let i = 0; i < row.length; i++) {
      if (row[i].toLowerCase().includes(label.toLowerCase())) {
        const nextRow = rows[r + 1]
        if (nextRow) {
          const val = nextRow.find(c => c.trim())
          if (val) return val.trim()
        }
      }
    }
  }
  return null
}

function parseHTML(filepath) {
  const html = fs.readFileSync(filepath, 'utf8')
  const rows = parseTRs(html)

  // Biển số từ tên file
  const bienSoRaw = path.basename(filepath, '.html')
  // Normalize: 61C15541V → 61C-155.41, nhưng giữ nguyên để so khớp flex
  const bienSo = bienSoRaw.replace(/V$/, '').replace(/([0-9]{5})$/, (m) => m.slice(0,3)+'.'+m.slice(3))

  const get = (label) => findVal(rows, label) || null

  // Lịch sử KĐ — tìm bảng có header "Trạm KĐ"
  const lichSuKD = []
  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => c.includes('Trạm KĐ') || c.includes('Trạm K'))) {
      headerRowIdx = i; break
    }
  }
  if (headerRowIdx >= 0) {
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i]
      if (r.length >= 5 && r[0] && r[0].match(/^\d{4}[A-Z]?$/)) {
        lichSuKD.push({
          tramKD:    r[0] || '',
          soPhieu:   r[1] || '',
          ngayKD:    r[2] || '',
          lanKD:     r[3] || '',
          soTem:     r[4] || '',
          thoiHanKD: r[5] || '',
        })
      }
    }
  }

  // Lần KĐ hiện hành = bản ghi có ngày KĐ gần hôm nay nhất (không quá tương lai xa)
  const parseDate = (s) => {
    if (!s) return null
    const [d,m,y] = (s||'').split('/')
    if (!d||!m||!y) return null
    return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`)
  }
  const today = new Date()
  let current = null
  if (lichSuKD.length > 0) {
    // Sắp xếp theo ngày KĐ giảm dần, lấy bản ghi có ngày hợp lệ gần nhất
    const sorted = [...lichSuKD]
      .filter(r => parseDate(r.ngayKD))
      .sort((a,b) => parseDate(b.ngayKD) - parseDate(a.ngayKD))
    current = sorted[0] || lichSuKD[0]
  }

  return {
    bienSo,
    bienSoRaw,
    // Đăng ký
    ngayDangKy:        get('Ngày đăng ký:'),
    ngayDangKyLanDau:  get('Ngày đăng ký lần đầu'),
    soSoKiemDinh:      get('Số sổ kiểm định'),
    soSoQuanLy:        get('Số sổ quản lý'),
    chuPhuongTien:     get('Chủ phương tiện'),
    diaChiChu:         get('Địa chỉ chủ phương tiện'),
    // Kỹ thuật
    loaiPhuongTien:    get('Loại phương tiện'),
    nhanHieu:          get('Nhãn hiệu'),
    soLoai:            get('Số loại'),
    soMayThucTe:       get('Số máy thực tế'),
    soKhungThucTe:     get('Số khung thực tế'),
    namSanXuat:        get('Năm sản xuất'),
    noiSanXuat:        get('Nơi sản xuất'),
    taiTrongThietKe:   get('Tải trọng thiết kế'),
    trongLuongBanThan: get('Trọng lượng bản thân'),
    soNguoiChoPhep:    get('Số người cho phép chở'),
    taiTrongKeoTheoTK: get('Tải trọng kéo theo TK'),
    thayDoiKetCau:     get('Thay đổi kết cấu'),
    chuyenDoiCongNang: get('Chuyển đổi công năng'),
    kinhDoanhVanTai:   get('Kinh doanh vận tải'),
    lapThietBiGSHT:    get('Lắp thiết bị GSHT'),
    congThucBanhXe:    get('Công thức bánh xe'),
    vetBanhXe:         get('Vết bánh xe'),
    kichThuocBao:      get('Kích thước bao'),
    kichThuocThung:    get('Kích thước thùng hàng'),
    chieuDaiCoSo:      get('Chiều dài cơ sở'),
    nhieuLieu:         get('Nhiên liệu'),
    dungTich:          get('Dung tích'),
    congSuatLonNhat:   get('Công suất lớn nhất'),
    soLop:             get('Số lốp'),
    coLop:             get('Cỡ lốp'),
    // Phí KĐ
    ngayNopPhi:        get('Ngày nộp phí'),
    donViThuPhi:       get('Đơn vị thu phí'),
    soBienLai:         get('Số biên lai'),
    phiNopDenHetNgay:  get('Phí nộp đến hết ngày'),
    // Lịch sử KĐ
    lichSuKD,
    // KĐ hiện hành
    kdHienHanh: current ? {
      tramKD:    current.tramKD,
      soPhieu:   current.soPhieu,
      ngayKD:    current.ngayKD,
      lanKD:     current.lanKD,
      soTem:     current.soTem,
      thoiHanKD: current.thoiHanKD,
    } : null,
  }
}

async function main() {
  if (!fs.existsSync(HTML_DIR)) {
    console.error(`Không tìm thấy thư mục: ${HTML_DIR}`)
    console.error('Dùng: node importXeKD.js --dir "/path/to/XE TAI/LUU TRU"')
    process.exit(1)
  }

  const files = fs.readdirSync(HTML_DIR)
    .filter(f => f.endsWith('.html') && !f.startsWith('._') && !f.startsWith('Thông'))
  
  console.log(`Tìm thấy ${files.length} file HTML`)

  const records = []
  let errors = 0
  for (const f of files) {
    try {
      const rec = parseHTML(path.join(HTML_DIR, f))
      records.push(rec)
      if (records.length % 20 === 0) process.stdout.write(`\rĐã parse ${records.length}/${files.length}...`)
    } catch(e) {
      console.error(`\nLỗi parse ${f}: ${e.message}`)
      errors++
    }
  }
  console.log(`\nParse xong: ${records.length} xe, ${errors} lỗi`)

  if (DRY_RUN) {
    console.log('\n-- DRY RUN: sample record --')
    console.log(JSON.stringify(records[0], null, 2))
    return
  }

  // Import to MongoDB
  const MONGODB_URI = process.env.MONGODB_URI
  if (!MONGODB_URI) {
    console.error('Thiếu MONGODB_URI trong .env')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)
  console.log('Connected MongoDB')

  const schema = new mongoose.Schema({}, { strict: false, collection: 'xe_kd' })
  const Model  = mongoose.model('XeKD', schema)

  let inserted = 0, updated = 0
  for (const rec of records) {
    const res = await Model.findOneAndUpdate(
      { bienSoRaw: rec.bienSoRaw },
      { $set: { ...rec, updatedAt: new Date() } },
      { upsert: true, new: true }
    )
    if (res.createdAt) inserted++; else updated++
  }
  console.log(`Import xong: ${inserted} mới, ${updated} cập nhật`)
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
