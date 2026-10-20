/*
 * ClassManager — coaching class manager (single-page web app).
 *
 * No build step, no dependencies, no backend. All data lives in
 * localStorage under STORE_KEY, so the app works offline after the
 * first load and can be hosted as-is on GitHub Pages.
 *
 * The "pure" helpers below touch neither DOM nor storage on purpose:
 * they take plain data arguments, which makes them unit-testable
 * (they run in Node too — the DOM wiring is guarded at the bottom).
 */

// ============================ Pure helpers ============================

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad2(n) { return String(n).padStart(2, "0"); }

// "YYYY-MM-DD" in the *local* timezone. Optional Date override (for tests).
function todayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
}

// "2026-10-20" -> "20 Oct 2026"
function fmtDate(iso) {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return Number(parts[2]) + " " + months[Number(parts[1]) - 1] + " " + parts[0];
}

function fmtINR(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

// Whole calendar months from startIso's month through endIso's month, inclusive.
// Returns 0 when start is after end.
function monthsBetweenInclusive(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = startIso.split("-").map(Number);
  const e = endIso.split("-").map(Number);
  const diff = (e[0] - s[0]) * 12 + (e[1] - s[1]) + 1;
  return diff > 0 ? diff : 0;
}

function receiptNo(seq) {
  return "RCPT-" + String(seq).padStart(4, "0");
}

function normBatch(b) { return String(b || "").trim().toLowerCase(); }

function planForBatch(plans, batch) {
  const want = normBatch(batch);
  return plans.find(function (p) { return normBatch(p.batch) === want; }) || null;
}

// Total fee the student *should* have paid up to asOf ("YYYY-MM-DD").
// null when their batch has no fee plan defined.
function studentExpected(student, plans, asOf) {
  const plan = planForBatch(plans, student.batch);
  if (!plan) return null;
  return monthsBetweenInclusive(student.admitted, asOf) * Number(plan.amount || 0);
}

function studentPaid(payments, studentId) {
  return payments
    .filter(function (p) { return p.studentId === studentId; })
    .reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);
}

// Fee still owed. null = no fee plan for this batch (dues unknown).
function studentDue(student, plans, payments, asOf) {
  const expected = studentExpected(student, plans, asOf);
  if (expected === null) return null;
  return Math.max(0, expected - studentPaid(payments, student.id));
}

// Lifetime attendance %, or null when nothing is marked yet.
function attendancePct(records, studentId) {
  const mine = records.filter(function (r) { return r.studentId === studentId; });
  if (!mine.length) return null;
  const present = mine.filter(function (r) { return r.present; }).length;
  return Math.round((present / mine.length) * 100);
}

function dayAttendance(records, dateStr) {
  const day = records.filter(function (r) { return r.date === dateStr; });
  const present = day.filter(function (r) { return r.present; }).length;
  return { marked: day.length, present: present };
}

// Average score % across tests dated within the last `days` days (ending asOf).
// Returns null when the student has no scored tests in the window.
function marksAvg(tests, marks, studentId, days, asOf) {
  const end = asOf || todayStr();
  const startParts = end.split("-").map(Number);
  const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  startDate.setDate(startDate.getDate() - (days - 1));
  const start = todayStr(startDate);

  const byId = {};
  tests.forEach(function (t) { byId[t.id] = t; });

  const pcts = marks
    .filter(function (m) { return m.studentId === studentId; })
    .map(function (m) { return { score: Number(m.score), test: byId[m.testId] }; })
    .filter(function (x) {
      return x.test && x.test.date >= start && x.test.date <= end && Number(x.test.maxMarks) > 0;
    })
    .map(function (x) { return (x.score / Number(x.test.maxMarks)) * 100; });

  if (!pcts.length) return null;
  return Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length);
}

function monthPrefix(dateStr) { return String(dateStr || "").slice(0, 7); } // "YYYY-MM"

// ============================ Storage ============================

var STORE_KEY = "classmanager-v1";

function defaultState() {
  return {
    students: [],      // {id, name, batch, phone, admitted}
    plans: [],         // {batch, amount}  — monthly fee per batch
    payments: [],      // {id, studentId, amount, date, mode, receipt}
    attendance: [],    // {studentId, date, present}
    tests: [],         // {id, name, subject, date, maxMarks, batch}
    marks: [],         // {testId, studentId, score}
    settings: { coachingName: "Sunrise Coaching Classes" },
    seq: { receipt: 1 }
  };
}

function loadState() {
  try {
    var raw = (typeof localStorage !== "undefined") ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.students)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage full/blocked */ }
}

