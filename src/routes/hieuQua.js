// hsg-backend/src/routes/hieuQua.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const XLSX = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const HieuQua = require('../models/HieuQua');

const anthropic = new Anthropic();

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────

function normBienSo(bs) {
  return (bs || '').toString().replace(/[-.\s]/g, '').toUpperCase();
}

/**
 * Lấy giá trị từ object theo nhiều field name variant
 */
function getField(obj, variants) {
  for (const v of variants) {
    if (obj[v] !== undefined && obj[v] !== null && obj[v] !== '') {
      const val = parseFloat(obj[v]);
      if (!isNaN(val)) return val;
    }
  }
  return 0;
}

/**
 * Detect xe tôn xốp:
 * 1. Mã cửa hàng bắt đầu bằng "TX"
 * 2. Xe Thaco 14 tấn
 * 3. Xe Chenglong 8.4 tấn
 */
function isTonXop(xe) {
  const ma = (xe['Mã hiện tại'] || xe['Mã hiện tại2'] || xe.maHienTai || '').toString().toUpperCase().trim();
  const ten = (xe['TÊN TÀI SẢN'] || xe.tenTaiSan || '').toString().toLowerCase();
  const taiTrong = parseFloat(
    xe['Tải trọng (Tấn)'] || xe['Tải trọng'] || xe.taiTrong || 0
  );

  if (ma.startsWith('TX')) return true;
  if (ten.includes('chenglong') && Math.abs(taiTrong - 8.4) < 0.15) return true;
  if (ten.includes('thaco') && Math.abs(taiTrong - 14) < 0.5) return true;
  return false;
}

/**
 * Tính toán chỉ số hiệu quả
 */
function calcMetrics(xe, hqRecord) {
  const tongKLVC = hqRecord.tongKLVC || 0;
  const klvcNoiBo = hqRecord.klvcNoiBo || 0;
  const taiTrong = parseFloat(
    xe['Tải trọng (Tấn)'] || xe['Tải trọng'] || xe.taiTrong || 0
  );
  const isTX = isTonXop(xe);

  const tyLeNoiBo = tongKLVC > 0 ? (klvcNoiBo / tongKLVC) * 100 : 0;

  let soChuyenNgay = 0;
  if (tongKLVC > 0) {
    if (isTX) {
      // Xe tôn xốp: tối đa 3T × 80%
      soChuyenNgay = tongKLVC / 26 / (3 * 1000 * 0.8);
    } else if (taiTrong > 0) {
      // Xe cửa hàng thường: 70% tải trọng
      soChuyenNgay = tongKLVC / 26 / (taiTrong * 1000 * 0.7);
    }
  }

  const danhGia = soChuyenNgay >= 1.5 ? 'Đạt' : 'Không đạt';

  return { tyLeNoiBo, soChuyenNgay, danhGia, isTX, taiTrong };
}

/**
 * Chuẩn hoá xe từ collection xetai
 */
function getXeInfo(xe) {
  const bienSo = normBienSo(
    xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || xe['Biển số'] || xe.bienSo || ''
  );
  const cuaHang = xe['Cưả hàng sử dụng'] || xe['Cửa hàng sử dụng'] || xe.cuaHang || '';
  const tinhMoi = xe['Tỉnh mới'] || xe.tinhMoi || '';
  const maHienTai = xe['Mã hiện tại'] || xe.maHienTai || '';
  const taiTrong = parseFloat(xe['Tải trọng (Tấn)'] || xe['Tải trọng'] || xe.taiTrong || 0);
  const tenTaiSan = xe['TÊN TÀI SẢN'] || xe.tenTaiSan || '';

  return { bienSo, cuaHang, tinhMoi, maHienTai, taiTrong, tenTaiSan };
}

