const router = require('express').Router()
const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── POST /api/analyze/pr — phân tích ảnh PR từ Oracle EBS ────────────────────
// Body: { images: [ { base64: "...", mediaType: "image/jpeg" }, ... ] }
router.post('/pr', async (req, res) => {
  try {
    const { images } = req.body
    if (!images || !images.length) {
      return res.status(400).json({ error: 'Không có ảnh để phân tích.' })
    }
    if (images.length > 10) {
      return res.status(400).json({ error: 'Tối đa 10 ảnh mỗi lần.' })
    }

    // Build message content với tất cả ảnh
    const content = []

    // Thêm tất cả ảnh vào content
    images.forEach((img, i) => {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType || 'image/jpeg',
          data: img.base64,
        }
      })
      content.push({
        type: 'text',
        text: `Ảnh ${i + 1}:`
      })
    })

    // Prompt phân tích
    content.push({
      type: 'text',
      text: `Bạn là chuyên gia phân tích chi phí xe tải cho công ty Hoa Sen Home.

Phân tích TẤT CẢ các ảnh PR (Purchase Requisition) từ Oracle E-Business Suite trên và trả về JSON theo đúng format sau, KHÔNG thêm text ngoài JSON:

{
  "prs": [
    {
      "prNumber": "số PR",
      "cuaHang": "tên cửa hàng (phần sau CN trong tên)",
      "bienSo": "biển số xe (tìm trong Description hoặc Requisition Lines)",
      "hangMuc": "mô tả hạng mục sửa chữa/bảo dưỡng ngắn gọn",
      "chiPhi": 0,
      "ngayGui": "dd/mm/yyyy",
      "trangThai": "Pending|In Process|Approved",
      "nguoiGui": "tên người/đơn vị gửi",
      "kmHienTai": 0,
      "ghiChu": "thông tin thêm nếu có",
      "batThuong": [
        "mô tả điểm bất thường nếu có (trùng lặp, chi phí cao, xe không đi được...)"
      ],
      "mucDoRuiRo": "thấp|trung bình|cao"
    }
  ],
  "tongChiPhi": 0,
  "tomTat": "tóm tắt ngắn gọn tổng thể",
  "canhBao": ["danh sách cảnh báo quan trọng cần chú ý"]
}

Quy tắc phân tích:
- Chi phí > 10 triệu: mucDoRuiRo = "cao"
- Chi phí 5-10 triệu: mucDoRuiRo = "trung bình"  
- Chi phí < 5 triệu: mucDoRuiRo = "thấp"
- Nếu 2 PR cùng biển số + cùng số tiền: batThuong = ["PR có thể trùng lặp"]
- Nếu xe không di chuyển được / nằm gara: ghi vào batThuong
- Nếu có ghi chú không chuyên nghiệp: ghi vào batThuong
- kmHienTai: lấy số KM nếu có trong description, không có thì 0
- bienSo: đọc chính xác biển số theo đúng format biển số Việt Nam (XX/XXX-YYY.YY)
- Nếu có nhiều biển số: liệt kê tất cả, cách nhau bằng dấu phẩy
- Nếu biển số trong Description khác với Requisition Lines: ưu tiên lấy theo Requisition Lines`
    })

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content }]
    })

    const text = response.content[0].text.trim()

    // Parse JSON từ response
    let result
    try {
      // Xử lý trường hợp Claude wrap trong ```json
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/({[\s\S]*})/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text
      result = JSON.parse(jsonStr)
    } catch(e) {
      return res.status(500).json({
        error: 'Không parse được kết quả AI',
        raw: text
      })
    }

    res.json(result)
  } catch(e) {
    if (e.status === 401) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY không hợp lệ.' })
    }
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/analyze/save — lưu kết quả phân tích vào MongoDB ────────────────
router.post('/save', async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const db = mongoose.connection.db
    const col = db.collection('sua_chua')

    const { prs } = req.body
    if (!prs?.length) return res.status(400).json({ error: 'Không có dữ liệu.' })

    const results = { added: 0, updated: 0, errors: [] }

    for (const pr of prs) {
      try {
        const doc = {
          prNumber:    pr.prNumber,
          cuaHang:     pr.cuaHang,
          bienSo:      pr.bienSo,
          hangMuc:     pr.hangMuc,
          chiPhi:      pr.chiPhi,
          ngayGui:     pr.ngayGui,
          trangThai:   pr.trangThai,
          nguoiGui:    pr.nguoiGui,
          kmHienTai:   pr.kmHienTai || 0,
          ghiChu:      pr.ghiChu || '',
          batThuong:   pr.batThuong || [],
          mucDoRuiRo:  pr.mucDoRuiRo,
          nguonDuLieu: 'AI_ERP_IMAGE',
          ngayImport:  new Date().toISOString(),
        }

        const existing = await col.findOne({ prNumber: pr.prNumber })
        if (existing) {
          await col.updateOne({ _id: existing._id }, { $set: doc })
          results.updated++
        } else {
          await col.insertOne(doc)
          results.added++
        }
      } catch(e) {
        results.errors.push({ pr: pr.prNumber, error: e.message })
      }
    }

    res.json({
      success: true,
      message: `Đã lưu: ${results.added} mới, ${results.updated} cập nhật`,
      ...results
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
