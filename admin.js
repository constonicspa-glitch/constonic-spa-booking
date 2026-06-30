/* 康姿多儷 SPA 預約系統 V4.0 穩定版 */
const cfg = window.CONSTONIC_CONFIG || {};
const db = window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const STAFF = ["雅潔老師", "巧萱美容師", "曼曼美甲師"];
const ALL_STAFF = ["雅潔老師", "巧萱美容師", "曼曼美甲師", "不指定"];
const ROOM_OPTIONS = ["未指定", "201", "202", "203", "VIP301-A", "VIP301-B", "VIP302"];
const PAYMENT_METHODS = ["現金", "刷卡", "匯款", "LINE Pay", "街口支付", "全支付", "Apple Pay", "Google Pay", "扣儲值", "扣課程", "團購券", "免收款", "其他"];

let currentBookings = [];
let realtimeChannel = null;

const $ = (id) => document.getElementById(id);
function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function todayISO(){ return toISO(new Date()); }
function toISO(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function dateLabel(dateStr){
  if(!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const w = ["日","一","二","三","四","五","六"][d.getDay()];
  return `${d.getFullYear()} / ${String(d.getMonth()+1).padStart(2,"0")} / ${String(d.getDate()).padStart(2,"0")} 星期${w}`;
}
function minutesToTime(min){ return `${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`; }
function money(n){ return Number(n || 0).toLocaleString("zh-TW"); }
function statusText(status){
  return ({ pending:"待確認", confirmed:"已確認", cancelled:"已取消", completed:"已完成", nail_request:"美甲待確認" }[status]) || status || "待確認";
}
function therapistClass(name){
  return ({ "雅潔老師":"therapist-yajie", "巧萱美容師":"therapist-qiaoxuan", "曼曼美甲師":"therapist-manman", "不指定":"therapist-none" }[name]) || "therapist-none";
}
function normalizeTherapist(name){ return ALL_STAFF.includes(name) ? name : "不指定"; }
function roomDisplay(room){ return room === "VIP301-A" ? "VIP301 床A" : room === "VIP301-B" ? "VIP301 床B" : (room || "未指定"); }
function formatItems(items, compact=false){
  return (items || []).map((item, idx) => {
    const t = !compact && item.therapist ? `｜${escapeHtml(item.therapist)}` : "";
    return `${idx+1}. ${escapeHtml(item.name || "-")}（${Number(item.duration || 0)}分）${t}`;
  }).join("<br>");
}
function getCurrentUser(){ return JSON.parse(sessionStorage.getItem("constonicStaffUser") || "null"); }

function login(){
  const username = $("username")?.value.trim() || "";
  const password = $("password")?.value || "";
  const user = (cfg.STAFF_ACCOUNTS || []).find(a => a.username === username && a.password === password);
  if(!user){ $("loginMessage").textContent = "帳號或密碼錯誤。"; return; }
  sessionStorage.setItem("constonicStaffUser", JSON.stringify({ username:user.username, displayName:user.displayName, role:user.role }));
  showAdmin();
}
function logout(){ sessionStorage.removeItem("constonicStaffUser"); location.reload(); }
function showAdmin(){
  const user = getCurrentUser();
  if(!user) return;
  $("loginCard")?.classList.add("hidden");
  $("adminMain")?.classList.remove("hidden");
  $("welcomeTitle").textContent = `${user.displayName} 後台行事曆`;
  setupRealtime();
  refreshAll();
}
function setupRealtime(){
  if(!db || realtimeChannel) return;
  realtimeChannel = db.channel("constonic-bookings-v4")
    .on("postgres_changes", { event:"*", schema:"public", table:"bookings" }, () => refreshAll())
    .on("postgres_changes", { event:"*", schema:"public", table:"booking_blocks" }, () => loadBlocks())
    .subscribe();
}
function updateDateUI(){ const date = $("date")?.value; if($("dateLabel")) $("dateLabel").textContent = dateLabel(date); }
function changeDate(days){
  const input = $("date");
  if(!input?.value) return;
  const d = new Date(input.value + "T00:00:00");
  d.setDate(d.getDate() + days);
  input.value = toISO(d);
  updateDateUI(); refreshAll();
}
function goToday(){ const input = $("date"); if(input) input.value = todayISO(); updateDateUI(); refreshAll(); }
async function refreshAll(){ await renderBookings(); await renderPendingCenter(); await renderTodayWorklist(); await renderMonthlyReport(); await loadBlocks(); }

function activeBookings(rows){ return (rows || []).filter(b => b.status !== "cancelled"); }
async function renderStats(date, bookings){
  const box = $("adminStats"); if(!box) return;
  const active = activeBookings(bookings);
  const pending = bookings.filter(b => ["pending", "nail_request"].includes(b.status)).length;
  const confirmed = bookings.filter(b => b.status === "confirmed").length;
  const month = date.slice(0,7);
  const y = Number(month.slice(0,4)); const m = Number(month.slice(5,7));
  const end = `${month}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
  let monthVisits = 0, unique = 0;
  try{
    const { data } = await db.from("bookings").select("phone,status").gte("date", `${month}-01`).lte("date", end).neq("status", "cancelled");
    monthVisits = (data || []).length;
    unique = new Set((data || []).map(b => b.phone).filter(Boolean)).size;
  }catch(e){ console.warn(e); }
  box.innerHTML = statCard("當日預約人數", active.length) + statCard("待確認", pending) + statCard("已確認", confirmed) + statCard("整月來店數", monthVisits, `不重複顧客 ${unique} 位`);
}
function statCard(label, value, note=""){
  return `<div class="stat-card"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div>${note ? `<div class="stat-note">${escapeHtml(note)}</div>` : ""}</div>`;
}
async function renderBookings(){
  if(!db) return;
  const user = getCurrentUser(); if(!user) return;
  const date = $("date")?.value || todayISO();
  const mode = $("viewMode")?.value || "calendar";
  const filter = $("therapistFilter")?.value || "全部";
  const box = $("calendarView"); if(!box) return;
  $("calendarTitle").textContent = `${date} 行事曆`;
  box.innerHTML = "載入中...";
  let query = db.from("bookings").select("*").eq("date", date).order("slot", { ascending:true });
  if(filter !== "全部") query = query.eq("therapist", filter);
  const { data, error } = await query;
  if(error){ box.innerHTML = `<p class="muted">讀取失敗，請確認 Supabase 設定。</p>`; console.error(error); return; }
  currentBookings = data || [];
  await renderStats(date, currentBookings);
  if(!currentBookings.length){ box.innerHTML = `<p class="muted">這一天目前沒有預約。</p>`; return; }
  if(mode === "list"){ box.innerHTML = currentBookings.map(listBookingCard).join(""); return; }
  renderCalendarGrid(box, currentBookings, filter);
}
function visibleStaff(bookings, filter){
  if(filter !== "全部") return [filter];
  const extra = bookings.some(b => !STAFF.includes(b.therapist));
  return extra ? [...STAFF, "不指定"] : STAFF;
}
function renderCalendarGrid(box, bookings, filter){
  const cols = visibleStaff(bookings, filter);
  let html = `<div class="calendar-grid staff-${cols.length}"><div class="calendar-head time-head">時間</div>`;
  cols.forEach(s => html += `<div class="calendar-head ${therapistClass(s)}">${escapeHtml(s)}</div>`);
  for(let t=600; t<=1200; t+=30){
    const label = minutesToTime(t);
    html += `<div class="time-cell">${label}</div>`;
    cols.forEach(s => {
      const matches = bookings.filter(b => normalizeTherapist(b.therapist) === s && b.slot === label);
      html += `<div class="calendar-cell droppable-slot" data-time="${label}" data-therapist="${escapeHtml(s)}" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)" ondrop="dropBooking(event,'${label}','${escapeHtml(s)}')">${matches.map(bookingCard).join("")}</div>`;
    });
  }
  html += `</div>`;
  const nonTime = bookings.filter(b => !/^\d{2}:\d{2}$/.test(String(b.slot || "")));
  if(nonTime.length){ html += `<div class="card sub-card"><h3>未排入時間軸的預約</h3>${nonTime.map(listBookingCard).join("")}</div>`; }
  box.innerHTML = html;
}
function bookingCard(b){
  return `<div class="booking-card ${therapistClass(b.therapist)} ${b.status === "completed" ? "completed" : ""}" draggable="true" ondragstart="dragBooking(event,'${escapeHtml(b.id)}')" onclick="openBookingModal('${escapeHtml(b.id)}')"><div class="booking-color-strip"></div><strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name)}</strong><div>${formatItems(b.items, true)}</div><div class="hint">保留 ${Number(b.total_block || 0)} 分｜${statusText(b.status)}</div></div>`;
}
function listBookingCard(b){
  return `<div class="booking-card list ${therapistClass(b.therapist)}" onclick="openBookingModal('${escapeHtml(b.id)}')"><div class="booking-color-strip"></div><strong>${escapeHtml(b.date || "")} ${escapeHtml(b.slot || "")}｜${escapeHtml(b.customer_name || "-")}</strong><div>${formatItems(b.items)}</div><div class="hint">美容師：${escapeHtml(b.therapist || "-")}｜狀態：${statusText(b.status)}</div></div>`;
}
function dragBooking(event, id){ event.dataTransfer.setData("text/plain", id); event.dataTransfer.effectAllowed = "move"; }
function allowDrop(event){ event.preventDefault(); event.currentTarget.classList.add("drag-over"); }
function leaveDrop(event){ event.currentTarget.classList.remove("drag-over"); }
async function dropBooking(event, newSlot, newTherapist){
  event.preventDefault(); event.currentTarget.classList.remove("drag-over");
  const id = event.dataTransfer.getData("text/plain");
  const b = currentBookings.find(x => x.id === id);
  if(!b) return;
  if(!confirm(`確認將「${b.customer_name}」改到 ${newSlot}｜${newTherapist} 嗎？`)) return;
  const { error } = await db.from("bookings").update({ slot:newSlot, therapist:newTherapist }).eq("id", id);
  if(error){ alert("修改時間失敗"); console.error(error); return; }
  refreshAll();
}