// Demo dataset so the app can be explored (and screenshotted) immediately.
function demoData() {
  var s = defaultState();
  s.settings.coachingName = "Sunrise Coaching Classes";
  s.plans = [
    { batch: "Class 10 – Morning", amount: 1500 },
    { batch: "Class 12 – Evening", amount: 2000 }
  ];
  var a = uid(), b = uid(), c = uid(), d = uid(), e = uid();
  s.students = [
    { id: a, name: "Rohan Patil",   batch: "Class 10 – Morning", phone: "9822012345", admitted: "2026-08-05" },
    { id: b, name: "Sneha Deshmukh", batch: "Class 10 – Morning", phone: "9822067890", admitted: "2026-08-05" },
    { id: c, name: "Amit Joshi",    batch: "Class 10 – Morning", phone: "9822034567", admitted: "2026-09-12" },
    { id: d, name: "Priya Nair",    batch: "Class 12 – Evening", phone: "9822098765", admitted: "2026-07-01" },
    { id: e, name: "Kunal Rane",    batch: "Class 12 – Evening", phone: "9822043210", admitted: "2026-10-02" }
  ];
  // A few days of attendance for the Morning batch.
  var days = [], t = new Date();
  for (var i = 1; i <= 5; i++) { var dd = new Date(t); dd.setDate(dd.getDate() - i); days.push(todayStr(dd)); }
  [a, b, c].forEach(function (sid, idx) {
    days.forEach(function (day, di) {
      s.attendance.push({ studentId: sid, date: day, present: !(idx === 2 && di === 1) });
    });
  });
  var t1 = uid(), t2 = uid();
  s.tests = [
    { id: t1, name: "Maths Unit Test 1", subject: "Maths", date: days[4], maxMarks: 50, batch: "Class 10 – Morning" },
    { id: t2, name: "Science Unit Test 1", subject: "Science", date: days[2], maxMarks: 50, batch: "Class 10 – Morning" }
  ];
  s.marks = [
    { testId: t1, studentId: a, score: 42 }, { testId: t1, studentId: b, score: 47 }, { testId: t1, studentId: c, score: 31 },
    { testId: t2, studentId: a, score: 39 }, { testId: t2, studentId: b, score: 44 }, { testId: t2, studentId: c, score: 28 }
  ];
  s.payments = [
    { id: uid(), studentId: a, amount: 3000, date: days[3], mode: "UPI",  receipt: receiptNo(s.seq.receipt++) },
    { id: uid(), studentId: d, amount: 4000, date: days[1], mode: "Cash", receipt: receiptNo(s.seq.receipt++) },
    { id: uid(), studentId: b, amount: 1500, date: todayStr(), mode: "Cash", receipt: receiptNo(s.seq.receipt++) }
  ];
  return s;
}

// ============================ AI: parent message ============================

// Keyless Pollinations OpenAI-compatible endpoint (same one Briefly and
// CodeSense use). No API key, no signup; `private: true` keeps the text out
// of Pollinations' public feed. The prompt template is intentionally hidden
// from the UI; only the generated message is shown.
var AI_URL = "https://text.pollinations.ai/openai/v1/chat/completions";
var AI_TIMEOUT_MS = 30000;

function aiDraft(promptText) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, AI_TIMEOUT_MS);
  return fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: "openai",
      private: true,
      messages: [{ role: "user", content: promptText }]
    })
  }).then(function (res) {
    if (res.status === 429) throw new Error("rate-limited");
    if (!res.ok) throw new Error("http-" + res.status);
    return res.json();
  }).then(function (data) {
    var c = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
    if (!c || !c.trim()) throw new Error("empty");
    return c.trim();
  }).finally(function () { clearTimeout(timer); });
}

// Offline-safe fallback: a plain template from the same facts the AI would use.
function parentMessageTemplate(student, facts, lang) {
  var name = student.name;
  if (lang === "hi") {
    return "नमस्ते, " + name + " की इस महीने की प्रगति: उपस्थिति " +
      facts.attendance + ", टेस्ट औसत " + facts.marks + "। " +
      (facts.dueNote ? facts.dueNoteHi + " " : "") +
      "धन्यवाद — " + facts.coaching + "।";
  }
  return "Hello, here is " + name + "'s progress this month: attendance " +
    facts.attendance + ", test average " + facts.marks + ". " +
    (facts.dueNote ? facts.dueNote + " " : "") +
    "Thank you — " + facts.coaching + ".";
}

