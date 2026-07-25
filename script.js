/* ============ Storage keys ============ */
const NAMES_KEY = "cpgc_attendance_names_v1";
const RECORDS_KEY = "cpgc_attendance_records_v1";
const ACCOUNTS_KEY = "cpgc_attendance_admin_accounts_v1";

/* ============ Google Sheets cloud sync ============ */
// Paste your deployed Apps Script Web App URL between the quotes below.
// Leave it empty ("") to keep the app fully local/offline with no sync.
const GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwNJDC6WYiirh6yFolmoGWCKkzVwdlCzkLwMY6wTJbWfh_TzvWUPATpJMGf3nyPD5Cyvw/exec";

// Must exactly match SECRET_TOKEN in your Apps Script code — this stops
// random visitors who find your Web App URL from reading/writing records
// without going through this app's admin login first.
const CLOUD_SYNC_TOKEN = "X-HiGKPunwzkDAeVz6MYNLLpzB-Quz97";

function cloudSyncEnabled(){
  return !!GOOGLE_SHEETS_WEBAPP_URL && GOOGLE_SHEETS_WEBAPP_URL.trim() !== "";
}

async function cloudSaveRecord(record){
  if(!cloudSyncEnabled()) return;
  try {
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "save", record, token: CLOUD_SYNC_TOKEN })
    });
  } catch(e){ /* offline — will just stay local until next successful sync */ }
}

async function cloudDeleteRecord(id){
  if(!cloudSyncEnabled()) return;
  try {
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", id, token: CLOUD_SYNC_TOKEN })
    });
  } catch(e){}
}

async function cloudDeleteDateKey(dateKey){
  if(!cloudSyncEnabled()) return;
  try {
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "deleteByDateKey", dateKey, token: CLOUD_SYNC_TOKEN })
    });
  } catch(e){}
}

async function cloudFetchRecords(){
  if(!cloudSyncEnabled()) return null;
  try {
    const res = await fetch(GOOGLE_SHEETS_WEBAPP_URL + "?token=" + encodeURIComponent(CLOUD_SYNC_TOKEN), { method: "GET" });
    const data = await res.json();
    if(data && data.ok && Array.isArray(data.records)) return data.records;
  } catch(e){}
  return null;
}

// Pulls every record from the Sheet and merges it into local storage
// (cloud copy wins per record id), then re-renders the list.
async function syncRecordsFromCloud(showFeedback){
  if(!cloudSyncEnabled()){
    if(showFeedback) showToast("Cloud sync isn't set up yet");
    return;
  }
  if(showFeedback) showToast("Syncing from cloud…");
  const cloudRecords = await cloudFetchRecords();
  if(cloudRecords === null){
    if(showFeedback) showToast("Couldn't reach the cloud — check your internet connection");
    return;
  }
  const local = loadRecords();
  const byId = {};
  local.forEach(r => { byId[r.id] = r; });
  cloudRecords.forEach(r => { byId[r.id] = r; }); // cloud is source of truth on conflict
  const merged = Object.values(byId).sort((a, b) => b.id - a.id);
  saveRecords(merged);
  if(isAdmin) renderRecords();
  if(showFeedback) showToast("Synced " + cloudRecords.length + " record(s) from cloud");
}

/* ============ Encode helpers (obscure, not real security) ============ */
function enc(str){ try { return btoa(unescape(encodeURIComponent(str || ""))); } catch(e){ return ""; } }
function dec(str){ try { return decodeURIComponent(escape(atob(str || ""))); } catch(e){ return ""; } }

const DEFAULT_ACCOUNTS = [
  { user: enc("CAGgco_ADMIN"), pass: enc("Cagayan_Provgcos") },
  { user: "", pass: "" },
  { user: "", pass: "" },
  { user: "", pass: "" }
];

/* ============ Storage functions ============ */
function loadNames(){
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || []; }
  catch(e){ return []; }
}
function saveNames(list){
  localStorage.setItem(NAMES_KEY, JSON.stringify(list));
}
function loadRecords(){
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || []; }
  catch(e){ return []; }
}
function saveRecords(list){
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
}
function saveAccounts(accounts){
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }
  catch(e){ /* storage blocked (e.g. private browsing) — ignore, login still works from defaults */ }
}
function loadAccounts(){
  try {
    const stored = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
    if(Array.isArray(stored) && stored.length === 4){
      const hasAny = stored.some(acc => acc && acc.user && acc.user.trim() !== "");
      if(hasAny) return stored;
    }
  } catch(e){}
  try { saveAccounts(DEFAULT_ACCOUNTS); } catch(e){}
  return DEFAULT_ACCOUNTS.slice();
}

/* ============ Gathering time options ============ */
const GATHERING_TIME_CONFIG = {
  "Worship Service": { type: "select", options: ["4:30 AM", "8:30 AM", "12:30 PM", "2:30 PM", "Special Viewing"] },
  "Prayer Meeting": { type: "select", options: ["4:30 AM", "8:00 AM", "11:30 AM", "6:30 PM", "Special Viewing"] },
  "Combined Prayer Meeting & Worship": { type: "custom" },
  "Thanksgiving": { type: "select", options: ["4:00 PM", "6:00 AM", "6:30 PM", "Special Viewing"] },
  "Glorious Thanksgiving": { type: "select", options: ["4:00 PM", "6:00 AM", "6:30 PM", "Special Viewing"] }
};

