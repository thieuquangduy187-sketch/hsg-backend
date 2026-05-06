#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/scripts/importDangKiem.js
// Parse HTML theo span ID — chính xác, không bị lệch field
//
// Cách dùng:
//   JWT_TOKEN=<token> API_URL=https://hsg-backend.onrender.com \
//   node src/scripts/importDangKiem.js "/path/to/XE TAI/LUU TRU"
//
// Debug 1 file:
//   node src/scripts/importDangKiem.js file.html --debug
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config()
const fs    = require('fs')
const path  = require('path')
const https = require('https')
const http  = require('http')

const HTML_DIR  = process.argv[2] || process.env.HTML_DIR  || './html_files'
const API_URL   = process.env.API_URL   || 'http://localhost:3000'
const JWT_TOKEN = process.env.JWT_TOKEN || ''
const BATCH     = 20

// ── Chuẩn hoá biển số: "61H-205.30V" → "61H20530" ────────
function normBienSo(raw) {
  return (raw || '')
    .toUpperCase()
    .replace(/THÔNG TIN PHƯƠNG TIỆN BIỂN ĐĂNG KÝ[:：]?\s*/i, '')
    .replace(/[-.\s]/g, '')
    .replace(/V$/, '')
    .trim()
}

// ── Parse nội dung 1 span theo id ─────────────────────────
function spanById(html, id) {
  const re = new RegExp(
    `<span[^>]+\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/span>`,
    'i'
  )
  const m = html.match(re)
  if (!m) return ''
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Parse bảng lịch sử kiểm định ─────────────────────────
function parseLichSuKD(html) {
  const tableRe = /<table[^>]+id=["']DGKiemDinh["'][^>]*>([\s\S]*?)<\/table>/i
  const tableM  = html.match(tableRe)
  if (!tableM) return []

  const rows   = []
  const rowRe  = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowM
  let first = true
  while ((rowM = rowRe.exec(tableM[1])) !== null) {
    if (first) { first = false; continue }
    const cells = []
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let cellM
    while ((cellM = cellRe.exec(rowM[1])) !== null) {
      cells.push(
        cellM[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
    }
    if (cells.length >= 5 && /\d{2}\/\d{2}\/\d{4}/.test(cells[2])) {
      rows.push({
        tramKD:    cells[0] || '',
        soPhieu:   cells[1] || '',
        ngayKD:    cells[2] || '',
        lanKD:     cells[3] || '',
        soTem:     cells[4] || '',
        thoiHanKD: cells[5] || '',
      })
    }
  }
  return rows
}

// ── Tìm lần KĐ gần hôm nay nhất ──────────────────────────
function findRecentKD(lichSu) {
  if (!lichSu?.length) return null
  const today = Date.now()
  return lichSu
    .map(l => {
      const [d, m, y] = (l.ngayKD || '').split('/')
      const ts = (d && m && y) ? new Date(`${y}-${m}-${d}`).getTime() : NaN
      return { ...l, _delta: isNaN(ts) ? Infinity : Math.abs(ts - today) }
    })
    .sort((a, b) => a._delta - b._delta)[0] || null
}

// ── Parse toàn bộ 1 file HTML ─────────────────────────────
function parseFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8')

  const rawBS  = spanById(html, 'LblBinDangKy') || path.basename(filePath, '.html')
  const bienSo = normBienSo(rawBS)

  const lichSuKD = parseLichSuKD(html)
  const recentKD = findRecentKD(lichSuKD)

  return {
    bienSo,
    ngayDangKy:        spanById(html, 'txtNgayDK'),
    ngayDangKyLanDau:  spanById(html, 'txtNgayDKLD'),
    soSoKiemDinh:      spanById(html, 'txtSoSoKD'),
    soSoQuanLy:        spanById(html, 'txtSoSoQL'),
    chuPhuongTien:     spanById(html, 'txtChuPT'),
    diaChiChu:         spanById(html, 'txtDiaChi'),
    loaiPhuongTien:    spanById(html, 'txtLoaiPT'),
    nhanHieu:          spanById(html, 'txtNhanHieu'),
    soLoai:            spanById(html, 'txtSoLoai'),
    soMay:             spanById(html, 'txtSoMay'),
    soKhung:           spanById(html, 'txtSoKhung'),
    namSanXuat:        spanById(html, 'txtNamSX'),
    noiSanXuat:        spanById(html, 'txtNoiSanXuat'),
    taiTrongThietKe:   spanById(html, 'txtTaiTrong'),
    trongLuongBanThan: spanById(html, 'txtTrongLuong'),
    soNguoi:           spanById(html, 'txtSoCho'),
    taiTrongKeo:       spanById(html, 'txtTaiTrongKeo'),
    thayDoiKetCau:     spanById(html, 'lblCaiTao'),
    chuyenDoiCongNang: spanById(html, 'lblChuyenDoi'),
    kinhDoanhVanTai:   spanById(html, 'lblKDVT'),
    lapGSHT:           spanById(html, 'lblGSHT'),
    congThucBanhXe:    spanById(html, 'txtCTBanhXe'),
    vetBanhXe:         spanById(html, 'txtVetBanhXe'),
    kichThuocBao:      spanById(html, 'txtKichThuocBao'),
    kichThuocThung:    spanById(html, 'txtKichThuocThung'),
    chieuDaiCoSo:      spanById(html, 'txtChieuDaiCoSo'),
    kieuDC:            spanById(html, 'txtKieuDongCo'),
    kyHieu:            spanById(html, 'txtKyHieu'),
    nhienLieu:         spanById(html, 'txtNhienLieu'),
    dungTich:          spanById(html, 'txtDungTich'),
    congSuat:          spanById(html, 'txtNemax'),
    phanhChinh:        spanById(html, 'txtPhanhChinh'),
    phanhDo:           spanById(html, 'txtPhanhDo'),
    soLop:             spanById(html, 'txtSoLop'),
    coLop:             spanById(html, 'txtCoLop'),
    ngayNopPhi:        spanById(html, 'txtNgayNop'),
    donViThuPhi:       spanById(html, 'txtDonVi'),
    soBienLai:         spanById(html, 'txtBL_ID'),
    phiDenHetNgay:     spanById(html, 'txtDenNgay'),
    thoiHanKDHienTai:  recentKD?.thoiHanKD || '',
    ngayKDGanNhat:     recentKD?.ngayKD     || '',
    lichSuKD,
  }
}

// ── Gửi batch lên API ─────────────────────────────────────
function apiPost(records) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ records })
    const url     = new URL(`${API_URL}/api/dang-kiem/import`)
    const isHttps = url.protocol === 'https:'
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization:    `Bearer ${JWT_TOKEN}`,
      },
    }
    const lib = isHttps ? https : http
    const req = lib.request(options, r => {
      let data = ''
      r.on('data', c => { data += c })
      r.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) } })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