function parentFacts(studentId, state, asOf) {
  var st = state.students.find(function (x) { return x.id === studentId; });
  var att = attendancePct(state.attendance, studentId);
  var avg = marksAvg(state.tests, state.marks, studentId, 30, asOf);
  var due = studentDue(st, state.plans, state.payments, asOf);
  return {
    student: st,
    attendance: att === null ? "not marked yet" : att + "%",
    marks: avg === null ? "no tests yet" : avg + "%",
    dueNote: (due !== null && due > 0) ? ("Fee due: " + fmtINR(due) + ".") : "",
    dueNoteHi: (due !== null && due > 0) ? ("बकाया फीस: " + fmtINR(due) + "।") : "",
    coaching: state.settings.coachingName || "the class"
  };
}

// ============================ DOM app ============================
// Everything below runs only in a browser (guarded at the bottom).

var state = null;
var editingStudentId = null;
var parentStudentId = null;

function allBatches() {
  var set = {};
  state.students.forEach(function (s) { if (s.batch) set[s.batch] = 1; });
  state.plans.forEach(function (p) { if (p.batch) set[p.batch] = 1; });
  return Object.keys(set).sort();
}

function studentName(id) {
  var st = state.students.find(function (x) { return x.id === id; });
  return st ? st.name : "—";
}

function pctPill(pct) {
  if (pct === null) return '<span class="pill info">—</span>';
  var cls = pct >= 75 ? "ok" : (pct >= 50 ? "warn" : "bad");
  return '<span class="pill ' + cls + '">' + pct + "%</span>";
}

function dueCell(st, asOf) {
  var due = studentDue(st, state.plans, state.payments, asOf);
  if (due === null) return '<span class="muted">no plan</span>';
  if (due === 0) return '<span class="pill ok">clear</span>';
  return '<span class="pill bad">' + fmtINR(due) + "</span>";
}

// ---------- tab switching ----------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-pane").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

// ---------- dashboard ----------
function renderDashboard() {
  var asOf = todayStr();
  var month = monthPrefix(asOf);
  var collected = state.payments
    .filter(function (p) { return monthPrefix(p.date) === month; })
    .reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
  var dues = state.students.reduce(function (s, st) {
    var d = studentDue(st, state.plans, state.payments, asOf);
    return s + (d || 0);
  }, 0);
  var day = dayAttendance(state.attendance, asOf);

  document.getElementById("dash-stats").innerHTML =
    statCard("Students", state.students.length, state.students.length + " enrolled", "") +
    statCard("Collected this month", fmtINR(collected), month, "good") +
    statCard("Total dues", fmtINR(dues), dues > 0 ? "needs follow-up" : "all clear", dues > 0 ? "bad" : "good") +
    statCard("Today's attendance",
      day.marked ? Math.round(day.present / day.marked * 100) + "%" : "—",
      day.marked ? day.present + " / " + day.marked + " present" : "not marked yet", "");

  var recent = state.payments.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
  document.getElementById("dash-recent-payments").innerHTML = recent.length
    ? "<table><tbody>" + recent.map(function (p) {
        return "<tr><td>" + fmtDate(p.date) + "</td><td>" + esc(studentName(p.studentId)) +
               "</td><td><strong>" + fmtINR(p.amount) + "</strong></td></tr>";
      }).join("") + "</tbody></table>"
    : '<p class="muted">No payments recorded yet.</p>';

  var defaulters = state.students
    .map(function (st) { return { st: st, due: studentDue(st, state.plans, state.payments, asOf) }; })
    .filter(function (x) { return x.due !== null && x.due > 0; })
    .sort(function (a, b) { return b.due - a.due; })
    .slice(0, 5);
  document.getElementById("dash-defaulters").innerHTML = defaulters.length
    ? "<table><tbody>" + defaulters.map(function (x) {
        return "<tr><td>" + esc(x.st.name) + "</td><td class='muted'>" + esc(x.st.batch) +
               "</td><td><strong>" + fmtINR(x.due) + "</strong></td></tr>";
      }).join("") + "</tbody></table>"
    : '<p class="muted">No dues — everyone is paid up. 🎉</p>';
}

function statCard(k, v, s, cls) {
  return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v ' + cls + '">' +
         esc(v) + '</div><div class="s">' + esc(s) + "</div></div>";
}