// ────────────────────────────────────────────
// GET /api/hieu-qua?thang=X&nam=Y
// Lấy báo cáo hiệu quả tháng X/Y
// ────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1;
    const nam = parseInt(req.query.nam) || new Date().getFullYear();

    const db = mongoose.connection.db;
    const xetaiCol = db.collection('xetai');

    // Lấy tất cả xe tải
    const allXe = await xetaiCol.find({}).toArray();

    // Lấy dữ liệu hiệu quả tháng này
    const hqRecords = await HieuQua.find({ thang, nam }).lean();
    const hqMap = {};
    hqRecords.forEach(h => {
      hqMap[normBienSo(h.bienSo)] = h;
    });

    const results = [];

    for (const xe of allXe) {
      const info = getXeInfo(xe);
      if (!info.bienSo) continue;

      const hq = hqMap[info.bienSo];
      if (!hq) continue; // Chỉ trả về xe có data tháng này

      const metrics = calcMetrics(xe, hq);

      results.push({
        bienSo: info.bienSo,
        cuaHang: info.cuaHang,
        tinhMoi: info.tinhMoi,
        maHienTai: info.maHienTai,
        taiTrong: info.taiTrong,
        tenTaiSan: info.tenTaiSan,
        isTonXop: metrics.isTX,
        km: hq.km || 0,
        tongKLVC: hq.tongKLVC || 0,
        klvcNoiBo: hq.klvcNoiBo || 0,
        tyLeNoiBo: metrics.tyLeNoiBo,
        soChuyenNgay: metrics.soChuyenNgay,
        danhGia: metrics.danhGia,
        source: hq.source,
        ghiChu: hq.ghiChu || ''
      });
    }

    // Sắp xếp: Không đạt trước, theo tỉnh
    results.sort((a, b) => {
      if (a.danhGia !== b.danhGia) return a.danhGia === 'Không đạt' ? -1 : 1;
      return (a.tinhMoi || '').localeCompare(b.tinhMoi || '', 'vi');
    });

    res.json({
      thang, nam,
      total: results.length,
      dat: results.filter(r => r.danhGia === 'Đạt').length,
      khongDat: results.filter(r => r.danhGia === 'Không đạt').length,
      data: results
    });
  } catch (err) {
    console.error('[hieuQua] GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// GET /api/hieu-qua/months
// Danh sách tháng đã có dữ liệu
// ────────────────────────────────────────────
router.get('/months', auth, async (req, res) => {
  try {
    const months = await HieuQua.aggregate([
      { $group: { _id: { thang: '$thang', nam: '$nam' }, count: { $sum: 1 } } },
      { $sort: { '_id.nam': -1, '_id.thang': -1 } }
    ]);
    res.json(months.map(m => ({
      thang: m._id.thang,
      nam: m._id.nam,
      count: m.count
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// POST /api/hieu-qua/save
// Lưu / cập nhật 1 record
// ────────────────────────────────────────────
router.post('/save', auth, async (req, res) => {
  try {
    const { bienSo, thang, nam, km, tongKLVC, klvcNoiBo, ghiChu } = req.body;
    if (!bienSo || !thang || !nam) {
      return res.status(400).json({ error: 'Thiếu biển số, tháng hoặc năm' });
    }

    const bs = normBienSo(bienSo);
    const record = await HieuQua.findOneAndUpdate(
      { bienSo: bs, thang: parseInt(thang), nam: parseInt(nam) },
      {
        $set: {
          km: parseFloat(km) || 0,
          tongKLVC: parseFloat(tongKLVC) || 0,
          klvcNoiBo: parseFloat(klvcNoiBo) || 0,
          ghiChu: ghiChu || '',
          source: 'manual',
          updatedAt: new Date(),
          updatedBy: req.user?.username || 'admin'
        }
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, record });
  } catch (err) {
    console.error('[hieuQua] save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// POST /api/hieu-qua/bulk-save
// Lưu nhiều record cùng lúc (dùng khi import)
// ────────────────────────────────────────────
router.post('/bulk-save', auth, async (req, res) => {
  try {
    const { records } = req.body; // Array of { bienSo, thang, nam, km, tongKLVC, klvcNoiBo }
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu' });
    }

    let saved = 0, skipped = 0, errors = [];

    for (const r of records) {
      try {
        const bs = normBienSo(r.bienSo);
        if (!bs || !r.thang || !r.nam) { skipped++; continue; }

        await HieuQua.findOneAndUpdate(
          { bienSo: bs, thang: parseInt(r.thang), nam: parseInt(r.nam) },
          {
            $set: {
              km: parseFloat(r.km) || 0,
              tongKLVC: parseFloat(r.tongKLVC) || 0,
              klvcNoiBo: parseFloat(r.klvcNoiBo) || 0,
              source: r.source || 'manual',
              ghiChu: r.ghiChu || '',
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
        saved++;
      } catch (e) {
        errors.push({ bienSo: r.bienSo, error: e.message });
      }
    }

    res.json({ ok: true, saved, skipped, errors });
  } catch (err) {
    console.error('[hieuQua] bulk-save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// POST /api/hieu-qua/sync-ntxt
// Đồng bộ từ collection ntxt vào hieu_qua
// (chạy thủ công sau khi nhật trình tháng đã nhập đủ)
// ────────────────────────────────────────────
router.post('/sync-ntxt', auth, async (req, res) => {
  try {
    const thang = parseInt(req.body.thang);
    const nam = parseInt(req.body.nam);
    if (!thang || !nam) return res.status(400).json({ error: 'Thiếu tháng/năm' });

    const db = mongoose.connection.db;
    const ntxtCol = db.collection('ntxt');

    // TODO: Điều chỉnh field names nếu cần
    // Hiện tại thử các variant phổ biến
    const ntxtRecords = await ntxtCol.find({ thang, nam }).toArray();
    if (ntxtRecords.length === 0) {
      return res.json({ ok: true, synced: 0, message: 'Không có dữ liệu ntxt tháng này' });
    }

    let synced = 0;
    for (const nt of ntxtRecords) {
      const bs = normBienSo(nt.bienSo || nt['Biển số'] || '');
      if (!bs) continue;

      // Thử nhiều field name variant
      const km = getField(nt, ['km', 'tongKm', 'totalKm', 'soKm', 'KM']);
      const tongKLVC = getField(nt, [
        'tongKhoi', 'tongKLVC', 'slvc', 'tongKhoiLuong',
        'khoiLuong', 'tongKhoiVanChuyen', 'SLVC', 'tongKhoiVC'
      ]);
      const klvcNoiBo = getField(nt, [
        'khNoiBo', 'klvcNoiBo', 'slvcNoiBo', 'noiBoKhoi',
        'khoiNoiBo', 'khoiLuongNoiBo', 'tongKhoiNoiBo'
      ]);

      await HieuQua.findOneAndUpdate(
        { bienSo: bs, thang, nam },
        { $set: { km, tongKLVC, klvcNoiBo, source: 'ntxt_sync', updatedAt: new Date() } },
        { upsert: true }
      );
      synced++;
    }

    res.json({ ok: true, synced, total: ntxtRecords.length });
  } catch (err) {
    console.error('[hieuQua] sync-ntxt error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// POST /api/hieu-qua/import-excel
// Import dữ liệu lịch sử từ file Excel
// Format: cột theo tháng, hàng theo xe
// ────────────────────────────────────────────
router.post('/import-excel', auth, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'Không có file' });
    }

    const wb = XLSX.read(req.files.file.data, { type: 'buffer' });

    let totalSaved = 0, totalSkipped = 0;
    const sheetErrors = [];

    for (const sheetName of wb.SheetNames) {
      try {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // Tìm header rows
        // Row 0: STT | BIENSỐ | ... | Tháng X/Y | | | | | | Tháng...
        // Row 1: | | ... | Km | SLVC | SLVC nội bộ | Tỷ lệ | Số chuyến | Đánh giá | ...
        if (rows.length < 3) continue;

        // Parse header để tìm vị trí các tháng
        const monthHeaders = []; // [{ thang, nam, colKm, colSLVC, colNoiBo }]

        const row0 = rows[0];
        const row1 = rows[1];

        // Tìm cột bắt đầu data (sau STT, BIENSỐ, ..., Tỉnh)
        for (let col = 0; col < row0.length; col++) {
          const cell = (row0[col] || '').toString();
          // Match "Tháng MM/YYYY" or "Tháng MM/YY"
          const match = cell.match(/[Tt]h[áa]ng\s*(\d{1,2})[\/\-](\d{2,4})/);
          if (match) {
            const thang = parseInt(match[1]);
            const namRaw = parseInt(match[2]);
            const nam = namRaw < 100 ? 2000 + namRaw : namRaw;

            // Tìm sub-columns trong row1 từ col trở đi
            let colKm = -1, colSLVC = -1, colNoiBo = -1;
            for (let c = col; c < Math.min(col + 12, row1.length); c++) {
              const sub = (row1[c] || '').toString().toLowerCase();
              if (colKm === -1 && sub.includes('km')) colKm = c;
              else if (colSLVC === -1 && (sub.includes('slvc') || sub.includes('khối lượng')) && !sub.includes('nội')) colSLVC = c;
              else if (colNoiBo === -1 && (sub.includes('nội') || sub.includes('noi bo'))) colNoiBo = c;
            }

            if (colKm !== -1 || colSLVC !== -1) {
              monthHeaders.push({ thang, nam, colKm, colSLVC, colNoiBo });
            }
          }
        }

        if (monthHeaders.length === 0) continue;

        // Parse từng hàng xe (từ row 2 trở đi)
        for (let rowIdx = 2; rowIdx < rows.length; rowIdx++) {
          const row = rows[rowIdx];
          if (!row || !row[1]) continue;

          const bienSo = normBienSo((row[1] || '').toString());
          if (!bienSo || bienSo.length < 5) continue;

          for (const mh of monthHeaders) {
            const km = parseFloat(mh.colKm !== -1 ? row[mh.colKm] : 0) || 0;
            const tongKLVC = parseFloat(mh.colSLVC !== -1 ? row[mh.colSLVC] : 0) || 0;
            const klvcNoiBo = parseFloat(mh.colNoiBo !== -1 ? row[mh.colNoiBo] : 0) || 0;

            // Bỏ qua nếu không có data thực
            if (km === 0 && tongKLVC === 0) { totalSkipped++; continue; }
            // Bỏ qua nếu dữ liệu có vẻ bất thường (có thể là #REF! → đã thành 0)
            if (tongKLVC < 0) { totalSkipped++; continue; }

            try {
              await HieuQua.findOneAndUpdate(
                { bienSo, thang: mh.thang, nam: mh.nam },
                {
                  $set: {
                    km, tongKLVC, klvcNoiBo,
                    source: 'excel_import',
                    updatedAt: new Date()
                  }
                },
                { upsert: true }
              );
              totalSaved++;
            } catch {
              totalSkipped++;
            }
          }
        }
      } catch (e) {
        sheetErrors.push({ sheet: sheetName, error: e.message });
      }
    }

    res.json({
      ok: true,
      saved: totalSaved,
      skipped: totalSkipped,
      sheets: wb.SheetNames,
      sheetErrors
    });
  } catch (err) {
    console.error('[hieuQua] import-excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// DELETE /api/hieu-qua/:bienSo/:thang/:nam
// Xóa record
// ────────────────────────────────────────────
router.delete('/:bienSo/:thang/:nam', auth, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền' });
    }
    const bs = normBienSo(req.params.bienSo);
    await HieuQua.deleteOne({
      bienSo: bs,
      thang: parseInt(req.params.thang),
      nam: parseInt(req.params.nam)
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────
// GET /api/hieu-qua/analysis?thang=X&nam=Y
// Phân tích xu hướng + dự báo bằng AI
// ────────────────────────────────────────────
router.get('/analysis', auth, async (req, res) => {
  try {
    const thang = parseInt(req.query.thang) || new Date().getMonth() + 1;
    const nam = parseInt(req.query.nam) || new Date().getFullYear();

    // Lấy 6 tháng gần nhất
    const months = [];
    let t = thang, y = nam;
    for (let i = 0; i < 6; i++) {
      months.unshift({ thang: t, nam: y });
      t--;
      if (t === 0) { t = 12; y--; }
    }

    const db = mongoose.connection.db;
    const xetaiCol = db.collection('xetai');
    const allXe = await xetaiCol.find({}).toArray();

    // Build xe map
    const xeMap = {};
    allXe.forEach(xe => {
      const bs = normBienSo(
        xe['BIỂN SỐ'] || xe['BIẼNSỐ'] || xe['Biển số'] || xe.bienSo || ''
      );
      if (bs) xeMap[bs] = xe;
    });

    // Tổng hợp dữ liệu từng tháng
    const monthSummaries = [];
    for (const m of months) {
      const records = await HieuQua.find({ thang: m.thang, nam: m.nam }).lean();
      if (records.length === 0) continue;

      let totalKm = 0, totalKLVC = 0, totalNoiBo = 0;
      let datCount = 0, khongDatCount = 0;
      let totalSoChuyen = 0, countChuyen = 0;

      for (const r of records) {
        const xe = xeMap[normBienSo(r.bienSo)];
        if (!xe) continue;
        const metrics = calcMetrics(xe, r);

        totalKm += r.km || 0;
        totalKLVC += r.tongKLVC || 0;
        totalNoiBo += r.klvcNoiBo || 0;
        if (metrics.soChuyenNgay > 0) {
          totalSoChuyen += metrics.soChuyenNgay;
          countChuyen++;
        }
        if (metrics.danhGia === 'Đạt') datCount++;
        else khongDatCount++;
      }

      const totalXe = datCount + khongDatCount;
      monthSummaries.push({
        label: `${m.thang}/${m.nam}`,
        thang: m.thang,
        nam: m.nam,
        totalXe,
        dat: datCount,
        khongDat: khongDatCount,
        tyLeDat: totalXe > 0 ? ((datCount / totalXe) * 100).toFixed(1) : 0,
        avgKm: totalXe > 0 ? Math.round(totalKm / totalXe) : 0,
        tongKLVC: Math.round(totalKLVC / 1000), // đổi sang tấn
        tyLeNoiBo: totalKLVC > 0 ? ((totalNoiBo / totalKLVC) * 100).toFixed(1) : 0,
        avgSoChuyen: countChuyen > 0 ? (totalSoChuyen / countChuyen).toFixed(2) : 0
      });
    }

    if (monthSummaries.length === 0) {
      return res.json({ analysis: 'Chưa có đủ dữ liệu để phân tích.', monthSummaries: [] });
    }

    // Gọi Claude để phân tích
    const dataText = monthSummaries.map(m =>
      `Tháng ${m.label}: ${m.totalXe} xe | Đạt: ${m.dat} (${m.tyLeDat}%) | TB số chuyến/ngày: ${m.avgSoChuyen} | Tổng KLVC: ${m.tongKLVC} tấn | Tỷ lệ nội bộ: ${m.tyLeNoiBo}%`
    ).join('\n');

    const prompt = `Bạn là chuyên gia phân tích hiệu quả đội xe tải. Dưới đây là dữ liệu hiệu quả hoạt động xe tải của công ty qua ${monthSummaries.length} tháng gần nhất:

${dataText}

Yêu cầu phân tích (bằng tiếng Việt, ngắn gọn, thực tế):

1. **Xu hướng hoạt động**: Nhận xét xu hướng tăng/giảm về tỷ lệ đạt và sản lượng vận chuyển.
2. **Tháng mạnh/yếu**: Xác định tháng hoạt động tốt nhất và yếu nhất, giải thích nguyên nhân có thể.
3. **Dự báo tháng tới**: Dựa trên xu hướng, dự báo tháng ${monthSummaries.length > 0 ? (() => { const last = monthSummaries[monthSummaries.length - 1]; let t = last.thang + 1, y = last.nam; if (t > 12) { t = 1; y++; } return `${t}/${y}`; })() : 'tiếp theo'}.
4. **Khuyến nghị**: 1-2 hành động cụ thể để cải thiện hiệu quả.

Trả lời tối đa 250 từ, sử dụng bullet points.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });

    const analysis = message.content[0]?.text || 'Không thể phân tích.';

    res.json({ analysis, monthSummaries });
  } catch (err) {
    console.error('[hieuQua] analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
