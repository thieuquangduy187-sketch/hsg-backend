// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/gpsSync.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const mongoose = require('mongoose')
const BINHANH_BASE = 'https://gps3.binhanh.vn/api/v1'
const { binahLogin, syncCameraStatus, saveToken } = require('../binahDownloader')

const db = () => mongoose.connection.db

async function getToken() {
  const cfg = await db().collection('gps_config').findOne({ key: 'binhanh_token' })
  return cfg?.value || null
}

async function binahCall(path, body, token) {
  const res = await fetch(`${BINHANH_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`,
      'Accept': 'application/json', 'Origin': 'https://gps3.binhanh.vn',
    },
    body: JSON.stringify(body)
  })
  if (res.status === 401) throw new Error('TOKEN_EXPIRED')
  if (!res.ok) throw new Error(`Binhanh error: ${res.status}`)
  return res.json()
}

// ══════════════════════════════════════════════════════════
// GPS STATUS — Thuật toán phát hiện xe dừng hoạt động
// Dựa trên previousKm từ /temperature-report/temperature/chart
//
// previousKm = km tích lũy đến đầu ngày đó
// Nếu previousKm[N] == previousKm[N-1] → xe không đi ngày N (flat line)
//
// 3 trạng thái:
//   stopped      → dừng > 3 ngày liên tiếp (flat line streak)
//   low_activity → tổng km/tháng < 1000km (hoạt động rất ít)
//   normal       → bình thường
// ══════════════════════════════════════════════════════════
function calcGpsStatus(vehicle, kmHistory) {
  const raw = (kmHistory.get(vehicle.plateRaw) || [])
    .filter(r => r.previousKm != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const today   = new Date().toISOString().split('T')[0]
  const gpsTime = vehicle.gpsTime

  // ── Fallback: không có km history → dùng gpsTime ─────────
  if (!raw.length) {
    if (!gpsTime) return { code: 'no_data', label: 'Không có dữ liệu', color: '#8E8E93', stoppedDays: 0 }
    const daysSince = Math.floor((new Date(today) - new Date(gpsTime.split('T')[0])) / 86400000)
    if (daysSince > 7)
      return { code: 'stopped', label: `Xe dừng hoạt động ${daysSince} ngày`, color: '#FF3B30', stoppedDays: daysSince, stoppedSince: gpsTime.split('T')[0], kmTotal: 0 }
    return { code: 'normal', label: 'Bình thường', color: '#34C759', stoppedDays: daysSince, kmTotal: 0 }
  }

  // ── 1. Làm tròn previousKm về số nguyên ──────────────────
  const history = raw.map(r => ({
    date:   r.date,
    prevKm: Math.round(r.previousKm)
  }))

  // ── 2. Đếm chuỗi ngày flat liên tiếp từ hôm nay trở về ──
  let stoppedDays = 0
  let stoppedSince = null
  for (let i = history.length - 1; i >= 1; i--) {
    const delta = history[i].prevKm - history[i - 1].prevKm
    if (delta === 0) {
      stoppedDays++
      stoppedSince = history[i].date
    } else {
      break // xe có di chuyển → dừng đếm
    }
  }

  // ── 3. Tổng km trong kỳ = prevKm[cuối] - prevKm[đầu] ────
  const kmFirst  = history[0].prevKm
  const kmLast   = history[history.length - 1].prevKm
  const kmTotal  = Math.max(0, kmLast - kmFirst)

  // ── 4. Xác định trạng thái ───────────────────────────────
  const daysTracked = history.length

  // Fix: nếu toàn bộ km = 0 → xe không có data thực
  // Dùng gpsTime để tính daysSince thật
  if (kmTotal === 0 && gpsTime) {
    const daysSinceGps = Math.floor((new Date(today) - new Date(gpsTime.split('T')[0])) / 86400000)
    if (daysSinceGps > 7) {
      return {
        code:        'stopped',
        label:       `Xe dừng hoạt động ${daysSinceGps} ngày`,
        color:       '#FF3B30',
        stoppedDays: daysSinceGps,
        stoppedSince: gpsTime.split('T')[0],
        kmTotal:     0,
        kmPerDay:    0
      }
    }
  }

  // Ưu tiên: stopped (flat line) > low_activity > normal
  if (stoppedDays > 7) {
    return {
      code:        'stopped',
      label:       `Xe dừng hoạt động ${stoppedDays} ngày`,
      color:       '#FF3B30',
      stoppedDays, stoppedSince, kmTotal,
      kmPerDay: (daysTracked - stoppedDays) > 0
        ? Math.round(kmTotal / (daysTracked - stoppedDays))
        : 0
    }
  }

  // Xe có chạy nhưng km/tháng quá thấp → hoạt động rất ít
  const kmThreshold = Math.round(1000 * daysTracked / 30)
  if (kmTotal > 0 && kmTotal < kmThreshold && kmTotal < 1000 && daysTracked >= 7) {
    return {
      code:    'low_activity',
      label:   `Hoạt động rất ít (${kmTotal} km/${daysTracked} ngày)`,
      color:   '#FF9500',
      stoppedDays, kmTotal,
      kmPerDay: daysTracked > 0 ? Math.round(kmTotal / daysTracked) : 0
    }
  }

  return {
    code:     'normal',
    label:    'Bình thường',
    color:    '#34C759',
    stoppedDays, kmTotal,
    kmPerDay: daysTracked > 0 ? Math.round(kmTotal / daysTracked) : 0
  }
}

// ── Camera Status Logic ─────────────────────────────────────
function calcCamStatus(vehicle) {
  const camCount = vehicle.camCount || 0
  const cameras  = vehicle.cameras  || []
  if (camCount === 0 || cameras.length === 0)
    return { code: 'no_cam', label: 'Không có cam', color: '#8E8E93', active: 0, total: 0 }
  const active = cameras.filter(c => c.record === true).length
  const lost   = camCount - active
  if (lost <= 0)    return { code: 'ok',       label: `${active}/${camCount} cam OK`,  color: '#34C759', active, total: camCount }
  if (lost >= camCount) return { code: 'lost_all', label: `Mất hết ${camCount} cam`,   color: '#FF3B30', active, total: camCount }
  return               { code: 'partial',   label: `Mất ${lost}/${camCount} cam`,      color: '#FF9500', active, total: camCount }
}

// ── Helper: load xetai map {normBS → {cuaHang, tinhMoi}} ───
async function loadXeMap() {
  const allXe = await db().collection('xetai').find({}, {
    projection: { 'BIỂN SỐ':1,'BIẼNSỐ':1,'Biển số':1,'Cưả hàng sử dụng':1,'Tỉnh mới':1 }
  }).toArray()
  const map = new Map()
  for (const xe of allXe) {
    const bs = (xe['BIỂN SỐ']||xe['BIẼNSỐ']||xe['Biển số']||'').trim()
    if (!bs) continue
    const info = { cuaHang: xe['Cưả hàng sử dụng']||'', tinhMoi: xe['Tỉnh mới']||'' }
    map.set(bs.replace(/[-\.]/g,'').toUpperCase(), info)  // "61H07661"
    map.set(bs.toUpperCase(), info)                        // "61H-076.61"
  }
  return map
}

// ══════════════════════════════════════════════════════════
router.post('/set-token', async (req, res) => {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'Thiếu token' })
    await db().collection('gps_config').updateOne(
      { key: 'binhanh_token' },
      { $set: { key: 'binhanh_token', value: token, updatedAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/auto-login', async (req, res) => {
  try {
    const token = await binahLogin()
    await saveToken(token)
    res.json({ success: true, message: 'Token renewed' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/sync-camera', async (req, res) => {
  try { res.json(await syncCameraStatus()) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /sync ─────────────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const token = await getToken()
    if (!token) return res.status(400).json({ error: 'Chưa có token' })
    const data     = await binahCall('/vehicleonline/list', {
      filterCondition:5, hasPermissionAsAdmin:false, skipVehiclePlateChanged:false, languageId:1
    }, token)
    const vehicles = Array.isArray(data) ? data : (data?.data||data?.vehicles||[])
    if (!vehicles.length) return res.json({ success:true, synced:0 })
    const now = new Date(), today = now.toISOString().split('T')[0]
    const statusOps = vehicles.map(v => {
      const plateRaw = v.vehiclePlate||v.plate||''
      const camCount = v.packageBAP?.serverServiceInfo?.camcount ?? v.camCount ?? 0
      return { updateOne: { filter:{ plateRaw }, update:{ $set:{
        plateRaw, vehicleId:v.vehicleId||v.id||null,
        isOnline:v.isOnline??v.online??false, totalKm:parseFloat(v.totalKm||0),
        gpsTime:v.gpsTime||null, camCount, cameras:v.cameraDevice?.cameras||v.cameras||[],
        speed:v.speed||0, lat:v.lat||null, lng:v.lng||null, syncedAt:now, syncDate:today
      }}, upsert:true }}
    })
    const kmOps = vehicles.filter(v=>v.vehiclePlate||v.plate).map(v => ({
      updateOne: { filter:{ plateRaw:v.vehiclePlate||v.plate, date:today },
        update:{ $set:{ plateRaw:v.vehiclePlate||v.plate, date:today, totalKm:parseFloat(v.totalKm||0), recordedAt:now } },
        upsert:true }
    }))
    await db().collection('gps_status').bulkWrite(statusOps)
    if (kmOps.length) await db().collection('gps_km_history').bulkWrite(kmOps)
    const online = vehicles.filter(v=>v.isOnline??v.online).length
    await db().collection('gps_config').updateOne({ key:'last_sync' },
      { $set:{ key:'last_sync', value:now.toISOString(), total:vehicles.length, online, offline:vehicles.length-online } },
      { upsert:true })
    res.json({ success:true, total:vehicles.length, online, offline:vehicles.length-online, synced:statusOps.length })
  } catch(e) {
    if (e.message==='TOKEN_EXPIRED') return res.status(401).json({ error:'Token hết hạn' })
    res.status(500).json({ error:e.message })
  }
})

// ── GET /status ────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const since30 = new Date(); since30.setDate(since30.getDate()-30)
    const since30Str = since30.toISOString().split('T')[0]
    const [vehicles, kmDocs, lastSync] = await Promise.all([
      db().collection('gps_status').find({}).toArray(),
      db().collection('gps_km_history').find({ date:{ $gte:since30Str } }).toArray(),
      db().collection('gps_config').findOne({ key:'last_sync' })
    ])
    const kmHistory = new Map()
    for (const r of kmDocs) {
      if (!kmHistory.has(r.plateRaw)) kmHistory.set(r.plateRaw, [])
      kmHistory.get(r.plateRaw).push({
        date:       r.date,
        previousKm: r.previousKm ?? r.totalKm ?? null,  // từ backfill mới
        kmToday:    r.kmToday ?? 0
      })
    }
    const xeMap = await loadXeMap()
    const enriched = vehicles.map(v => {
      const gpsStatus = calcGpsStatus(v, kmHistory)
      const camStatus = calcCamStatus(v)
      const bsNorm    = (v.plateRaw||'').replace(/_[A-Z]$/,'').replace(/[-\.]/g,'').toUpperCase()
      const xeInfo    = xeMap.get(bsNorm) || { cuaHang:'', tinhMoi:'' }
      return { ...v, gpsStatus, camStatus, cuaHang:xeInfo.cuaHang, tinhMoi:xeInfo.tinhMoi }
    })
    const s = {
      total:       enriched.length,
      online:      enriched.filter(v=>v.isOnline).length,
      offline:     enriched.filter(v=>!v.isOnline).length,
      stopped:     enriched.filter(v=>v.gpsStatus.code==='stopped').length,
      lowActivity: enriched.filter(v=>v.gpsStatus.code==='low_activity').length,
      normal:      enriched.filter(v=>v.gpsStatus.code==='normal').length,
      camPartial:  enriched.filter(v=>v.camStatus.code==='partial').length,
      camLostAll:  enriched.filter(v=>v.camStatus.code==='lost_all').length,
    }
    res.json({ vehicles:enriched, lastSync:lastSync?.value||null, summary:s })
  } catch(e) { res.status(500).json({ error:e.message }) }
})

// ── GET /camera-status ─────────────────────────────────────
router.get('/camera-status', async (req, res) => {
  try {
    const [rows, lastSync, xeMap] = await Promise.all([
      db().collection('camera_status').find({}).sort({ bienSo:1 }).toArray(),
      db().collection('gps_config').findOne({ key:'last_camera_sync' }),
      loadXeMap()  // luôn lấy fresh từ xetai
    ])
    // Enrich với cuaHang/tinhMoi mới nhất từ xetai
    const enriched = rows.map((r, idx) => {
      const xeInfo = xeMap.get(r.bienSo?.toUpperCase()) || { cuaHang: r.cuaHang||'', tinhMoi: r.tinhMoi||'' }
      return { ...r, stt: idx + 1, cuaHang: xeInfo.cuaHang, tinhMoi: xeInfo.tinhMoi }
    })
    const total = enriched.length, ok = enriched.filter(r=>r.ok).length
    res.json({
      lastSync: lastSync?.valueVN || lastSync?.value || null,
      total, ok, warning: total - ok, rows: enriched
    })
  } catch(e) { res.status(500).json({ error:e.message }) }
})

// ── POST /upload-camera-excel ──────────────────────────────
router.post('/upload-camera-excel', async (req, res) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error:'Thiếu data' })
    const buf  = Buffer.from(data, 'base64')
    const XLSX = require('xlsx')
    const wb   = XLSX.read(buf, { type:'buffer' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'' })
    const headerIdx = rows.findIndex(r => r[0]==='STT' || r[1]==='Phương tiện')
    if (headerIdx < 0) return res.status(400).json({ error:'Không tìm thấy header', sample:rows.slice(0,5) })

    const normBS = s => String(s||'').replace(/[-\.]/g,'').toUpperCase().trim()
    const xeMap  = await loadXeMap()

    const parsed = []
    for (const row of rows.slice(headerIdx+1)) {
      if (!row[0]||!row[1]) continue
      const bsExcel = String(row[1]).trim()
      const xeInfo  = xeMap.get(bsExcel.toUpperCase()) || xeMap.get(normBS(bsExcel))
      if (!xeInfo) continue  // chỉ xe trong xetai

      const kenh   = [row[2],row[3],row[4],row[5]].map(k=>String(k||'').trim().normalize('NFC'))
      const active = kenh.filter(k=>k==='Hoạt động').length
      const hasLoi = kenh.some(k=>k==='Lỗi')
      parsed.push({
        bienSo: bsExcel, cuaHang: xeInfo.cuaHang, tinhMoi: xeInfo.tinhMoi,
        kenh1:kenh[0], kenh2:kenh[1], kenh3:kenh[2], kenh4:kenh[3],
        active, ok: active>=2,
        status: active>=2 ? 'Bình thường'
          : active===0 && hasLoi ? 'Mất tín hiệu'
          : active===0 ? 'Mất hết cam'
          : `Cần kiểm tra (${active} kênh)`
      })
    }
    if (!parsed.length) return res.status(400).json({ error:'Không khớp được xe nào với xetai' })
    const now    = new Date()
    const vnTime = new Date(now.getTime()+7*60*60*1000)
    const vnStr  = vnTime.toISOString().replace('T',' ').replace('Z','').slice(0,19)+' (GMT+7)'
    await db().collection('camera_status').deleteMany({})
    await db().collection('camera_status').insertMany(parsed.map(r=>({...r,syncedAt:now,syncedAtVN:vnStr})))
    await db().collection('gps_config').updateOne({ key:'last_camera_sync' },
      { $set:{ key:'last_camera_sync', value:now.toISOString(), valueVN:vnStr,
        total:parsed.length, ok:parsed.filter(r=>r.ok).length, warning:parsed.filter(r=>!r.ok).length }},
      { upsert:true })
    res.json({ success:true, total:parsed.length,
      ok:parsed.filter(r=>r.ok).length, warning:parsed.filter(r=>!r.ok).length })
  } catch(e) { console.error('[CameraExcel]',e.message); res.status(500).json({ error:e.message }) }
})