// ---------- students ----------
function renderStudents() {
  var q = document.getElementById("student-search").value.trim().toLowerCase();
  var asOf = todayStr();
  var rows = state.students.filter(function (st) {
    return !q || st.name.toLowerCase().includes(q) ||
           (st.batch || "").toLowerCase().includes(q) ||
           (st.phone || "").toLowerCase().includes(q);
  });
  document.getElementById("students-tbody").innerHTML = rows.map(function (st) {
    var att = attendancePct(state.attendance, st.id);
    return "<tr><td><strong>" + esc(st.name) + "</strong></td>" +
      "<td>" + esc(st.batch) + "</td>" +
      "<td>" + esc(st.phone || "—") + "</td>" +
      "<td>" + fmtDate(st.admitted) + "</td>" +
      "<td>" + dueCell(st, asOf) + "</td>" +
      "<td>" + pctPill(att) + "</td>" +
      "<td style='white-space:nowrap'>" +
        "<button class='btn small' data-act='msg' data-id='" + st.id + "' title='AI parent message'>✉️</button> " +
        "<button class='btn small' data-act='edit' data-id='" + st.id + "'>Edit</button> " +
        "<button class='btn small danger' data-act='del' data-id='" + st.id + "'>Delete</button>" +
      "</td></tr>";
  }).join("") || '<tr><td colspan="7" class="muted">No students yet — add your first one.</td></tr>';

  document.getElementById("students-tbody").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.dataset.id;
      if (b.dataset.act === "edit") openStudentModal(id);
      else if (b.dataset.act === "del") deleteStudent(id);
      else if (b.dataset.act === "msg") openParentModal(id);
    });
  });
}

function openStudentModal(id) {
  editingStudentId = id || null;
  var st = id ? state.students.find(function (x) { return x.id === id; }) : null;
  document.getElementById("student-modal-title").textContent = st ? "Edit student" : "Add student";
  document.getElementById("st-name").value = st ? st.name : "";
  document.getElementById("st-batch").value = st ? st.batch : "";
  document.getElementById("st-phone").value = st ? (st.phone || "") : "";
  document.getElementById("st-admitted").value = st ? st.admitted : todayStr();
  document.getElementById("batch-datalist").innerHTML =
    allBatches().map(function (b) { return "<option value='" + esc(b) + "'>"; }).join("");
  document.getElementById("student-modal").classList.remove("hidden");
}

function saveStudentModal() {
  var name = document.getElementById("st-name").value.trim();
  var batch = document.getElementById("st-batch").value.trim();
  if (!name) { alert("Name is required."); return; }
  if (!batch) { alert("Batch is required (it links the student to a fee plan)."); return; }
  var data = {
    name: name,
    batch: batch,
    phone: document.getElementById("st-phone").value.trim(),
    admitted: document.getElementById("st-admitted").value || todayStr()
  };
  if (editingStudentId) {
    Object.assign(state.students.find(function (x) { return x.id === editingStudentId; }), data);
  } else {
    state.students.push(Object.assign({ id: uid() }, data));
  }
  saveState(state);
  document.getElementById("student-modal").classList.add("hidden");
  renderAll();
}

function deleteStudent(id) {
  var st = state.students.find(function (x) { return x.id === id; });
  if (!st || !confirm("Delete " + st.name + " and all their fees, attendance and marks?")) return;
  state.students = state.students.filter(function (x) { return x.id !== id; });
  state.payments = state.payments.filter(function (p) { return p.studentId !== id; });
  state.attendance = state.attendance.filter(function (r) { return r.studentId !== id; });
  state.marks = state.marks.filter(function (m) { return m.studentId !== id; });
  saveState(state);
  renderAll();
}

