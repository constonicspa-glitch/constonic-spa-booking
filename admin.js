
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
  if (status === "completed") return "已完成";
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
  renderMonthlyReport();
}

function money(n){
  return Number(n || 0).toLocaleString("zh-TW");
}

function defaultCheckout(b){
  const old = b.checkout || {};
  const techRows = old.tech_rows || (b.items || []).map((item, idx) => ({
    item_name: item.name || `技術${idx+1}`,
    amount: 0,
    rate: "30"
  }));
  return {
    payment_status: old.payment_status || "未收款",
    payment_method: old.payment_method || "現金",
    tech_rows: techRows,
    product_amount: Number(old.product_amount || 0),
    course_amount: Number(old.course_amount || 0),
    stored_value_new_amount: Number(old.stored_value_new_amount || 0),
    platform_fixed_pay: Number(old.platform_fixed_pay || 0),
    total_received: Number(old.total_received || 0),
    invoice_status: old.invoice_status || "未開",
    receipt_note: old.receipt_note || ""
  };
}

function calcCheckoutTotal(c){
  const techBonus = (c.tech_rows || []).reduce((sum, row) => {
    return sum + Math.round(Number(row.amount || 0) * Number(row.rate || 0) / 100);
  }, 0);
  const productBonus = Math.round(Number(c.product_amount || 0) * 0.10);
  const courseBonus = Math.round((Number(c.course_amount || 0) + Number(c.stored_value_new_amount || 0)) * 0.02);
  const platformPay = Number(c.platform_fixed_pay || 0);
  return { techBonus, productBonus, courseBonus, platformPay, salaryTotal: techBonus + productBonus + courseBonus + platformPay };
}

function renderCheckoutForm(b){
  const c = defaultCheckout(b);
  const totals = calcCheckoutTotal(c);
  const rows = (c.tech_rows || []).map((row, idx) => `
    <div class="cashier-row">
      <div class="field">
        <label>技術項目</label>
        <input id="techName_${idx}" value="${escapeHtml(row.item_name || "")}">
      </div>
      <div class="field">
        <label>技術金額</label>
        <input id="techAmount_${idx}" type="number" min="0" value="${Number(row.amount || 0)}">
      </div>
      <div class="field">
        <label>抽成</label>
        <select id="techRate_${idx}">
          <option value="30" ${String(row.rate)==="30" ? "selected" : ""}>30%</option>
          <option value="40" ${String(row.rate)==="40" ? "selected" : ""}>40%</option>
        </select>
      </div>
    </div>
  `).join("");

  return `<div class="cashier-box">
    <h3>收銀／薪資計算</h3>
    <p class="hint">商品10%；技術可選30%或40%；新購課程／新收儲值2%；平台團購固定薪資手動輸入。</p>

    <div class="form-grid">
      <div class="field">
        <label>收款狀態</label>
        <select id="paymentStatus">
          ${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>收款方式</label>
        <select id="paymentMethod">
          ${["現金","刷卡","匯款","LINE Pay","街口支付","Apple Pay","Google Pay","其他"].map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>
    </div>

    <h4>技術服務</h4>
    <div id="techRows" data-count="${(c.tech_rows || []).length}">${rows}</div>

    <h4>其他收入／獎金</h4>
    <div class="form-grid">
      <div class="field"><label>商品銷售金額（10%）</label><input id="productAmount" type="number" min="0" value="${c.product_amount}"></div>
      <div class="field"><label>新購課程金額（2%）</label><input id="courseAmount" type="number" min="0" value="${c.course_amount}"></div>
      <div class="field"><label>新收儲值金額（2%）</label><input id="storedValueNewAmount" type="number" min="0" value="${c.stored_value_new_amount}"></div>
      <div class="field"><label>平台團購固定薪資</label><input id="platformFixedPay" type="number" min="0" value="${c.platform_fixed_pay}"></div>
      <div class="field"><label>本次實際收款金額</label><input id="totalReceived" type="number" min="0" value="${c.total_received}"></div>
      <div class="field">
        <label>發票狀態</label>
        <select id="invoiceStatus">
          ${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="field">
      <label>收款備註</label>
      <textarea id="receiptNote" rows="2" placeholder="例如：補尾款、優惠折扣、刷兩次卡等">${escapeHtml(c.receipt_note || "")}</textarea>
    </div>

    <div class="cashier-summary">
      <div>技術獎金：NT$ ${money(totals.techBonus)}</div>
      <div>商品獎金：NT$ ${money(totals.productBonus)}</div>
      <div>課程／儲值獎金：NT$ ${money(totals.courseBonus)}</div>
      <div>平台固定薪資：NT$ ${money(totals.platformPay)}</div>
      <strong>本次薪資合計：NT$ ${money(totals.salaryTotal)}</strong>
    </div>

    <button type="button" class="primary" onclick="saveCheckout('${escapeHtml(b.id)}')">儲存收銀資料</button>
  </div>`;
}

function collectCheckoutFromForm(){
  const count = Number(document.getElementById("techRows")?.dataset.count || 0);
  const tech_rows = [];
  for(let i=0;i<count;i++){
    tech_rows.push({
      item_name: document.getElementById(`techName_${i}`)?.value || "",
      amount: Number(document.getElementById(`techAmount_${i}`)?.value || 0),
      rate: document.getElementById(`techRate_${i}`)?.value || "30"
    });
  }
  const checkout = {
    payment_status: document.getElementById("paymentStatus")?.value || "未收款",
    payment_method: document.getElementById("paymentMethod")?.value || "現金",
    tech_rows,
    product_amount: Number(document.getElementById("productAmount")?.value || 0),
    course_amount: Number(document.getElementById("courseAmount")?.value || 0),
    stored_value_new_amount: Number(document.getElementById("storedValueNewAmount")?.value || 0),
    platform_fixed_pay: Number(document.getElementById("platformFixedPay")?.value || 0),
    total_received: Number(document.getElementById("totalReceived")?.value || 0),
    invoice_status: document.getElementById("invoiceStatus")?.value || "未開",
    receipt_note: document.getElementById("receiptNote")?.value || ""
  };
  checkout.calculated = calcCheckoutTotal(checkout);
  return checkout;
}

async function saveCheckout(id){
  const checkout = collectCheckoutFromForm();
  const { error } = await db.from("bookings").update({ checkout, status: "completed" }).eq("id", id);
  if(error){
    alert("收銀資料儲存失敗");
    console.error(error);
    return;
  }
  alert("收銀資料已儲存");
  closeBookingModal();
  renderBookings();
  if(typeof renderPendingCenter === "function") renderPendingCenter();
  if(typeof renderMonthlyReport === "function") renderMonthlyReport();
}


