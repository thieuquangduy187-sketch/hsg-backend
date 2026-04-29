// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/routes/cuaHang.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const router   = require('express').Router()
const mongoose = require('mongoose')

// ── Helper: lấy collection ────────────────────────────────
const db = () => mongoose.connection.db

// ── Helper: xác định xe thuộc HSG hay HSH ────────────────
async function isHSH(dotChuyenDoi) {
  if (!dotChuyenDoi) return false
  const cfg = await db().collection('chuyen_doi_config').findOne({ key: 'done' })
  const done = cfg?.dots || []
  return done.includes(dotChuyenDoi)
}

// ── Helper: normalize string để so sánh (bỏ dấu cách thừa, lowercase)
function normStr(s) {
  return (s || '').trim().toLowerCase()
    .normalize('NFC') // chuẩn hóa Unicode
}

// ── Helper: xe có phải Tổng kho không (tên bắt đầu bằng TK)
function isTongKho(tenCH) {
  return /^(TK|Tổng kho|Tong kho)/i.test((tenCH || '').trim())
}

// ── Helper: lookup thông tin CH từ danhsachcuahang ────────
// isHsh: true → trả HSH_MACH, false → trả HSG_MACH
async function lookupCH(tenCH, tinhGoi, isHsh) {
  const col    = db().collection('danhsachcuahang')
  const allDocs = await col.find({}).toArray()
  const normTen = normStr(tenCH)
  const normTinh = normStr(tinhGoi)

  // Tìm exact match trước (NFC normalized)
  let doc = allDocs.find(d => {
    const matchTen = normStr(d.HSG_TENCH) === normTen || normStr(d.HSH_TENCH) === normTen
    if (!matchTen) return false
    if (normTinh) return normStr(d.HSG_TINH) === normTinh
    return true
  })

  // Nếu không có tỉnh → lấy kết quả đầu tiên theo tên
  if (!doc && !normTinh) {
    doc = allDocs.find(d =>
      normStr(d.HSG_TENCH) === normTen || normStr(d.HSH_TENCH) === normTen
    )
  }

  if (!doc) return null

  // Fix 2: Tổng kho → tỉnh mới = tên cửa hàng (không dùng HSG_TINH)
  const tinh = isTongKho(tenCH) ? tenCH : (doc.HSG_TINH || '')

  return {
    ma:      isHsh ? (doc.HSH_MACH || doc.HSG_MACH) : doc.HSG_MACH,
    tinh,
    mien:    doc['Miền'] || doc.Mien || '',
    hsgTen:  doc.HSG_TENCH,
    hshTen:  doc.HSH_TENCH,
  }
}

