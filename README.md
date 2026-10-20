# ClassManager — Coaching Class Manager

A single-page web app for coaching classes and tuition centers: student
roster, fee tracking with a defaulter list, daily batch-wise attendance,
test marks with per-student progress, printable fee receipts, and an
AI-drafted parent progress message.

## Features

- **Dashboard** — students enrolled, fees collected this month, total dues,
  today's attendance, recent payments, top defaulters.
- **Students** — roster with name, batch, phone, admission date; search;
  add / edit / delete (deleting a student removes their fees, attendance
  and marks too).
- **Fees**
  - Monthly fee plans per batch (e.g. "Class 10 – Morning → ₹1500/month").
  - Record payments (Cash / UPI / Card / Bank transfer) with auto-numbered
    receipts (`RCPT-0001…`).
  - Paid / due computed per student; **defaulter list** sorted by amount due.
  - **Printable fee receipts** via the browser print dialog (receipt-only
    print stylesheet — no app chrome on paper).
- **Attendance** — pick a date and batch, tap Present/Absent per student
  (saves instantly), "mark all present", clear-a-day; lifetime % per
  student shown on the Students tab.
- **Marks** — add tests (name, subject, date, max marks, batch), enter
  scores per student, per-student progress view with average and a
  bar chart of the last 10 tests.
- **✉️ Parent message** — one click builds the student's facts (attendance %,
  30-day test average, fee due) and drafts a warm WhatsApp-style message
  for the parent in English or Hindi. Works offline via a built-in
  template if the AI is unreachable.
- **Settings** — coaching name (appears on receipts), load demo data,
  erase all data.

## How dues are computed

For each student whose batch has a fee plan:

```
expected = (calendar months from admission month through current month) × plan amount
due      = max(0, expected − total paid)
```

Students whose batch has no plan show "no plan" — dues are unknown rather
than silently zero. Payments are never edited or deleted (an audit-friendly
choice for money records); a wrong entry is corrected by recording an
adjusting payment.

## How to run

No build step, no dependencies, no server.

- **Easiest:** open `index.html` in any modern browser.
- **Hosted:** push to GitHub and enable **Settings → Pages → Deploy from
  branch → `main`** — the app is a static site and works as-is.

All data is stored in the browser's `localStorage` (`classmanager-v1` key).
Use **Settings → Load demo data** to explore with a realistic dataset.

## AI integration

The ✉️ button on each student row calls the keyless
[Pollinations](https://pollinations.ai) OpenAI-compatible text endpoint
(`POST https://text.pollinations.ai/openai/v1/chat/completions`,
`model: "openai"`, `private: true`) — the same endpoint used in Briefly
and CodeSense. No API key or signup needed.

How it works (`app.js` → `aiDraft` / `generateParentMessage`):

1. The app computes facts locally: attendance %, average test score over
   the last 30 days, fee due, coaching name.
2. A hidden prompt template asks for a short (<60 words) warm parent
   message in English or Hindi using those facts.
3. The result is editable in the modal with a copy button.

Graceful degradation: on timeout (30s), rate-limit (HTTP 429), or any
network failure, the app falls back to a built-in template built from the
same facts — the feature never hard-fails offline.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure: tab layout, forms, modals, print-only receipt area |
| `styles.css` | All styling incl. the `@media print` receipt stylesheet |
| `app.js` | All logic: storage, fee/attendance/marks math, rendering, AI call |

## Limitations

- Single device / single browser — `localStorage` doesn't sync; ~5 MB cap.
- Fee model is monthly-plans only: no partial months, custom cycles, or
  discounts/scholarships.
- The free AI endpoint has no SLA and can be rate-limited; the fallback
  template covers that.
- Receipts print through the browser — no silent/direct thermal printing.

## Possible extensions

- Export/import JSON or CSV backup; multi-month fee reports.
- Per-student fee ledger view and SMS/WhatsApp deep-link sharing of receipts.
- Discounts, admission fees, and staff salary tracking for a full office suite.

## Interview notes

**What this project is:** ClassManager is a single-page, dependency-free web
app that lets a small coaching class manage students, fees, attendance and
test marks from one screen, with printable fee receipts and an AI-drafted
parent progress message. Everything runs client-side.

**Key technical decisions (and honest reasoning):**

- *Static HTML/CSS/JS, no framework, no build step.* A coaching-class owner
  isn't going to run `npm install`. Zero dependencies means the app opens
  by double-clicking `index.html` and deploys to GitHub Pages with no
  pipeline. The trade-off is hand-written DOM code instead of components —
  acceptable at this size (~700 lines of JS), and it keeps the whole app
  auditable.
- *localStorage instead of a backend.* No accounts, no server costs, works
  offline after first load, and student data never leaves the machine —
  which matters for a product handling children's records. The honest
  trade-offs: no multi-device sync, ~5 MB storage cap, and data loss if the
  browser profile is wiped (hence the demo/erase controls and a documented
  export extension).
- *Dues = months × plan − paid, clamped at zero; "no plan" shown instead of
  ₹0.* Real tuition centers charge per calendar month, and silently showing
  ₹0 due for a batch with no plan would be a lie in a money feature — so
  the unknown case is explicit. Payments are append-only (no edit/delete)
  because editing money records destroys auditability.
- *Receipts via a print-only stylesheet, not a PDF library.* The brief asked
  for "printable receipts via browser print" — a `@media print` rule that
  hides the app and shows only a receipt block achieves it with zero
  dependencies and works on any printer the browser sees.
- *AI via the keyless Pollinations endpoint with a template fallback.*
  Zero-setup AI (no API key for a shop owner to manage) matches the
  no-backend decision; `private: true` keeps student facts out of the
  public feed. Because a free anonymous tier can be rate-limited or down,
  the same facts feed a built-in offline template — the feature degrades,
  never breaks.
- *Pure, DOM-free helper functions* (`studentDue`, `attendancePct`,
  `marksAvg`, …) are separated from rendering so the money/stats math is
  unit-testable — verified with 17 Node assertions covering month-boundary
  fee math, negative-due clamping, attendance percentages, and the 30-day
  marks window.

**Main trade-offs / limitations:** single-browser storage (no sync);
monthly-only fee model; free-tier AI with no SLA; browser-mediated printing.

**How I'd extend it:** JSON/CSV backup + restore; a per-student fee ledger
screen; discounts and admission-fee handling; WhatsApp deep-links to share
receipts/messages; and a tiny sync backend (e.g. Supabase) when the class
outgrows one computer — the pure-function core would carry over unchanged.