const roomOptions = ["未指定", "201", "202", "203", "VIP301-A", "VIP301-B", "VIP302"];

function roomDisplay(room){
  if(room === "VIP301-A") return "VIP301 床A";
  if(room === "VIP301-B") return "VIP301 床B";
  return room || "未指定";
}

function renderRoomForm(b){
  const selected = b.checkout?.room || "未指定";
  return `<div class="room-box">
    <h3>房型安排</h3>
    <p class="hint">VIP301 有兩張床，可同時安排兩位；系統以 VIP301 床A／床B 分開記錄。</p>
    <div class="form-grid">
      <div class="field">
        <label>房型／床位</label>
        <select id="roomSelect">
          ${roomOptions.map(r => `<option value="${r}" ${selected===r ? "selected" : ""}>${roomDisplay(r)}</option>`).join("")}
        </select>
      </div>
    </div>
    <button type="button" onclick="saveRoom('${escapeHtml(b.id)}')">儲存房型</button>
  </div>`;
}

async function saveRoom(id){
  const room = document.getElementById("roomSelect")?.value || "未指定";
  const booking = currentBookings.find(b => b.id === id) || {};
  const checkout = booking.checkout || {};
  checkout.room = room;
  const { error } = await db.from("bookings").update({ checkout }).eq("id", id);
  if(error){
    alert("房型儲存失敗");
    console.error(error);
    return;
  }
  alert("房型已儲存");
  closeBookingModal();
  renderBookings();
  if(typeof renderTodayWorklist === "function") renderTodayWorklist();
}

async function renderTodayWorklist(){
  let box = document.getElementById("todayWorklistCard");
  const adminMain = document.getElementById("adminMain");
  if(!adminMain) return;

  if(!box){
    box = document.createElement("section");
    box.className = "card";
    box.id = "todayWorklistCard";
    box.innerHTML = `
      <div class="report-title-row">
        <h2>今日工作清單／未收銀提醒</h2>
        <button type="button" onclick="renderTodayWorklist()">更新</button>
      </div>
      <div id="todayWorklistContent" class="muted">載入中...</div>
    `;
    const firstCard = adminMain.querySelector(".card");
    if(firstCard && firstCard.nextSibling){
      adminMain.insertBefore(box, firstCard.nextSibling);
    }else{
      adminMain.appendChild(box);
    }
  }

  const content = document.getElementById("todayWorklistContent");
  const dateValue = document.getElementById("date")?.value || new Date().toISOString().slice(0,10);

  const { data, error } = await db.from("bookings").select("*").eq("date", dateValue).order("slot", { ascending: true });
  if(error){
    content.innerHTML = "今日工作清單讀取失敗。";
    console.error(error);
    return;
  }

  const rows = data || [];
  if(!rows.length){
    content.className = "muted";
    content.innerHTML = "這一天目前沒有預約。";
    return;
  }

  const active = rows.filter(b => b.status !== "cancelled");
  const unpaid = active.filter(b => b.status !== "completed" && b.status !== "cancelled");
  const noRoom = active.filter(b => !b.checkout?.room || b.checkout?.room === "未指定");

  content.className = "today-worklist";
  content.innerHTML = `
    <div class="worklist-stats">
      <div class="stat-card"><div class="stat-value">${active.length}</div><div class="stat-label">今日預約</div></div>
      <div class="stat-card"><div class="stat-value">${unpaid.length}</div><div class="stat-label">未完成收銀</div></div>
      <div class="stat-card"><div class="stat-value">${noRoom.length}</div><div class="stat-label">未安排房型</div></div>
    </div>
    <div class="worklist-list">
      ${active.map(b => `<div class="worklist-item ${therapistClass(b.therapist)}" onclick="openBookingModal('${escapeHtml(b.id)}')">
        <div class="booking-color-strip"></div>
        <strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name)}</strong>
        <div>${escapeHtml(b.therapist)}｜${roomDisplay(b.checkout?.room)}</div>
        <div class="hint">${statusText(b.status)}｜${formatItems(b.items, true)}</div>
      </div>`).join("")}
    </div>`;
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

function sum(arr, fn){
  return (arr || []).reduce((total, item) => total + Number(fn(item) || 0), 0);
}

