#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/scripts/importDangKiem.js
// Script import 1 lần: parse HTML → push lên API
//
// Cách dùng:
//   1. node src/scripts/importDangKiem.js /path/to/XE\ TAI/LUU\ TRU
//   2. Hoặc đặt HTML_DIR trong .env rồi chạy: node src/scripts/importDangKiem.js
//
// Yêu cầu:
//   - Backend đang chạy (hoặc dùng MONGODB_URI trực tiếp)
//   - API_URL=https://hsg-backend.onrender.com  (hoặc http://localhost:3000)
//   - JWT_TOKEN=<token admin>   (lấy từ login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const https = require('https')
const http  = require('http')

const HTML_DIR  = process.argv[2] || process.env.HTML_DIR || './html_files'
const API_URL   = process.env.API_URL   || 'http://localhost:3000'
const JWT_TOKEN = process.env.JWT_TOKEN || ''
const BATCH     = 20   // records per API call

// ── HTML Parser ───────────────────────────────────────────
function parseHtml(html) {
  // Extract table rows as [label, value] pairs
  const rows = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  let trMatch
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = []
    let tdMatch
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const raw = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      cells.push(raw)
    }
    if (cells.some(c => c)) rows.push(cells)
  }
  return rows
}

function extract(rows, ...labels) {
  for (const label of labels) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      for (let j = 0; j < row.length - 1; j++) {
        const cell = row[j].toLowerCase().replace(/[:]/g, '').trim()
        if (labels.map(l => l.toLowerCase()).some(l => cell.includes(l))) {
          // Try next cell in same row
          const val = row[j + 1]?.trim()
          if (val) return val
          // Try next row
          const nextVal = rows[i + 1]?.[0]?.trim()
          if (nextVal && !nextVal.includes(':')) return nextVal
        }
      }
    }
  }
  return ''
}

function parseFile(htmlPath) {
  const html   = fs.readFileSync(htmlPath, 'utf8')
  const rows   = parseHtml(html)
  const bienSo = path.basename(htmlPath, '.html').replace(/_/g, '')

  // Lịch sử kiểm định (bảng cuối: Trạm KĐ | Số phiếu | Ngày KĐ | Lần KĐ | Số tem | Thời hạn)
  const lichSuKD = []
  let inKDTable  = false
  for (const row of rows) {
    if (row.some(c => c.includes('Trạm KĐ') || c.includes('Số phiếu'))) {
      inKDTable = true; continue
    }
    if (inKDTable && row.length >= 5 && row[0] && row[2]) {
      // row[0]=TramKD, row[1]=SoPhieu, row[2]=NgayKD, row[3]=LanKD, row[4]=SoTem, row[5]=ThoiHan
      const thoiHan = row[5] || row[4] || ''
      // Only include rows that look like real data (date format dd/mm/yyyy)
      if (/\d{2}\/\d{2}\/\d{4}/.test(row[2])) {
        lichSuKD.push({ tramKD: row[0], soPhieu: row[1] || '', ngayKD: row[2], lanKD: row[3] || '', soTem: row[4] || '', thoiHanKD: thoiHan })
      }
    }
  }

  // Tìm lần KĐ gần hôm nay nhất
  const today = new Date()
  const recentKD = lichSuKD
    .map(l => { const p = l.ngayKD.split('/'); return { ...l, _d: new Date(`${p[2]}-${p[1]}-${p[0]}`) } })
    .filter(l => !isNaN(l._d))
    .sort((a, b) => Math.abs(a._d - today) - Math.abs(b._d - today))[0]

  const g = (...labels) => extract(rows, ...labels)

  return {
    bienSo,
    ngayDangKy:        g('Ngày đăng ký'),
    soSoKiemDinh:      g('Số sổ kiểm định'),
    soSoQuanLy:        g('Số sổ quản lý'),
    chuPhuongTien:     g('Chủ phương tiện'),
    diaChiChu:         g('Địa chỉ chủ phương tiện', 'Địa chỉ'),
    loaiPhuongTien:    g('Loại phương tiện'),
    nhanHieu:          g('Nhãn hiệu'),
    soLoai:            g('Số loại'),
    soMay:             g('Số máy thực tế', 'Số máy'),
    soKhung:           g('Số khung thực tế', 'Số khung'),
    namSanXuat:        g('Năm sản xuất'),
    noiSanXuat:        g('Nơi sản xuất'),
    taiTrongThietKe:   g('Tải trọng thiết kế'),
    trongLuongBanThan: g('Trọng lượng bản thân'),
    soNguoi:           g('Số người cho phép chở'),
    taiTrongKeo:       g('Tải trọng kéo theo TK'),
    kichThuocBao:      g('Kích thước bao'),
    kichThuocThung:    g('Kích thước thùng hàng', 'Kích thước thùng'),
    chieuDaiCoSo:      g('Chiều dài cơ sở'),
    kieuDC:            g('Kiểu ĐC', 'Loại động cơ'),
    nhienLieu:         g('Nhiên liệu'),
    dungTich:          g('Dung tích'),
    congSuat:          g('Công suất lớn nhất', 'Công suất'),
    congThucBanhXe:    g('Công thức bánh xe'),
    vetBanhXe:         g('Vết bánh xe'),
    soLop:             g('Số lốp'),
    coLop:             g('Cỡ lốp'),
    kinhDoanhVanTai:   g('Kinh doanh vận tải'),
    lapGSHT:           g('Lắp thiết bị GSHT', 'GSHT'),
    ngayNopPhi:        g('Ngày nộp phí'),
    donViThuPhi:       g('Đơn vị thu phí'),
    soBienLai:         g('Số biên lai'),
    phiDenHetNgay:     g('Phí nộp đến hết ngày'),
    thoiHanKDHienTai:  recentKD?.thoiHanKD || '',
    ngayKDGanNhat:     recentKD?.ngayKD     || '',
    lichSuKD,
  }
}