async function fetchBooking(id){
  const local = currentBookings.find(b => b.id === id);
  if(local) return local;
  const { data, error } = await db.from("bookings").select("*").eq("id", id).single();
  if(error){ console.error(error); return null; }
  return data;
}
function defaultCheckout(b){
  const c = b.checkout || {};
  return {
    room: c.room || "未指定",
    payment_status: c.payment_status || "未收款",
    payment_method: c.payment_method || "現金",
    tech_rows: c.tech_rows || (b.items || []).map((i, idx) => ({ item_name:i.name || `技術${idx+1}`, amount:0, rate:"30" })),
    product_amount: Number(c.product_amount || 0),
    course_amount: Number(c.course_amount || 0),
    stored_value_new_amount: Number(c.stored_value_new_amount || 0),
    platform_fixed_pay: Number(c.platform_fixed_pay || 0),
    total_received: Number(c.total_received || 0),
    invoice_status: c.invoice_status || "未開",
    receipt_note: c.receipt_note || ""
  };
}
function checkoutTotals(c){
  const tech30Amount = (c.tech_rows || []).filter(r => String(r.rate) === "30").reduce((s,r)=>s+Number(r.amount||0),0);
  const tech40Amount = (c.tech_rows || []).filter(r => String(r.rate) === "40").reduce((s,r)=>s+Number(r.amount||0),0);
  const tech30Bonus = Math.round(tech30Amount * 0.30);
  const tech40Bonus = Math.round(tech40Amount * 0.40);
  const productBonus = Math.round(Number(c.product_amount || 0) * 0.10);
  const courseBonus = Math.round((Number(c.course_amount || 0) + Number(c.stored_value_new_amount || 0)) * 0.02);
  const platformPay = Number(c.platform_fixed_pay || 0);
  return { tech30Amount, tech40Amount, tech30Bonus, tech40Bonus, productBonus, courseBonus, platformPay, salaryTotal:tech30Bonus+tech40Bonus+productBonus+courseBonus+platformPay };
}
async function openBookingModal(id){
  const b = await fetchBooking(id);
  if(!b){ alert("找不到這筆預約，請按更新後再試。"); return; }
  const body = $("bookingModalBody"); if(!body) return;
  body.innerHTML = renderBookingModal(b);
  $("bookingModal").classList.remove("hidden");
}
function closeBookingModal(){ $("bookingModal")?.classList.add("hidden"); }
function renderBookingModal(b){
  return `<div class="booking-modal-shell"><header class="modal-header"><div><p class="eyebrow">CONSTONIC ADMIN V4.0</p><h2>${escapeHtml(b.customer_name || "-")}｜${escapeHtml(b.date)} ${escapeHtml(b.slot)}</h2></div><button type="button" class="modal-close" onclick="closeBookingModal()">×</button></header><main class="modal-body-grid"><section>${renderDetailPanel(b)}${renderItemEditor(b)}${renderRoomPanel(b)}</section><section>${renderCheckoutPanel(b)}</section></main><footer class="modal-footer"><button type="button" onclick="updateStatus('${escapeHtml(b.id)}','confirmed')">已確認</button><button type="button" onclick="updateStatus('${escapeHtml(b.id)}','cancelled')">取消</button><button type="button" onclick="deleteBooking('${escapeHtml(b.id)}')">刪除</button><button type="button" class="primary" onclick="saveCheckout('${escapeHtml(b.id)}')">💾 儲存收銀／薪資</button></footer></div>`;
}
function renderDetailPanel(b){
  const nail = b.nail_request || null;
  return `<div class="panel"><h3>預約資料</h3><div class="info-grid"><div><span>日期時間</span><strong>${escapeHtml(b.date)} ${escapeHtml(b.slot)}</strong></div><div><span>姓名</span><strong>${escapeHtml(b.customer_name || "-")}</strong></div><div><span>電話</span><strong>${escapeHtml(b.phone || "-")}</strong></div><div><span>LINE</span><strong>${escapeHtml(b.line_name || "-")}</strong></div><div><span>美容師</span><strong>${escapeHtml(b.therapist || "-")}</strong></div><div><span>狀態</span><strong>${statusText(b.status)}</strong></div><div><span>第一次</span><strong>${escapeHtml(b.first_visit || "-")}</strong></div><div><span>房型</span><strong>${roomDisplay(b.checkout?.room)}</strong></div></div><div class="note-block"><span>預約項目</span><p>${formatItems(b.items)}</p></div><div class="note-block"><span>時間保留</span><p>療程 ${Number(b.service_minutes||0)} 分｜整理 ${Number(b.internal_buffer||0)} 分｜保留 ${Number(b.total_block||0)} 分</p></div>${nail ? `<div class="note-block"><span>美甲申請</span><p>希望時段：${escapeHtml(nail.preferred_period || "-")}<br>指定時間：${escapeHtml(nail.preferred_time || "-")}<br>手部/足部：${escapeHtml(nail.part || "-")}<br>樣式：${escapeHtml(nail.style || "-")}<br>備註：${escapeHtml(nail.nail_note || "-")}</p></div>` : ""}<div class="note-block"><span>備註</span><p>${escapeHtml(b.note || "-")}</p></div></div>`;
}
function renderItemEditor(b){
  const items = b.items || [];
  return `<div class="panel"><h3>修正預約項目</h3><p class="hint">修改後會重新計算保留時間，前台空檔會同步釋放。</p><div id="itemRows" data-count="${items.length}">${items.map((i, idx)=>itemRowHtml(i, idx)).join("")}</div><div class="button-row"><button type="button" onclick="addItemRow()">＋新增項目</button><button type="button" class="primary" onclick="saveBookingItems('${escapeHtml(b.id)}')">💾 儲存項目</button></div></div>`;
}
function itemRowHtml(item={}, idx=0){
  return `<div class="item-row"><div class="field"><label>療程名稱</label><input id="itemName_${idx}" value="${escapeHtml(item.name || "")}"></div><div class="field"><label>時間</label><input id="itemDuration_${idx}" type="number" min="0" step="10" value="${Number(item.duration || 60)}"></div><div class="field"><label>服務人員</label><select id="itemTherapist_${idx}">${ALL_STAFF.map(t=>`<option ${item.therapist===t?"selected":""}>${t}</option>`).join("")}</select></div><button type="button" class="danger-soft" onclick="this.closest('.item-row').remove(); reindexItemRows();">刪除</button></div>`;
}
function reindexItemRows(){ const rows = [...document.querySelectorAll("#itemRows .item-row")]; rows.forEach((row, idx)=>{ row.querySelectorAll("input,select").forEach(el=>{ if(el.id.startsWith("itemName_")) el.id = `itemName_${idx}`; if(el.id.startsWith("itemDuration_")) el.id = `itemDuration_${idx}`; if(el.id.startsWith("itemTherapist_")) el.id = `itemTherapist_${idx}`; }); }); $("itemRows").dataset.count = rows.length; }
function addItemRow(){ const box = $("itemRows"); const idx = Number(box.dataset.count || 0); box.insertAdjacentHTML("beforeend", itemRowHtml({ name:"", duration:60, therapist:"不指定" }, idx)); box.dataset.count = idx + 1; }
function collectItems(){
  const rows = [...document.querySelectorAll("#itemRows .item-row")];
  return rows.map((row, idx) => ({ name:$("itemName_"+idx)?.value.trim(), duration:Number($("itemDuration_"+idx)?.value || 0), therapist:$("itemTherapist_"+idx)?.value || "不指定" })).filter(i => i.name && i.duration > 0);
}
async function saveBookingItems(id){
  const items = collectItems();
  if(!items.length){ alert("至少要保留一個療程項目"); return; }
  const service_minutes = items.reduce((s,i)=>s+Number(i.duration||0),0);
  const internal_buffer = service_minutes <= 60 ? 10 : 20;
  const total_block = service_minutes + internal_buffer;
  const therapist = items[0]?.therapist || "不指定";
  const { error } = await db.from("bookings").update({ items, service_minutes, internal_buffer, total_block, therapist }).eq("id", id);
  if(error){ alert("儲存項目失敗"); console.error(error); return; }
  alert(`已更新項目，保留時間 ${total_block} 分`);
  closeBookingModal(); refreshAll();
}
function renderRoomPanel(b){
  const c = defaultCheckout(b);
  return `<div class="panel"><h3>房型安排</h3><p class="hint">VIP301 有兩張床，可同時安排兩位。</p><div class="field"><label>房型／床位</label><select id="roomSelect">${ROOM_OPTIONS.map(r=>`<option value="${r}" ${c.room===r?"selected":""}>${roomDisplay(r)}</option>`).join("")}</select></div><button type="button" onclick="saveRoom('${escapeHtml(b.id)}')">儲存房型</button></div>`;
}
async function saveRoom(id){
  const b = await fetchBooking(id); if(!b) return;
  const checkout = b.checkout || {}; checkout.room = $("roomSelect")?.value || "未指定";
  const { error } = await db.from("bookings").update({ checkout }).eq("id", id);
  if(error){ alert("房型儲存失敗"); console.error(error); return; }
  alert("房型已儲存"); closeBookingModal(); refreshAll();
}
function renderCheckoutPanel(b){
  const c = defaultCheckout(b); const t = checkoutTotals(c);
  const rows = c.tech_rows.map((r,idx)=>`<div class="tech-row"><div class="field"><label>項目</label><input id="techName_${idx}" value="${escapeHtml(r.item_name || "")}"></div><div class="field"><label>金額</label><input id="techAmount_${idx}" type="number" min="0" value="${Number(r.amount || 0)}"></div><div class="field"><label>抽成</label><select id="techRate_${idx}"><option value="30" ${String(r.rate)==="30"?"selected":""}>30%</option><option value="40" ${String(r.rate)==="40"?"selected":""}>40%</option></select></div></div>`).join("");
  return `<div class="panel cashier-panel"><h3>收銀／薪資</h3><div class="form-grid compact"><div class="field"><label>收款狀態</label><select id="paymentStatus">${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}</select></div><div class="field"><label>收款方式</label><select id="paymentMethod">${PAYMENT_METHODS.map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}</select></div></div><details open class="collapse"><summary>技術服務</summary><div id="techRows" data-count="${c.tech_rows.length}">${rows}</div></details><details class="collapse"><summary>商品／課程／儲值／平台</summary><div class="form-grid compact"><div class="field"><label>商品10%</label><input id="productAmount" type="number" min="0" value="${c.product_amount}"></div><div class="field"><label>新課程2%</label><input id="courseAmount" type="number" min="0" value="${c.course_amount}"></div><div class="field"><label>新儲值2%</label><input id="storedValueAmount" type="number" min="0" value="${c.stored_value_new_amount}"></div><div class="field"><label>平台固定</label><input id="platformPay" type="number" min="0" value="${c.platform_fixed_pay}"></div><div class="field"><label>本次實收</label><input id="totalReceived" type="number" min="0" value="${c.total_received}"></div><div class="field"><label>發票</label><select id="invoiceStatus">${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}</select></div></div><div class="field"><label>備註</label><textarea id="receiptNote" rows="2">${escapeHtml(c.receipt_note)}</textarea></div></details><div class="salary-card"><div><span>技術30%</span><strong>NT$ ${money(t.tech30Bonus)}</strong></div><div><span>技術40%</span><strong>NT$ ${money(t.tech40Bonus)}</strong></div><div><span>商品10%</span><strong>NT$ ${money(t.productBonus)}</strong></div><div><span>課程／儲值2%</span><strong>NT$ ${money(t.courseBonus)}</strong></div><div><span>平台固定</span><strong>NT$ ${money(t.platformPay)}</strong></div><div class="total"><span>本次薪資</span><strong>NT$ ${money(t.salaryTotal)}</strong></div></div></div>`;
}
function collectCheckoutFromForm(existing={}){
  const rows = [...document.querySelectorAll("#techRows .tech-row")].map((row,idx)=>({ item_name:$("techName_"+idx)?.value || "", amount:Number($("techAmount_"+idx)?.value || 0), rate:$("techRate_"+idx)?.value || "30" }));
  const checkout = { ...existing, room:$("roomSelect")?.value || existing.room || "未指定", payment_status:$("paymentStatus")?.value || "未收款", payment_method:$("paymentMethod")?.value || "現金", tech_rows:rows, product_amount:Number($("productAmount")?.value || 0), course_amount:Number($("courseAmount")?.value || 0), stored_value_new_amount:Number($("storedValueAmount")?.value || 0), platform_fixed_pay:Number($("platformPay")?.value || 0), total_received:Number($("totalReceived")?.value || 0), invoice_status:$("invoiceStatus")?.value || "未開", receipt_note:$("receiptNote")?.value || "" };
  checkout.calculated = checkoutTotals(checkout);
  return checkout;
}
async function saveCheckout(id){
  const b = await fetchBooking(id); if(!b) return;
  const checkout = collectCheckoutFromForm(b.checkout || {});
  const { error } = await db.from("bookings").update({ checkout, status:"completed" }).eq("id", id);
  if(error){ alert("收銀儲存失敗"); console.error(error); return; }
  alert("收銀已儲存，狀態已完成"); closeBookingModal(); refreshAll();
}
async function updateStatus(id, status){
  const { error } = await db.from("bookings").update({ status }).eq("id", id);
  if(error){ alert("更新失敗"); console.error(error); return; }
  closeBookingModal(); refreshAll();
}
async function deleteBooking(id){
  if(!confirm("確認刪除此筆預約？")) return;
  const { error } = await db.from("bookings").delete().eq("id", id);
  if(error){ alert("刪除失敗"); console.error(error); return; }
  closeBookingModal(); refreshAll();
}