function getMonthRange(dateStr){
  const ym = (dateStr || new Date().toISOString().slice(0,10)).slice(0,7);
  const year = Number(ym.slice(0,4));
  const month = Number(ym.slice(5,7));
  const lastDay = new Date(year, month, 0).getDate();
  return { ym, start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2,"0")}` };
}

function checkoutTotals(checkout){
  const c = checkout || {};
  const techRows = c.tech_rows || [];
  const tech30Amount = sum(techRows.filter(r => String(r.rate)==="30"), r => r.amount);
  const tech40Amount = sum(techRows.filter(r => String(r.rate)==="40"), r => r.amount);
  const tech30Bonus = Math.round(tech30Amount * 0.30);
  const tech40Bonus = Math.round(tech40Amount * 0.40);
  const productAmount = Number(c.product_amount || 0);
  const productBonus = Math.round(productAmount * 0.10);
  const courseAmount = Number(c.course_amount || 0);
  const storedValueNewAmount = Number(c.stored_value_new_amount || 0);
  const courseBonus = Math.round((courseAmount + storedValueNewAmount) * 0.02);
  const platformPay = Number(c.platform_fixed_pay || 0);
  const totalReceived = Number(c.total_received || 0);
  const salaryTotal = tech30Bonus + tech40Bonus + productBonus + courseBonus + platformPay;
  return {
    tech30Amount, tech40Amount, tech30Bonus, tech40Bonus,
    productAmount, productBonus,
    courseAmount, storedValueNewAmount, courseBonus,
    platformPay, totalReceived, salaryTotal
  };
}

function reportCard(title, lines){
  return `<div class="report-card">
    <h3>${escapeHtml(title)}</h3>
    ${lines.map(row => `<div class="report-line"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`).join("")}
  </div>`;
}

async function renderMonthlyReport(){
  const old = document.getElementById("monthlyReportCard");
  let box = old;
  const adminMain = document.getElementById("adminMain");
  if(!adminMain) return;

  if(!box){
    box = document.createElement("section");
    box.className = "card";
    box.id = "monthlyReportCard";
    box.innerHTML = `
      <div class="report-title-row">
        <h2>本月收銀／薪資統計</h2>
        <button type="button" onclick="renderMonthlyReport()">更新統計</button>
      </div>
      <div id="monthlyReportContent" class="muted">載入中...</div>
    `;
    adminMain.appendChild(box);
  }

  const content = document.getElementById("monthlyReportContent");
  if(!content) return;

  const dateValue = document.getElementById("date")?.value || new Date().toISOString().slice(0,10);
  const { ym, start, end } = getMonthRange(dateValue);

  const { data, error } = await db
    .from("bookings")
    .select("*")
    .gte("date", start)
    .lte("date", end)
    .not("checkout", "is", null);

  if(error){
    content.innerHTML = "月報讀取失敗。";
    console.error(error);
    return;
  }

  const rows = data || [];
  if(!rows.length){
    content.className = "muted";
    content.innerHTML = `${ym} 目前尚無收銀資料。`;
    return;
  }

  content.className = "monthly-report-grid";

  const allTotals = rows.map(b => checkoutTotals(b.checkout));
  const totalRevenue = sum(allTotals, t => t.totalReceived);
  const totalSalary = sum(allTotals, t => t.salaryTotal);
  const totalProduct = sum(allTotals, t => t.productAmount);
  const totalCourse = sum(allTotals, t => t.courseAmount);
  const totalStored = sum(allTotals, t => t.storedValueNewAmount);
  const totalPlatform = sum(allTotals, t => t.platformPay);

  const paymentGroups = {};
  rows.forEach(b => {
    const method = b.checkout?.payment_method || "未填";
    paymentGroups[method] = (paymentGroups[method] || 0) + Number(b.checkout?.total_received || 0);
  });

  const therapistGroups = {};
  rows.forEach(b => {
    const name = b.therapist || "不指定";
    if(!therapistGroups[name]){
      therapistGroups[name] = [];
    }
    therapistGroups[name].push(checkoutTotals(b.checkout));
  });

  let html = "";
  html += reportCard(`${ym} 全店收銀`, [
    ["本月收款", `NT$ ${money(totalRevenue)}`],
    ["商品銷售", `NT$ ${money(totalProduct)}`],
    ["課程銷售", `NT$ ${money(totalCourse)}`],
    ["新收儲值", `NT$ ${money(totalStored)}`],
    ["平台固定薪資", `NT$ ${money(totalPlatform)}`],
    ["薪資合計", `NT$ ${money(totalSalary)}`]
  ]);

  html += reportCard("收款方式", Object.entries(paymentGroups).map(([method, amount]) => [method, `NT$ ${money(amount)}`]));

  Object.entries(therapistGroups).forEach(([name, list]) => {
    const tech30Amount = sum(list, t => t.tech30Amount);
    const tech40Amount = sum(list, t => t.tech40Amount);
    const tech30Bonus = sum(list, t => t.tech30Bonus);
    const tech40Bonus = sum(list, t => t.tech40Bonus);
    const productBonus = sum(list, t => t.productBonus);
    const courseBonus = sum(list, t => t.courseBonus);
    const platformPay = sum(list, t => t.platformPay);
    const salary = sum(list, t => t.salaryTotal);
    html += reportCard(`${name} 薪資`, [
      ["技術30%金額", `NT$ ${money(tech30Amount)}`],
      ["技術30%獎金", `NT$ ${money(tech30Bonus)}`],
      ["技術40%金額", `NT$ ${money(tech40Amount)}`],
      ["技術40%獎金", `NT$ ${money(tech40Bonus)}`],
      ["商品10%", `NT$ ${money(productBonus)}`],
      ["課程／儲值2%", `NT$ ${money(courseBonus)}`],
      ["平台固定", `NT$ ${money(platformPay)}`],
      ["薪資合計", `NT$ ${money(salary)}`]
    ]);
  });

  content.innerHTML = html;
}

const today = new Date();
$("date").value = today.toISOString().slice(0,10);
$("date").addEventListener("change", () => { renderBookings(); renderTodayWorklist(); renderMonthlyReport(); });
$("therapistFilter").addEventListener("change", renderBookings);
$("viewMode").addEventListener("change", renderBookings);
if (getCurrentUser()) showAdmin();



/* =========================
   CONSTONIC ADMIN V2.0 PATCH
   房型、收銀、今日工作總覽：強制整合版
========================= */

window.CONSTONIC_ADMIN_VERSION = "V2.0";

const V2_ROOM_OPTIONS = ["未指定", "201", "202", "203", "VIP301-A", "VIP301-B", "VIP302"];

function v2RoomDisplay(room){
  if(room === "VIP301-A") return "VIP301 床A";
  if(room === "VIP301-B") return "VIP301 床B";
  return room || "未指定";
}

function v2Money(n){
  return Number(n || 0).toLocaleString("zh-TW");
}

function v2CheckoutDefaults(b){
  const c = b.checkout || {};
  const techRows = c.tech_rows || (b.items || []).map((item, idx) => ({
    item_name: item.name || `技術${idx+1}`,
    amount: 0,
    rate: "30"
  }));
  return {
    room: c.room || "未指定",
    payment_status: c.payment_status || "未收款",
    payment_method: c.payment_method || "現金",
    tech_rows: techRows,
    product_amount: Number(c.product_amount || 0),
    course_amount: Number(c.course_amount || 0),
    stored_value_new_amount: Number(c.stored_value_new_amount || 0),
    platform_fixed_pay: Number(c.platform_fixed_pay || 0),
    total_received: Number(c.total_received || 0),
    invoice_status: c.invoice_status || "未開",
    receipt_note: c.receipt_note || ""
  };
}

function v2CheckoutTotals(c){
  const tech30Rows = (c.tech_rows || []).filter(r => String(r.rate) === "30");
  const tech40Rows = (c.tech_rows || []).filter(r => String(r.rate) === "40");
  const tech30Amount = tech30Rows.reduce((s,r)=>s+Number(r.amount||0),0);
  const tech40Amount = tech40Rows.reduce((s,r)=>s+Number(r.amount||0),0);
  const tech30Bonus = Math.round(tech30Amount * .30);
  const tech40Bonus = Math.round(tech40Amount * .40);
  const productBonus = Math.round(Number(c.product_amount||0) * .10);
  const courseBonus = Math.round((Number(c.course_amount||0)+Number(c.stored_value_new_amount||0)) * .02);
  const platformPay = Number(c.platform_fixed_pay||0);
  return {tech30Amount, tech40Amount, tech30Bonus, tech40Bonus, productBonus, courseBonus, platformPay, salaryTotal: tech30Bonus+tech40Bonus+productBonus+courseBonus+platformPay};
}

function v2FormatItems(items){
  return (items || []).map((i, idx) => `${idx+1}. ${escapeHtml(i.name || "-")}（${Number(i.duration||0)}分）${i.therapist ? "｜"+escapeHtml(i.therapist) : ""}`).join("<br>");
}

function v2StatusText(status){
  if(typeof statusText === "function") return statusText(status);
  if(status === "pending") return "待確認";
  if(status === "confirmed") return "已確認";
  if(status === "cancelled") return "已取消";
  if(status === "completed") return "已完成";
  if(status === "nail_request") return "美甲待確認";
  return status || "待確認";
}

function v2RenderRoomSection(b){
  const c = v2CheckoutDefaults(b);
  return `<div class="v2-section room-box">
    <h3>房型安排</h3>
    <p class="hint">VIP301 有兩張床，可同時安排兩位；請以床A／床B 分開指定。</p>
    <div class="field">
      <label>房型／床位</label>
      <select id="v2RoomSelect">
        ${V2_ROOM_OPTIONS.map(r=>`<option value="${r}" ${c.room===r ? "selected" : ""}>${v2RoomDisplay(r)}</option>`).join("")}
      </select>
    </div>
    <button type="button" onclick="v2SaveRoom('${escapeHtml(b.id)}')">儲存房型</button>
  </div>`;
}

function v2RenderCheckoutSection(b){
  const c = v2CheckoutDefaults(b);
  const totals = v2CheckoutTotals(c);
  const rows = (c.tech_rows || []).map((r,idx)=>`
    <div class="cashier-row">
      <div class="field"><label>技術項目</label><input id="v2TechName_${idx}" value="${escapeHtml(r.item_name||"")}"></div>
      <div class="field"><label>技術金額</label><input id="v2TechAmount_${idx}" type="number" min="0" value="${Number(r.amount||0)}"></div>
      <div class="field"><label>抽成</label><select id="v2TechRate_${idx}">
        <option value="30" ${String(r.rate)==="30"?"selected":""}>30%</option>
        <option value="40" ${String(r.rate)==="40"?"selected":""}>40%</option>
      </select></div>
    </div>`).join("");

  return `<div class="v2-section cashier-box">
    <h3>收銀／薪資計算</h3>
    <p class="hint">商品10%；技術可選30%或40%；新購課程／新收儲值2%；平台團購固定薪資手動輸入。</p>

    <div class="form-grid">
      <div class="field"><label>收款狀態</label><select id="v2PaymentStatus">${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>收款方式</label><select id="v2PaymentMethod">${["現金","刷卡","匯款","LINE Pay","街口支付","Apple Pay","Google Pay","其他"].map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}</select></div>
    </div>

    <h4>技術服務</h4>
    <div id="v2TechRows" data-count="${(c.tech_rows||[]).length}">${rows}</div>

    <h4>其他收入／獎金</h4>
    <div class="form-grid">
      <div class="field"><label>商品銷售金額（10%）</label><input id="v2ProductAmount" type="number" min="0" value="${c.product_amount}"></div>
      <div class="field"><label>新購課程金額（2%）</label><input id="v2CourseAmount" type="number" min="0" value="${c.course_amount}"></div>
      <div class="field"><label>新收儲值金額（2%）</label><input id="v2StoredValueAmount" type="number" min="0" value="${c.stored_value_new_amount}"></div>
      <div class="field"><label>平台團購固定薪資</label><input id="v2PlatformPay" type="number" min="0" value="${c.platform_fixed_pay}"></div>
      <div class="field"><label>本次實際收款</label><input id="v2TotalReceived" type="number" min="0" value="${c.total_received}"></div>
      <div class="field"><label>發票狀態</label><select id="v2InvoiceStatus">${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
    </div>

    <div class="field"><label>收款備註</label><textarea id="v2ReceiptNote" rows="2">${escapeHtml(c.receipt_note||"")}</textarea></div>

    <div class="cashier-summary">
      <div>技術30%：NT$ ${v2Money(totals.tech30Bonus)}</div>
      <div>技術40%：NT$ ${v2Money(totals.tech40Bonus)}</div>
      <div>商品10%：NT$ ${v2Money(totals.productBonus)}</div>
      <div>課程／儲值2%：NT$ ${v2Money(totals.courseBonus)}</div>
      <div>平台固定：NT$ ${v2Money(totals.platformPay)}</div>
      <strong>本次薪資合計：NT$ ${v2Money(totals.salaryTotal)}</strong>
    </div>

    <button type="button" class="primary" onclick="v2SaveCheckout('${escapeHtml(b.id)}')">儲存收銀資料</button>
  </div>`;
}

function v2CollectCheckout(existing){
  const count = Number(document.getElementById("v2TechRows")?.dataset.count || 0);
  const tech_rows = [];
  for(let i=0;i<count;i++){
    tech_rows.push({
      item_name: document.getElementById(`v2TechName_${i}`)?.value || "",
      amount: Number(document.getElementById(`v2TechAmount_${i}`)?.value || 0),
      rate: document.getElementById(`v2TechRate_${i}`)?.value || "30"
    });
  }
  const checkout = {
    ...(existing || {}),
    room: document.getElementById("v2RoomSelect")?.value || existing?.room || "未指定",
    payment_status: document.getElementById("v2PaymentStatus")?.value || "未收款",
    payment_method: document.getElementById("v2PaymentMethod")?.value || "現金",
    tech_rows,
    product_amount: Number(document.getElementById("v2ProductAmount")?.value || 0),
    course_amount: Number(document.getElementById("v2CourseAmount")?.value || 0),
    stored_value_new_amount: Number(document.getElementById("v2StoredValueAmount")?.value || 0),
    platform_fixed_pay: Number(document.getElementById("v2PlatformPay")?.value || 0),
    total_received: Number(document.getElementById("v2TotalReceived")?.value || 0),
    invoice_status: document.getElementById("v2InvoiceStatus")?.value || "未開",
    receipt_note: document.getElementById("v2ReceiptNote")?.value || ""
  };
  checkout.calculated = v2CheckoutTotals(checkout);
  return checkout;
}

async function v2SaveRoom(id){
  const booking = (currentBookings || []).find(b=>b.id===id) || {};
  const checkout = {...(booking.checkout || {}), room: document.getElementById("v2RoomSelect")?.value || "未指定"};
  const {error} = await db.from("bookings").update({checkout}).eq("id", id);
  if(error){ alert("房型儲存失敗"); console.error(error); return; }
  alert("房型已儲存");
  if(typeof renderBookings==="function") renderBookings();
  if(typeof v2RenderTodayWorklist==="function") v2RenderTodayWorklist();
}

async function v2SaveCheckout(id){
  const booking = (currentBookings || []).find(b=>b.id===id) || {};
  const checkout = v2CollectCheckout(booking.checkout || {});
  const {error} = await db.from("bookings").update({checkout, status:"completed"}).eq("id", id);
  if(error){ alert("收銀資料儲存失敗"); console.error(error); return; }
  alert("收銀資料已儲存，狀態已改為已完成");
  closeBookingModal();
  if(typeof renderBookings==="function") renderBookings();
  if(typeof v2RenderTodayWorklist==="function") v2RenderTodayWorklist();
  if(typeof renderMonthlyReport==="function") renderMonthlyReport();
}

window.openBookingModal = function(id){
  const b = (currentBookings || []).find(x=>x.id===id);
  if(!b){ alert("找不到這筆預約"); return; }
  const modal = document.getElementById("bookingModal");
  const body = document.getElementById("bookingModalBody");
  if(!modal || !body){ alert("後台彈窗元件不存在，請確認 admin.html 已更新到 V2.0"); return; }

  const nail = b.nail_request || null;
  body.innerHTML = `<h2>預約完整資料</h2>
    <div class="v2-booking-detail">
      <p><strong>預約時間：</strong>${escapeHtml(b.date)} ${escapeHtml(b.slot)}</p>
      <p><strong>客戶姓名：</strong>${escapeHtml(b.customer_name || "-")}</p>
      <p><strong>電話：</strong>${escapeHtml(b.phone || "-")}</p>
      <p><strong>LINE：</strong>${escapeHtml(b.line_name || "-")}</p>
      <p><strong>第一次來店：</strong>${escapeHtml(b.first_visit || "-")}</p>
      <p><strong>美容師：</strong>${escapeHtml(b.therapist || "-")}</p>
      <p><strong>預約項目：</strong><br>${v2FormatItems(b.items)}</p>
      ${nail ? `<p><strong>美甲申請：</strong><br>希望時段：${escapeHtml(nail.preferred_period||"-")}<br>指定時間：${escapeHtml(nail.preferred_time||"-")}<br>手部/足部：${escapeHtml(nail.part||"-")}<br>樣式：${escapeHtml(nail.style||"-")}<br>備註：${escapeHtml(nail.nail_note||"-")}</p>` : ""}
      <p><strong>時間保留：</strong>療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</p>
      <p><strong>備註：</strong>${escapeHtml(b.note || "-")}</p>
      <p><strong>狀態：</strong>${v2StatusText(b.status)}</p>
    </div>
    ${v2RenderRoomSection(b)}
    ${v2RenderCheckoutSection(b)}
    <div class="modal-actions">
      <button onclick="updateStatus('${escapeHtml(b.id)}','confirmed')">已確認</button>
      <button onclick="updateStatus('${escapeHtml(b.id)}','cancelled')">取消</button>
      <button onclick="deleteBooking('${escapeHtml(b.id)}')">刪除</button>
    </div>`;
  modal.classList.remove("hidden");
};

async function v2RenderTodayWorklist(){
  const content = document.getElementById("todayWorklistContent");
  if(!content) return;
  const dateValue = document.getElementById("date")?.value || new Date().toISOString().slice(0,10);
  const {data,error} = await db.from("bookings").select("*").eq("date", dateValue).order("slot", {ascending:true});
  if(error){ content.innerHTML = "今日工作清單讀取失敗。"; console.error(error); return; }
  const rows = data || [];
  const active = rows.filter(b=>b.status!=="cancelled");
  const unpaid = active.filter(b=>b.status!=="completed");
  const noRoom = active.filter(b=>!b.checkout?.room || b.checkout?.room==="未指定");
  content.className = "today-worklist";
  if(!active.length){ content.innerHTML = "這一天目前沒有預約。"; return; }
  content.innerHTML = `<div class="worklist-stats">
    <div class="stat-card"><div class="stat-value">${active.length}</div><div class="stat-label">今日預約</div></div>
    <div class="stat-card"><div class="stat-value">${unpaid.length}</div><div class="stat-label">未完成收銀</div></div>
    <div class="stat-card"><div class="stat-value">${noRoom.length}</div><div class="stat-label">未安排房型</div></div>
  </div>
  <div class="worklist-list">${active.map(b=>`<div class="worklist-item ${typeof therapistClass==="function"?therapistClass(b.therapist):""}" onclick="openBookingModal('${escapeHtml(b.id)}')">
    <div class="booking-color-strip"></div>
    <strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name||"-")}</strong>
    <div>${escapeHtml(b.therapist||"-")}｜${v2RoomDisplay(b.checkout?.room)}</div>
    <div class="hint">${v2StatusText(b.status)}｜${v2FormatItems(b.items)}</div>
  </div>`).join("")}</div>`;
}

const v2OriginalRenderBookings = window.renderBookings || renderBookings;
if(typeof v2OriginalRenderBookings === "function"){
  window.renderBookings = async function(){
    await v2OriginalRenderBookings();
    setTimeout(()=>{ v2RenderTodayWorklist(); if(typeof renderMonthlyReport==="function") renderMonthlyReport(); }, 100);
  };
}

setTimeout(()=>{ v2RenderTodayWorklist(); }, 800);



/* =========================
   CONSTONIC V2.1 BOOKING BLOCKS
   一鍵關閉預約日 / 美容師休假
========================= */

const BLOCK_THERAPISTS = ["全店", "雅潔老師", "巧萱美容師", "曼曼美甲師"];

async function v21LoadBlocks(){
  const box = document.getElementById("bookingBlocksContent");
  if(!box) return;
  const dateValue = document.getElementById("blockDate")?.value || document.getElementById("date")?.value || new Date().toISOString().slice(0,10);
  const { data, error } = await db.from("booking_blocks").select("*").eq("date", dateValue).order("created_at", { ascending:false });
  if(error){
    box.innerHTML = "讀取關閉日失敗，請確認 Supabase 已執行 V2.1 SQL。";
    console.error(error);
    return;
  }
  const rows = data || [];
  if(!rows.length){
    box.innerHTML = "這一天沒有關閉設定。";
    return;
  }
  box.innerHTML = rows.map(b => `<div class="block-row">
    <div><strong>${escapeHtml(b.date)}</strong>｜${escapeHtml(b.therapist || "全店")}｜${escapeHtml(b.reason || "休假/不開放")}</div>
    <button type="button" onclick="v21DeleteBlock('${escapeHtml(b.id)}')">刪除</button>
  </div>`).join("");
}

async function v21CreateBlock(){
  const date = document.getElementById("blockDate")?.value || document.getElementById("date")?.value;
  const therapist = document.getElementById("blockTherapist")?.value || "全店";
  const reason = document.getElementById("blockReason")?.value || "休假/不開放";
  if(!date){
    alert("請先選擇日期");
    return;
  }
  const { error } = await db.from("booking_blocks").insert({
    date,
    therapist,
    reason,
    all_day: true
  });
  if(error){
    alert("新增關閉日失敗，請確認 Supabase 已執行 V2.1 SQL");
    console.error(error);
    return;
  }
  alert("已新增關閉設定");
  v21LoadBlocks();
}

async function v21DeleteBlock(id){
  if(!confirm("確定刪除這個關閉設定？")) return;
  const { error } = await db.from("booking_blocks").delete().eq("id", id);
  if(error){
    alert("刪除失敗");
    console.error(error);
    return;
  }
  v21LoadBlocks();
}

function v21EnsureBlocksPanel(){
  const adminMain = document.getElementById("adminMain");
  if(!adminMain || document.getElementById("bookingBlocksCard")) return;

  const card = document.createElement("section");
  card.className = "card";
  card.id = "bookingBlocksCard";
  card.innerHTML = `
    <h2>一鍵關閉預約日／美容師休假</h2>
    <p class="hint">可關閉全店當天預約，或只關閉某位美容師當天預約。不需要每天輸入上下班時間。</p>
    <div class="form-grid">
      <div class="field">
        <label>關閉日期</label>
        <input type="date" id="blockDate" value="${document.getElementById("date")?.value || new Date().toISOString().slice(0,10)}">
      </div>
      <div class="field">
        <label>關閉對象</label>
        <select id="blockTherapist">
          ${BLOCK_THERAPISTS.map(t => `<option>${t}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>原因</label>
        <input id="blockReason" placeholder="例如：公休、課程日、老師休假">
      </div>
    </div>
    <button type="button" class="primary" onclick="v21CreateBlock()">新增關閉設定</button>
    <div id="bookingBlocksContent" class="booking-blocks-list muted">載入中...</div>
  `;
  adminMain.appendChild(card);

  document.getElementById("blockDate")?.addEventListener("change", v21LoadBlocks);
  v21LoadBlocks();
}

setTimeout(v21EnsureBlocksPanel, 900);



/* =========================
   CONSTONIC V2.2 COMPACT MODAL
   手機版分頁式彈窗，避免頁面過長卡頓
========================= */

function v22SwitchTab(tab){
  document.querySelectorAll(".v22-tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll(".v22-tab-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === tab));
}

function v22RenderCompactBookingDetail(b){
  const nail = b.nail_request || null;
  return `<div class="v22-detail-list">
    <div><span>預約時間</span><strong>${escapeHtml(b.date)} ${escapeHtml(b.slot)}</strong></div>
    <div><span>姓名</span><strong>${escapeHtml(b.customer_name || "-")}</strong></div>
    <div><span>電話</span><strong>${escapeHtml(b.phone || "-")}</strong></div>
    <div><span>LINE</span><strong>${escapeHtml(b.line_name || "-")}</strong></div>
    <div><span>美容師</span><strong>${escapeHtml(b.therapist || "-")}</strong></div>
    <div><span>狀態</span><strong>${v2StatusText(b.status)}</strong></div>
    <div class="full"><span>預約項目</span><p>${v2FormatItems(b.items)}</p></div>
    <div class="full"><span>時間保留</span><p>療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</p></div>
    ${nail ? `<div class="full"><span>美甲申請</span><p>希望時段：${escapeHtml(nail.preferred_period||"-")}<br>指定時間：${escapeHtml(nail.preferred_time||"-")}<br>手部/足部：${escapeHtml(nail.part||"-")}<br>樣式：${escapeHtml(nail.style||"-")}<br>備註：${escapeHtml(nail.nail_note||"-")}</p></div>` : ""}
    <div class="full"><span>備註</span><p>${escapeHtml(b.note || "-")}</p></div>
  </div>`;
}

function v22RenderCompactCheckoutSection(b){
  const c = v2CheckoutDefaults(b);
  const totals = v2CheckoutTotals(c);
  const rows = (c.tech_rows || []).map((r,idx)=>`
    <div class="cashier-row compact">
      <div class="field"><label>項目</label><input id="v2TechName_${idx}" value="${escapeHtml(r.item_name||"")}"></div>
      <div class="field"><label>金額</label><input id="v2TechAmount_${idx}" type="number" min="0" value="${Number(r.amount||0)}"></div>
      <div class="field"><label>抽成</label><select id="v2TechRate_${idx}">
        <option value="30" ${String(r.rate)==="30"?"selected":""}>30%</option>
        <option value="40" ${String(r.rate)==="40"?"selected":""}>40%</option>
      </select></div>
    </div>`).join("");

  return `<div class="v22-compact-checkout">
    <div class="form-grid compact-grid">
      <div class="field"><label>收款狀態</label><select id="v2PaymentStatus">${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>收款方式</label><select id="v2PaymentMethod">${["現金","刷卡","匯款","LINE Pay","街口支付","Apple Pay","Google Pay","其他"].map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}</select></div>
    </div>

    <details open class="v22-details">
      <summary>技術服務</summary>
      <div id="v2TechRows" data-count="${(c.tech_rows||[]).length}">${rows}</div>
    </details>

    <details class="v22-details">
      <summary>商品／課程／儲值／平台</summary>
      <div class="form-grid compact-grid">
        <div class="field"><label>商品（10%）</label><input id="v2ProductAmount" type="number" min="0" value="${c.product_amount}"></div>
        <div class="field"><label>新購課程（2%）</label><input id="v2CourseAmount" type="number" min="0" value="${c.course_amount}"></div>
        <div class="field"><label>新收儲值（2%）</label><input id="v2StoredValueAmount" type="number" min="0" value="${c.stored_value_new_amount}"></div>
        <div class="field"><label>平台固定薪資</label><input id="v2PlatformPay" type="number" min="0" value="${c.platform_fixed_pay}"></div>
        <div class="field"><label>本次實收</label><input id="v2TotalReceived" type="number" min="0" value="${c.total_received}"></div>
        <div class="field"><label>發票</label><select id="v2InvoiceStatus">${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>收款備註</label><textarea id="v2ReceiptNote" rows="2">${escapeHtml(c.receipt_note||"")}</textarea></div>
    </details>

    <div class="cashier-summary compact-summary">
      <div>技術30%：NT$ ${v2Money(totals.tech30Bonus)}</div>
      <div>技術40%：NT$ ${v2Money(totals.tech40Bonus)}</div>
      <div>商品10%：NT$ ${v2Money(totals.productBonus)}</div>
      <div>課程／儲值2%：NT$ ${v2Money(totals.courseBonus)}</div>
      <div>平台固定：NT$ ${v2Money(totals.platformPay)}</div>
      <strong>本次薪資：NT$ ${v2Money(totals.salaryTotal)}</strong>
    </div>
  </div>`;
}

window.openBookingModal = function(id){
  const b = (currentBookings || []).find(x=>x.id===id);
  if(!b){ alert("找不到這筆預約"); return; }
  const modal = document.getElementById("bookingModal");
  const body = document.getElementById("bookingModalBody");
  if(!modal || !body){ alert("後台彈窗元件不存在，請確認 admin.html 已更新"); return; }

  body.innerHTML = `<div class="v22-modal-shell">
    <div class="v22-modal-header">
      <div>
        <h2>預約資料</h2>
        <p>${escapeHtml(b.customer_name || "-")}｜${escapeHtml(b.date)} ${escapeHtml(b.slot)}</p>
      </div>
      <button class="modal-close" onclick="closeBookingModal()">×</button>
    </div>

    <div class="v22-tabs">
      <button type="button" class="v22-tab-btn active" data-tab="detail" onclick="v22SwitchTab('detail')">資料</button>
      <button type="button" class="v22-tab-btn" data-tab="room" onclick="v22SwitchTab('room')">房型</button>
      <button type="button" class="v22-tab-btn" data-tab="cashier" onclick="v22SwitchTab('cashier')">收銀</button>
    </div>

    <div class="v22-modal-scroll">
      <section class="v22-tab-panel active" data-panel="detail">
        ${v22RenderCompactBookingDetail(b)}
      </section>

      <section class="v22-tab-panel" data-panel="room">
        ${v2RenderRoomSection(b)}
      </section>

      <section class="v22-tab-panel" data-panel="cashier">
        ${v22RenderCompactCheckoutSection(b)}
      </section>
    </div>

    <div class="v22-modal-actions">
      <button onclick="updateStatus('${escapeHtml(b.id)}','confirmed')">已確認</button>
      <button onclick="updateStatus('${escapeHtml(b.id)}','cancelled')">取消</button>
      <button onclick="deleteBooking('${escapeHtml(b.id)}')">刪除</button>
      <button class="primary" onclick="v2SaveCheckout('${escapeHtml(b.id)}')">儲存收銀</button>
    </div>
  </div>`;
  modal.classList.remove("hidden");
};



/* =========================
   CONSTONIC ADMIN V3.0
   Responsive SPA/POS Layout
   電腦左右分欄／平板手機自動收放
========================= */

window.CONSTONIC_ADMIN_VERSION = "V3.0";

function v3SafeStatus(status){
  if(typeof v2StatusText === "function") return v2StatusText(status);
  if(typeof statusText === "function") return statusText(status);
  if(status === "pending") return "待確認";
  if(status === "confirmed") return "已確認";
  if(status === "cancelled") return "已取消";
  if(status === "completed") return "已完成";
  if(status === "nail_request") return "美甲待確認";
  return status || "待確認";
}

function v3Items(items){
  if(typeof v2FormatItems === "function") return v2FormatItems(items);
  return (items || []).map((i, idx) => `${idx+1}. ${escapeHtml(i.name || "-")}（${Number(i.duration||0)}分）${i.therapist ? "｜"+escapeHtml(i.therapist) : ""}`).join("<br>");
}

function v3CheckoutDefaults(b){
  if(typeof v2CheckoutDefaults === "function") return v2CheckoutDefaults(b);
  const c = b.checkout || {};
  return {
    room: c.room || "未指定",
    payment_status: c.payment_status || "未收款",
    payment_method: c.payment_method || "現金",
    tech_rows: c.tech_rows || (b.items || []).map((item, idx)=>({ item_name:item.name || `技術${idx+1}`, amount:0, rate:"30" })),
    product_amount: Number(c.product_amount || 0),
    course_amount: Number(c.course_amount || 0),
    stored_value_new_amount: Number(c.stored_value_new_amount || 0),
    platform_fixed_pay: Number(c.platform_fixed_pay || 0),
    total_received: Number(c.total_received || 0),
    invoice_status: c.invoice_status || "未開",
    receipt_note: c.receipt_note || ""
  };
}

function v3Totals(c){
  if(typeof v2CheckoutTotals === "function") return v2CheckoutTotals(c);
  const tech30 = (c.tech_rows || []).filter(r=>String(r.rate)==="30").reduce((s,r)=>s+Number(r.amount||0),0);
  const tech40 = (c.tech_rows || []).filter(r=>String(r.rate)==="40").reduce((s,r)=>s+Number(r.amount||0),0);
  const tech30Bonus = Math.round(tech30*.3);
  const tech40Bonus = Math.round(tech40*.4);
  const productBonus = Math.round(Number(c.product_amount||0)*.1);
  const courseBonus = Math.round((Number(c.course_amount||0)+Number(c.stored_value_new_amount||0))*.02);
  const platformPay = Number(c.platform_fixed_pay||0);
  return {tech30Bonus, tech40Bonus, productBonus, courseBonus, platformPay, salaryTotal: tech30Bonus+tech40Bonus+productBonus+courseBonus+platformPay};
}

function v3Money(n){
  if(typeof v2Money === "function") return v2Money(n);
  return Number(n||0).toLocaleString("zh-TW");
}

function v3RoomDisplay(room){
  if(typeof v2RoomDisplay === "function") return v2RoomDisplay(room);
  if(room === "VIP301-A") return "VIP301 床A";
  if(room === "VIP301-B") return "VIP301 床B";
  return room || "未指定";
}

function v3RoomSection(b){
  const c = v3CheckoutDefaults(b);
  const rooms = ["未指定","201","202","203","VIP301-A","VIP301-B","VIP302"];
  return `<div class="v3-panel">
    <h3>房型安排</h3>
    <p class="hint">VIP301 有兩張床，可同時安排兩位，請分床A／床B。</p>
    <div class="field">
      <label>房型／床位</label>
      <select id="v2RoomSelect">
        ${rooms.map(r=>`<option value="${r}" ${c.room===r?"selected":""}>${v3RoomDisplay(r)}</option>`).join("")}
      </select>
    </div>
    <button type="button" onclick="v2SaveRoom('${escapeHtml(b.id)}')">儲存房型</button>
  </div>`;
}

function v3DetailSection(b){
  const nail = b.nail_request || null;
  return `<div class="v3-panel">
    <h3>預約資料</h3>
    <div class="v3-info-grid">
      <div><span>日期時間</span><strong>${escapeHtml(b.date)} ${escapeHtml(b.slot)}</strong></div>
      <div><span>姓名</span><strong>${escapeHtml(b.customer_name || "-")}</strong></div>
      <div><span>電話</span><strong>${escapeHtml(b.phone || "-")}</strong></div>
      <div><span>LINE</span><strong>${escapeHtml(b.line_name || "-")}</strong></div>
      <div><span>美容師</span><strong>${escapeHtml(b.therapist || "-")}</strong></div>
      <div><span>狀態</span><strong>${v3SafeStatus(b.status)}</strong></div>
      <div><span>第一次</span><strong>${escapeHtml(b.first_visit || "-")}</strong></div>
      <div><span>房型</span><strong>${v3RoomDisplay(b.checkout?.room)}</strong></div>
    </div>
    <div class="v3-note-block">
      <span>預約項目</span>
      <p>${v3Items(b.items)}</p>
    </div>
    <div class="v3-note-block">
      <span>時間保留</span>
      <p>療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</p>
    </div>
    ${nail ? `<div class="v3-note-block">
      <span>美甲申請</span>
      <p>希望時段：${escapeHtml(nail.preferred_period||"-")}<br>指定時間：${escapeHtml(nail.preferred_time||"-")}<br>手部/足部：${escapeHtml(nail.part||"-")}<br>樣式：${escapeHtml(nail.style||"-")}<br>備註：${escapeHtml(nail.nail_note||"-")}</p>
    </div>` : ""}
    <div class="v3-note-block">
      <span>備註</span>
      <p>${escapeHtml(b.note || "-")}</p>
    </div>
  </div>`;
}

function v3CashierSection(b){
  const c = v3CheckoutDefaults(b);
  const t = v3Totals(c);
  const rows = (c.tech_rows || []).map((r,idx)=>`
    <div class="v3-tech-row">
      <div class="field"><label>項目</label><input id="v2TechName_${idx}" value="${escapeHtml(r.item_name||"")}"></div>
      <div class="field"><label>金額</label><input id="v2TechAmount_${idx}" type="number" min="0" value="${Number(r.amount||0)}"></div>
      <div class="field"><label>抽成</label><select id="v2TechRate_${idx}">
        <option value="30" ${String(r.rate)==="30"?"selected":""}>30%</option>
        <option value="40" ${String(r.rate)==="40"?"selected":""}>40%</option>
      </select></div>
    </div>`).join("");

  return `<div class="v3-panel v3-cashier-panel">
    <h3>收銀／薪資</h3>
    <div class="v3-cashier-head">
      <div class="field"><label>收款狀態</label><select id="v2PaymentStatus">${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>收款方式</label><select id="v2PaymentMethod">${["現金","刷卡","匯款","LINE Pay","街口支付","Apple Pay","Google Pay","其他"].map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}</select></div>
    </div>

    <details open class="v3-collapse">
      <summary>技術服務</summary>
      <div id="v2TechRows" data-count="${(c.tech_rows||[]).length}" class="v3-tech-list">${rows}</div>
    </details>

    <details class="v3-collapse">
      <summary>商品／課程／儲值／平台</summary>
      <div class="v3-money-grid">
        <div class="field"><label>商品10%</label><input id="v2ProductAmount" type="number" min="0" value="${c.product_amount}"></div>
        <div class="field"><label>新課程2%</label><input id="v2CourseAmount" type="number" min="0" value="${c.course_amount}"></div>
        <div class="field"><label>新儲值2%</label><input id="v2StoredValueAmount" type="number" min="0" value="${c.stored_value_new_amount}"></div>
        <div class="field"><label>平台固定</label><input id="v2PlatformPay" type="number" min="0" value="${c.platform_fixed_pay}"></div>
        <div class="field"><label>本次實收</label><input id="v2TotalReceived" type="number" min="0" value="${c.total_received}"></div>
        <div class="field"><label>發票</label><select id="v2InvoiceStatus">${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>備註</label><textarea id="v2ReceiptNote" rows="2">${escapeHtml(c.receipt_note||"")}</textarea></div>
    </details>

    <div class="v3-salary-card">
      <div><span>技術30%</span><strong>NT$ ${v3Money(t.tech30Bonus)}</strong></div>
      <div><span>技術40%</span><strong>NT$ ${v3Money(t.tech40Bonus)}</strong></div>
      <div><span>商品10%</span><strong>NT$ ${v3Money(t.productBonus)}</strong></div>
      <div><span>課程／儲值2%</span><strong>NT$ ${v3Money(t.courseBonus)}</strong></div>
      <div><span>平台固定</span><strong>NT$ ${v3Money(t.platformPay)}</strong></div>
      <div class="total"><span>本次薪資</span><strong>NT$ ${v3Money(t.salaryTotal)}</strong></div>
    </div>
  </div>`;
}

window.openBookingModal = function(id){
  const b = (currentBookings || []).find(x=>x.id===id);
  if(!b){ alert("找不到這筆預約"); return; }

  const modal = document.getElementById("bookingModal");
  const body = document.getElementById("bookingModalBody");
  if(!modal || !body){
    alert("後台彈窗元件不存在，請確認 admin.html 已更新到 V3.0");
    return;
  }

  body.innerHTML = `<div class="v3-modal">
    <header class="v3-modal-header">
      <div>
        <p class="eyebrow">CONSTONIC ADMIN V3.0</p>
        <h2>${escapeHtml(b.customer_name || "-")}｜${escapeHtml(b.date)} ${escapeHtml(b.slot)}</h2>
      </div>
      <button class="modal-close" onclick="closeBookingModal()">×</button>
    </header>

    <main class="v3-modal-body">
      <section class="v3-left">
        ${v3DetailSection(b)}
        ${v3RoomSection(b)}
      </section>
      <section class="v3-right">
        ${v3CashierSection(b)}
      </section>
    </main>

    <footer class="v3-modal-footer">
      <button onclick="updateStatus('${escapeHtml(b.id)}','confirmed')">已確認</button>
      <button onclick="updateStatus('${escapeHtml(b.id)}','cancelled')">取消</button>
      <button onclick="deleteBooking('${escapeHtml(b.id)}')">刪除</button>
      <button class="primary" onclick="v2SaveCheckout('${escapeHtml(b.id)}')">儲存收銀</button>
    </footer>
  </div>`;

  modal.classList.remove("hidden");
};