/* ============ App state ============ */
let names = loadNames();
let isAdmin = false;
let currentAdminUser = "";

/* ============ Date display ============ */
function formatDateFull(d){
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' }) +
         " • " + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}
function formatClockLine(d){
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' }) +
         " • " + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function localDateKey(d){
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateKeyOf(rec){
  return rec.dateKey || (rec.isoDate ? rec.isoDate.slice(0, 10) : localDateKey(new Date(rec.id)));
}
function formatDateOnly(d){
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
function parseDateKey(key){
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function showToday(){
  document.getElementById('todayDate').textContent = formatClockLine(new Date());
}

/* ============ Utility ============ */
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============ Custom confirm modal (avoids blocked native confirm()) ============ */
const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
let pendingConfirmAction = null;

function showConfirm(message, onConfirm){
  confirmMessage.textContent = message;
  pendingConfirmAction = onConfirm;
  confirmModal.classList.add('show');
}
confirmOkBtn.addEventListener('click', () => {
  confirmModal.classList.remove('show');
  if(typeof pendingConfirmAction === 'function') pendingConfirmAction();
  pendingConfirmAction = null;
});
confirmCancelBtn.addEventListener('click', () => {
  confirmModal.classList.remove('show');
  pendingConfirmAction = null;
});

/* ============ Preserve selections across re-renders ============ */
function captureSelections(){
  const state = {};
  names.forEach((name, idx) => {
    const dutyInput = document.querySelector(`input[name="duty-${idx}"]:checked`);
    const reasonInput = document.querySelector(`input[name="reason-${idx}"]:checked`);
    const attInput = document.querySelector(`input[name="attendance-${idx}"]:checked`);
    const zoneSelect = document.getElementById(`zone-${idx}`);
    const eventSelect = document.getElementById(`event-${idx}`);
    const timeSelect = document.getElementById(`time-${idx}`);
    const timeInput = document.getElementById(`timeInput-${idx}`);
    const rowCheckbox = document.getElementById(`select-${idx}`);
    let timeVal = "";
    if(eventSelect){
      const config = GATHERING_TIME_CONFIG[eventSelect.value];
      if(config && config.type === "select" && timeSelect) timeVal = timeSelect.value;
      else if(config && config.type === "custom" && timeInput) timeVal = timeInput.value;
    }
    state[name] = {
      duty: dutyInput ? dutyInput.value : null,
      reason: reasonInput ? reasonInput.value : null,
      attendance: attInput ? attInput.value : null,
      zone: zoneSelect ? zoneSelect.value : "",
      event: eventSelect ? eventSelect.value : "",
      time: timeVal,
      selected: rowCheckbox ? rowCheckbox.checked : false
    };
  });
  return state;
}
function restoreSelections(state){
  names.forEach((name, idx) => {
    const s = state[name];
    if(!s) return;
    if(s.duty){
      const el = document.querySelector(`input[name="duty-${idx}"][value="${cssEscapeValue(s.duty)}"]`);
      if(el){ el.checked = true; el.dispatchEvent(new Event('change')); }
    }
    if(s.reason){
      const el = document.querySelector(`input[name="reason-${idx}"][value="${cssEscapeValue(s.reason)}"]`);
      if(el){ el.checked = true; el.dispatchEvent(new Event('change')); }
    }
    if(s.attendance){
      const el = document.querySelector(`input[name="attendance-${idx}"][value="${cssEscapeValue(s.attendance)}"]`);
      if(el){ el.checked = true; el.dispatchEvent(new Event('change')); }
    }
    const zoneSelect = document.getElementById(`zone-${idx}`);
    if(zoneSelect && s.zone) zoneSelect.value = s.zone;
    const eventSelect = document.getElementById(`event-${idx}`);
    if(eventSelect && s.event) eventSelect.value = s.event;
    updateTimeField(idx);
    if(s.time){
      const config = GATHERING_TIME_CONFIG[s.event];
      if(config && config.type === "select"){
        const timeSelect = document.getElementById(`time-${idx}`);
        if(timeSelect) timeSelect.value = s.time;
      } else if(config && config.type === "custom"){
        const timeInput = document.getElementById(`timeInput-${idx}`);
        if(timeInput) timeInput.value = s.time;
      }
    }
    const rowCheckbox = document.getElementById(`select-${idx}`);
    if(rowCheckbox) rowCheckbox.checked = !!s.selected;
  });
}
function cssEscapeValue(v){
  return String(v).replace(/(["\\])/g, '\\$1');
}

function updateTimeField(idx){
  const eventSelect = document.getElementById(`event-${idx}`);
  const timeSelect = document.getElementById(`time-${idx}`);
  const timeCustom = document.getElementById(`timeCustom-${idx}`);
  const timeInput = document.getElementById(`timeInput-${idx}`);
  const timeNone = document.getElementById(`timeNone-${idx}`);
  if(!eventSelect || !timeSelect || !timeCustom || !timeNone) return;

  const config = GATHERING_TIME_CONFIG[eventSelect.value];

  if(!config){
    timeSelect.style.display = "none";
    timeCustom.style.display = "none";
    timeNone.style.display = "inline";
    timeSelect.innerHTML = "";
    if(timeInput) timeInput.value = "";
    return;
  }

  if(config.type === "select"){
    timeNone.style.display = "none";
    timeCustom.style.display = "none";
    timeSelect.style.display = "inline-block";
    const currentVal = timeSelect.value;
    timeSelect.innerHTML = `<option value="">Select time</option>` +
      config.options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if(config.options.includes(currentVal)) timeSelect.value = currentVal;
  } else if(config.type === "custom"){
    timeNone.style.display = "none";
    timeSelect.style.display = "none";
    timeCustom.style.display = "flex";
  }
}

/* ============ Render the Attendance table ============ */
function renderNames(){
  const savedState = captureSelections();
  const body = document.getElementById('attBody');
  const noNames = document.getElementById('noNames');
  body.innerHTML = "";

  if(names.length === 0){
    noNames.style.display = "block";
    updateSelectAllVisibility();
    return;
  }
  noNames.style.display = "none";

  names.forEach((name, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${isAdmin ? `<input type="checkbox" class="row-select" id="select-${idx}">` : ``}</td>
      <td class="name-cell">${escapeHtml(name)}</td>
      <td>
        <div class="choice-group" data-role="duty" data-idx="${idx}">
          <label><input type="radio" name="duty-${idx}" value="On Duty"> On Duty</label>
          <label><input type="radio" name="duty-${idx}" value="Not On Duty"> Not On Duty</label>
          ${isAdmin ? `<button class="clear-choice" data-role="duty" data-idx="${idx}" title="Unclick / reset">↺ clear</button>` : ``}
        </div>
      </td>
      <td>
        <div class="choice-group" data-role="reason" data-idx="${idx}">
          <label><input type="radio" name="reason-${idx}" value="Valid Reason"> Valid Reason</label>
          <label><input type="radio" name="reason-${idx}" value="Not Valid Reason"> Not Valid Reason</label>
          ${isAdmin ? `<button class="clear-choice" data-role="reason" data-idx="${idx}" title="Unclick / reset">↺ clear</button>` : ``}
        </div>
      </td>
      <td>
        <div class="choice-group" data-role="attendance" data-idx="${idx}">
          <label><input type="radio" name="attendance-${idx}" value="Attended"> Attended</label>
          <label><input type="radio" name="attendance-${idx}" value="Missed"> Missed</label>
          <label><input type="radio" name="attendance-${idx}" value="Via Zoom"> Via Zoom</label>
          ${isAdmin ? `<button class="clear-choice" data-role="attendance" data-idx="${idx}" title="Unclick / reset">↺ clear</button>` : ``}
        </div>
      </td>
      <td>
        <select class="zone-select" id="zone-${idx}">
          <option value="">Select zone</option>
          <option value="Zone 1A">Zone 1A</option>
          <option value="Zone 1B">Zone 1B</option>
          <option value="Zone 2">Zone 2</option>
          <option value="Zone 3">Zone 3</option>
        </select>
      </td>
      <td>
        <select class="event-select" id="event-${idx}">
          <option value="">Select gathering</option>
          <option value="Prayer Meeting">Prayer Meeting</option>
          <option value="Worship Service">Worship Service</option>
          <option value="Combined Prayer Meeting & Worship">Combined Prayer Meeting & Worship</option>
          <option value="Thanksgiving">Thanksgiving</option>
          <option value="Glorious Thanksgiving">Glorious Thanksgiving</option>
          <option value="MASS INDOCTRINATION">MASS INDOCTRINATION</option>
          <option value="BIBLE STUDY">BIBLE STUDY</option>
          <option value="MCGI EVENTS">MCGI EVENTS</option>
        </select>
      </td>
      <td>
        <div class="time-field" id="timeField-${idx}">
          <select class="time-select" id="time-${idx}" style="display:none;"></select>
          <div class="time-custom" id="timeCustom-${idx}" style="display:none;">
            <input type="text" class="time-input" id="timeInput-${idx}" placeholder="Enter time">
            <button type="button" class="time-special-btn" id="timeSpecial-${idx}">Special Viewing</button>
          </div>
          <span class="time-none" id="timeNone-${idx}">—</span>
        </div>
      </td>
      <td>${isAdmin ? `<button class="btn-danger btn-small del-name" title="Remove name" data-idx="${idx}">🗑 Delete</button>` : `<span style="color:#b7bec6; font-size:.8rem;">Admin only</span>`}</td>
    `;
    body.appendChild(tr);
  });

  // Gathering → Time field behavior
  names.forEach((name, idx) => {
    const eventSelect = document.getElementById(`event-${idx}`);
    if(eventSelect){
      eventSelect.addEventListener('change', () => updateTimeField(idx));
    }
    const specialBtn = document.getElementById(`timeSpecial-${idx}`);
    if(specialBtn){
      specialBtn.addEventListener('click', () => {
        const input = document.getElementById(`timeInput-${idx}`);
        if(input) input.value = "Special Viewing";
      });
    }
    updateTimeField(idx);
  });

  // Radio highlight behavior for duty, reason & attendance
  body.querySelectorAll('.choice-group').forEach(group => {
    const role = group.dataset.role;
    group.querySelectorAll('input[type=radio]').forEach(input => {
      input.addEventListener('change', () => {
        group.querySelectorAll('label').forEach(l => {
          l.classList.remove('checked-duty-on','checked-duty-off','checked-pres-on','checked-pres-off','checked-pres-zoom','checked-reason-on','checked-reason-off');
        });
        const label = input.closest('label');
        if(role === 'duty'){
          label.classList.add(input.value === 'On Duty' ? 'checked-duty-on' : 'checked-duty-off');
        } else if(role === 'reason'){
          label.classList.add(input.value === 'Valid Reason' ? 'checked-reason-on' : 'checked-reason-off');
        } else {
          if(input.value === 'Attended') label.classList.add('checked-pres-on');
          else if(input.value === 'Via Zoom') label.classList.add('checked-pres-zoom');
          else label.classList.add('checked-pres-off');
        }
      });
    });
  });

  // Admin-only: clear/unclick a duty, reason, or attendance choice back to blank
  body.querySelectorAll('.clear-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      if(!isAdmin) return;
      const role = btn.dataset.role;
      const idx = btn.dataset.idx;
      document.querySelectorAll(`input[name="${role}-${idx}"]`).forEach(r => r.checked = false);
      const group = btn.closest('.choice-group');
      group.querySelectorAll('label').forEach(l => {
        l.classList.remove('checked-duty-on','checked-duty-off','checked-pres-on','checked-pres-off','checked-pres-zoom','checked-reason-on','checked-reason-off');
      });
    });
  });

  // Admin-only: delete a name
  body.querySelectorAll('.del-name').forEach(btn => {
    btn.addEventListener('click', () => {
      if(!isAdmin) return;
      const idx = parseInt(btn.dataset.idx, 10);
      const removed = names[idx];
      showConfirm(`Remove "${removed}" from the list?`, () => {
        names.splice(idx, 1);
        saveNames(names);
        renderNames();
        showToast(`"${removed}" removed`);
      });
    });
  });

  restoreSelections(savedState);
  updateSelectAllVisibility();
}

function updateSelectAllVisibility(){
  const selectAll = document.getElementById('selectAllCheckbox');
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  if(!selectAll || !deleteBtn) return;
  selectAll.style.visibility = isAdmin ? 'visible' : 'hidden';
  selectAll.checked = false;
  deleteBtn.style.display = isAdmin ? 'inline-block' : 'none';
}

/* ============ Select all / delete selected ============ */
document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
  if(!isAdmin) return;
  document.querySelectorAll('.row-select').forEach(cb => { cb.checked = e.target.checked; });
});

document.getElementById('deleteSelectedBtn').addEventListener('click', () => {
  if(!isAdmin) return;
  const checkedBoxes = Array.from(document.querySelectorAll('.row-select:checked'));
  if(checkedBoxes.length === 0){
    showToast("Select at least one name first.");
    return;
  }
  const selectedIdx = checkedBoxes.map(cb => parseInt(cb.id.replace('select-', ''), 10));
  const selectedNames = selectedIdx.map(i => names[i]);
  showConfirm(`Delete ${selectedNames.length} selected name${selectedNames.length > 1 ? 's' : ''}? This cannot be undone.`, () => {
    names = names.filter(n => !selectedNames.includes(n));
    saveNames(names);
    renderNames();
    showToast(`${selectedNames.length} name${selectedNames.length > 1 ? 's' : ''} deleted`);
  });
});

// Allow pressing Enter to confirm while the confirm modal is open,
// or to trigger "Delete Selected" once names are checked in the table.
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;

  if(confirmModal.classList.contains('show')){
    e.preventDefault();
    confirmOkBtn.click();
    return;
  }

  if(isAdmin &&
     !manageAccountsModal.classList.contains('show') &&
     !downloadModal.classList.contains('show') &&
     !editRecordModal.classList.contains('show')){
    const tag = (e.target.tagName || '').toLowerCase();
    if(tag === 'input' || tag === 'select' || tag === 'textarea') return; // don't hijack typing
    const anyChecked = document.querySelector('.row-select:checked');
    if(anyChecked){
      e.preventDefault();
      document.getElementById('deleteSelectedBtn').click();
    }
  }
});

/* ============ Add name ============ */
document.getElementById('addNameBtn').addEventListener('click', addName);
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') addName();
});
function addName(){
  const input = document.getElementById('nameInput');
  const val = input.value.trim();
  if(!val) return;
  const isDuplicate = names.some(n => n.trim().toLowerCase() === val.toLowerCase());
  if(isDuplicate){
    showToast(`"${val}" is already on the list.`);
    return;
  }
  names.push(val);
  saveNames(names);
  input.value = "";
  renderNames();
}

/* ============ Save attendance ============ */
document.getElementById('saveBtn').addEventListener('click', () => {
  if(names.length === 0){
    showToast("Add at least one name first.");
    return;
  }

  const entries = names.map((name, idx) => {
    const dutyInput = document.querySelector(`input[name="duty-${idx}"]:checked`);
    const reasonInput = document.querySelector(`input[name="reason-${idx}"]:checked`);
    const attInput = document.querySelector(`input[name="attendance-${idx}"]:checked`);
    const zoneSelect = document.getElementById(`zone-${idx}`);
    const eventSelect = document.getElementById(`event-${idx}`);
    const timeSelect = document.getElementById(`time-${idx}`);
    const timeInput = document.getElementById(`timeInput-${idx}`);
    let timeVal = null;
    if(eventSelect){
      const config = GATHERING_TIME_CONFIG[eventSelect.value];
      if(config && config.type === "select" && timeSelect && timeSelect.value) timeVal = timeSelect.value;
      else if(config && config.type === "custom" && timeInput && timeInput.value.trim()) timeVal = timeInput.value.trim();
    }
    return {
      name,
      duty: dutyInput ? dutyInput.value : null,
      reason: reasonInput ? reasonInput.value : null,
      attendance: attInput ? attInput.value : null,
      zone: zoneSelect && zoneSelect.value ? zoneSelect.value : null,
      event: eventSelect && eventSelect.value ? eventSelect.value : null,
      time: timeVal
    };
  });

  const now = new Date();
  const record = {
    id: now.getTime(),
    dateLabel: formatDateFull(now),
    isoDate: now.toISOString(),
    dateKey: localDateKey(now),
    entries
  };

  const records = loadRecords();
  records.unshift(record);
  saveRecords(records);
  cloudSaveRecord(record);

  showToast(cloudSyncEnabled() ? "Attendance saved ✔ (syncing to cloud…)" : "Attendance saved ✔");
  if(isAdmin) renderRecords();
});

/* ============ Sign-in gate ============ */
const loginGate = document.getElementById('loginGate');
const mainApp = document.getElementById('mainApp');
const userInput = document.getElementById('adminUsernameInput');
const pwInput = document.getElementById('adminPasswordInput');
const loginError = document.getElementById('loginError');

function resetGateFields(){
  userInput.value = "";
  pwInput.value = "";
  pwInput.type = "password";
  document.getElementById('toggleLoginPw').textContent = "Show";
  loginError.style.display = "none";
}
function showGate(){
  resetGateFields();
  mainApp.style.display = "none";
  loginGate.style.display = "flex";
  setTimeout(() => userInput.focus(), 50);
}
function enterApp(){
  loginGate.style.display = "none";
  mainApp.style.display = "block";
}

document.getElementById('submitLoginBtn').addEventListener('click', attemptLogin);
pwInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') attemptLogin(); });
userInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') pwInput.focus(); });

document.getElementById('toggleLoginPw').addEventListener('click', () => {
  const btn = document.getElementById('toggleLoginPw');
  const showing = pwInput.type === 'text';
  pwInput.type = showing ? 'password' : 'text';
  btn.textContent = showing ? 'Show' : 'Hide';
});

function attemptLogin(){
  const enteredUser = userInput.value.trim().toLowerCase();
  const enteredPw = pwInput.value.trim();

  let accounts;
  try {
    accounts = loadAccounts();
    if(!Array.isArray(accounts) || accounts.length === 0) accounts = DEFAULT_ACCOUNTS;
  } catch(e){
    accounts = DEFAULT_ACCOUNTS;
  }

  let match = accounts.find(acc =>
    acc.user && dec(acc.user).trim().toLowerCase() === enteredUser && dec(acc.pass) === enteredPw
  );

  // Safety net: the built-in default account always works, even if stored
  // accounts are corrupted or storage is blocked on this device/browser.
  if(!match){
    const fallback = DEFAULT_ACCOUNTS[0];
    if(dec(fallback.user).trim().toLowerCase() === enteredUser && dec(fallback.pass) === enteredPw){
      match = fallback;
    }
  }

  if(match){
    isAdmin = true;
    currentAdminUser = dec(match.user);
    enterApp();
    applyAdminUI();
    showToast(`Welcome, ${currentAdminUser}`);
  } else {
    loginError.style.display = "block";
  }
}

document.getElementById('adminLogoutBtn').addEventListener('click', () => {
  isAdmin = false;
  currentAdminUser = "";
  showGate();
  showToast("Signed out");
});

/* ============ Manage admin accounts ============ */
const manageAccountsModal = document.getElementById('manageAccountsModal');
const accountSlots = document.getElementById('accountSlots');

document.getElementById('adminBadge').addEventListener('click', () => {
  const accounts = loadAccounts();
  accountSlots.innerHTML = accounts.map((acc, i) => `
    <div style="margin-bottom:10px; padding-bottom:8px; ${i < 3 ? 'border-bottom:1px solid #eee;' : ''}">
      <small class="hint">Account ${i + 1}</small>
      <input type="text" class="slot-user" data-i="${i}" placeholder="Username" value="${escapeHtml(dec(acc.user) || '')}">
      <div class="slot-pw-wrap">
        <input type="password" class="slot-pw" data-i="${i}" placeholder="Password" value="${escapeHtml(dec(acc.pass) || '')}">
        <button type="button" class="toggle-pw toggle-slot-pw" data-i="${i}">Show</button>
      </div>
    </div>
  `).join('');
  manageAccountsModal.classList.add('show');
});
accountSlots.addEventListener('click', (e) => {
  if(!e.target.classList.contains('toggle-slot-pw')) return;
  const i = e.target.dataset.i;
  const input = manageAccountsModal.querySelector(`.slot-pw[data-i="${i}"]`);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  e.target.textContent = showing ? 'Show' : 'Hide';
});
document.getElementById('cancelAccountsBtn').addEventListener('click', () => manageAccountsModal.classList.remove('show'));
document.getElementById('closeAccountsX').addEventListener('click', () => manageAccountsModal.classList.remove('show'));
document.getElementById('submitAccountsBtn').addEventListener('click', () => {
  const usersEls = manageAccountsModal.querySelectorAll('.slot-user');
  const pwsEls = manageAccountsModal.querySelectorAll('.slot-pw');
  const newAccounts = [];
  for(let i = 0; i < 4; i++){
    newAccounts.push({ user: enc(usersEls[i].value.trim()), pass: enc(pwsEls[i].value) });
  }
  saveAccounts(newAccounts);
  manageAccountsModal.classList.remove('show');
  showToast("Admin accounts updated");
});
document.getElementById('resetAccountsBtn').addEventListener('click', () => {
  showConfirm("Reset all 4 admin account slots back to the original default? This removes any accounts you've added.", () => {
    saveAccounts(DEFAULT_ACCOUNTS);
    manageAccountsModal.classList.remove('show');
    showToast("Admin accounts reset to default");
  });
});
document.getElementById('resetFromLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  showConfirm("Reset all admin account slots back to the original default (CAGgco_ADMIN)? This removes any accounts you've added.", () => {
    saveAccounts(DEFAULT_ACCOUNTS);
    showToast("Admin accounts reset to default. Try logging in again.");
  });
});

/* ============ Apply admin UI state ============ */
function applyAdminUI(){
  const badge = document.getElementById('adminBadge');
  badge.style.display = isAdmin ? 'inline-flex' : 'none';
  if(isAdmin) document.getElementById('adminBadgeName').textContent = currentAdminUser;

  if(!isAdmin){
    document.getElementById('recordsPanel').style.display = 'none';
    document.getElementById('toggleRecordsBtn').textContent = 'Show';
  }
  renderNames();
}

/* ============ Saved records panel (admin only) ============ */
document.getElementById('toggleRecordsBtn').addEventListener('click', () => {
  if(!isAdmin) return;
  const panel = document.getElementById('recordsPanel');
  const btn = document.getElementById('toggleRecordsBtn');
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? 'Show' : 'Hide';
  if(!isOpen){
    renderRecords();
    if(cloudSyncEnabled()) syncRecordsFromCloud(false);
  }
});

document.getElementById('syncCloudBtn').addEventListener('click', () => {
  if(!isAdmin) return;
  syncRecordsFromCloud(true);
});

document.getElementById('clearRecordsBtn').addEventListener('click', () => {
  if(!isAdmin) return;
  showConfirm("Delete ALL saved attendance records? This cannot be undone.", () => {
    const existing = loadRecords();
    saveRecords([]);
    existing.forEach(r => cloudDeleteRecord(r.id));
    renderRecords();
    showToast("All records deleted");
  });
});

function tagFor(value, kind){
  if(!value) return `<span class="tag tag-none">Not marked</span>`;
  if(kind === 'duty'){
    return value === 'On Duty'
      ? `<span class="tag tag-on">On Duty</span>`
      : `<span class="tag tag-off">Not On Duty</span>`;
  }
  if(kind === 'reason'){
    return value === 'Valid Reason'
      ? `<span class="tag tag-reason-on">Valid Reason</span>`
      : `<span class="tag tag-reason-off">Not Valid Reason</span>`;
  }
  if(kind === 'attendance'){
    if(value === 'Attended') return `<span class="tag tag-pres">Attended</span>`;
    if(value === 'Via Zoom') return `<span class="tag tag-zoom">Via Zoom</span>`;
    return `<span class="tag tag-npres">Missed</span>`;
  }
  return `<span class="tag tag-none">${escapeHtml(value)}</span>`;
}

function groupRecordsByDate(records){
  const groups = {};
  records.forEach(rec => {
    const key = dateKeyOf(rec);
    if(!groups[key]) groups[key] = [];
    groups[key].push(rec);
  });
  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({
      dateKey: key,
      dateLabel: formatDateOnly(parseDateKey(key)),
      records: groups[key]
    }));
}

function renderRecords(){
  if(!isAdmin) return;
  const records = loadRecords();
  const list = document.getElementById('recordsList');
  const noRecords = document.getElementById('noRecords');
  list.innerHTML = "";

  if(records.length === 0){
    noRecords.style.display = 'block';
    return;
  }
  noRecords.style.display = 'none';

  const groups = groupRecordsByDate(records);

  groups.forEach(group => {
    const folder = document.createElement('div');
    folder.className = 'date-folder';
    folder.innerHTML = `
      <div class="folder-head" data-key="${group.dateKey}">
        <span class="folder-title">📁 ${escapeHtml(group.dateLabel)}<span class="folder-count">(${group.records.length} save${group.records.length > 1 ? 's' : ''})</span></span>
        <span class="folder-actions">
          <button class="btn-primary btn-small btn-icon folder-download" data-key="${group.dateKey}" title="Download this date">⬇ Download</button>
          <button class="btn-danger btn-small btn-icon folder-delete" data-key="${group.dateKey}" title="Delete this date's records">🗑</button>
          <span class="folder-caret">▾</span>
        </span>
      </div>
      <div class="folder-body" id="folder-${group.dateKey}">
        ${group.records.map(rec => `
          <div class="record">
            <div class="record-head" data-id="${rec.id}">
              <strong>🕒 ${escapeHtml(rec.dateLabel)}</strong>
              <span>
                <button class="btn-ghost btn-small btn-icon record-edit" data-id="${rec.id}" title="Edit date & time">✏️</button>
                <button class="btn-primary btn-small btn-icon record-download" data-id="${rec.id}" title="Download this save">⬇</button>
                <button class="btn-danger del-record btn-small" data-id="${rec.id}">Delete</button>
                <span style="margin-left:6px;">▾</span>
              </span>
            </div>
            <div class="record-body" id="body-${rec.id}">
              <table>
                <thead><tr><th>Name</th><th>Duty</th><th>Reason</th><th>Attendance</th><th>Zone</th><th>Gatherings</th><th>Time</th></tr></thead>
                <tbody>
                  ${rec.entries.map(e => `
                    <tr>
                      <td>${escapeHtml(e.name)}</td>
                      <td>${tagFor(e.duty, 'duty')}</td>
                      <td>${tagFor(e.reason, 'reason')}</td>
                      <td>${tagFor(e.attendance, 'attendance')}</td>
                      <td>${e.zone ? `<span class="tag tag-zone">${escapeHtml(e.zone)}</span>` : `<span class="tag tag-none">Not set</span>`}</td>
                      <td>${e.event ? `<span class="tag tag-event">${escapeHtml(e.event)}</span>` : `<span class="tag tag-none">Not set</span>`}</td>
                      <td>${e.time ? `<span class="tag tag-time">${escapeHtml(e.time)}</span>` : `<span class="tag tag-none">Not set</span>`}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    list.appendChild(folder);
  });

  // Folder expand/collapse
  list.querySelectorAll('.folder-head').forEach(head => {
    head.addEventListener('click', (e) => {
      if(e.target.closest('.folder-download') || e.target.closest('.folder-delete')) return;
      const key = head.dataset.key;
      document.getElementById(`folder-${key}`).classList.toggle('open');
    });
  });

  // Individual record expand/collapse
  list.querySelectorAll('.record-head').forEach(head => {
    head.addEventListener('click', (e) => {
      if(e.target.closest('.del-record') || e.target.closest('.record-download')) return;
      const id = head.dataset.id;
      document.getElementById(`body-${id}`).classList.toggle('open');
    });
  });

  // Delete individual saved record
  list.querySelectorAll('.del-record').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if(!isAdmin) return;
      const id = parseInt(btn.dataset.id, 10);
      showConfirm("Delete this saved record? This cannot be undone.", () => {
        let records = loadRecords();
        records = records.filter(r => r.id !== id);
        saveRecords(records);
        cloudDeleteRecord(id);
        renderRecords();
        showToast("Record deleted");
      });
    });
  });

  // Delete an entire date's records
  list.querySelectorAll('.folder-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if(!isAdmin) return;
      const key = btn.dataset.key;
      showConfirm("Delete ALL saved records for this date? This cannot be undone.", () => {
        let records = loadRecords();
        records = records.filter(r => dateKeyOf(r) !== key);
        saveRecords(records);
        cloudDeleteDateKey(key);
        renderRecords();
        showToast("Date's records deleted");
      });
    });
  });

  // Edit a saved record's date & time
  list.querySelectorAll('.record-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if(!isAdmin) return;
      const id = parseInt(btn.dataset.id, 10);
      const rec = loadRecords().find(r => r.id === id);
      if(!rec) return;
      openEditRecordModal(rec);
    });
  });

  // Download a single saved record
  list.querySelectorAll('.record-download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      const rec = loadRecords().find(r => r.id === id);
      if(!rec) return;
      openDownloadModal(`Attendance_${dateKeyOf(rec)}_${rec.id}`, buildRecordSectionHTML(rec));
    });
  });

  // Download all records for a date
  list.querySelectorAll('.folder-download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const recs = loadRecords().filter(r => dateKeyOf(r) === key);
      const bodyHtml = recs.map(buildRecordSectionHTML).join('');
      openDownloadModal(`Attendance_${key}`, bodyHtml);
    });
  });
}

