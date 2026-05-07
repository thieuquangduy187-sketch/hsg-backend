#!/usr/bin/env node
require('dotenv').config()
const fs    = require('fs')
const path  = require('path')
const https = require('https')
const http  = require('http')

const HTML_DIR  = process.argv[2] || process.env.HTML_DIR  || './html_files'
const API_URL   = process.env.API_URL   || 'http://localhost:3000'
const JWT_TOKEN = process.env.JWT_TOKEN || ''
const BATCH     = 20

function normBienSo(raw) {
  return (raw || '')
    .toUpperCase()
    .replace(/THÔNG TIN PHƯƠNG TIỆN BIỂN ĐĂNG KÝ[:：]?\s*/i, '')
    .replace(/[-.\s]/g, '')
    .replace(/V$/, '')
    .trim()
}

function spanById(html, id) {
  const re = new RegExp(`<span[^>]+\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/span>`, 'i')
  const m = html.match(re)
  if (!m) return ''
  return m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function parseLichSuKD(html) {
  const tableM = html.match(/<table[^>]+id=["']DGKiemDinh["'][^>]*>([\s\S]*?)<\/table>/i)
  if (!tableM) return []
  const rows = []; const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowM; let first = true
  while ((rowM = rowRe.exec(tableM[1])) !== null) {
    if (first) { first = false; continue }
    const cells = []; const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi; let cellM
    while ((cellM = cellRe.exec(rowM[1])) !== null)
      cells.push(cellM[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim())
    if (cells.length >= 5 && /\d{2}\/\d{2}\/\d{4}/.test(cells[2]))
      rows.push({ tramKD:cells[0], soPhieu:cells[1], ngayKD:cells[2], lanKD:cells[3], soTem:cells[4], thoiHanKD:cells[5]||'' })
  }
  return rows
}

function findRecentKD(lichSu) {
  if (!lichSu?.length) return null
  const today = Date.now()

  const parsed = lichSu.map(l => {
    const [d,m,y] = (l.thoiHanKD||'').split('/')
    const ts = (d&&m&&y) ? new Date(`${y}-${m}-${d}`).getTime() : NaN
    return { ...l, _ts: isNaN(ts) ? null : ts }
  }).filter(l => l._ts !== null)

  if (!parsed.length) return lichSu[0]

  // Ưu tiên: hạn KĐ trong tương lai — lấy ngày gần today nhất (sắp hết hạn)
  const future = parsed.filter(l => l._ts >= today).sort((a,b) => a._ts - b._ts)
  if (future.length > 0) return future[0]

  // Tất cả đã hết hạn: lấy hạn gần nhất trong quá khứ
  return parsed.sort((a,b) => b._ts - a._ts)[0]
}

function parseFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8')
  const rawBS = spanById(html, 'LblBinDangKy') || path.basename(filePath, '.html')
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

// ── HTTP request helper — log cả status code ──────────────
function httpRequest(url, method, body, token) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url)
    const isHttps = u.protocol === 'https:'
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     u.pathname + (u.search || ''),
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(payload ? {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }
    const lib = isHttps ? https : http
    const req = lib.request(opts, r => {
      let data = ''
      r.on('data', c => { data += c })
      r.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { raw: data.slice(0, 300) } }
        resolve({ status: r.statusCode, body: parsed })
      })
    })
    req.on('error', e => reject(e))
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('Request timeout after 45s')) })
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  // Debug mode
  if (process.argv[3] === '--debug') {
    const rec = parseFile(HTML_DIR)
    Object.entries(rec).forEach(([k,v]) => {
      if (k==='lichSuKD') { console.log('lichSuKD:'); (v||[]).forEach((l,i)=>console.log(`  [${i}]`,JSON.stringify(l))) }
      else console.log(`  ${k.padEnd(22)}: ${v||'(trống)'}`)
    })
    return
  }

  if (!fs.existsSync(HTML_DIR)) {
    console.error(`❌ Không tìm thấy: ${HTML_DIR}`); process.exit(1)
  }

  // ── Bước 1: Test connection ──────────────────────────────
  console.log(`🔗 Kiểm tra kết nối: ${API_URL}/api/dang-kiem`)
  try {
    const test = await httpRequest(`${API_URL}/api/dang-kiem`, 'GET', null, JWT_TOKEN)
    if (test.status === 401) {
      console.error('❌ Lỗi 401: JWT_TOKEN không hợp lệ hoặc đã hết hạn')
      console.error('   → Đăng nhập lại, lấy token mới từ localStorage.getItem("hsg_token")')
      process.exit(1)
    }
    if (test.status === 404) {
      console.error('❌ Lỗi 404: Route /api/dang-kiem không tồn tại')
      console.error('   → Kiểm tra backend đã deploy file index.js và dangKiem.js chưa')
      process.exit(1)
    }
    console.log(`✅ Kết nối OK — status ${test.status}`)
  } catch (e) {
    console.error(`❌ Không kết nối được backend: ${e.message}`)
    process.exit(1)
  }

  // ── Bước 2: Parse HTML ───────────────────────────────────
  const files = fs.readdirSync(HTML_DIR).filter(f => f.toLowerCase().endsWith('.html') && !f.startsWith('._'))
  console.log(`📂 ${files.length} file HTML`)

  const records = [], errors = []
  for (const f of files) {
    try {
      records.push(parseFile(path.join(HTML_DIR, f)))
      process.stdout.write(`\r  ✓ Parsed ${records.length}/${files.length}`)
    } catch (e) { errors.push(`${f}: ${e.message}`) }
  }
  console.log(`\n  Parse: ${records.length} OK, ${errors.length} lỗi`)
  if (errors.length) errors.forEach(e => console.warn('  ✗', e))

  // ── Bước 3: Upload theo batch ────────────────────────────
  let totalSaved = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    try {
      const { status, body: res } = await httpRequest(
        `${API_URL}/api/dang-kiem/import`, 'POST', { records: batch }, JWT_TOKEN
      )
      if (status !== 200 && status !== 201) {
        console.error(`\n  ✗ Batch ${i}-${i+BATCH}: HTTP ${status} — ${JSON.stringify(res).slice(0,200)}`)
        if (i === 0) {
          if (status === 401) console.error('   → Token hết hạn, đăng nhập lại')
          if (status === 404) console.error('   → Route POST /api/dang-kiem/import chưa có trên backend')
          if (status === 500) console.error('   → Lỗi server, xem Render Logs để biết chi tiết')
          break
        }
      } else {
        totalSaved += res.total || batch.length
        process.stdout.write(`\r  ↑ Uploaded ${Math.min(i+BATCH,records.length)}/${records.length} — saved: ${totalSaved}`)
      }
    } catch (e) {
      console.error(`\n  ✗ Batch ${i}-${i+BATCH}: ${e.message}`)
      if (i === 0) break
    }
  }
  console.log(`\n✅ Xong: ${totalSaved} records → collection dang_kiem`)
}

main().catch(e => { console.error(e); process.exit(1) })
