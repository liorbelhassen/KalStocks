// Real-time news context from public Telegram channels (via t.me/s/<channel> — no auth needed).
// Injected into the insight prompts so explanations are grounded in what is ACTUALLY happening
// right now, instead of the model's trained-in assumptions (which caused hallucinations like
// "rocket fire from Gaza"). Channels are configurable via the TELEGRAM_CHANNELS env var.
const DEFAULT_CHANNELS = (typeof process !== 'undefined' && process.env && process.env.TELEGRAM_CHANNELS
  ? process.env.TELEGRAM_CHANNELS
  : 'amitsegal,abualiexpress,hotstocksshells,globesnews,calcalist')
  .split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Fetch recent posts from each channel. Returns a flat array of "[channel] text" strings (newest
// last per channel). Tolerates individual channel failures.
export async function fetchTelegramNews(channels = DEFAULT_CHANNELS, { perChannel = 6, maxChars = 200 } = {}) {
  const results = await Promise.all(
    channels.map(async (ch) => {
      try {
        const r = await fetch(`https://t.me/s/${ch}`, { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } })
        if (!r.ok) return []
        const html = await r.text()
        const posts = [...html.matchAll(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)]
          .map((m) => stripHtml(m[1]))
          .filter((t) => t && t.length > 15)
        return posts.slice(-perChannel).map((t) => `[${ch}] ${t.slice(0, maxChars)}`)
      } catch {
        return []
      }
    }),
  )
  return results.flat()
}

// A prompt-ready Hebrew context block from the latest headlines (or '' if unavailable).
export async function telegramContext(channels) {
  let news = []
  try {
    news = await fetchTelegramNews(channels)
  } catch {
    return ''
  }
  if (!news.length) return ''
  return `\nכותרות חדשות עדכניות מהשעות האחרונות (ערוצי טלגרם — מקור אמת בזמן אמת):
${news.map((n) => `- ${n}`).join('\n')}
התבסס על הכותרות הרלוונטיות כדי לזהות את האירוע הדומיננטי האמיתי המניע את השוק/הנייר. אל תזכיר אירוע (במיוחד ביטחוני) שאינו מופיע בכותרות אלה או שלא אימתת בחיפוש.`
}
