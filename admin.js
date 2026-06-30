
const cfg = window.CONSTONIC_CONFIG || {};
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const staff = ["雅潔老師", "巧萱美容師", "曼曼美甲師"];
const therapistClassMap = {
  "雅潔老師": "therapist-yajie",
  "巧萱美容師": "therapist-qiaoxuan",
  "曼曼美甲師": "therapist-manman",
  "不指定": "therapist-none"
};

let currentBookings = [];
let realtimeChannel = null;
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function getCurrentUser() { return JSON.parse(sessionStorage.getItem("constonicStaffUser") || "null"); }

function login() {
  const username = $("username").value.trim();
  const password = $("password").value;
  const user = (cfg.STAFF_ACCOUNTS || []).find(a => a.username === username && a.password === password);
  if (!user) { $("loginMessage").textContent = "帳號或密碼錯誤。"; return; }
  sessionStorage.setItem("constonicStaffUser", JSON.stringify({username:user.username, displayName:user.displayName, role:user.role}));
  showAdmin();
}
function logout() { sessionStorage.removeItem("constonicStaffUser"); location.reload(); }
function showAdmin() {
  const user = getCurrentUser();
  if (!user) return;
  $("loginCard").classList.add("hidden");
  $("adminMain").classList.remove("hidden");
  $("welcomeTitle").textContent = `${user.displayName} 後台行事曆`;
  $("therapistFilter").disabled = false;
  setupRealtime();
  renderBookings();
  renderPendingCenter();
}
function setupRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = db.channel("constonic-bookings-realtime")
    .on("postgres_changes", { event:"*", schema:"public", table:"bookings" }, () => { renderBookings(); renderPendingCenter(); })
    .subscribe();
}
function statusText(status) {
  if (status === "pending") return "待確認";
  if (status === "confirmed") return "已確認";
  if (status === "cancelled") return "已取消";
  if (status === "nail_request") return "美甲待確認";
  return status || "待確認";
}
function therapistClass(name) { return therapistClassMap[name] || "therapist-none"; }
function minutesToTime(min) { return `${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`; }
function formatItems(items, compact=false) {
  return (items || []).map((i,idx) => {
    const t = (!compact && i.therapist) ? `｜${escapeHtml(i.therapist)}` : "";
    return `${idx+1}. ${escapeHtml(i.name)}（${Number(i.duration||0)}分）${t}`;
  }).join("<br>");
}
function bookingCard(b) {
  const cls = therapistClass(b.therapist);
  const id = escapeHtml(b.id);
  return `<div class="booking-card calendar-booking-card ${cls} status-${escapeHtml(b.status)}" draggable="true" ondragstart="dragBooking(event,'${id}')" onclick="openBookingModal('${id}')">
    <div class="booking-color-strip"></div>
    <strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name)}</strong>
    <div class="booking-item-lines">${formatItems(b.items, true)}</div>
    <div class="hint">保留 ${Number(b.total_block || 0)} 分｜${statusText(b.status)}</div>
  </div>`;
}
function listBookingCard(b) {
  const cls = therapistClass(b.therapist);
  const id = escapeHtml(b.id);
  return `<div class="booking-card list-booking-card ${cls} status-${escapeHtml(b.status)}" onclick="openBookingModal('${id}')">
    <div class="booking-color-strip"></div>
    <strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name)}</strong>
    <div>${formatItems(b.items)}</div>
    <div class="hint">療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</div>
    <div>美容師：<span class="therapist-label ${cls}">${escapeHtml(b.therapist)}</span></div>
    <div>電話：${escapeHtml(b.phone)}</div>
    <div class="hint">狀態：${statusText(b.status)}</div>
  </div>`;
}
function statCard(label, value, note="") {
  return `<div class="stat-card"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div>${note ? `<div class="hint">${escapeHtml(note)}</div>` : ""}</div>`;
}
async function renderStats(date, bookings) {
  const box = $("adminStats"); if (!box) return;
  const active = bookings.filter(b => b.status !== "cancelled");
  const pending = bookings.filter(b => b.status === "pending").length;
  const confirmed = bookings.filter(b => b.status === "confirmed").length;
  const monthStart = `${date.slice(0,7)}-01`;
  const y = Number(date.slice(0,4)); const m = Number(date.slice(5,7));
  const last = new Date(y, m, 0).getDate();
  const monthEnd = `${date.slice(0,7)}-${String(last).padStart(2,"0")}`;
  const {data} = await db.from("bookings").select("phone,status").gte("date", monthStart).lte("date", monthEnd).neq("status", "cancelled");
  const monthVisits = (data || []).length;
  const uniqueCustomers = new Set((data || []).map(b=>b.phone).filter(Boolean)).size;
  box.innerHTML = statCard("當日預約人數", active.length) + statCard("待確認", pending) + statCard("已確認", confirmed) + statCard("整月來店數", monthVisits, `不重複顧客 ${uniqueCustomers} 位`);
}