// ---------- fees ----------
function renderFees() {
  var asOf = todayStr();

  document.getElementById("plans-list").innerHTML = state.plans.length
    ? state.plans.map(function (p, i) {
        return "<div class='att-row'><span><strong>" + esc(p.batch) + "</strong> — " +
               fmtINR(p.amount) + "/month</span>" +
               "<button class='btn small danger' data-plan='" + i + "'>Delete</button></div>";
      }).join("")
    : '<p class="muted">No fee plans yet. Add one per batch — dues are computed from these.</p>';
  document.getElementById("plans-list").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (confirm("Delete this fee plan? Existing dues will show as “no plan”."))
        { state.plans.splice(Number(b.dataset.plan), 1); saveState(state); renderAll(); }
    });
  });

  document.getElementById("pay-student").innerHTML = state.students.map(function (st) {
    return "<option value='" + st.id + "'>" + esc(st.name) + " (" + esc(st.batch) + ")</option>";
  }).join("");
  document.getElementById("pay-date").value = todayStr();

  var defaulters = state.students
    .map(function (st) { return { st: st, due: studentDue(st, state.plans, state.payments, asOf) }; })
    .filter(function (x) { return x.due !== null && x.due > 0; })
    .sort(function (a, b) { return b.due - a.due; });
  document.getElementById("defaulters-tbody").innerHTML = defaulters.map(function (x) {
    var exp = studentExpected(x.st, state.plans, asOf);
    var paid = studentPaid(state.payments, x.st.id);
    return "<tr><td><strong>" + esc(x.st.name) + "</strong></td><td>" + esc(x.st.batch) + "</td>" +
      "<td>" + esc(x.st.phone || "—") + "</td><td>" + fmtINR(exp) + "</td><td>" + fmtINR(paid) +
      "</td><td><strong>" + fmtINR(x.due) + "</strong></td></tr>";
  }).join("") || '<tr><td colspan="6" class="muted">No defaulters. 🎉</td></tr>';

  var pays = state.payments.slice().sort(function (a, b) {
    return (b.date + b.receipt).localeCompare(a.date + a.receipt);
  });
  document.getElementById("payments-tbody").innerHTML = pays.map(function (p) {
    return "<tr><td>" + esc(p.receipt) + "</td><td>" + fmtDate(p.date) + "</td>" +
      "<td>" + esc(studentName(p.studentId)) + "</td><td><strong>" + fmtINR(p.amount) + "</strong></td>" +
      "<td>" + esc(p.mode) + "</td>" +
      "<td><button class='btn small' data-print='" + p.id + "'>🖨 Receipt</button></td></tr>";
  }).join("") || '<tr><td colspan="6" class="muted">No payments recorded yet.</td></tr>';
  document.getElementById("payments-tbody").querySelectorAll("[data-print]").forEach(function (b) {
    b.addEventListener("click", function () { printReceipt(b.dataset.print); });
  });
}

function savePlan() {
  var batch = document.getElementById("plan-batch").value.trim();
  var amount = Number(document.getElementById("plan-amount").value);
  if (!batch) { alert("Batch name is required."); return; }
  if (!(amount > 0)) { alert("Enter a valid monthly amount."); return; }
  var existing = planForBatch(state.plans, batch);
  if (existing) existing.amount = amount;
  else state.plans.push({ batch: batch, amount: amount });
  document.getElementById("plan-batch").value = "";
  document.getElementById("plan-amount").value = "";
  saveState(state);
  renderAll();
}

function savePayment() {
  var studentId = document.getElementById("pay-student").value;
  var amount = Number(document.getElementById("pay-amount").value);
  if (!studentId) { alert("Add a student first."); return; }
  if (!(amount > 0)) { alert("Enter a valid amount."); return; }
  var p = {
    id: uid(),
    studentId: studentId,
    amount: amount,
    date: document.getElementById("pay-date").value || todayStr(),
    mode: document.getElementById("pay-mode").value,
    receipt: receiptNo(state.seq.receipt++)
  };
  state.payments.push(p);
  document.getElementById("pay-amount").value = "";
  saveState(state);
  renderAll();
  printReceipt(p.id); // record at the counter, hand over the receipt
}

// ---------- receipt printing (browser print, receipt-only stylesheet) ----------
function printReceipt(paymentId) {
  var p = state.payments.find(function (x) { return x.id === paymentId; });
  if (!p) return;
  var st = state.students.find(function (x) { return x.id === p.studentId; });
  var coaching = esc(state.settings.coachingName || "Coaching Class");
  document.getElementById("print-area").innerHTML =
    "<div class='receipt'>" +
    "<h2>" + coaching + "</h2>" +
    "<h3>FEE RECEIPT</h3><hr>" +
    "<div class='r-row'><span>Receipt:</span><strong>" + esc(p.receipt) + "</strong></div>" +
    "<div class='r-row'><span>Date:</span><span>" + fmtDate(p.date) + "</span></div>" +
    "<div class='r-row'><span>Student:</span><span>" + esc(st ? st.name : "—") + "</span></div>" +
    "<div class='r-row'><span>Batch:</span><span>" + esc(st ? st.batch : "—") + "</span></div>" +
    "<hr>" +
    "<div class='r-row'><span>Amount:</span><strong>" + fmtINR(p.amount) + "</strong></div>" +
    "<div class='r-row'><span>Mode:</span><span>" + esc(p.mode) + "</span></div>" +
    "<hr><p class='center'>Thank you!</p>" +
    "</div>";
  window.print();
}