// ── GET /camera-excel-export ───────────────────────────────
router.get('/camera-excel-export', async (req, res) => {
  try {
    const [rows, lastSync] = await Promise.all([
      db().collection('camera_status').find({}).sort({ bienSo:1 }).toArray(),
      db().collection('gps_config').findOne({ key:'last_camera_sync' })
    ])
    if (!rows.length) return res.status(404).json({ error:'Chưa có data' })
    const XLSX = require('xlsx'), wb = XLSX.utils.book_new()
    const cols = ['Biển số','Cửa hàng','Tỉnh','Kênh 1','Kênh 2','Kênh 3','Kênh 4','Hoạt động','Trạng thái']
    const toRow = r => [r.bienSo,r.cuaHang||'',r.tinhMoi||'',r.kenh1||'',r.kenh2||'',r.kenh3||'',r.kenh4||'',r.active,r.status]
    const ws1 = XLSX.utils.aoa_to_sheet([['Camera - '+(lastSync?.valueVN||'')],[],cols,...rows.map(toRow)])
    ws1['!cols']=[10,20,15,12,12,12,12,8,20].map(w=>({wch:w}))
    XLSX.utils.book_append_sheet(wb,ws1,'Tất cả xe')
    const warn=rows.filter(r=>!r.ok)
    if (warn.length) {
      const ws2=XLSX.utils.aoa_to_sheet([['Cần kiểm tra'],[],cols,...warn.map(toRow)])
      XLSX.utils.book_append_sheet(wb,ws2,'Cần kiểm tra')
    }
    const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'})
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="camera_${new Date().toISOString().slice(0,10)}.xlsx"`)
    res.send(buf)
  } catch(e) { res.status(500).json({ error:e.message }) }
})

// ── GET /gps-excel-export ──────────────────────────────────
router.get('/gps-excel-export', async (req, res) => {
  try {
    const since30=new Date(); since30.setDate(since30.getDate()-30)
    const [vehicles,kmDocs]=await Promise.all([
      db().collection('gps_status').find({}).toArray(),
      db().collection('gps_km_history').find({date:{$gte:since30.toISOString().split('T')[0]}}).toArray()
    ])
    const kmHistory=new Map()
    for (const r of kmDocs) {
      if (!kmHistory.has(r.plateRaw)) kmHistory.set(r.plateRaw,[])
      kmHistory.get(r.plateRaw).push({date:r.date,km:r.totalKm})
    }
    const xeMap=await loadXeMap()
    const enriched=vehicles.map(v=>{
      const gs=calcGpsStatus(v,kmHistory)
      const bsN=(v.plateRaw||'').replace(/_[A-Z]$/,'').replace(/[-\.]/g,'').toUpperCase()
      const xi=xeMap.get(bsN)||{cuaHang:'',tinhMoi:''}
      return {...v,gpsStatus:gs,cuaHang:xi.cuaHang,tinhMoi:xi.tinhMoi}
    })
    const XLSX=require('xlsx'),wb=XLSX.utils.book_new()
    const cols=['Biển số','Cửa hàng','Tỉnh','GPS Time','Ngày mất','Km hôm nay','Trạng thái GPS']
    const toRow=v=>[(v.plateRaw||'').replace(/_[A-Z]$/,''),v.cuaHang,v.tinhMoi,
      v.gpsTime?v.gpsTime.split('T')[0]:'',
      v.gpsStatus?.daysSince!=null?v.gpsStatus.daysSince+' ngày':'',
      v.totalKm||0,v.gpsStatus?.label||'']
    const ws=XLSX.utils.aoa_to_sheet([['GPS - '+new Date().toLocaleString('vi-VN')],[],cols,...enriched.map(toRow)])
    ws['!cols']=[14,20,15,12,10,12,25].map(w=>({wch:w}))
    XLSX.utils.book_append_sheet(wb,ws,'GPS Status')
    const issues=enriched.filter(v=>v.gpsStatus?.code!=='normal')
    if (issues.length) {
      const ws2=XLSX.utils.aoa_to_sheet([['Có vấn đề'],[],cols,...issues.map(toRow)])
      XLSX.utils.book_append_sheet(wb,ws2,'Có vấn đề')
    }
    const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'})
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="gps_${new Date().toISOString().slice(0,10)}.xlsx"`)
    res.send(buf)
  } catch(e) { res.status(500).json({ error:e.message }) }
})


