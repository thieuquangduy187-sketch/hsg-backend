// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 BACKEND — hsg-backend/src/gpsCron.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BASE = process.env.BACKEND_URL || 'http://localhost:3000'

async function callAPI(path, method = 'POST') {
  try {
    const r = await fetch(`${BASE}${path}`, { method })
    const d = await r.json()
    console.log(`[Cron] ${path}:`, JSON.stringify(d).slice(0, 100))
    return d
  } catch(e) {
    console.error(`[Cron] ${path} error:`, e.message)
    return null
  }
}

function startGpsCron() {
  // Schedule: chạy mỗi phút, kiểm tra giờ
  setInterval(async () => {
    const now  = new Date()
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

    // 05:55 — auto-login lấy token mới trước khi sync
    if (hhmm === '05:55') {
      console.log('[Cron] 05:55 — Auto-login Binhanh...')
      await callAPI('/api/gps/auto-login')
    }

    // 06:00 — sync GPS + camera
    if (hhmm === '06:00') {
      console.log('[Cron] 06:00 — Sync GPS...')
      await callAPI('/api/gps/sync')
      console.log('[Cron] 06:00 — Sync Camera Excel...')
      await callAPI('/api/gps/sync-camera')
    }

    // 17:55 — auto-login lại
    if (hhmm === '17:55') {
      console.log('[Cron] 17:55 — Auto-login Binhanh...')
      await callAPI('/api/gps/auto-login')
    }

    // 18:00 — sync GPS + camera
    if (hhmm === '18:00') {
      console.log('[Cron] 18:00 — Sync GPS...')
      await callAPI('/api/gps/sync')
      console.log('[Cron] 18:00 — Sync Camera Excel...')
      await callAPI('/api/gps/sync-camera')
    }
  }, 60 * 1000)

  console.log('[GPS Cron] Đã khởi động — sync lúc 06:00 và 18:00, auto-login trước 5 phút')
}

module.exports = { startGpsCron }
