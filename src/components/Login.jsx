import { useState } from 'react'
import { signInWithGoogle } from '../services/auth'

// Full-screen login gate. The whole dashboard sits behind this — a user must sign in with Google
// before they can see or edit their portfolio.
export default function Login() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const onClick = async () => {
    setBusy(true)
    setErr(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      // Popup blocked / closed / network — show a friendly message.
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
        setErr('החלון נסגר לפני השלמת ההתחברות. נסה שוב.')
      } else {
        setErr('ההתחברות נכשלה. בדוק את החיבור ונסה שוב.')
      }
      setBusy(false)
    }
  }

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '40px 34px', maxWidth: 420, width: '100%', textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 6 }}>📈</div>
        <h1 style={{ margin: '0 0 6px', fontSize: 30, fontWeight: 800 }}>StocksInsights</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '0 0 28px', lineHeight: 1.6 }}>
          תובנות על מניות בשפה פשוטה — התיק שלך, ההערכות שלך, במקום אחד.
          <br />
          התחבר כדי לראות ולשמור את התיק שלך.
        </p>

        <button
          onClick={onClick}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            width: '100%', background: '#fff', color: '#3c4043',
            border: '1px solid #dadce0', borderRadius: 10, padding: '12px 16px',
            fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {busy ? 'מתחבר…' : 'התחבר עם Google'}
        </button>

        {err && <div style={{ color: 'var(--down)', fontSize: 13, marginTop: 14 }}>{err}</div>}

        <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 26, lineHeight: 1.6 }}>
          נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות.
        </p>
      </div>
    </div>
  )
}