// ── GET /api/gps/vehicle-history/:plateRaw ─────────────────
// Trả về km history 30 ngày để vẽ sparkline chart
router.get('/vehicle-history/:plateRaw', async (req, res) => {
  try {
    const { plateRaw } = req.params
    const since30 = new Date(); since30.setDate(since30.getDate() - 30)
    const docs = await db().collection('gps_km_history').find({
      plateRaw,
      date: { $gte: since30.toISOString().split('T')[0] }
    }).sort({ date: 1 }).toArray()

    const data = docs.map(d => ({
      date:      d.date,
      prevKm:    Math.round(d.previousKm || 0),
      kmToday:   Math.round(d.kmToday || 0)
    }))
    res.json({ plateRaw, data })
  } catch(e) { res.status(500).json({ error: e.message }) }
})
// ── Debug routes ───────────────────────────────────────────
router.get('/debug-raw', async (req, res) => {
  try {
    const token=await getToken()
    if (!token) return res.status(400).json({ error:'Chưa có token' })
    const data=await binahCall('/vehicleonline/list',{filterCondition:5,hasPermissionAsAdmin:false,skipVehiclePlateChanged:false,languageId:1},token)
    const vehicles=Array.isArray(data)?data:(data?.data||data?.vehicles||[])
    res.json({ total:vehicles.length, sample:vehicles.slice(0,2).map(v=>({ plate:v.vehiclePlate||v.plate, allKeys:Object.keys(v) })) })
  } catch(e) { res.status(500).json({ error:e.message }) }
})