async function renderPendingCenter(){
  const box = $("pendingCenter"); if(!box || !db) return;
  const { data, error } = await db.from("bookings").select("*").in("status", ["pending", "nail_request"]).order("date", { ascending:true }).order("slot", { ascending:true }).limit(50);
  if(error){ box.innerHTML = "讀取待確認資料失敗。"; console.error(error); return; }
  const rows = data || [];
  if(!rows.length){ box.className = "pending-center muted"; box.innerHTML = "目前沒有待確認預約。"; return; }
  box.className = "pending-center";
  box.innerHTML = rows.map(b => `<div class="pending-card ${therapistClass(b.therapist)}" onclick="openBookingModal('${escapeHtml(b.id)}')"><div class="booking-color-strip"></div><strong>${escapeHtml(b.date)}｜${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name || "-")}</strong><div>${formatItems(b.items, true)}</div><div class="hint">${statusText(b.status)}</div></div>`).join("");
}
async function renderTodayWorklist(){
  const box = $("todayWorklistContent"); if(!box || !db) return;
  const date = $("date")?.value || todayISO();
  const { data, error } = await db.from("bookings").select("*").eq("date", date).order("slot", { ascending:true });
  if(error){ box.innerHTML = "讀取失敗"; console.error(error); return; }
  const rows = activeBookings(data || []);
  if(!rows.length){ box.className = "today-worklist muted"; box.innerHTML = "這一天目前沒有預約。"; return; }
  box.className = "today-worklist";
  box.innerHTML = rows.map(b => `<div class="worklist-item ${therapistClass(b.therapist)}" onclick="openBookingModal('${escapeHtml(b.id)}')"><div class="booking-color-strip"></div><strong>${escapeHtml(b.slot)}｜${escapeHtml(b.customer_name || "-")}</strong><div>${escapeHtml(b.therapist || "-")}｜${roomDisplay(b.checkout?.room)}</div><div class="hint">${statusText(b.status)}｜${formatItems(b.items, true)}</div></div>`).join("");
}

