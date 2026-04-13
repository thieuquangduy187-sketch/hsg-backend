const router  = require('express').Router()
const Xe  = require('../models/Xe')
const Oto = require('../models/Oto')

function cleanNum(val) {
  if (!val && val !== 0) return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
}

router.get('/', async (req, res) => {
  try {
    const [xeDocs, otoDocs] = await Promise.all([
      Xe.find({}).lean(),
      Oto.find({}).lean(),
    ])

    const byMien={}, byLoaiThung={}, byNamSX={}, byLoaiXe={}, byPhapNhan={}, byTaiTrong={}
    let tongNguyenGia=0, tongGTCL=0, coTaiNan=0, daDieuDong=0

    xeDocs.forEach(d => {
      const mien  = d['Miền'] || 'Khác'
      // exact field names from MongoDB
      const lt    = d['Loại Thùng\n(Lửng, mui bạt, có cẩu)'] || 'Khác'
      const nam   = parseInt(d['Năm SX']) || 0
      const lx    = d['Loại xe'] || 'Khác'
      const pn    = d['Pháp nhân đứng tên'] || 'Khác'
      const tt    = cleanNum(d['Tải trọng \n(Tấn)'] || d['Tải trọng (Tấn)'])
      const ng    = cleanNum(d[' Nguyên giá'] || d['Nguyên giá'])
      const gt    = cleanNum(d[' GTCL'] || d['GTCL'])

      byMien[mien]   = (byMien[mien] || 0) + 1
      byLoaiThung[lt]= (byLoaiThung[lt] || 0) + 1
      if (nam > 0) byNamSX[nam] = (byNamSX[nam] || 0) + 1
      byLoaiXe[lx]   = (byLoaiXe[lx] || 0) + 1
      byPhapNhan[pn] = (byPhapNhan[pn] || 0) + 1

      const grp = tt<=1?'< 1T':tt<=2.5?'1–2.5T':tt<=6?'2.5–6T':tt<=10?'6–10T':'> 10T'
      byTaiTrong[grp]= (byTaiTrong[grp] || 0) + 1

      tongNguyenGia += ng
      tongGTCL      += gt
      if ((d['Lịch sử tai nạn'] || '').length > 3) coTaiNan++
      if (String(d['Cây điều động'] || '').replace(/^0$/, '').length > 1) daDieuDong++
    })

    // Ô tô con stats
    const oByMien={}, oByNhanHieu={}, oByDonVi={}
    let oTongGTCL=0

    otoDocs.forEach(d => {
      const mien = d['Miền'] || 'Khác'
      const nh   = d['Nhãn hiệu'] || d['Loại xe'] || 'Khác'
      const dv   = d['Đơn vị sử dụng'] || 'Khác'
      const gt   = cleanNum(d['GTCL'] || d['Giá trị'])

      oByMien[mien]   = (oByMien[mien] || 0) + 1
      oByNhanHieu[nh] = (oByNhanHieu[nh] || 0) + 1
      oByDonVi[dv]    = (oByDonVi[dv] || 0) + 1
      oTongGTCL      += gt
    })

    res.json({
      xeTai: {
        stats: {
          total: xeDocs.length,
          tongNguyenGia, tongGTCL, coTaiNan, daDieuDong,
          byMien, byLoaiThung, byNamSX, byLoaiXe, byPhapNhan, byTaiTrong,
        }
      },
      otocon: {
        stats: {
          total: otoDocs.length,
          tongGTCL: oTongGTCL,
          byMien: oByMien,
          byNhanHieu: oByNhanHieu,
          byDonVi: oByDonVi,
        }
      },
      fetchedAt: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
