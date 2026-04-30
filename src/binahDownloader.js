// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/binahDownloader.js
// Auto-login Binhanh + download camera Excel report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const mongoose = require('mongoose')

const BINHANH_BASE = 'https://gps3.binhanh.vn/api/v1'
const COMPANY_ID   = 46140

// ── Auto-login: lấy JWT token mới ────────────────────────
async function binahLogin() {
  const res = await fetch(`${BINHANH_BASE}/authentication/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName:   process.env.BINHANH_USER     || 'hoasenhome',
      Password:   process.env.BINHANH_PASSWORD || 'Binh12345678',
      IPClient:   '115.78.6.177',
      AppType:    0,
      ClientType: 1,
      deviceID:   '87687f1f-4465-8024-f7ac-067a8befd10c',
    })
  })
  // Log response headers để debug
  const contentType = res.headers.get('content-type') || ''
  console.log('[binahLogin] Content-Type:', contentType)
  console.log('[binahLogin] Status:', res.status)
  
  // Đọc raw text trước
  const rawText = await res.text()
  console.log('[binahLogin] Raw response (first 300):', rawText.slice(0, 300))
  
  // Check headers for token
  const headerToken = res.headers.get('authorization') 
    || res.headers.get('x-token') 
    || res.headers.get('token')
  if (headerToken) {
    console.log('[binahLogin] Token found in header!')
    return headerToken.replace('Bearer ', '')
  }
  
  // Parse JSON
  let data
  try { data = JSON.parse(rawText) } catch(e) {
    // Không phải JSON — có thể raw text là token
    if (rawText && rawText.startsWith('eyJ')) {
      console.log('[binahLogin] Raw text is JWT token!')
      return rawText.trim()
    }
    throw new Error('Response not JSON: ' + rawText.slice(0, 100))
  }
  
  // data.data là object với keys số → đây là Uint8Array/Buffer bị JSON.parse
  // Convert về string
  if (data?.data && typeof data.data === 'object' && '0' in data.data) {
    const bytes = Object.values(data.data)
    const str = Buffer.from(bytes).toString('utf8')
    console.log('[binahLogin] Decoded buffer string (first 300):', str.slice(0, 300))
    // String này có thể là JWT hoặc JSON chứa token
    if (str.startsWith('eyJ')) return str.trim()
    try {
      const inner = JSON.parse(str)
      const t = inner?.token || inner?.accessToken || inner?.jwtToken || inner?.data?.token
      if (t) return t
      console.log('[binahLogin] Inner JSON keys:', Object.keys(inner))
    } catch(e) {}
  }
  
  const token = data?.data?.token || data?.data?.accessToken
    || data?.token || data?.accessToken
    || (typeof data?.data === 'string' && data.data.startsWith('eyJ') ? data.data : null)
  
  if (!token) {
    console.log('[binahLogin] Cannot find token. data keys:', Object.keys(data || {}))
    throw new Error('Login failed - token not found')
  }
  return token
}

// ── Lưu token vào DB để gpsSync.js dùng ──────────────────
async function saveToken(token) {
  await mongoose.connection.db.collection('gps_config').updateOne(
    { key: 'binhanh_token' },
    { $set: { key: 'binhanh_token', value: token, updatedAt: new Date(), source: 'auto-login' } },
    { upsert: true }
  )
}

// ── Download camera Excel từ Binhanh ─────────────────────
async function downloadCameraExcel(token) {
  // Thử các endpoint có thể có
  const endpoints = [
    { method: 'GET',  path: `/image/export-excel?companyId=${COMPANY_ID}` },
    { method: 'POST', path: '/image/export-excel',           body: { companyId: COMPANY_ID, languageId: 1 } },
    { method: 'GET',  path: `/report/image/excel?companyId=${COMPANY_ID}` },
    { method: 'POST', path: '/image/export',                  body: { companyId: COMPANY_ID } },
    { method: 'GET',  path: `/image/download?companyId=${COMPANY_ID}` },
  ]

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    'Origin':        'https://gps3.binhanh.vn',
    'Referer':       'https://gps3.binhanh.vn/',
  }

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BINHANH_BASE}${ep.path}`, {
        method:  ep.method,
        headers,
        ...(ep.body ? { body: JSON.stringify(ep.body) } : {})
      })
      const ct = res.headers.get('content-type') || ''
      console.log(`[Binhanh] ${ep.method} ${ep.path} → ${res.status} ${ct}`)
      if (res.ok && (ct.includes('excel') || ct.includes('spreadsheet') || ct.includes('octet'))) {
        const buf = Buffer.from(await res.arrayBuffer())
        console.log('[Binhanh] ✅ Found Excel endpoint:', ep.path, 'size:', buf.length)
        return { buffer: buf, endpoint: ep.path }
      }
    } catch(e) {
      console.log(`[Binhanh] ${ep.path} error:`, e.message)
    }
  }
  return null
}