function blockMode(){ return document.querySelector('input[name="blockMode"]:checked')?.value || "range"; }
function toggleBlockMode(){ const mode = blockMode(); document.querySelectorAll(".block-range").forEach(el=>el.classList.toggle("hidden", mode !== "range")); document.querySelectorAll(".block-multi").forEach(el=>el.classList.toggle("hidden", mode !== "multi")); }
function dateRange(start,end){ const dates=[]; if(!start||!end) return dates; const s=new Date(start+"T00:00:00"), e=new Date(end+"T00:00:00"); for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) dates.push(toISO(d)); return dates; }
function splitDates(text){ return String(text||"").split(/[\n,，、\s]+/).map(s=>s.trim()).filter(Boolean); }
async function createBlocks(){
  const dates = blockMode() === "range" ? dateRange($("blockStart")?.value, $("blockEnd")?.value) : splitDates($("blockDates")?.value);
  if(!dates.length){ alert("請輸入要關閉的日期"); return; }
  const therapist = $("blockTherapist")?.value || "全店";
  const reason = $("blockReason")?.value || "休假/不開放";
  const { error } = await db.from("booking_blocks").insert(dates.map(date => ({ date, therapist, reason, all_day:true })));
  if(error){ alert("新增失敗，請確認 booking_blocks SQL 已建立"); console.error(error); return; }
  alert(`已新增 ${dates.length} 天休假／店休`); loadBlocks();
}
async function loadBlocks(){
  const box = $("blocksContent"); if(!box || !db) return;
  const base = $("blockStart")?.value || $("date")?.value || todayISO();
  const ym = base.slice(0,7); const y=Number(ym.slice(0,4)), m=Number(ym.slice(5,7)); const end=`${ym}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
  const { data, error } = await db.from("booking_blocks").select("*").gte("date", `${ym}-01`).lte("date", end).order("date", { ascending:true });
  if(error){ box.innerHTML = "讀取休假資料失敗。"; console.error(error); return; }
  const rows = data || [];
  if(!rows.length){ box.className = "booking-blocks-list muted"; box.innerHTML = `${ym} 尚無休假／店休設定。`; return; }
  box.className = "booking-blocks-list";
  box.innerHTML = rows.map(b => `<div class="block-row"><div><strong>${escapeHtml(b.date)}</strong>｜${escapeHtml(b.therapist || "全店")}｜${escapeHtml(b.reason || "休假/不開放")}</div><button type="button" onclick="deleteBlock('${escapeHtml(b.id)}')">刪除</button></div>`).join("");
}
async function deleteBlock(id){ if(!confirm("確定刪除這個休假／店休設定？")) return; const { error } = await db.from("booking_blocks").delete().eq("id", id); if(error){ alert("刪除失敗"); console.error(error); return; } loadBlocks(); }

function getMonthRange(){ const date = $("date")?.value || todayISO(); const ym = date.slice(0,7); const y=Number(ym.slice(0,4)), m=Number(ym.slice(5,7)); return { ym, start:`${ym}-01`, end:`${ym}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}` }; }
async function renderMonthlyReport(){
  const box = $("monthlyReportContent"); if(!box || !db) return;
  const { ym, start, end } = getMonthRange();
  const { data, error } = await db.from("bookings").select("*").gte("date", start).lte("date", end);
  if(error){ box.innerHTML = "讀取月報失敗"; console.error(error); return; }
  const rows = (data || []).filter(b => b.status !== "cancelled");
  let totalReceived=0, salary=0, product=0, course=0, stored=0;
  rows.forEach(b => { const c=defaultCheckout(b); const t=checkoutTotals(c); totalReceived += Number(c.total_received||0); salary += t.salaryTotal; product += Number(c.product_amount||0); course += Number(c.course_amount||0); stored += Number(c.stored_value_new_amount||0); });
  box.className = "report-grid";
  box.innerHTML = statCard(`${ym} 預約`, rows.length) + statCard("實收金額", `NT$ ${money(totalReceived)}`) + statCard("商品銷售", `NT$ ${money(product)}`) + statCard("新課程", `NT$ ${money(course)}`) + statCard("新儲值", `NT$ ${money(stored)}`) + statCard("薪資估算", `NT$ ${money(salary)}`);
}
function csvEscape(value){ return `"${String(value ?? "").replaceAll('"','""')}"`; }
async function exportMonthlyCSV(){
  const { ym, start, end } = getMonthRange();
  const { data, error } = await db.from("bookings").select("*").gte("date", start).lte("date", end).order("date", { ascending:true }).order("slot", { ascending:true });
  if(error){ alert("匯出失敗"); console.error(error); return; }
  const headers = ["日期","時間","客戶姓名","電話","美容師","狀態","房型","預約項目","收款狀態","收款方式","本次實收","商品金額","新課程","新儲值","薪資估算","發票","備註"];
  const lines = [headers.map(csvEscape).join(",")];
  (data || []).forEach(b => { const c=defaultCheckout(b); const t=checkoutTotals(c); lines.push([b.date,b.slot,b.customer_name,b.phone,b.therapist,statusText(b.status),c.room,(b.items||[]).map(i=>`${i.name}(${i.duration}分)`).join(" / "),c.payment_status,c.payment_method,c.total_received,c.product_amount,c.course_amount,c.stored_value_new_amount,t.salaryTotal,c.invoice_status,c.receipt_note].map(csvEscape).join(",")); });
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`康姿多儷SPA_${ym}_月報.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function init(){
  if(!$("date").value) $("date").value = todayISO();
  if(!$("blockStart").value) $("blockStart").value = $("date").value;
  if(!$("blockEnd").value) $("blockEnd").value = $("date").value;
  updateDateUI();
  $("date")?.addEventListener("change", () => { updateDateUI(); refreshAll(); });
  $("therapistFilter")?.addEventListener("change", renderBookings);
  $("viewMode")?.addEventListener("change", renderBookings);
  document.querySelectorAll('input[name="blockMode"]').forEach(r => r.addEventListener("change", toggleBlockMode));
  $("blockStart")?.addEventListener("change", loadBlocks);
  toggleBlockMode();
  if(getCurrentUser()) showAdmin();
}
document.addEventListener("DOMContentLoaded", init);