// ---------- attendance ----------
function renderAttendance() {
  var dateEl = document.getElementById("att-date");
  if (!dateEl.value) dateEl.value = todayStr();
  var batches = allBatches();
  var batchEl = document.getElementById("att-batch");
  batchEl.innerHTML = batches.map(function (b) {
    return "<option" + (b === batchEl.value ? " selected" : "") + ">" + esc(b) + "</option>";
  }).join("");
  var batch = batchEl.value || batches[0] || "";

  var students = state.students.filter(function (s) { return s.batch === batch; });
  var recById = {};
  state.attendance.forEach(function (r) {
    if (r.date === dateEl.value) recById[r.studentId] = r.present;
  });

  document.getElementById("att-list").innerHTML = students.length
    ? students.map(function (st) {
        var v = recById[st.id];
        return "<div class='att-row'><span class='att-name'>" + esc(st.name) + "</span>" +
          "<span class='seg'>" +
          "<button class='btn small" + (v === true ? " active-p" : "") + "' data-att='1' data-id='" + st.id + "'>Present</button>" +
          "<button class='btn small" + (v === false ? " active-a" : "") + "' data-att='0' data-id='" + st.id + "'>Absent</button>" +
          "</span></div>";
      }).join("")
    : '<p class="muted">No students in this batch.</p>';

  document.getElementById("att-list").querySelectorAll("[data-att]").forEach(function (b) {
    b.addEventListener("click", function () {
      setAttendance(b.dataset.id, dateEl.value, b.dataset.att === "1");
    });
  });

  var marked = students.filter(function (st) { return recById[st.id] !== undefined; });
  var present = marked.filter(function (st) { return recById[st.id] === true; });
  document.getElementById("att-summary").innerHTML =
    "<p><strong>" + present.length + " / " + marked.length + "</strong> marked present " +
    (marked.length ? "(" + Math.round(present.length / marked.length * 100) + "%)" : "") + "</p>" +
    "<p class='muted small'>Per-student lifetime % is shown on the Students tab.</p>";
}

function setAttendance(studentId, date, present) {
  var existing = state.attendance.find(function (r) { return r.studentId === studentId && r.date === date; });
  if (existing) existing.present = present;
  else state.attendance.push({ studentId: studentId, date: date, present: present });
  saveState(state);
  renderAttendance();
  renderDashboard();
}

// ---------- marks ----------
function renderMarks() {
  var batches = ["<option value=''>All students</option>"].concat(allBatches().map(function (b) {
    return "<option>" + esc(b) + "</option>";
  }));
  document.getElementById("test-batch").innerHTML = batches.join("");
  if (!document.getElementById("test-date").value)
    document.getElementById("test-date").value = todayStr();

  document.getElementById("prog-student").innerHTML = state.students.map(function (st) {
    return "<option value='" + st.id + "'>" + esc(st.name) + " (" + esc(st.batch) + ")</option>";
  }).join("");
  renderProgress();

  var tests = state.tests.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  document.getElementById("tests-list").innerHTML = tests.map(function (t) {
    var students = state.students.filter(function (s) { return !t.batch || s.batch === t.batch; });
    var markById = {};
    state.marks.forEach(function (m) { if (m.testId === t.id) markById[m.studentId] = m.score; });
    var rows = students.map(function (st) {
      return "<div class='score-row'><span>" + esc(st.name) + "</span>" +
        "<input type='number' min='0' max='" + t.maxMarks + "' data-test='" + t.id + "' data-student='" + st.id +
        "' value='" + (markById[st.id] == null ? "" : markById[st.id]) + "' placeholder='—' />" +
        "<span class='muted small'>/ " + t.maxMarks + "</span></div>";
    }).join("");
    return "<div class='panel'><h2>" + esc(t.name) +
      " <span class='muted small'>" + esc(t.subject || "") + " · " + fmtDate(t.date) +
      " · max " + t.maxMarks + (t.batch ? " · " + esc(t.batch) : "") + "</span>" +
      " <button class='btn small danger' data-deltest='" + t.id + "' style='float:right'>Delete</button></h2>" +
      (rows || "<p class='muted'>No students match this test's batch.</p>") +
      (rows ? "<button class='btn primary' data-savetest='" + t.id + "' style='margin-top:10px'>Save scores</button>" : "") +
      "</div>";
  }).join("") || '<p class="muted">No tests yet.</p>';

  document.getElementById("tests-list").querySelectorAll("[data-savetest]").forEach(function (b) {
    b.addEventListener("click", function () { saveScores(b.dataset.savetest); });
  });
  document.getElementById("tests-list").querySelectorAll("[data-deltest]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!confirm("Delete this test and all its scores?")) return;
      state.tests = state.tests.filter(function (t) { return t.id !== b.dataset.deltest; });
      state.marks = state.marks.filter(function (m) { return m.testId !== b.dataset.deltest; });
      saveState(state); renderAll();
    });
  });
}

