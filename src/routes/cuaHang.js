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

// ── Helper: normalize string (lowercase, NFC, trim)
function normStr(s) {
  return (s || '').trim().toLowerCase().normalize('NFC')
}

// ── Helper: bỏ tiền tố địa danh hành chính
// "Thành phố Trà Vinh 3" → "Trà Vinh 3"
// "Tỉnh An Giang" → "An Giang"
// "Cửa hàng Châu Đốc" → "Châu Đốc"
function stripPrefix(s) {
  return (s || '').trim()
    .replace(/^(thành phố|tp\.?|tỉnh|cửa hàng|ch|huyện|quận|thị xã|tx\.?)\s+/i, '')
    .trim()
}

// ── Helper: xe có phải Tổng kho không
function isTongKho(tenCH) {
  return /^(TK|Tổng kho|Tong kho)/i.test((tenCH || '').trim())
}

// ── Helper: so sánh tên CH có match không (thử exact + strip prefix)
function matchTenCH(dbTen, searchTen) {
  if (!dbTen || !searchTen) return false
  const a = normStr(dbTen)
  const b = normStr(searchTen)
  if (a === b) return true
  // Thử strip prefix cả 2 phía
  if (normStr(stripPrefix(dbTen)) === normStr(stripPrefix(searchTen))) return true
  // Thử strip 1 phía
  if (a === normStr(stripPrefix(searchTen))) return true
  if (normStr(stripPrefix(dbTen)) === b) return true
  return false
}

// ── Helper: lookup CH từ danhsachcuahang (allDocs đã load sẵn)
// Fix 2: kiểm tra cả HSG_TENCH và HSH_TENCH
// Fix 3: strip tiền tố địa danh khi so sánh
function lookupFromDocs(allDocs, tenCH, tinhGoi) {
  const normTinh = normStr(tinhGoi)

  // Ưu tiên: match tên + tỉnh
  if (normTinh) {
    const exact = allDocs.find(d =>
      (matchTenCH(d.HSG_TENCH, tenCH) || matchTenCH(d.HSH_TENCH, tenCH))
      && normStr(d.HSG_TINH) === normTinh
    )
    if (exact) return exact
  }

  // Fallback: match tên không cần tỉnh
  return allDocs.find(d =>
    matchTenCH(d.HSG_TENCH, tenCH) || matchTenCH(d.HSH_TENCH, tenCH)
  ) || null
}