async function renderPendingCenter(){
  const box = $("pendingCenter");
  if(!box) return;
  const { data, error } = await db
    .from("bookings")
    .select("*")
    .in("status", ["pending", "nail_request"])
    .order("date", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);
  if(error){
    box.innerHTML = "讀取待確認資料失敗。";
    console.error(error);
    return;
  }
  const rows = data || [];
  if(!rows.length){
    box.className = "pending-center muted";
    box.innerHTML = "目前沒有待確認預約。";
    return;
  }
  box.className = "pending-center";
  box.innerHTML = rows.map(b => {
    const nail = b.nail_request || {};
    const nailText = b.status === "nail_request"
      ? `<div class="hint">美甲需求：${escapeHtml(nail.part || "-")}｜${escapeHtml(nail.style || "-")}｜${escapeHtml(nail.preferred_period || "-")}｜${escapeHtml(nail.preferred_time || "-")}</div>`
      : "";
    return `<div class="pending-card ${therapistClass(b.therapist)}" onclick="openBookingModal('${escapeHtml(b.id)}')">
      <div class="booking-color-strip"></div>
      <strong>${escapeHtml(b.date)}｜${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name)}</strong>
      <div>${formatItems(b.items, true)}</div>
      ${nailText}
      <div class="hint">${statusText(b.status)}</div>
    </div>`;
  }).join("");
}

