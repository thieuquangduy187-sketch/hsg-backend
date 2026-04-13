const router = require('express').Router()
const Oto = require('../models/Oto')

// GET /api/oto — danh sách ô tô con
router.get('/', async (req, res) => {
  try {
    const { search = '', mien = '' } = req.query
    const filter = {}
    if (search) {
      filter.$or = [
        { 'Biển số': { $regex: search, $options: 'i' } },
        { 'Nhãn hiệu': { $regex: search, $options: 'i' } },
        { 'Đơn vị sử dụng': { $regex: search, $options: 'i' } },
      ]
    }
    if (mien) filter['Miền'] = mien

    const docs = await Oto.find(filter).sort({ STT: 1 })
    res.json(docs.map(d => d.toAPI()))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