// ── Parse Excel buffer → camera status ───────────────────
function parseExcel(buffer) {
  const JSZip = require('jszip') // cần thêm npm install jszip
  // Dùng xml parser tương tự code đã viết
  const AdmZip = require('adm-zip')
  const zip    = new AdmZip(buffer)
  const ssXml  = zip.getEntry('xl/sharedStrings.xml')?.getData().toString('utf8') || ''
  const shXml  = zip.getEntry('xl/worksheets/sheet1.xml')?.getData().toString('utf8') || ''
  if (!ssXml || !shXml) return null

  // Parse shared strings
  const strings = [...ssXml.matchAll(/<si>(.*?)<\/si>/gs)]
    .map(m => (m[1].match(/<t[^>]*>(.*?)<\/t>/gs) || []).map(t => t.replace(/<[^>]+>/g,'').trim()).join(''))

  // Parse rows
  const rows = []
  for (const rowM of shXml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells = []
    for (const cellM of rowM[1].matchAll(/<c[^>]*>(.*?)<\/c>/gs)) {
      const t = (cellM[0].match(/t="([^"]*)"/) || [])[1]
      const v = (cellM[1].match(/<v>(.*?)<\/v>/) || [])[1] || ''
      cells.push(t === 's' ? (strings[parseInt(v)] || '') : v)
    }
    rows.push(cells)
  }

  // Tìm header row (STT, Phương tiện, Kênh 1...)
  const headerIdx = rows.findIndex(r => r[0] === 'STT')
  if (headerIdx < 0) return null

  const data = []
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row[0] || !row[1]) continue
    const kenh = [row[2]||'', row[3]||'', row[4]||'', row[5]||'']
    const active = kenh.filter(k => k === 'Hoạt động').length
    data.push({
      stt:    parseInt(row[0]),
      bienSo: row[1],
      kenh1:  kenh[0], kenh2: kenh[1], kenh3: kenh[2], kenh4: kenh[3],
      active,
      ok:     active >= 2,
      status: active >= 2 ? 'Bình thường' : active === 0 ? 'Mất hết cam' : `Cần kiểm tra (${active} kênh)`
    })
  }
  return data
}

// ── Main: login → download → parse → lưu DB ──────────────
async function syncCameraStatus() {
  console.log('[CameraSync] Bắt đầu...')
  try {
    // 1. Auto-login
    const token = await binahLogin()
    await saveToken(token)
    console.log('[CameraSync] Login OK, token saved')

    // 2. Download Excel
    const result = await downloadCameraExcel(token)
    if (!result) {
      console.log('[CameraSync] Chưa tìm thấy Excel endpoint — cần thêm endpoint đúng')
      return { success: false, message: 'Excel endpoint not found' }
    }

    // 3. Parse
    const rows = parseExcel(result.buffer)
    if (!rows) return { success: false, message: 'Parse Excel failed' }

    // 4. Lưu vào DB collection camera_status
    const col = mongoose.connection.db.collection('camera_status')
    const now = new Date()
    await col.deleteMany({}) // xóa old data
    await col.insertMany(rows.map(r => ({ ...r, syncedAt: now })))

    // 5. Lưu lastSync
    await mongoose.connection.db.collection('gps_config').updateOne(
      { key: 'last_camera_sync' },
      { $set: { key: 'last_camera_sync', value: now.toISOString(), total: rows.length, ok: rows.filter(r=>r.ok).length } },
      { upsert: true }
    )

    console.log(`[CameraSync] ✅ Done: ${rows.length} xe, ${rows.filter(r=>r.ok).length} OK, ${rows.filter(r=>!r.ok).length} cần kiểm tra`)
    return { success: true, total: rows.length }
  } catch(e) {
    console.error('[CameraSync] Error:', e.message)
    return { success: false, error: e.message }
  }
}

module.exports = { binahLogin, syncCameraStatus, saveToken }