// ── Helper: lookup với load collection (dùng khi không có allDocs sẵn)
async function lookupCH(tenCH, tinhGoi, isHsh) {
  const allDocs = await db().collection('danhsachcuahang').find({}).toArray()
  const doc = lookupFromDocs(allDocs, tenCH, tinhGoi)
  if (!doc) return null
  const tinh = isTongKho(tenCH) ? tenCH : (doc.HSG_TINH || '')
  return {
    ma:     isHsh ? (doc.HSH_MACH || doc.HSG_MACH) : doc.HSG_MACH,
    tinh,
    mien:   doc['Miền'] || doc.Mien || '',
    hsgTen: doc.HSG_TENCH,
    hshTen: doc.HSH_TENCH,
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

    const xeCol = db().collection('xetai')
    const cdCol = db().collection('danhsachchuyendoi')

    const xeDot = await cdCol.find({ 'Đợt chuyển đổi': dot }).toArray()
    if (!xeDot.length) return res.json({ success: true, updated: 0, message: 'Không có xe nào trong đợt này' })

    // Load toàn bộ xetai + xeoto + danhsachcuahang 1 lần
    const otoCol = db().collection('xeoto')
    const [allXe, allOto, allCH] = await Promise.all([
      xeCol.find({}, { projection: { 'BIỂN SỐ':1, 'BIẼNSỐ':1, 'Biển số':1, 'Cưả hàng sử dụng':1, 'Tỉnh mới':1 } }).toArray(),
      otoCol.find({}, { projection: { 'BIỂN SỐ':1, 'BIẼNSỐ':1, 'Biển số':1 } }).toArray(),
      db().collection('danhsachcuahang').find({}).toArray(),
    ])
    // Build otoSet
    const otoSet = new Set()
    for (const o of allOto) {
      const bs = (o['BIỂN SỐ'] || o['BIẼNSỐ'] || o['Biển số'] || '').trim()
      if (bs) { otoSet.add(bs.toUpperCase()); otoSet.add(bs.toUpperCase().replace(/[\s\-\.]/g,'')) }
    }

    // Build map normalized biển số → xe doc
    const xeMap = new Map()
    for (const x of allXe) {
      const bs = (x['BIỂN SỐ'] || x['BIẼNSỐ'] || x['Biển số'] || '').trim()
      if (bs) {
        xeMap.set(bs.toUpperCase(), x)
        xeMap.set(bs.toUpperCase().replace(/[\s\-\.]/g,''), x)
      }
    }

    const results = []   // chi tiết từng xe
    const bulkOps = []

    for (const xe of xeDot) {
      const bienSo = (xe['Biển số'] || xe.bienSo || '').trim()
      if (!bienSo) continue

      const xeDoc = xeMap.get(bienSo.toUpperCase())
                 || xeMap.get(bienSo.toUpperCase().replace(/[\s\-\.]/g,''))

      if (!xeDoc) {
        const isOto = otoSet.has(bienSo.toUpperCase()) || otoSet.has(bienSo.toUpperCase().replace(/[\s\-\.]/g,''))
        results.push({ bienSo, status: 'not_in_xetai',
          reason: isOto ? 'Xe ô tô con (không cần cập nhật)' : 'Không tìm thấy trong xetai — đã thanh lý hoặc biển số sai'
        })
        continue
      }

      const tenCH = xeDoc['Cưả hàng sử dụng'] || ''
      const tinh  = xeDoc['Tỉnh mới'] || ''

      if (!tenCH) {
        results.push({ bienSo, status: 'no_cuahang', reason: 'Xe chưa có thông tin cửa hàng sử dụng' })
        continue
      }

      // Fix 2+3: dùng lookupFromDocs (đã load allCH) + strip prefix
      const doc = lookupFromDocs(allCH, tenCH, tinh)
      const info = doc ? {
        ma:   doc.HSH_MACH || doc.HSG_MACH,
        tinh: isTongKho(tenCH) ? tenCH : (doc.HSG_TINH || ''),
        mien: doc['Miền'] || doc.Mien || '',
      } : null
      if (!info) {
        results.push({ bienSo, tenCH, tinh, status: 'ch_not_found', reason: `Tên CH "${tenCH}" không tìm thấy trong danhsachcuahang` })
        continue
      }

      const newTinh = isTongKho(tenCH) ? tenCH : info.tinh
      bulkOps.push({
        updateOne: {
          filter: { $or: [{ 'BIỂN SỐ': bienSo }, { 'BIẼNSỐ': bienSo }, { 'Biển số': bienSo }] },
          update: { $set: { 'Mã hiện tại': info.ma, 'Tỉnh mới': newTinh, 'Miền': info.mien } }
        }
      })
      results.push({ bienSo, tenCH, tinh, status: 'updated', ma: info.ma, tinhMoi: newTinh, mien: info.mien })
    }

    if (bulkOps.length) await xeCol.bulkWrite(bulkOps)

    const updated   = results.filter(r => r.status === 'updated').length
    const missed    = results.filter(r => r.status !== 'updated')

    res.json({
      success: true,
      total:   xeDot.length,
      updated,
      missed:  missed.length,
      results, // toàn bộ chi tiết từng xe
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
    // Lưu cả 2 format: gốc và stripped để match được cả 2 kiểu
    const cdDocs = await cdCol.find({}, { projection: { 'Biển số': 1, 'Đợt chuyển đổi': 1 } }).toArray()
    const dotMap = new Map()
    for (const d of cdDocs) {
      const bs = d['Biển số'] || ''
      if (!bs) continue
      dotMap.set(bs.toUpperCase().trim(), d['Đợt chuyển đổi'])
      // Thêm format stripped để match khi lookup
      dotMap.set(bs.toUpperCase().replace(/[\s\-\.]/g, ''), d['Đợt chuyển đổi'])
    }

    // Lấy tất cả xe
    const allXe = await xeCol.find({}, {
      projection: { 'BIỂN SỐ': 1, 'BIẼNSỐ': 1, 'Biển số': 1, 'Cưả hàng sử dụng': 1, 'Tỉnh mới': 1, 'Miền': 1, 'Mã hiện tại': 1 }
    }).toArray()

    // Load tất cả 1 lần
    const otoCol2  = db().collection('xeoto')
    const ignoreCol = db().collection('audit_ignore')
    const [allCH2, allOto2, ignoreDocs] = await Promise.all([
      chCol.find({}).toArray(),
      otoCol2.find({}, { projection: { 'BIỂN SỐ':1, 'BIẼNSỐ':1, 'Biển số':1 } }).toArray(),
      ignoreCol.find({}).toArray(),
    ])
    const allCH = allCH2
    const ignoreSet = new Set(ignoreDocs.map(d => `${d.bienSo}|${d.tenCH}`))
    const otoSet2 = new Set()
    for (const o of allOto2) {
      const bs = (o['BIỂN SỐ'] || o['BIẼNSỐ'] || o['Biển số'] || '').trim()
      if (bs) { otoSet2.add(bs.toUpperCase()); otoSet2.add(bs.toUpperCase().replace(/[\s\-\.]/g,'')) }
    }

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

      // Thử lookup biển số theo cả 2 format
      const dot   = dotMap.get(bienSo.toUpperCase().trim())
               || dotMap.get(bienSo.toUpperCase().replace(/[\s\-\.]/g, ''))
               || ''
      const isHsh = dot ? dotsDone.includes(dot) : false

      // Fix 1: bỏ qua nếu là xe ô tô
      const bsNorm = bienSo.toUpperCase().replace(/[\s\-\.]/g,'')
      if (otoSet2.has(bienSo.toUpperCase()) || otoSet2.has(bsNorm)) continue

      // Fix 2+3: dùng lookupFromDocs với strip prefix
      const chDoc = lookupFromDocs(allCH, tenCH, isTongKho(tenCH) ? '' : tinhXe)

      if (!chDoc) {
        // Fix 2: kiểm tra đã update thủ công chưa (nếu mã khớp với bất kỳ HSG/HSH thì bỏ qua)
        const anyMatch = allCH.find(d => d.HSG_MACH === maXe || d.HSH_MACH === maXe)
        if (anyMatch) continue // đã cập nhật thủ công đúng → bỏ qua
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
    const cfg = await db().collection('chuyen_doi_config').findOne({ key: 'done' })
    const dotsDone = cfg?.dots || []

    // Build dotMap với fix mới
    const cdAll = await cdCol.find({}, { projection: { 'Biển số': 1, 'Đợt chuyển đổi': 1 } }).toArray()
    const dotMap = new Map()
    for (const d of cdAll) {
      const bs = d['Biển số'] || ''
      if (!bs) continue
      dotMap.set(bs.toUpperCase().trim(), d['Đợt chuyển đổi'])
      dotMap.set(bs.toUpperCase().replace(/[\s\-\.]/g,''), d['Đợt chuyển đổi'])
    }

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

      // Check dotMap với format mới
      const dotFound = dotMap.get(bienSo.toUpperCase().trim())
                    || dotMap.get(bienSo.toUpperCase().replace(/[\s\-\.]/g,''))
      results.push({
        bienSo_cd:    bienSo,
        bienSo_found: !!(xeDoc),
        dot_found:    dotFound || null,
        isHsh:        dotFound ? dotsDone.includes(dotFound) : false,
        tenCH,
        tinh,
        ch_found:     !!(chDoc),
        hsg_mach:     chDoc?.HSG_MACH,
        hsh_mach:     chDoc?.HSH_MACH,
        expect_ma:    dotFound && dotsDone.includes(dotFound) ? chDoc?.HSH_MACH : chDoc?.HSG_MACH,
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