async function renderBookings() {
  const user = getCurrentUser(); if (!user) return;
  const date = $("date").value;
  const mode = $("viewMode").value;
  const filter = $("therapistFilter").value;
  const box = $("calendarView");
  $("calendarTitle").textContent = `${date} 行事曆`;
  box.innerHTML = "載入中...";
  let query = db.from("bookings").select("*").eq("date", date).order("slot", {ascending:true});
  if (filter !== "全部") query = query.eq("therapist", filter);
  const {data, error} = await query;
  if (error) { box.innerHTML = '<p class="muted">讀取失敗，請確認 Supabase 設定。</p>'; console.error(error); return; }
  const bookings = data || [];
  currentBookings = bookings;
  await renderStats(date, bookings);
  if (!bookings.length) { box.innerHTML = '<p class="muted">這一天目前沒有預約。</p>'; return; }
  if (mode === "list") { box.innerHTML = bookings.map(listBookingCard).join(""); return; }
  const visibleStaff = filter === "全部" ? staff : [filter];
  let html = `<div class="calendar-grid staff-${visibleStaff.length}"><div class="calendar-head time-head">時間</div>`;
  visibleStaff.forEach(s => html += `<div class="calendar-head ${therapistClass(s)}">${escapeHtml(s)}</div>`);
  for (let t=600; t<=1200; t+=30) {
    const label = minutesToTime(t);
    html += `<div class="time-cell">${label}</div>`;
    visibleStaff.forEach(s => {
      const matches = bookings.filter(b => b.therapist === s && b.slot === label);
      html += `<div class="calendar-cell droppable-slot" data-time="${label}" data-therapist="${escapeHtml(s)}" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)" ondrop="dropBooking(event,'${label}','${escapeHtml(s)}')">${matches.map(bookingCard).join("")}</div>`;
    });
  }
  html += "</div>";
  box.innerHTML = html;
}
function dragBooking(event, id) { event.dataTransfer.setData("text/plain", id); event.dataTransfer.effectAllowed = "move"; }
function allowDrop(event) { event.preventDefault(); event.currentTarget.classList.add("drag-over"); }
function leaveDrop(event) { event.currentTarget.classList.remove("drag-over"); }
async function dropBooking(event, newSlot, newTherapist) {
  event.preventDefault(); event.currentTarget.classList.remove("drag-over");
  const id = event.dataTransfer.getData("text/plain");
  const booking = currentBookings.find(b => b.id === id);
  if (!booking) return;
  if (!confirm(`確認將「${booking.customer_name}」改到 ${newSlot}｜${newTherapist} 嗎？`)) return;
  const {error} = await db.from("bookings").update({slot:newSlot, therapist:newTherapist}).eq("id", id);
  if (error) { alert("修改時間失敗，請稍後再試。"); console.error(error); return; }
  renderBookings();
}
function openBookingModal(id) {
  const b = currentBookings.find(item => item.id === id); if (!b) return;
  $("bookingModalBody").innerHTML = `<div class="summary">
    <p><strong>預約時間：</strong>${escapeHtml(b.date)} ${escapeHtml(b.slot)}</p>
    <p><strong>客戶姓名：</strong>${escapeHtml(b.customer_name)}</p>
    <p><strong>電話：</strong>${escapeHtml(b.phone)}</p>
    <p><strong>LINE：</strong>${escapeHtml(b.line_name || "-")}</p>
    <p><strong>第一次來店：</strong>${escapeHtml(b.first_visit || "-")}</p>
    <p><strong>美容師：</strong>${escapeHtml(b.therapist)}</p>
    <p><strong>預約項目：</strong><br>${formatItems(b.items)}</p>
    <p><strong>時間保留：</strong>療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</p>
    ${b.nail_request ? `<p><strong>美甲申請：</strong><br>
      希望時段：${escapeHtml(b.nail_request.preferred_period || "-")}<br>
      指定時間：${escapeHtml(b.nail_request.preferred_time || "-")}<br>
      手部/足部：${escapeHtml(b.nail_request.part || "-")}<br>
      樣式：${escapeHtml(b.nail_request.style || "-")}<br>
      美甲備註：${escapeHtml(b.nail_request.nail_note || "-")}
    </p>` : ""}
    <p><strong>備註：</strong>${escapeHtml(b.note || "-")}</p>
    <p><strong>狀態：</strong>${statusText(b.status)}</p>
    <div class="booking-actions">
      <button onclick="updateStatus('${escapeHtml(b.id)}','confirmed'); closeBookingModal();">已確認</button>
      <button onclick="updateStatus('${escapeHtml(b.id)}','cancelled'); closeBookingModal();">取消</button>
      <button onclick="deleteBooking('${escapeHtml(b.id)}'); closeBookingModal();">刪除</button>
    </div>
  </div>`;
  $("bookingModal").classList.remove("hidden");
}
function closeBookingModal() { $("bookingModal").classList.add("hidden"); }

async function updateBuffer(id){
  const input = document.getElementById("bufferInput");
  if(!input) return;
  const internal_buffer = Number(input.value || 0);
  if(internal_buffer < 0){ alert("整理時間不可小於 0 分鐘"); return; }
  const booking = currentBookings.find(b => b.id === id);
  const service_minutes = Number(booking?.service_minutes || 0);
  const total_block = service_minutes + internal_buffer;
  const { error } = await db.from("bookings").update({ internal_buffer, total_block }).eq("id", id);
  if(error){ alert("整理時間更新失敗"); console.error(error); return; }
  closeBookingModal();
  renderBookings();
}

async function updateStatus(id, status) {
  const {error} = await db.from("bookings").update({status}).eq("id", id);
  if (error) { alert("更新失敗"); console.error(error); }
  renderBookings();
}
async function deleteBooking(id) {
  if (!confirm("確認刪除此筆預約？")) return;
  const {error} = await db.from("bookings").delete().eq("id", id);
  if (error) { alert("刪除失敗"); console.error(error); }
  renderBookings();
}
const today = new Date();
$("date").value = today.toISOString().slice(0,10);
$("date").addEventListener("change", renderBookings);
$("therapistFilter").addEventListener("change", renderBookings);
$("viewMode").addEventListener("change", renderBookings);
if (getCurrentUser()) showAdmin();
