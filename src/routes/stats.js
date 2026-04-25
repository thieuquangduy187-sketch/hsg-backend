const router = require('express').Router()
const { protect, adminOnly } = require('../middleware/auth')
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
      const mien = d['Miền']                                     || 'Khác'
      const ltRaw = d['Loại Thùng\n(Lửng, mui bạt, có cẩu)'] || d['Loại Thùng'] || ''
      const lt = ltRaw.includes('Lửng') ? 'Thùng lửng'
               : ltRaw.includes('mui bạt') ? 'Thùng mui bạt'
               : ltRaw.includes('kín') ? 'Thùng kín'
               : ltRaw ? ltRaw.substring(0,20) : 'Khác'
      const nam  = parseInt(d['Năm SX'])                         || 0
      const lx   = d['Loại xe']                                  || 'Khác'
      const pn   = d['Pháp nhân đứng tên']                       || 'Khác'
      const tt   = cleanNum(d['Tải trọng \n(Tấn)'])
      const ng   = cleanNum(d[' Nguyên giá'])
      const gt   = cleanNum(d[' GTCL'])

      byMien[mien]    = (byMien[mien]    || 0) + 1
      byLoaiThung[lt] = (byLoaiThung[lt] || 0) + 1
      if (nam > 0) byNamSX[nam] = (byNamSX[nam] || 0) + 1
      byLoaiXe[lx]    = (byLoaiXe[lx]   || 0) + 1
      byPhapNhan[pn]  = (byPhapNhan[pn]  || 0) + 1

      const grp = tt<=1?'< 1T':tt<=2.5?'1–2.5T':tt<=6?'2.5–6T':tt<=10?'6–10T':'> 10T'
      byTaiTrong[grp] = (byTaiTrong[grp] || 0) + 1

      tongNguyenGia += ng
      tongGTCL      += gt
      if ((d['Lịch sử tai nạn'] || '').length > 3) coTaiNan++
      if (String(d['Cây điều động'] || '').replace(/^0$/, '').length > 1) daDieuDong++
    })

    // Ô tô con
    const oByMien={}, oByNhanHieu={}, oByDonVi={}
    let oTongGTCL=0

    otoDocs.forEach(d => {
      const mien = d['Miền']                                       || 'Khác'
      const nh   = d['NHÃN HIỆU'] || d['Nhãn hiệu'] || d['Loại xe'] || 'Khác'
      const dv   = d['Đơn vị sử dụng']                            || 'Khác'
      const gt   = cleanNum(d['GTCL'])

      oByMien[mien]    = (oByMien[mien]    || 0) + 1
      oByNhanHieu[nh]  = (oByNhanHieu[nh]  || 0) + 1
      oByDonVi[dv]     = (oByDonVi[dv]     || 0) + 1
      oTongGTCL       += gt
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
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router

// ── GET /api/stats/nhat-trinh-report?thang=4&nam=2026 ─────────────────────────
// Báo cáo nhật trình xe tải theo tháng
router.get('/nhat-trinh-report', protect, adminOnly, async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const db = mongoose.connection.db
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1
    const nam   = parseInt(req.query.nam)   || new Date().getFullYear()

    // 1. Lấy toàn bộ xe tải + nhóm theo tỉnh/cửa hàng
    const allXe = await db.collection('xetai').find({}).toArray()

    // 2. Lấy nhật trình đã nộp trong tháng
    const submitted = await db.collection('ntxt')
      .find({ thang, nam }).toArray()

    const submittedMap = {}
    submitted.forEach(r => {
      submittedMap[r.maHienTai] = r
      if (r.bienSo) submittedMap[r.bienSo] = r
    })

    // 3. Build danh sách xe với trạng thái nộp
    const xeList = allXe.map(xe => {
      const ma     = xe['Mã hiện tại'] || ''
      const bienSo = xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || ''
      const record = submittedMap[ma] || submittedMap[bienSo] || null

      return {
        ma, bienSo,
        tenTaiSan:  xe['TÊN TÀI SẢN']        || '',
        cuaHang:    xe['Cưả hàng sử dụng']   || '',
        tinh:       xe['Tỉnh mới'] || xe['Tỉnh Cũ'] || xe['Tỉnh gộp'] || '',
        mien:       xe['Miền']               || '',
        loaiXe:     xe['Loại xe']             || '',
        taiTrong:   xe['Tải trọng \n(Tấn)']  || 0,
        daNop: !!record,
        record: record ? {
          _id:          String(record._id),
          submittedAt:  record.submittedAt,
          updatedAt:    record.updatedAt,
          bienSo:       record.bienSo,
          kmDauThang:   record.kmDauThang,
          kmCuoiThang:  record.kmCuoiThang,
          tongKmDiChuyen: record.tongKmDiChuyen,
          kmDuongDeo:   record.kmDuongDeo,
          tgSuDungCau:  record.tgSuDungCau,
          tongLitDau:   record.tongLitDau,
          tongTienDau:  record.tongTienDau,
          tongKLChuyen: record.tongKLChuyen,
          klNoiBo:      record.klNoiBo,
          soChuyenXe:   record.soChuyenXe,
          cpThueNgoai:  record.cpThueNgoai,
          klThueNgoai:  record.klThueNgoai,
          ghiChu:       record.ghiChu,
        } : null,
      }
    }).filter(x => x.ma || x.bienSo)

    // 4. Thống kê tổng hợp
    const tongXe   = xeList.length
    const daNop    = xeList.filter(x => x.daNop).length
    const chuaNop  = tongXe - daNop

    // 5. Nhóm theo tỉnh
    const byTinh = {}
    xeList.forEach(xe => {
      const t = xe.tinh || 'Chưa phân loại'
      if (!byTinh[t]) byTinh[t] = { tinh: t, mien: xe.mien, tongXe: 0, daNop: 0, chuaNop: 0, xe: [] }
      byTinh[t].tongXe++
      if (xe.daNop) byTinh[t].daNop++
      else byTinh[t].chuaNop++
      byTinh[t].xe.push(xe)
    })

    // Sort tỉnh: đã nộp nhiều nhất → ít nhất → chưa nộp, cùng số thì theo tên
    const tinhList = Object.values(byTinh).sort((a, b) => {
      if (b.daNop !== a.daNop) return b.daNop - a.daNop
      const pctA = a.daNop / a.tongXe
      const pctB = b.daNop / b.tongXe
      if (pctB !== pctA) return pctB - pctA
      return (a.tinh || '').localeCompare(b.tinh || '')
    })

    // 6. Tổng hợp số liệu các xe đã nộp
    const tongKLArr = submitted.map(r => r.tongKLChuyen || 0).filter(v => v > 0)
    const tongKMArr = submitted.map(r => r.tongKmDiChuyen || 0).filter(v => v > 0)
    const tongKLNoBoArr = submitted.map(r => r.klNoiBo || 0).filter(v => v > 0)

    const avg = (arr) => arr.length ? Math.round(arr.reduce((a,b) => a+b,0) / arr.length) : 0

    const tonghop = {
      tongKm:       submitted.reduce((s,r) => s + (r.tongKmDiChuyen || 0), 0),
      tongKL:       submitted.reduce((s,r) => s + (r.tongKLChuyen   || 0), 0),
      tongLitDau:   submitted.reduce((s,r) => s + (r.tongLitDau     || 0), 0),
      tongTienDau:  submitted.reduce((s,r) => s + (r.tongTienDau    || 0), 0),
      tongPhutCau:  submitted.reduce((s,r) => s + (r.tgSuDungCau   || 0), 0),
      tongKLNoiBo:  submitted.reduce((s,r) => s + (r.klNoiBo        || 0), 0),
      tongCPThue:   submitted.reduce((s,r) => s + (r.cpThueNgoai   || 0), 0),
      // Trung bình (chỉ tính xe có giá trị > 0)
      avgKL:        avg(tongKLArr),    // trung bình KL chuyên chở
      avgKm:        avg(tongKMArr),    // trung bình km
      avgKLNoBo:    avg(tongKLNoBoArr),// trung bình KL nội bộ
      soXeCoKL:     tongKLArr.length,
      soXeCoKm:     tongKMArr.length,
    }

    res.json({
      thang, nam,
      summary: { tongXe, daNop, chuaNop, phanTram: Math.round(daNop/tongXe*100) },
      tongHop: tonghop,
      byTinh: tinhList,
      xeList,
    })
  } catch(e) {
    console.error('report error:', e)
    res.status(500).json({ error: e.message })
  }
})