/* ============ Export helpers (image / word) ============ */
const APP_TITLE = "Cagayan Province Guest Coordinators Attendance";

function plainTag(value, kind){
  if(!value) return 'Not marked';
  return value;
}

function buildRecordSectionHTML(rec){
  return `
    <h3 style="margin:18px 0 8px; font-size:1rem; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1f2a37;">🕒 ${escapeHtml(rec.dateLabel)}</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:6px; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <thead>
        <tr style="background:#f6f8fa;">
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Name</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Duty</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Reason</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Attendance</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Zone</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Gathering</th>
          <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #e3e8ee; font-size:12px; color:#6b7684;">Time</th>
        </tr>
      </thead>
      <tbody>
        ${rec.entries.map(e => `
          <tr>
            <td style="padding:8px; border-bottom:1px solid #eee; font-weight:600;">${escapeHtml(e.name)}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(plainTag(e.duty))}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(plainTag(e.reason))}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(plainTag(e.attendance))}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(e.zone || 'Not set')}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(e.event || 'Not set')}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(e.time || 'Not set')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function downloadAsWord(filename, bodyHtml){
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset="utf-8"><title>${escapeHtml(APP_TITLE)}</title></head>
  <body>
    <h2 style="font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1f2a37;">${escapeHtml(APP_TITLE)}</h2>
    ${bodyHtml}
  </body>
  </html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Word document downloaded");
}