function saveScores(testId) {
  var t = state.tests.find(function (x) { return x.id === testId; });
  document.getElementById("tests-list").querySelectorAll("input[data-test='" + testId + "']").forEach(function (inp) {
    var sid = inp.dataset.student;
    var val = inp.value.trim();
    var existing = state.marks.find(function (m) { return m.testId === testId && m.studentId === sid; });
    if (val === "") {
      if (existing) state.marks = state.marks.filter(function (m) { return m !== existing; });
      return;
    }
    var score = Number(val);
    if (!(score >= 0) || score > Number(t.maxMarks)) return; // ignore invalid quietly
    if (existing) existing.score = score;
    else state.marks.push({ testId: testId, studentId: sid, score: score });
  });
  saveState(state);
  renderAll();
}

function addTest() {
  var name = document.getElementById("test-name").value.trim();
  if (!name) { alert("Test name is required."); return; }
  var max = Number(document.getElementById("test-max").value);
  if (!(max > 0)) { alert("Max marks must be positive."); return; }
  state.tests.push({
    id: uid(),
    name: name,
    subject: document.getElementById("test-subject").value.trim(),
    date: document.getElementById("test-date").value || todayStr(),
    maxMarks: max,
    batch: document.getElementById("test-batch").value
  });
  document.getElementById("test-name").value = "";
  document.getElementById("test-subject").value = "";
  saveState(state);
  renderAll();
}

function renderProgress() {
  var sid = document.getElementById("prog-student").value;
  var view = document.getElementById("prog-view");
  if (!sid) { view.innerHTML = '<p class="muted">Add a student first.</p>'; return; }
  var byId = {};
  state.tests.forEach(function (t) { byId[t.id] = t; });
  var rows = state.marks
    .filter(function (m) { return m.studentId === sid; })
    .map(function (m) { return { m: m, t: byId[m.testId] }; })
    .filter(function (x) { return x.t; })
    .sort(function (a, b) { return a.t.date.localeCompare(b.t.date); });

  if (!rows.length) { view.innerHTML = '<p class="muted">No scores recorded for this student yet.</p>'; return; }

  var avg = Math.round(rows.reduce(function (s, x) {
    return s + (Number(x.m.score) / Number(x.t.maxMarks)) * 100;
  }, 0) / rows.length);

  var last10 = rows.slice(-10);
  var bars = last10.map(function (x) {
    var pct = Math.min(100, (Number(x.m.score) / Number(x.t.maxMarks)) * 100);
    return "<div class='bar' style='height:" + Math.max(4, pct) + "%' title='" + esc(x.t.name) +
           ": " + x.m.score + "/" + x.t.maxMarks + "'><span>" + Math.round(pct) + "%</span></div>";
  }).join("");

  view.innerHTML =
    "<p><strong>Average: " + avg + "%</strong> across " + rows.length + " test(s)</p>" +
    "<div class='bars'>" + bars + "</div><p class='chart-x'>Last " + last10.length + " tests, oldest → newest</p>" +
    "<table><thead><tr><th>Test</th><th>Subject</th><th>Date</th><th>Score</th></tr></thead><tbody>" +
    rows.slice().reverse().map(function (x) {
      return "<tr><td>" + esc(x.t.name) + "</td><td>" + esc(x.t.subject || "—") + "</td><td>" +
             fmtDate(x.t.date) + "</td><td><strong>" + x.m.score + "</strong> / " + x.t.maxMarks + "</td></tr>";
    }).join("") + "</tbody></table>";
}

// ---------- parent message (AI) ----------
function openParentModal(studentId) {
  parentStudentId = studentId;
  var facts = parentFacts(studentId, state, todayStr());
  document.getElementById("parent-student-name").textContent = facts.student.name;
  document.getElementById("parent-stats").innerHTML =
    "Attendance: <strong>" + esc(facts.attendance) + "</strong> · " +
    "Test avg (30 days): <strong>" + esc(facts.marks) + "</strong>" +
    (facts.dueNote ? " · <strong>" + esc(facts.dueNote) + "</strong>" : "");
  document.getElementById("parent-text").value =
    parentMessageTemplate(facts.student, facts, "en");
  document.getElementById("parent-note").textContent =
    "Template shown — click “Generate with AI” for a warmer, personalized version.";
  document.getElementById("parent-modal").classList.remove("hidden");
}