// ── Debug 1 file ──────────────────────────────────────────
function debugOne(filePath) {
  const rec = parseFile(filePath)
  console.log(`\n=== DEBUG: ${path.basename(filePath)} ===`)
  Object.entries(rec).forEach(([k, v]) => {
    if (k === 'lichSuKD') {
      console.log('lichSuKD:')
      ;(v || []).forEach((l, i) => console.log(`  [${i}]`, JSON.stringify(l)))
    } else {
      console.log(`  ${k.padEnd(22)}: ${(typeof v === 'string' ? v || '(trống)' : v)}`)
    }
  })
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  // Debug mode: node importDangKiem.js file.html --debug
  if (process.argv[3] === '--debug') {
    debugOne(HTML_DIR); return
  }

  if (!fs.existsSync(HTML_DIR)) {
    console.error(`❌ Không tìm thấy: ${HTML_DIR}`)
    process.exit(1)
  }

  const files = fs.readdirSync(HTML_DIR)
    .filter(f => f.toLowerCase().endsWith('.html') && !f.startsWith('._'))

  console.log(`📂 ${files.length} file HTML`)
  if (!JWT_TOKEN) console.warn('⚠  JWT_TOKEN trống')

  const records = [], errors = []
  for (const f of files) {
    try {
      records.push(parseFile(path.join(HTML_DIR, f)))
      process.stdout.write(`\r  ✓ Parsed ${records.length}/${files.length}`)
    } catch (e) { errors.push(`${f}: ${e.message}`) }
  }
  console.log(`\n  Parse: ${records.length} OK, ${errors.length} lỗi`)
  errors.forEach(e => console.warn('  ✗', e))

  let totalSaved = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    try {
      const res = await apiPost(batch)
      if (res.error) console.error(`\n  ✗ Batch ${i}: ${res.error}`)
      else { totalSaved += res.total || batch.length; process.stdout.write(`\r  ↑ Uploaded ${Math.min(i+BATCH, records.length)}/${records.length}`) }
    } catch (e) { console.error(`\n  ✗ Batch ${i}: ${e.message}`) }
  }
  console.log(`\n✅ Xong: ${totalSaved} records → dang_kiem`)
}

main().catch(e => { console.error(e); process.exit(1) })