function downloadAsImage(filename, bodyHtml){
  if(typeof html2canvas === 'undefined'){
    showToast("Couldn't load image tool. Check your internet connection and try again.");
    return;
  }
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '760px';
  container.style.background = '#ffffff';
  container.style.padding = '24px';
  container.style.fontFamily = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  container.style.color = '#1f2a37';
  container.innerHTML = `<h2 style="margin:0 0 6px;">${escapeHtml(APP_TITLE)}</h2>${bodyHtml}`;
  document.body.appendChild(container);

  html2canvas(container, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename + '.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      document.body.removeChild(container);
      showToast("Image downloaded");
    }, 'image/jpeg', 0.92);
  }).catch(() => {
    showToast("Couldn't create the image.");
    document.body.removeChild(container);
  });
}

/* ============ Download modal wiring ============ */
const downloadModal = document.getElementById('downloadModal');
let pendingDownload = null;

function openDownloadModal(filename, bodyHtml){
  pendingDownload = { filename, bodyHtml };
  downloadModal.classList.add('show');
}
document.getElementById('downloadImageBtn').addEventListener('click', () => {
  if(!pendingDownload) return;
  downloadAsImage(pendingDownload.filename, pendingDownload.bodyHtml);
  downloadModal.classList.remove('show');
  pendingDownload = null;
});
document.getElementById('downloadWordBtn').addEventListener('click', () => {
  if(!pendingDownload) return;
  downloadAsWord(pendingDownload.filename, pendingDownload.bodyHtml);
  downloadModal.classList.remove('show');
  pendingDownload = null;
});
document.getElementById('cancelDownloadBtn').addEventListener('click', () => {
  downloadModal.classList.remove('show');
  pendingDownload = null;
});

