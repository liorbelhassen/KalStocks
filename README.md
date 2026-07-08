# KalStocks

הסבר עממי, מבוסס AI, לתנודות מניות בבורסת תל אביב — דשבורד חי (ירוק/אדום), התראות טלגרם, וסיכום מייל פעמיים ביום.

> נתונים לצורכי מידע בלבד. אינם מהווים ייעוץ השקעות.

## Stack
React 19 + Vite · Firebase (Firestore, Auth, Cloud Functions) · Recharts · Resend · Claude API (web search).

## Quick start
```bash
npm install
cp .env.example .env.local   # fill Firebase values
npm run dev

# functions
cd functions && npm install
npm run serve                # emulator
```

## מבנה
- `src/` — דשבורד React (RTL). כרגע מרנדר מ־`sampleData.js`; שלב 2 מחבר ל־Firestore חי.
- `functions/` — pipeline מתוזמן (poller → detect → explain → notify → digest).
- `PROJECT_MEMORY.md` — מקור האמת לארכיטקטורה, מודל הנתונים והשלבים.

## סטטוס
שלב 0 (scaffold) הושלם. ראה `PROJECT_MEMORY.md` לרשימת השלבים.