// ══════════════════════════════════════════════════════════
// GET /api/cua-hang/config — lấy config đợt đã chuyển đổi
// ══════════════════════════════════════════════════════════
router.get('/config', async (req, res) => {
  try {
    const cfg = await db().collection('chuyen_doi_config').findOne({ key: 'done' })
    // Đếm xe theo từng đợt
    const dotCount = await db().collection('danhsachchuyendoi').aggregate([
      { $group: { _id: '$Đợt chuyển đổi', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray()
    res.json({ dotsDone: cfg?.dots || [], dotCount })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// POST /api/cua-hang/config — admin đánh dấu đợt đã/chưa chuyển
// ══════════════════════════════════════════════════════════
router.post('/config', async (req, res) => {
  try {
    const { dots } = req.body // ['Đợt 1', 'Đợt 2']
    await db().collection('chuyen_doi_config').updateOne(
      { key: 'done' },
      { $set: { key: 'done', dots: dots || [], updatedAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true, dots })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// POST /api/cua-hang/batch-update — A: update hàng loạt theo đợt
// KHÔNG ghi cây điều động
// ══════════════════════════════════════════════════════════
router.post('/batch-update', async (req, res) => {
  try {
    const { dot } = req.body
    if (!dot) return res.status(400).json({ error: 'Thiếu tên đợt' })

    const xeCol  = db().collection('xetai')
    const cdCol  = db().collection('danhsachchuyendoi')
    const chCol  = db().collection('danhsachcuahang')

    // Lấy danh sách xe thuộc đợt này
    const xeDot = await cdCol.find({ 'Đợt chuyển đổi': dot }).toArray()
    if (!xeDot.length) return res.json({ success: true, updated: 0, message: 'Không có xe nào trong đợt này' })

    // Build map biển số → thông tin CH mới (HSH)
    let updated = 0, notFound = []
    const bulkOps = []

    for (const xe of xeDot) {
      const bienSo = xe['Biển số'] || xe.bienSo || ''
      if (!bienSo) continue

      // Tìm thông tin CH hiện tại của xe trong xetai
      const xeDoc = await xeCol.findOne({
        $or: [{ 'BIỂN SỐ': bienSo }, { 'BIẼNSỐ': bienSo }, { 'Biển số': bienSo }]
      }, { projection: { 'Cưả hàng sử dụng': 1, 'Tỉnh mới': 1 } })

      if (!xeDoc) { notFound.push(bienSo); continue }

      const tenCH = xeDoc['Cưả hàng sử dụng'] || ''
      const tinh  = xeDoc['Tỉnh mới'] || ''

      // Lookup thông tin HSH từ danhsachcuahang
      // Dùng lookupCH mới (isHsh=true vì batch update = đã chuyển HSH)
      const info = await lookupCH(tenCH, tinh, true)
      if (!info) { notFound.push(`${bienSo}(CH không tìm thấy)`); continue }

      // Fix 2: Tổng kho → tỉnh mới = tên cửa hàng
      const newTinh = isTongKho(tenCH) ? tenCH : info.tinh

      bulkOps.push({
        updateOne: {
          filter: { $or: [{ 'BIỂN SỐ': bienSo }, { 'BIẼNSỐ': bienSo }, { 'Biển số': bienSo }] },
          update: { $set: {
            'Mã hiện tại':       info.ma,
            'Tỉnh mới':          newTinh,
            'Miền':              info.mien,
            // KHÔNG update Cây điều động, KHÔNG đổi tên CH
          }}
        }
      })
      updated++
    }

    if (bulkOps.length) await xeCol.bulkWrite(bulkOps)

    res.json({
      success: true, updated,
      notFound: notFound.length,
      notFoundList: notFound.slice(0, 20),
      message: `Đã cập nhật ${updated}/${xeDot.length} xe theo ${dot}`
    })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// GET /api/cua-hang/suggest?q=Chau+Thanh — B: autocomplete
// ══════════════════════════════════════════════════════════
router.get('/suggest', async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    if (q.length < 1) return res.json([])

    const col    = db().collection('danhsachcuahang')
    const regex  = new RegExp(q, 'i')

    // Tìm match trong cả HSG_TENCH và HSH_TENCH
    const docs = await col.find({
      $or: [{ HSG_TENCH: regex }, { HSH_TENCH: regex }]
    }, {
      projection: { HSG_TENCH: 1, HSH_TENCH: 1, HSG_TINH: 1, HSG_MACH: 1, HSH_MACH: 1, 'Miền': 1 }
    }).limit(20).toArray()

    // Dedup và format gợi ý
    const seen = new Set()
    const results = []
    for (const d of docs) {
      // Gợi ý HSG
      const keyHsg = `${d.HSG_TENCH}|${d.HSG_TINH}`
      if (d.HSG_TENCH && !seen.has(keyHsg)) {
        seen.add(keyHsg)
        results.push({
          display:  `${d.HSG_TENCH} - ${d.HSG_TINH}`,
          value:    d.HSG_TENCH,
          ma:       d.HSG_MACH,
          tinh:     d.HSG_TINH,
          mien:     d['Miền'],
          type:     'HSG'
        })
      }
      // Gợi ý HSH nếu khác tên
      const keyHsh = `${d.HSH_TENCH}|${d.HSG_TINH}`
      if (d.HSH_TENCH && d.HSH_TENCH !== d.HSG_TENCH && !seen.has(keyHsh)) {
        seen.add(keyHsh)
        results.push({
          display:  `${d.HSH_TENCH} - ${d.HSG_TINH}`,
          value:    d.HSH_TENCH,
          ma:       d.HSH_MACH,
          tinh:     d.HSG_TINH,
          mien:     d['Miền'],
          type:     'HSH'
        })
      }
    }
    res.json(results.slice(0, 15))
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// GET /api/cua-hang/audit — C: dò lại toàn bộ hệ thống
// ══════════════════════════════════════════════════════════
router.get('/audit', async (req, res) => {
  try {
    const xeCol  = db().collection('xetai')
    const chCol  = db().collection('danhsachcuahang')
    const cdCol  = db().collection('danhsachchuyendoi')
    const cfg    = await db().collection('chuyen_doi_config').findOne({ key: 'done' })
    const dotsDone = cfg?.dots || []

    // Map biển số → đợt chuyển đổi
    const cdDocs = await cdCol.find({}, { projection: { 'Biển số': 1, 'Đợt chuyển đổi': 1 } }).toArray()
    const dotMap = new Map()
    for (const d of cdDocs) {
      const bs = d['Biển số'] || ''
      if (bs) dotMap.set(bs.toUpperCase(), d['Đợt chuyển đổi'])
    }

    // Lấy tất cả xe
    const allXe = await xeCol.find({}, {
      projection: { 'BIỂN SỐ': 1, 'BIẼNSỐ': 1, 'Biển số': 1, 'Cưả hàng sử dụng': 1, 'Tỉnh mới': 1, 'Miền': 1, 'Mã hiện tại': 1 }
    }).toArray()

    // Load audit_ignore list
    const ignoreCol = db().collection('audit_ignore')
    const ignoreSet = new Set(
      (await ignoreCol.find({}).toArray()).map(d => `${d.bienSo}|${d.tenCH}`)
    )

    // Load toàn bộ danhsachcuahang 1 lần (tránh N+1 query)
    const allCH = await chCol.find({}).toArray()

    const issues = []
    for (const xe of allXe) {
      const bienSo  = xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || xe['Biển số'] || ''
      const tenCH   = xe['Cưả hàng sử dụng'] || ''
      const tinhXe  = xe['Tỉnh mới'] || ''
      const mienXe  = xe['Miền'] || ''
      const maXe    = xe['Mã hiện tại'] || ''
      if (!tenCH) continue

      // Bỏ qua nếu đã ignore
      if (ignoreSet.has(`${bienSo}|${tenCH}`)) continue

      const dot   = dotMap.get(bienSo.toUpperCase().replace(/[\s\-\.]/g, '')) || ''
      const isHsh = dot ? dotsDone.includes(dot) : false

      // Lookup với NFC normalize
      const normTen  = normStr(tenCH)
      const normTinh = normStr(tinhXe)
      let chDoc = allCH.find(d => {
        const matchTen = normStr(d.HSG_TENCH) === normTen || normStr(d.HSH_TENCH) === normTen
        if (!matchTen) return false
        if (normTinh && !isTongKho(tenCH)) return normStr(d.HSG_TINH) === normTinh
        return true
      })
      // Fallback: tìm chỉ theo tên
      if (!chDoc) chDoc = allCH.find(d =>
        normStr(d.HSG_TENCH) === normTen || normStr(d.HSH_TENCH) === normTen
      )

      if (!chDoc) {
        issues.push({ bienSo, tenCH, tinhXe, maXe, loai: 'NOT_FOUND', message: 'Tên CH không tìm thấy trong danh sách' })
        continue
      }

      const expectMa   = isHsh ? (chDoc.HSH_MACH || chDoc.HSG_MACH) : chDoc.HSG_MACH
      // Fix 2: Tổng kho → expectTinh = tenCH
      const expectTinh = isTongKho(tenCH) ? tenCH : (chDoc.HSG_TINH || '')
      const expectMien = chDoc['Miền'] || chDoc.Mien || ''

      const errs = []
      if (maXe   && expectMa   && maXe   !== expectMa)   errs.push(`Mã CH: "${maXe}" ≠ "${expectMa}"`)
      if (tinhXe && expectTinh && tinhXe !== expectTinh) errs.push(`Tỉnh: "${tinhXe}" ≠ "${expectTinh}"`)
      if (mienXe && expectMien && mienXe !== expectMien) errs.push(`Miền: "${mienXe}" ≠ "${expectMien}"`)

      if (errs.length) {
        issues.push({
          bienSo, tenCH, tinhXe, maXe, loai: 'MISMATCH',
          message: errs.join(' | '),
          suggest: { ma: expectMa, tinh: expectTinh, mien: expectMien }
        })
      }
    }

    res.json({ total: allXe.length, issues: issues.length, data: issues })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// POST /api/cua-hang/ignore — bỏ qua cảnh báo 1 xe
// ══════════════════════════════════════════════════════════
router.post('/ignore', async (req, res) => {
  try {
    const { bienSo, tenCH } = req.body
    if (!bienSo || !tenCH) return res.status(400).json({ error: 'Thiếu thông tin' })
    await db().collection('audit_ignore').updateOne(
      { bienSo, tenCH },
      { $set: { bienSo, tenCH, ignoredAt: new Date() } },
      { upsert: true }
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// POST /api/cua-hang/unignore — bỏ bỏ qua (audit lại)
// ══════════════════════════════════════════════════════════
router.post('/unignore', async (req, res) => {
  try {
    const { bienSo, tenCH } = req.body
    await db().collection('audit_ignore').deleteOne({ bienSo, tenCH })
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════════════
// POST /api/cua-hang/fix-one — sửa 1 xe từ kết quả audit
// ══════════════════════════════════════════════════════════
router.post('/fix-one', async (req, res) => {
  try {
    const { bienSo, ma, tinh, mien } = req.body
    if (!bienSo) return res.status(400).json({ error: 'Thiếu biển số' })

    const result = await db().collection('xetai').updateOne(
      { $or: [{ 'BIỂN SỐ': bienSo }, { 'BIẼNSỐ': bienSo }, { 'Biển số': bienSo }] },
      { $set: {
        ...(ma   ? { 'Mã hiện tại': ma   } : {}),
        ...(tinh ? { 'Tỉnh mới':    tinh } : {}),
        ...(mien ? { 'Miền':        mien } : {}),
      }}
    )
    res.json({ success: true, matched: result.matchedCount })
  } catch(e) { res.status(500).json({ error: e.message }) }
})


// ══════════════════════════════════════════════════════════
// GET /api/cua-hang/debug-dot/:dot — debug batch update
// ══════════════════════════════════════════════════════════
router.get('/debug-dot/:dot', async (req, res) => {
  try {
    const dot    = decodeURIComponent(req.params.dot)
    const cdCol  = db().collection('danhsachchuyendoi')
    const xeCol  = db().collection('xetai')
    const chCol  = db().collection('danhsachcuahang')

    const xeDot = await cdCol.find({ 'Đợt chuyển đổi': dot }).toArray()
    const allCH = await chCol.find({}).toArray()

    const results = []
    for (const xe of xeDot.slice(0, 10)) { // debug 10 xe đầu
      const bienSo = xe['Biển số'] || xe.bienSo || ''

      // Thử nhiều cách tìm xe trong xetai
      const xeDoc = await xeCol.findOne({
        $or: [
          { 'BIỂN SỐ': bienSo },
          { 'BIẼNSỐ':  bienSo },
          { 'Biển số': bienSo },
        ]
      }, { projection: { 'BIỂN SỐ':1, 'BIẼNSỐ':1, 'Biển số':1, 'Cưả hàng sử dụng':1, 'Tỉnh mới':1 } })

      const tenCH = xeDoc?.['Cưả hàng sử dụng'] || ''
      const tinh  = xeDoc?.['Tỉnh mới'] || ''

      // Thử lookup CH
      const normTen = normStr(tenCH)
      const chDoc = allCH.find(d =>
        normStr(d.HSG_TENCH) === normTen || normStr(d.HSH_TENCH) === normTen
      )

      results.push({
        bienSo_cd:    bienSo,
        bienSo_found: !!(xeDoc),
        tenCH,
        tinh,
        ch_found:     !!(chDoc),
        hsg_mach:     chDoc?.HSG_MACH,
        hsh_mach:     chDoc?.HSH_MACH,
        // Xem biển số thực trong xetai (để so sánh format)
        xetai_sample: xeDoc ? (xeDoc['BIỂN SỐ'] || xeDoc['BIẼNSỐ'] || xeDoc['Biển số']) : null
      })
    }

    // Thêm: xem format biển số thực tế trong danhsachchuyendoi
    const sampleBS = xeDot.slice(0, 3).map(x => ({
      raw: x['Biển số'] || x.bienSo,
      keys: Object.keys(x).filter(k => k.toLowerCase().includes('bi') || k.toLowerCase().includes('số'))
    }))

    res.json({ dot, total: xeDot.length, sampleBS, results })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