/* ============ Edit record date/time modal ============ */
const editRecordModal = document.getElementById('editRecordModal');
const editRecordInput = document.getElementById('editRecordDateTime');
let editingRecordId = null;

function toDateTimeLocalValue(d){
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openEditRecordModal(rec){
  editingRecordId = rec.id;
  const d = rec.isoDate ? new Date(rec.isoDate) : new Date(rec.id);
  editRecordInput.value = toDateTimeLocalValue(d);
  editRecordModal.classList.add('show');
  setTimeout(() => editRecordInput.focus(), 50);
}

document.getElementById('cancelEditRecordBtn').addEventListener('click', () => {
  editRecordModal.classList.remove('show');
  editingRecordId = null;
});
editRecordInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('saveEditRecordBtn').click();
  }
});

document.getElementById('saveEditRecordBtn').addEventListener('click', () => {
  if(editingRecordId === null) return;
  const val = editRecordInput.value;
  if(!val){
    showToast("Please choose a date and time");
    return;
  }
  const newDate = new Date(val);
  if(isNaN(newDate.getTime())){
    showToast("That date/time isn't valid");
    return;
  }
  let records = loadRecords();
  const rec = records.find(r => r.id === editingRecordId);
  if(rec){
    rec.isoDate = newDate.toISOString();
    rec.dateKey = localDateKey(newDate);
    rec.dateLabel = formatDateFull(newDate);
    saveRecords(records);
    cloudSaveRecord(rec);
    renderRecords();
    showToast("Record date & time updated");
  }
  editRecordModal.classList.remove('show');
  editingRecordId = null;
});

/* ============ Init ============ */
showToday();
setInterval(showToday, 1000);
renderNames();
applyAdminUI();

/* ============ Offline support (only works when hosted on a real
   web server with https:// or on localhost — not on file://) ============ */
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline caching unavailable */ });
  });
}