router.get('/backfill-status', async (req, res) => {
  try {
    const [cfg,kmCount]=await Promise.all([
      db().collection('gps_config').findOne({ key:'last_backfill' }),
      db().collection('gps_km_history').countDocuments()
    ])
    res.json({ lastBackfill:cfg?.value||null, done:cfg?.done, errors:cfg?.errors, kmRecords:kmCount })
  } catch(e) { res.status(500).json({ error:e.message }) }
})

router.post('/backfill-history', async (req, res) => {
  try {
    const token=await getToken()
    if (!token) return res.status(400).json({ error:'Chưa có token' })
    const vehicles=await db().collection('gps_status').find({vehicleId:{$ne:null}},{projection:{vehicleId:1,plateRaw:1}}).toArray()
    if (!vehicles.length) return res.status(400).json({ error:'Chưa có dữ liệu xe. Hãy Sync trước.' })
    const toDate=new Date(), fromDate=new Date()
    fromDate.setDate(fromDate.getDate()-30)
    const fromStr=fromDate.toISOString().split('T')[0]+'T00:00:00'
    const toStr=toDate.toISOString().split('T')[0]+'T23:59:59'
    res.json({ success:true, message:`Bắt đầu backfill ${vehicles.length} xe.`, total:vehicles.length });
    (async()=>{
      let done=0,errors=0
      for (let i=0;i<vehicles.length;i+=5) {
        const batch=vehicles.slice(i,i+5)
        await Promise.all(batch.map(async v=>{
          try {
            const data=await binahCall('/temperature-report/temperature/chart',
              {vehicleId:v.vehicleId,fromDate:fromStr,toDate:toStr,numberRow:2000,getAddress:false},token)
            const points=Array.isArray(data)?data:(data?.data||data?.result||[])
            if (!points.length){done++;return}
            // Group by day, lấy previousKm cuối cùng của mỗi ngày
            // previousKm = km tích lũy đến đầu ngày đó (dùng để so sánh ngày này vs ngày trước)
            const byDay = {}
            for (const p of points) {
              if (!p.dateTime) continue
              const day = p.dateTime.split('T')[0]
              if (!byDay[day]) byDay[day] = { kms: [], prevKms: [] }
              if (p.km != null)         byDay[day].kms.push(parseFloat(p.km))
              if (p.previousKm != null) byDay[day].prevKms.push(parseFloat(p.previousKm))
            }
            const ops = Object.entries(byDay).map(([date, d]) => {
              const maxKm    = d.kms.length      ? Math.max(...d.kms)     : 0
              const prevKm   = d.prevKms.length  ? Math.max(...d.prevKms) : maxKm
              // kmToday = max km ngày đó - previousKm (km thực đi trong ngày)
              const kmToday  = Math.max(0, Math.round(maxKm - prevKm))
              return {
                updateOne: {
                  filter: { plateRaw: v.plateRaw, date },
                  update: { $set: {
                    plateRaw:   v.plateRaw,
                    date,
                    previousKm: Math.round(prevKm),   // làm tròn integer
                    kmToday,              // km thực đi trong ngày
                    totalKm:    kmToday,  // backward compat
                    source:     'backfill'
                  }},
                  upsert: true
                }
              }
            })
            if (ops.length) await db().collection('gps_km_history').bulkWrite(ops)
            done++
          } catch(e){console.error('[Backfill]',v.plateRaw,e.message);errors++}
        }))
        await new Promise(r=>setTimeout(r,300))
      }
      await db().collection('gps_config').updateOne({key:'last_backfill'},
        {$set:{key:'last_backfill',value:new Date().toISOString(),done,errors}},{upsert:true})
    })()
  } catch(e) { res.status(500).json({ error:e.message }) }
})