function generateParentMessage() {
  var lang = document.getElementById("parent-lang").value;
  var facts = parentFacts(parentStudentId, state, todayStr());
  var btn = document.getElementById("parent-generate");
  var note = document.getElementById("parent-note");
  btn.disabled = true;
  btn.textContent = "Generating…";
  note.textContent = "";

  var prompt =
    "You are a warm, professional coaching-class teacher writing a short WhatsApp message " +
    "to a parent in " + (lang === "hi" ? "Hindi (Devanagari script)" : "simple English") + ". " +
    "Keep it under 60 words, friendly and specific, no emojis. " +
    "Facts — student: " + facts.student.name + " (" + facts.student.batch + "); " +
    "attendance: " + facts.attendance + "; average test score in the last 30 days: " + facts.marks + "; " +
    (facts.dueNote ? facts.dueNote + " " : "") +
    "Sign off as: " + facts.coaching + ".";

  aiDraft(prompt).then(function (msg) {
    document.getElementById("parent-text").value = msg;
    note.textContent = "Drafted by AI — edit freely before sending.";
  }).catch(function () {
    // Graceful offline fallback: the built-in template from the same facts.
    document.getElementById("parent-text").value =
      parentMessageTemplate(facts.student, facts, lang);
    note.textContent = "AI unavailable (offline or busy) — showing the built-in template instead.";
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = "✨ Generate with AI";
  });
}

// ---------- settings ----------
function renderSettings() {
  document.getElementById("set-coaching").value = state.settings.coachingName || "";
  document.getElementById("brand-name").textContent = state.settings.coachingName || "ClassManager";
}

// ---------- render all ----------
function renderAll() {
  renderSettings();
  renderDashboard();
  renderStudents();
  renderFees();
  renderAttendance();
  renderMarks();
}

// ---------- init ----------
function initApp() {
  state = loadState() || defaultState();
  saveState(state); // persist defaults on first run
  initTabs();
  renderAll();

  document.getElementById("student-search").addEventListener("input", renderStudents);
  document.getElementById("add-student-btn").addEventListener("click", function () { openStudentModal(null); });
  document.getElementById("student-modal-cancel").addEventListener("click", function () {
    document.getElementById("student-modal").classList.add("hidden");
  });
  document.getElementById("student-modal-save").addEventListener("click", saveStudentModal);

  document.getElementById("add-plan-btn").addEventListener("click", savePlan);
  document.getElementById("save-payment-btn").addEventListener("click", savePayment);

  document.getElementById("att-date").addEventListener("change", renderAttendance);
  document.getElementById("att-batch").addEventListener("change", renderAttendance);
  document.getElementById("att-mark-all").addEventListener("click", function () {
    var batch = document.getElementById("att-batch").value;
    var date = document.getElementById("att-date").value || todayStr();
    state.students.filter(function (s) { return s.batch === batch; }).forEach(function (st) {
      setAttendanceSilent(st.id, date, true);
    });
    saveState(state); renderAttendance(); renderDashboard();
  });
  document.getElementById("att-clear").addEventListener("click", function () {
    var date = document.getElementById("att-date").value || todayStr();
    if (!confirm("Clear all attendance marks for " + fmtDate(date) + "?")) return;
    state.attendance = state.attendance.filter(function (r) { return r.date !== date; });
    saveState(state); renderAttendance(); renderDashboard();
  });

  document.getElementById("add-test-btn").addEventListener("click", addTest);
  document.getElementById("prog-student").addEventListener("change", renderProgress);

  document.getElementById("parent-generate").addEventListener("click", generateParentMessage);
  document.getElementById("parent-close").addEventListener("click", function () {
    document.getElementById("parent-modal").classList.add("hidden");
  });
  document.getElementById("parent-copy").addEventListener("click", function () {
    var ta = document.getElementById("parent-text");
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* clipboard API fallback */ }
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function () {});
  });

  document.getElementById("save-settings-btn").addEventListener("click", function () {
    state.settings.coachingName = document.getElementById("set-coaching").value.trim() || "ClassManager";
    saveState(state); renderSettings();
  });
  document.getElementById("demo-btn").addEventListener("click", function () {
    if (!confirm("Replace current data with demo data?")) return;
    state = demoData(); saveState(state); renderAll();
  });
  document.getElementById("erase-btn").addEventListener("click", function () {
    if (!confirm("Erase ALL ClassManager data? This cannot be undone.")) return;
    state = defaultState(); saveState(state); renderAll();
  });
}

function setAttendanceSilent(studentId, date, present) {
  var existing = state.attendance.find(function (r) { return r.studentId === studentId && r.date === date; });
  if (existing) existing.present = present;
  else state.attendance.push({ studentId: studentId, date: date, present: present });
}

// Only touch the DOM when there is one (lets the pure helpers run under Node).
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
