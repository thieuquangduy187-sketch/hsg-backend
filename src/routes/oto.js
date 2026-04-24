const router = require('express').Router()
const Oto = require('../models/Oto')

// GET /api/oto — danh sách ô tô con
router.get('/', async (req, res) => {
  try {
    const { search = '', mien = '' } = req.query
    const filter = {}
    if (search) {
      filter.$or = [
        { 'Biển số':         { $regex: search, $options: 'i' } },
        { 'BIỂN SỐ':         { $regex: search, $options: 'i' } },
        { 'Nhãn hiệu':       { $regex: search, $options: 'i' } },
        { 'Đơn vị sử dụng':  { $regex: search, $options: 'i' } },
      ]
    }
    if (mien) filter['Miền'] = mien
    const docs = await Oto.find(filter).sort({ STT: 1 })
    res.json(docs.map(d => d.toAPI()))
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/oto/raw — xem 1 document thô
router.get('/raw', async (req, res) => {
  try {
    const doc = await Oto.findOne({}).lean()
    res.json(doc)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/oto/keys — xem tên tất cả fields
router.get('/keys', async (req, res) => {
  try {
    const doc = await Oto.findOne({}).lean()
    if (!doc) return res.json({ keys: [], message: 'Collection rỗng' })
    const keys = Object.keys(doc).map(k => ({
      repr: JSON.stringify(k),
      val:  String(doc[k]).substring(0, 50)
    }))
    res.json({ total: await Oto.countDocuments(), keys })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