async function syncGPS() {
  const token=await getToken()
  if (!token) throw new Error('Chưa có token')
  const data=await binahCall('/vehicleonline/list',{filterCondition:5,hasPermissionAsAdmin:false,skipVehiclePlateChanged:false,languageId:1},token)
  const vehicles=Array.isArray(data)?data:(data?.data||data?.vehicles||[])
  if (!vehicles.length) return {synced:0}
  const now=new Date(),today=now.toISOString().split('T')[0]
  const ops=vehicles.map(v=>({updateOne:{filter:{plateRaw:v.vehiclePlate||v.plate||''},update:{$set:{
    plateRaw:v.vehiclePlate||v.plate||'',vehicleId:v.vehicleId||v.id||null,
    isOnline:v.isOnline??v.online??false,totalKm:parseFloat(v.totalKm||0),gpsTime:v.gpsTime||null,
    camCount:v.packageBAP?.serverServiceInfo?.camcount??v.camCount??0,
    cameras:v.cameraDevice?.cameras||v.cameras||[],syncedAt:now,syncDate:today
  }},upsert:true}}))
  await db().collection('gps_status').bulkWrite(ops)
  const kmOps=vehicles.filter(v=>v.vehiclePlate||v.plate).map(v=>({updateOne:{
    filter:{plateRaw:v.vehiclePlate||v.plate,date:today},
    update:{$set:{plateRaw:v.vehiclePlate||v.plate,date:today,totalKm:parseFloat(v.totalKm||0),recordedAt:now}},upsert:true
  }}))
  if (kmOps.length) await db().collection('gps_km_history').bulkWrite(kmOps)
  const online=vehicles.filter(v=>v.isOnline??v.online).length
  await db().collection('gps_config').updateOne({key:'last_sync'},{$set:{key:'last_sync',value:now.toISOString(),total:vehicles.length,online,offline:vehicles.length-online}},{upsert:true})
  return {success:true,total:vehicles.length,online,offline:vehicles.length-online}
}

module.exports = router
module.exports.syncGPS = syncGPS
