// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/gpsCron.js
// Gọi hàm này từ index.js sau khi mongoose connect
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SYNC_URL = process.env.BACKEND_URL
  ? `${process.env.BACKEND_URL}/api/gps/sync`
  : 'http://localhost:3000/api/gps/sync'

function startGpsCron() {
  // Chạy lúc 6:00 và 18:00 mỗi ngày
  const INTERVALS = ['06:00', '18:00']

  const checkAndRun = () => {
    const now  = new Date()
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (INTERVALS.includes(hhmm)) {
      console.log(`[GPS Cron] ${hhmm} — bắt đầu sync...`)
      fetch(SYNC_URL, { method: 'POST' })
        .then(r => r.json())
        .then(d => console.log(`[GPS Cron] Sync xong:`, d.total, 'xe,', d.online, 'online'))
        .catch(e => console.error('[GPS Cron] Lỗi:', e.message))
    }
  }

  // Check mỗi phút
  setInterval(checkAndRun, 60 * 1000)
  console.log('[GPS Cron] Đã khởi động — sync lúc 06:00 và 18:00 hàng ngày')
}

module.exports = { startGpsCron }