// ── API call ──────────────────────────────────────────────
function apiPost(records) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ records })
    const url     = new URL(API_URL + '/api/dang-kiem/import')
    const isHttps = url.protocol === 'https:'
    const options = {
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
      path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${JWT_TOKEN}`,
      },
    }
    const lib = isHttps ? https : http
    const req = lib.request(options, r => {
      let data = ''
      r.on('data', c => data += c)
      r.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(HTML_DIR)) {
    console.error(`❌ Không tìm thấy thư mục: ${HTML_DIR}`)
    console.error('   Dùng: node src/scripts/importDangKiem.js /path/to/html_folder')
    process.exit(1)
  }

  const files = fs.readdirSync(HTML_DIR)
    .filter(f => f.endsWith('.html') && !f.startsWith('._') && !f.startsWith('Thông tin'))

  console.log(`📂 Tìm thấy ${files.length} file HTML trong ${HTML_DIR}`)
  if (!JWT_TOKEN) console.warn('⚠  JWT_TOKEN trống — nếu API yêu cầu auth sẽ bị 401')

  const records = []
  let errors = 0
  for (const f of files) {
    try {
      const rec = parseFile(path.join(HTML_DIR, f))
      records.push(rec)
      process.stdout.write(`\r  ✓ Parsed ${records.length}/${files.length}`)
    } catch (e) {
      errors++
      console.error(`\n  ✗ ${f}: ${e.message}`)
    }
  }
  console.log(`\n  Parse xong: ${records.length} xe, ${errors} lỗi`)

  // Batch push
  let total = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    try {
      const res = await apiPost(batch)
      total += res.total || batch.length
      process.stdout.write(`\r  ↑ Uploaded ${Math.min(i + BATCH, records.length)}/${records.length}`)
    } catch (e) {
      console.error(`\n  ✗ Batch ${i}–${i+BATCH}: ${e.message}`)
    }
  }
  console.log(`\n✅ Import xong: ${total} records vào collection dang_kiem`)
}

main().catch(e => { console.error(e); process.exit(1) })
