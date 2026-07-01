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


/* =========================
   CONSTONIC V4.1
   拆分療程排程修正：
   - 同一筆預約不同療程可分配不同美容師
   - 行事曆依每個療程項目顯示
   - 支援非半點時間
   - 技術薪資支援固定薪資
========================= */

window.CONSTONIC_VERSION = "V4.1";

function v41Pad(n){return String(n).padStart(2,"0");}
function v41TimeToMin(t){
  const m = String(t||"").match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return Number(m[1])*60 + Number(m[2]);
}
function v41MinToTime(m){return v41Pad(Math.floor(m/60))+":"+v41Pad(m%60);}
function v41ValidTime(t){return v41TimeToMin(t) !== null;}
function v41ItemStart(booking, idx){
  const base = v41TimeToMin(booking.slot);
  if(base === null) return booking.slot || "";
  let offset = 0;
  const items = booking.items || [];
  for(let i=0;i<idx;i++) offset += Number(items[i].duration || 0);
  return v41MinToTime(base + offset);
}
function v41ItemEnd(booking, idx){
  const start = v41TimeToMin(v41ItemStart(booking, idx));
  if(start === null) return "";
  const item = (booking.items || [])[idx] || {};
  return v41MinToTime(start + Number(item.duration || 0));
}
function v41NormalizeStaff(t){
  if(["雅潔老師","巧萱美容師","曼曼美甲師"].includes(t)) return t;
  return "不指定";
}
function v41StaffList(bookings, filter){
  if(filter && filter !== "全部") return [filter];
  const base = ["雅潔老師","巧萱美容師","曼曼美甲師"];
  const hasOther = (bookings||[]).some(b => (b.items||[]).some(i => !base.includes(i.therapist || b.therapist)));
  return hasOther ? [...base, "不指定"] : base;
}
function v41BuildSegments(bookings){
  const segments = [];
  (bookings || []).forEach(b => {
    const items = b.items || [];
    if(!items.length){
      segments.push({booking:b, item:null, idx:0, staff:v41NormalizeStaff(b.therapist), start:b.slot, duration:Number(b.total_block||b.service_minutes||0), title:b.customer_name||"-"});
      return;
    }
    items.forEach((item, idx) => {
      const staff = v41NormalizeStaff(item.therapist || b.therapist);
      const start = v41ItemStart(b, idx);
      segments.push({
        booking:b,
        item,
        idx,
        staff,
        start,
        duration:Number(item.duration || 0),
        title:b.customer_name||"-",
        status:b.status
      });
    });
  });
  return segments;
}
function v41SegmentCard(seg){
  const b = seg.booking;
  const item = seg.item || {};
  const status = typeof statusText === "function" ? statusText(b.status) : b.status;
  const cls = typeof therapistClass === "function" ? therapistClass(seg.staff) : "";
  return `<div class="booking-card v41-segment-card ${cls}" draggable="true" ondragstart="dragBooking(event,'${escapeHtml(b.id)}')" onclick="openBookingModal('${escapeHtml(b.id)}')">
    <div class="booking-color-strip"></div>
    <strong>${escapeHtml(seg.start)}｜${escapeHtml(b.customer_name || "-")}</strong>
    <div>${seg.idx+1}. ${escapeHtml(item.name || "-")}（${Number(item.duration||0)}分）</div>
    <div class="hint">${escapeHtml(seg.staff)}｜${status}</div>
  </div>`;
}

/* 覆蓋行事曆：用療程項目作為顯示單位 */
window.renderBookings = async function(){
  const date = document.getElementById("date")?.value;
  const mode = document.getElementById("viewMode")?.value || "calendar";
  const filter = document.getElementById("therapistFilter")?.value || "全部";
  const box = document.getElementById("calendarView");
  const title = document.getElementById("calendarTitle");
  if(!date || !box) return;

  if(title) title.textContent = `${date} 行事曆`;
  box.innerHTML = "載入中...";

  let q = db.from("bookings").select("*").eq("date", date).order("slot", {ascending:true});
  const {data,error} = await q;
  if(error){
    box.innerHTML = "<p class='muted'>讀取失敗。</p>";
    console.error(error);
    return;
  }
  const bookings = data || [];
  window.currentBookings = bookings;

  if(typeof renderStats === "function") renderStats(date, bookings);
  if(typeof renderPendingCenter === "function") renderPendingCenter();
  if(typeof renderTodayWorklist === "function") renderTodayWorklist();

  if(!bookings.length){
    box.innerHTML = "<p class='muted'>這一天目前沒有預約。</p>";
    return;
  }

  const staffList = v41StaffList(bookings, filter);
  const segments = v41BuildSegments(bookings).filter(s => filter === "全部" || s.staff === filter);

  if(mode === "list"){
    box.innerHTML = bookings.map(b => typeof listBookingCard === "function" ? listBookingCard(b) : "").join("");
    return;
  }

  const timeSet = new Set();
  for(let t=600;t<=1200;t+=30) timeSet.add(v41MinToTime(t));
  segments.forEach(s => { if(v41ValidTime(s.start)) timeSet.add(s.start); });
  const times = Array.from(timeSet).sort((a,b)=>v41TimeToMin(a)-v41TimeToMin(b));

  let html = `<div class="calendar-grid staff-${staffList.length}"><div class="calendar-head time-head">時間</div>`;
  staffList.forEach(s => html += `<div class="calendar-head ${typeof therapistClass==="function"?therapistClass(s):""}">${escapeHtml(s)}</div>`);

  times.forEach(label => {
    html += `<div class="time-cell">${label}</div>`;
    staffList.forEach(staff => {
      const matches = segments.filter(s => s.staff === staff && s.start === label);
      html += `<div class="calendar-cell droppable-slot" data-time="${label}" data-therapist="${escapeHtml(staff)}" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)" ondrop="dropBooking(event,'${label}','${escapeHtml(staff)}')">${matches.map(v41SegmentCard).join("")}</div>`;
    });
  });
  html += "</div>";
  box.innerHTML = html;
};

/* 儲存預約項目：重算總時間，並讓行事曆依項目拆分 */
window.v41CollectEditItems = function(){
  const box = document.getElementById("editItemsBox") || document.getElementById("v31ItemRows");
  if(!box) return null;
  const rows = Array.from(box.querySelectorAll(".edit-item-row,.v31-item-row"));
  if(!rows.length) return null;
  return rows.map((row, idx) => {
    const inputs = row.querySelectorAll("input");
    const selects = row.querySelectorAll("select");
    const name = inputs[0]?.value?.trim() || "";
    const duration = Number(inputs[1]?.value || 0);
    const therapist = selects[0]?.value || "不指定";
    return {name, duration, therapist};
  }).filter(i => i.name && i.duration > 0);
};

window.saveEditItems = async function(id){
  const items = v41CollectEditItems();
  if(!items || !items.length){ alert("至少要保留一個療程項目"); return; }
  const service = items.reduce((s,i)=>s+Number(i.duration||0),0);
  const buffer = service <= 60 ? 10 : 20;
  const primary = items[0].therapist || "不指定";
  const {error} = await db.from("bookings").update({
    items,
    service_minutes: service,
    internal_buffer: buffer,
    total_block: service + buffer,
    therapist: primary
  }).eq("id", id);
  if(error){ alert("儲存項目失敗"); console.error(error); return; }
  alert("已儲存項目，行事曆與前台空檔會依新時間重新計算。");
  closeBookingModal();
  renderBookings();
};
window.v31SaveBookingItems = saveEditItems;

/* 固定薪資：重新計算收銀 */
function v41CalcSalary(checkout){
  const rows = checkout.tech_rows || [];
  let tech30=0, tech40=0, fixed=0;
  rows.forEach(r => {
    const amount = Number(r.amount || 0);
    const rate = String(r.rate || "30");
    if(rate === "30") tech30 += Math.round(amount * 0.3);
    else if(rate === "40") tech40 += Math.round(amount * 0.4);
    else if(rate === "fixed") fixed += amount;
  });
  const product = Math.round(Number(checkout.product_amount||0)*0.1);
  const course = Math.round((Number(checkout.course_amount||0)+Number(checkout.stored_value_new_amount||0))*0.02);
  const platform = Number(checkout.platform_fixed_pay||0);
  return {tech30, tech40, fixed, product, course, platform, total:tech30+tech40+fixed+product+course+platform};
}

/* 若原本彈窗存在，補強固定薪資選項 */
document.addEventListener("change", e => {
  if(e.target && e.target.id && e.target.id.includes("TechRate")){
    const opt = Array.from(e.target.options).some(o => o.value === "fixed");
    if(!opt){
      const o = document.createElement("option");
      o.value = "fixed"; o.textContent = "固定薪資";
      e.target.appendChild(o);
    }
  }
}, true);

setTimeout(() => {
  document.querySelectorAll('select[id*="TechRate"]').forEach(sel => {
    if(!Array.from(sel.options).some(o => o.value === "fixed")){
      const o = document.createElement("option");
      o.value = "fixed";
      o.textContent = "固定薪資";
      sel.appendChild(o);
    }
  });
}, 1000);


/* =========================
   CONSTONIC ADMIN V4.2
   技術服務新增固定薪資輸入
========================= */

window.CONSTONIC_ADMIN_VERSION = "V4.2";

function c42Money(n){
  return Number(n || 0).toLocaleString("zh-TW");
}

function c42EnsureFixedPayOptions(){
  document.querySelectorAll('select[id*="TechRate"], select[data-rate-select]').forEach(sel => {
    if(!Array.from(sel.options).some(o => o.value === "fixed")){
      const opt = document.createElement("option");
      opt.value = "fixed";
      opt.textContent = "固定薪資";
      sel.appendChild(opt);
    }
  });
}

function c42AddFixedPayFields(){
  document.querySelectorAll(".v3-tech-row, .tech-row, .cashier-row").forEach((row, idx) => {
    if(row.querySelector(".c42-fixed-pay-field")) return;
    const sel = row.querySelector('select[id*="TechRate"], select[data-rate-select]');
    if(!sel) return;
    const wrap = document.createElement("div");
    wrap.className = "field c42-fixed-pay-field";
    wrap.innerHTML = `<label>固定薪資</label><input id="c42FixedPay_${idx}" type="number" min="0" value="0" placeholder="平台獎金">`;
    row.appendChild(wrap);
    sel.addEventListener("change", () => {
      wrap.classList.toggle("hidden", sel.value !== "fixed");
      c42UpdateSalaryPreview();
    });
    wrap.classList.toggle("hidden", sel.value !== "fixed");
  });
}

function c42UpdateSalaryPreview(){
  let tech30 = 0, tech40 = 0, fixed = 0;

  document.querySelectorAll(".v3-tech-row, .tech-row, .cashier-row").forEach((row, idx) => {
    const amountInput = row.querySelector('input[id*="TechAmount"], input[type="number"]');
    const rateSelect = row.querySelector('select[id*="TechRate"], select[data-rate-select]');
    const amount = Number(amountInput?.value || 0);
    const rate = rateSelect?.value || "30";
    if(rate === "30") tech30 += Math.round(amount * .3);
    else if(rate === "40") tech40 += Math.round(amount * .4);
    else if(rate === "fixed") fixed += Number(row.querySelector(".c42-fixed-pay-field input")?.value || 0);
  });

  const salaryBox = document.querySelector(".v3-salary-card, .salary-summary");
  if(salaryBox && !salaryBox.querySelector(".c42-fixed-row")){
    const div = document.createElement("div");
    div.className = "c42-fixed-row";
    div.innerHTML = `<span>固定薪資</span><strong>NT$ 0</strong>`;
    salaryBox.insertBefore(div, salaryBox.querySelector(".total"));
  }
  const fixedRow = document.querySelector(".c42-fixed-row strong");
  if(fixedRow) fixedRow.textContent = "NT$ " + c42Money(fixed);

  const totalStrong = document.querySelector(".v3-salary-card .total strong, .salary-summary .total strong");
  if(totalStrong){
    const productText = Array.from(document.querySelectorAll(".v3-salary-card div, .salary-summary div")).find(x=>x.textContent.includes("商品"))?.querySelector("strong")?.textContent || "0";
    const courseText = Array.from(document.querySelectorAll(".v3-salary-card div, .salary-summary div")).find(x=>x.textContent.includes("課程"))?.querySelector("strong")?.textContent || "0";
    const platformText = Array.from(document.querySelectorAll(".v3-salary-card div, .salary-summary div")).find(x=>x.textContent.includes("平台"))?.querySelector("strong")?.textContent || "0";
    const parseMoney = s => Number(String(s).replace(/[^\d.-]/g,"") || 0);
    totalStrong.textContent = "NT$ " + c42Money(tech30 + tech40 + fixed + parseMoney(productText) + parseMoney(courseText) + parseMoney(platformText));
  }
}

const c42OldSaveCheckout = typeof v2SaveCheckout === "function" ? v2SaveCheckout : null;
window.v2SaveCheckout = async function(id){
  const count = Number(document.getElementById("v2TechRows")?.dataset.count || document.querySelectorAll(".v3-tech-row,.tech-row,.cashier-row").length || 0);
  const techRows = [];
  for(let i=0;i<count;i++){
    const name = document.getElementById(`v2TechName_${i}`)?.value || document.querySelectorAll(".v3-tech-row input")[i*2]?.value || "";
    const amount = Number(document.getElementById(`v2TechAmount_${i}`)?.value || 0);
    const rate = document.getElementById(`v2TechRate_${i}`)?.value || document.querySelectorAll('select[id*="TechRate"]')[i]?.value || "30";
    const fixedPay = Number(document.getElementById(`c42FixedPay_${i}`)?.value || 0);
    techRows.push({item_name:name, amount, rate, fixed_pay:fixedPay});
  }

  const booking = (currentBookings || []).find(b => b.id === id) || {};
  const old = booking.checkout || {};
  const checkout = {
    ...old,
    room: document.getElementById("v2RoomSelect")?.value || old.room || "未指定",
    payment_status: document.getElementById("v2PaymentStatus")?.value || old.payment_status || "未收款",
    payment_method: document.getElementById("v2PaymentMethod")?.value || old.payment_method || "現金",
    tech_rows: techRows,
    product_amount: Number(document.getElementById("v2ProductAmount")?.value || 0),
    course_amount: Number(document.getElementById("v2CourseAmount")?.value || 0),
    stored_value_new_amount: Number(document.getElementById("v2StoredValueAmount")?.value || 0),
    platform_fixed_pay: Number(document.getElementById("v2PlatformPay")?.value || 0),
    total_received: Number(document.getElementById("v2TotalReceived")?.value || 0),
    invoice_status: document.getElementById("v2InvoiceStatus")?.value || "未開",
    receipt_note: document.getElementById("v2ReceiptNote")?.value || ""
  };

  const {error} = await db.from("bookings").update({checkout}).eq("id", id);
  if(error){
    alert("收銀儲存失敗");
    console.error(error);
    return;
  }
  alert("收銀／薪資已儲存");
  closeBookingModal();
  if(typeof renderBookings === "function") renderBookings();
};

document.addEventListener("input", e => {
  if(e.target && (e.target.closest(".v3-tech-row") || e.target.closest(".tech-row") || e.target.closest(".cashier-row"))){
    c42UpdateSalaryPreview();
  }
});

const c42Observer = new MutationObserver(() => {
  c42EnsureFixedPayOptions();
  c42AddFixedPayFields();
});
document.addEventListener("DOMContentLoaded", () => {
  c42Observer.observe(document.body, {childList:true, subtree:true});
  setTimeout(() => {
    c42EnsureFixedPayOptions();
    c42AddFixedPayFields();
  }, 800);
});


/* =========================
   CONSTONIC ADMIN V4.3
   技術服務固定薪資修正：
   - 抽成選單強制加入「固定薪資」
   - 選固定薪資時，金額欄位代表員工固定獎金
   - 薪資統計會把固定薪資列入本次薪資
========================= */

window.CONSTONIC_ADMIN_VERSION = "V4.3";

function c43EnsureRateOptions(){
  document.querySelectorAll('select[id*="TechRate"], select[data-rate-select]').forEach(sel => {
    const values = Array.from(sel.options).map(o => o.value);
    if(!values.includes("30")){
      const o = document.createElement("option");
      o.value = "30"; o.textContent = "30%";
      sel.appendChild(o);
    }
    if(!values.includes("40")){
      const o = document.createElement("option");
      o.value = "40"; o.textContent = "40%";
      sel.appendChild(o);
    }
    if(!values.includes("fixed")){
      const o = document.createElement("option");
      o.value = "fixed"; o.textContent = "固定薪資";
      sel.appendChild(o);
    }
  });
}

function c43SalaryFromRows(){
  let tech30 = 0, tech40 = 0, fixed = 0;
  const rows = Array.from(document.querySelectorAll(".v3-tech-row, .tech-row, .cashier-row"));
  rows.forEach((row, idx) => {
    const amountInput = row.querySelector('input[id*="TechAmount"]') || row.querySelector('input[type="number"]');
    const rateSelect = row.querySelector('select[id*="TechRate"], select[data-rate-select]');
    const amount = Number(amountInput?.value || 0);
    const rate = rateSelect?.value || "30";
    if(rate === "30") tech30 += Math.round(amount * 0.3);
    if(rate === "40") tech40 += Math.round(amount * 0.4);
    if(rate === "fixed") fixed += amount;
  });
  return {tech30, tech40, fixed};
}

function c43PatchSalaryBox(){
  const box = document.querySelector(".v3-salary-card, .salary-summary");
  if(!box) return;

  if(!box.querySelector(".c43-fixed-salary-row")){
    const row = document.createElement("div");
    row.className = "c43-fixed-salary-row";
    row.innerHTML = `<span>固定薪資</span><strong>NT$ 0</strong>`;
    const total = box.querySelector(".total");
    if(total) box.insertBefore(row, total);
    else box.appendChild(row);
  }

  const salary = c43SalaryFromRows();
  const fixedEl = box.querySelector(".c43-fixed-salary-row strong");
  if(fixedEl) fixedEl.textContent = "NT$ " + Number(salary.fixed || 0).toLocaleString("zh-TW");

  const rows = Array.from(box.querySelectorAll("div"));
  rows.forEach(row => {
    if(row.textContent.includes("技術30%")){
      const strong = row.querySelector("strong");
      if(strong) strong.textContent = "NT$ " + Number(salary.tech30 || 0).toLocaleString("zh-TW");
    }
    if(row.textContent.includes("技術40%")){
      const strong = row.querySelector("strong");
      if(strong) strong.textContent = "NT$ " + Number(salary.tech40 || 0).toLocaleString("zh-TW");
    }
  });

  const getMoney = label => {
    const row = rows.find(r => r.textContent.includes(label));
    return Number(String(row?.querySelector("strong")?.textContent || "0").replace(/[^\d.-]/g,"") || 0);
  };
  const totalEl = box.querySelector(".total strong");
  if(totalEl){
    const total = salary.tech30 + salary.tech40 + salary.fixed + getMoney("商品") + getMoney("課程") + getMoney("平台");
    totalEl.textContent = "NT$ " + Number(total || 0).toLocaleString("zh-TW");
  }
}

function c43PatchTechRows(){
  c43EnsureRateOptions();

  document.querySelectorAll('select[id*="TechRate"], select[data-rate-select]').forEach(sel => {
    if(sel.dataset.c43Patched) return;
    sel.dataset.c43Patched = "1";
    sel.addEventListener("change", () => {
      const row = sel.closest(".v3-tech-row, .tech-row, .cashier-row");
      const label = row?.querySelector(".c43-fixed-note");
      if(sel.value === "fixed"){
        if(!label){
          const note = document.createElement("div");
          note.className = "c43-fixed-note";
          note.textContent = "固定薪資：金額欄請直接填員工獎金";
          row.appendChild(note);
        }
      }else{
        label?.remove();
      }
      c43PatchSalaryBox();
    });
  });

  document.querySelectorAll(".v3-tech-row input, .tech-row input, .cashier-row input").forEach(input => {
    if(input.dataset.c43Patched) return;
    input.dataset.c43Patched = "1";
    input.addEventListener("input", c43PatchSalaryBox);
  });

  c43PatchSalaryBox();
}

const c43Observer = new MutationObserver(() => c43PatchTechRows());
document.addEventListener("DOMContentLoaded", () => {
  c43Observer.observe(document.body, {childList:true, subtree:true});
  setTimeout(c43PatchTechRows, 500);
  setTimeout(c43PatchTechRows, 1500);
});

setTimeout(c43PatchTechRows, 1000);


/* =========================
   CONSTONIC ADMIN V4.4
   修復：
   1. 新增預約項目時，同步新增技術薪資列
   2. 技術抽成強制支援 30% / 40% / 固定薪資
   3. 固定薪資直接用金額欄作為員工獎金
========================= */
window.CONSTONIC_ADMIN_VERSION = "V4.4";

function c44RateOptions(selected){
  return `
    <option value="30" ${String(selected)==="30"?"selected":""}>30%</option>
    <option value="40" ${String(selected)==="40"?"selected":""}>40%</option>
    <option value="fixed" ${String(selected)==="fixed"?"selected":""}>固定薪資</option>
  `;
}

function c44TechRowHtml(itemName="", amount=0, rate="30", idx=0){
  return `<div class="v3-tech-row c44-tech-row">
    <div class="field"><label>項目</label><input id="v2TechName_${idx}" value="${escapeHtml(itemName)}"></div>
    <div class="field"><label>金額／固定薪資</label><input id="v2TechAmount_${idx}" type="number" min="0" value="${Number(amount||0)}" placeholder="金額"></div>
    <div class="field"><label>抽成</label><select id="v2TechRate_${idx}">${c44RateOptions(rate)}</select></div>
  </div>`;
}

function c44SyncTechRowsFromEditItems(){
  const editRows = Array.from(document.querySelectorAll("#editItemsBox .edit-item-row, #v31ItemRows .v31-item-row"));
  const techBox = document.getElementById("v2TechRows");
  if(!techBox || !editRows.length) return;

  const oldRows = Array.from(techBox.querySelectorAll(".v3-tech-row,.tech-row,.cashier-row"));
  const oldData = oldRows.map((row, idx) => ({
    name: row.querySelector(`#v2TechName_${idx}`)?.value || row.querySelector("input")?.value || "",
    amount: Number(row.querySelector(`#v2TechAmount_${idx}`)?.value || row.querySelectorAll("input")[1]?.value || 0),
    rate: row.querySelector(`#v2TechRate_${idx}`)?.value || row.querySelector("select")?.value || "30"
  }));

  const items = editRows.map((row, idx) => {
    const inputs = row.querySelectorAll("input");
    const name = inputs[0]?.value || oldData[idx]?.name || "";
    return {
      name,
      amount: oldData[idx]?.amount || 0,
      rate: oldData[idx]?.rate || "30"
    };
  });

  techBox.dataset.count = items.length;
  techBox.innerHTML = items.map((it, idx)=>c44TechRowHtml(it.name, it.amount, it.rate, idx)).join("");
  c44PatchRateSelects();
  c44RecalcSalary();
}

function c44PatchRateSelects(){
  document.querySelectorAll('select[id*="TechRate"], select[data-rate-select]').forEach((sel, idx) => {
    const current = sel.value || "30";
    sel.innerHTML = c44RateOptions(current);
    sel.value = current === "fixed" ? "fixed" : (current === "40" ? "40" : "30");
  });
}

function c44RecalcSalary(){
  let tech30 = 0, tech40 = 0, fixed = 0;
  document.querySelectorAll("#v2TechRows .v3-tech-row, #v2TechRows .tech-row, #v2TechRows .cashier-row").forEach((row, idx) => {
    const amount = Number(document.getElementById(`v2TechAmount_${idx}`)?.value || row.querySelectorAll("input")[1]?.value || 0);
    const rate = document.getElementById(`v2TechRate_${idx}`)?.value || row.querySelector("select")?.value || "30";
    if(rate === "30") tech30 += Math.round(amount * .3);
    if(rate === "40") tech40 += Math.round(amount * .4);
    if(rate === "fixed") fixed += amount;
  });

  const box = document.querySelector(".v3-salary-card,.salary-summary");
  if(!box) return;

  function setLine(label, value){
    let row = Array.from(box.querySelectorAll("div")).find(d => d.textContent.includes(label));
    if(!row && label === "固定薪資"){
      row = document.createElement("div");
      row.className = "c44-fixed-salary-row";
      row.innerHTML = `<span>固定薪資</span><strong>NT$ 0</strong>`;
      const total = box.querySelector(".total");
      if(total) box.insertBefore(row, total); else box.appendChild(row);
    }
    const strong = row?.querySelector("strong");
    if(strong) strong.textContent = "NT$ " + Number(value||0).toLocaleString("zh-TW");
  }

  setLine("技術30%", tech30);
  setLine("技術40%", tech40);
  setLine("固定薪資", fixed);

  const money = label => Number(String(Array.from(box.querySelectorAll("div")).find(d => d.textContent.includes(label))?.querySelector("strong")?.textContent || "0").replace(/[^\d.-]/g,"") || 0);
  const totalEl = box.querySelector(".total strong");
  if(totalEl){
    const total = tech30 + tech40 + fixed + money("商品") + money("課程") + money("平台");
    totalEl.textContent = "NT$ " + total.toLocaleString("zh-TW");
  }
}

function c44BindSync(){
  c44PatchRateSelects();
  c44SyncTechRowsFromEditItems();

  document.querySelectorAll("#editItemsBox input, #v31ItemRows input, #editItemsBox select, #v31ItemRows select").forEach(el => {
    if(el.dataset.c44SyncBound) return;
    el.dataset.c44SyncBound = "1";
    el.addEventListener("input", () => setTimeout(c44SyncTechRowsFromEditItems, 50));
    el.addEventListener("change", () => setTimeout(c44SyncTechRowsFromEditItems, 50));
  });

  document.querySelectorAll("#v2TechRows input, #v2TechRows select").forEach(el => {
    if(el.dataset.c44SalaryBound) return;
    el.dataset.c44SalaryBound = "1";
    el.addEventListener("input", c44RecalcSalary);
    el.addEventListener("change", c44RecalcSalary);
  });

  c44RecalcSalary();
}

const c44OldAddItemRow = typeof addEditItemRow === "function" ? addEditItemRow : null;
window.addEditItemRow = function(){
  if(c44OldAddItemRow) c44OldAddItemRow();
  else if(typeof v31AddItemRow === "function") v31AddItemRow();
  setTimeout(c44SyncTechRowsFromEditItems, 80);
};

const c44OldV31Add = typeof v31AddItemRow === "function" ? v31AddItemRow : null;
window.v31AddItemRow = function(){
  if(c44OldV31Add) c44OldV31Add();
  setTimeout(c44SyncTechRowsFromEditItems, 80);
};

const c44Observer = new MutationObserver(() => c44BindSync());
document.addEventListener("DOMContentLoaded", () => {
  c44Observer.observe(document.body, {childList:true, subtree:true});
  setTimeout(c44BindSync, 500);
  setTimeout(c44BindSync, 1500);
});
setTimeout(c44BindSync, 1200);

/* CONSTONIC ADMIN V4.5 */
window.CONSTONIC_ADMIN_VERSION = 'V4.5';

/* CONSTONIC ADMIN V4.6 */
window.CONSTONIC_ADMIN_VERSION = 'V4.6';

/* CONSTONIC ADMIN V4.7 */
window.CONSTONIC_ADMIN_VERSION = 'V4.7';

/* CONSTONIC ADMIN V4.8 */
window.CONSTONIC_ADMIN_VERSION = 'V4.8';


/* CONSTONIC ADMIN V4.9 - 移除美甲 + 人員管理 + 手機行事曆 */
window.CONSTONIC_ADMIN_VERSION="V4.9";
const C49_ADMIN_DEFAULT_STAFF=[{name:"雅潔老師",active:true,type:"SPA",color:"pink"},{name:"巧萱美容師",active:true,type:"SPA",color:"purple"}];
function c49AdminLoadStaff(){try{const s=JSON.parse(localStorage.getItem("constonic_staff_members")||"[]");return (Array.isArray(s)&&s.length?s:C49_ADMIN_DEFAULT_STAFF).filter(x=>x&&x.type!=="美甲"&&!/美甲|曼曼/.test(String(x.name||"")));}catch(e){return C49_ADMIN_DEFAULT_STAFF;}}
function c49AdminSaveStaff(list){localStorage.setItem("constonic_staff_members",JSON.stringify((list||[]).filter(s=>s&&s.name&&s.type!=="美甲"&&!/美甲|曼曼/.test(String(s.name)))));}
function c49AdminActiveStaff(){return c49AdminLoadStaff().filter(s=>s.active!==false);}
function c49InjectStaffPanel(){if(document.getElementById("c49StaffPanel"))return;const main=document.getElementById("adminMain")||document.querySelector("main")||document.body;const card=document.createElement("section");card.id="c49StaffPanel";card.className="card";card.innerHTML='<h2>人員管理</h2><p class="hint">新增或停用人員後，前台與後台會同步讀取。美甲暫不放入預約系統。</p><div class="form-grid"><div class="field"><label>新增人員名稱</label><input id="c49StaffName" placeholder="例如：小安美容師"></div><div class="field"><label>類型</label><select id="c49StaffType"><option value="SPA">SPA／臉部／身體</option><option value="其他">其他</option></select></div></div><button type="button" class="primary" onclick="c49AddStaff()">＋新增人員</button><div id="c49StaffList" class="c49-staff-list"></div>';main.appendChild(card);c49RenderStaffList();}
function c49RenderStaffList(){const box=document.getElementById("c49StaffList");if(!box)return;const list=c49AdminLoadStaff();box.innerHTML=list.map((s,idx)=>`<div class="c49-staff-row"><div><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.type||"SPA")}｜${s.active===false?"已停用":"啟用中"}</span></div><div><button type="button" onclick="c49ToggleStaff(${idx})">${s.active===false?"啟用":"停用"}</button><button type="button" class="danger-soft" onclick="c49DeleteStaff(${idx})">刪除</button></div></div>`).join("");}
window.c49AddStaff=function(){const name=document.getElementById("c49StaffName")?.value?.trim();const type=document.getElementById("c49StaffType")?.value||"SPA";if(!name){alert("請輸入人員名稱");return;}if(/美甲|曼曼/.test(name)){alert("美甲暫不放入預約系統，請使用私訊詢問。");return;}const list=c49AdminLoadStaff();if(list.some(s=>s.name===name)){alert("此人員已存在");return;}list.push({name,type,active:true,color:"green"});c49AdminSaveStaff(list);document.getElementById("c49StaffName").value="";c49RenderStaffList();alert("人員已新增，前台重新整理後會同步。");};
window.c49ToggleStaff=function(idx){const list=c49AdminLoadStaff();if(!list[idx])return;list[idx].active=list[idx].active===false?true:false;c49AdminSaveStaff(list);c49RenderStaffList();};
window.c49DeleteStaff=function(idx){const list=c49AdminLoadStaff();if(!list[idx])return;if(!confirm("確定刪除這位人員？"))return;list.splice(idx,1);c49AdminSaveStaff(list);c49RenderStaffList();};
function c49RemoveNailFromAdmin(){document.querySelectorAll(".calendar-head, option, button, label").forEach(el=>{if(/曼曼|美甲/.test(el.textContent||el.value||""))el.remove();});}
window.v41StaffList=function(bookings,filter){const active=c49AdminActiveStaff().map(s=>s.name);if(filter&&filter!=="全部"&&active.includes(filter))return[filter];return active;};
document.addEventListener("DOMContentLoaded",()=>{setTimeout(c49InjectStaffPanel,900);setTimeout(c49RemoveNailFromAdmin,1000);});
document.addEventListener("click",()=>setTimeout(c49RemoveNailFromAdmin,200));


/* CONSTONIC ADMIN V5.0
   修正後台行事曆欄位錯位：
   - 強制用同一份人員名單產生標題與內容欄
   - 移除美甲欄位
   - 手機版改橫向滑動，不壓縮、不錯位
*/
window.CONSTONIC_ADMIN_VERSION = "V5.0";

function c50Staff(){
  try{
    if(typeof c49AdminActiveStaff === "function"){
      const list = c49AdminActiveStaff().map(s => s.name).filter(Boolean);
      return list.length ? list : ["雅潔老師","巧萱美容師"];
    }
  }catch(e){}
  try{
    const saved = JSON.parse(localStorage.getItem("constonic_staff_members") || "[]");
    const active = saved.filter(s => s && s.active !== false && s.type !== "美甲" && !/美甲|曼曼/.test(String(s.name||""))).map(s => s.name);
    return active.length ? active : ["雅潔老師","巧萱美容師"];
  }catch(e){
    return ["雅潔老師","巧萱美容師"];
  }
}

function c50TimeToMin(t){
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function c50MinToTime(min){
  return String(Math.floor(min/60)).padStart(2,"0") + ":" + String(min%60).padStart(2,"0");
}
function c50IsNailText(t){
  return /美甲|曼曼|指甲|卸甲|手部|足部|單色|造型/.test(String(t||""));
}
function c50StaffName(name){
  const list = c50Staff();
  return list.includes(name) ? name : "不指定";
}
function c50Segments(bookings){
  const segs = [];
  (bookings || []).forEach(b => {
    if(b.status === "cancelled") return;
    const base = c50TimeToMin(b.slot);
    if(base === null) return;

    const items = Array.isArray(b.items) ? b.items : [];
    if(!items.length){
      const staff = c50StaffName(b.therapist);
      segs.push({booking:b, item:{name:"預約", duration:Number(b.service_minutes||0)}, idx:0, staff, start:b.slot});
      return;
    }

    let offset = 0;
    items.forEach((item, idx) => {
      const dur = Number(item.duration || 0);
      if(dur <= 0) return;
      if(c50IsNailText([item.name,item.category,item.therapist,b.therapist].join(" "))){
        offset += dur;
        return;
      }
      const staff = c50StaffName(item.therapist || b.therapist);
      segs.push({
        booking:b,
        item,
        idx,
        staff,
        start:c50MinToTime(base + offset)
      });
      offset += dur;
    });
  });
  return segs.filter(s => s.staff !== "不指定");
}
function c50StatusText(s){
  if(typeof statusText === "function") return statusText(s);
  return ({pending:"待確認",confirmed:"已確認",completed:"已完成",cancelled:"已取消"}[s] || s || "待確認");
}
function c50Class(staff){
  if(typeof therapistClass === "function") return therapistClass(staff);
  return "";
}
function c50Card(seg){
  const b = seg.booking;
  const item = seg.item || {};
  return `<div class="booking-card c50-card ${c50Class(seg.staff)}" draggable="true" ondragstart="dragBooking(event,'${escapeHtml(b.id)}')" onclick="openBookingModal('${escapeHtml(b.id)}')">
    <div class="booking-color-strip"></div>
    <strong>${escapeHtml(seg.start)}｜${escapeHtml(b.customer_name || "-")}</strong>
    <div>${seg.idx + 1}. ${escapeHtml(item.name || "-")}（${Number(item.duration || 0)}分）</div>
    <div class="hint">${escapeHtml(seg.staff)}｜${c50StatusText(b.status)}</div>
  </div>`;
}

window.renderBookings = async function(){
  const date = document.getElementById("date")?.value;
  const box = document.getElementById("calendarView");
  const title = document.getElementById("calendarTitle");
  const filter = document.getElementById("therapistFilter")?.value || "全部";
  const mode = document.getElementById("viewMode")?.value || "calendar";
  if(!date || !box) return;

  if(title) title.textContent = `${date} 行事曆`;
  box.innerHTML = "載入中...";

  const {data,error} = await db.from("bookings").select("*").eq("date", date).order("slot", {ascending:true});
  if(error){
    console.error(error);
    box.innerHTML = "<p class='muted'>讀取失敗。</p>";
    return;
  }

  const bookings = data || [];
  window.currentBookings = bookings;

  if(typeof renderStats === "function") renderStats(date, bookings);
  if(typeof renderPendingCenter === "function") renderPendingCenter();
  if(typeof renderTodayWorklist === "function") renderTodayWorklist();

  const staffAll = c50Staff();
  const staffList = (filter && filter !== "全部") ? staffAll.filter(s => s === filter) : staffAll;
  const segments = c50Segments(bookings).filter(s => staffList.includes(s.staff));

  if(mode === "list"){
    box.innerHTML = bookings.map(b => typeof listBookingCard === "function" ? listBookingCard(b) : "").join("");
    return;
  }

  const timeSet = new Set();
  for(let m = 600; m <= 1200; m += 30) timeSet.add(c50MinToTime(m));
  segments.forEach(s => timeSet.add(s.start));
  const times = Array.from(timeSet).sort((a,b) => c50TimeToMin(a) - c50TimeToMin(b));

  let html = `<div class="calendar-grid c50-calendar-grid" style="grid-template-columns:86px repeat(${staffList.length}, minmax(230px, 1fr));">`;
  html += `<div class="calendar-head time-head">時間</div>`;
  staffList.forEach(staff => {
    html += `<div class="calendar-head ${c50Class(staff)}">${escapeHtml(staff)}</div>`;
  });

  times.forEach(t => {
    html += `<div class="time-cell">${t}</div>`;
    staffList.forEach(staff => {
      const cards = segments.filter(s => s.staff === staff && s.start === t);
      html += `<div class="calendar-cell droppable-slot" data-time="${t}" data-therapist="${escapeHtml(staff)}" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)" ondrop="dropBooking(event,'${t}','${escapeHtml(staff)}')">${cards.map(c50Card).join("")}</div>`;
    });
  });
  html += `</div>`;
  box.innerHTML = html;
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if(typeof renderBookings === "function") renderBookings();
  }, 900);
});


/* CONSTONIC ADMIN V5.1
   後台人員管理改存 Supabase，前台可同步
*/
window.CONSTONIC_ADMIN_VERSION = "V5.1";

async function c51LoadStaffDB(){
  try{
    const {data, error} = await db
      .from("staff_members")
      .select("*")
      .order("sort_order", {ascending:true});
    if(error) throw error;
    const list = (data || []).filter(s => s.type !== "美甲" && !/美甲|曼曼/.test(String(s.name || "")));
    localStorage.setItem("constonic_staff_members", JSON.stringify(list));
    return list;
  }catch(e){
    console.warn("staff_members 讀取失敗，改用本機資料", e);
    try{
      return JSON.parse(localStorage.getItem("constonic_staff_members") || "[]");
    }catch(err){
      return [
        {name:"雅潔老師", type:"SPA", active:true, color:"pink", sort_order:1},
        {name:"巧萱美容師", type:"SPA", active:true, color:"purple", sort_order:2}
      ];
    }
  }
}

function c51InjectStaffPanel(){
  let old = document.getElementById("c49StaffPanel");
  if(old) old.remove();
  if(document.getElementById("c51StaffPanel")) return;

  const main = document.getElementById("adminMain") || document.querySelector("main") || document.body;
  const card = document.createElement("section");
  card.id = "c51StaffPanel";
  card.className = "card";
  card.innerHTML = `
    <h2>人員管理</h2>
    <p class="hint">新增、停用或刪除後會存到 Supabase，前台重新整理後同步。</p>
    <div class="form-grid">
      <div class="field">
        <label>新增人員名稱</label>
        <input id="c51StaffName" placeholder="例如：小安美容師">
      </div>
      <div class="field">
        <label>類型</label>
        <select id="c51StaffType">
          <option value="SPA">SPA／臉部／身體</option>
          <option value="其他">其他</option>
        </select>
      </div>
    </div>
    <button type="button" class="primary" onclick="c51AddStaff()">＋新增人員</button>
    <div id="c51StaffList" class="c49-staff-list"></div>
  `;
  main.appendChild(card);
  c51RenderStaffList();
}

async function c51RenderStaffList(){
  const box = document.getElementById("c51StaffList");
  if(!box) return;
  const list = await c51LoadStaffDB();
  box.innerHTML = list.map((s,idx)=>`
    <div class="c49-staff-row">
      <div>
        <strong>${escapeHtml(s.name)}</strong>
        <span>${escapeHtml(s.type || "SPA")}｜${s.active === false ? "已停用" : "啟用中"}</span>
      </div>
      <div>
        <button type="button" onclick="c51ToggleStaff('${s.id}', ${s.active === false ? "true" : "false"})">${s.active === false ? "啟用" : "停用"}</button>
        <button type="button" class="danger-soft" onclick="c51DeleteStaff('${s.id}')">刪除</button>
      </div>
    </div>
  `).join("");
}

window.c51AddStaff = async function(){
  const name = document.getElementById("c51StaffName")?.value?.trim();
  const type = document.getElementById("c51StaffType")?.value || "SPA";
  if(!name){ alert("請輸入人員名稱"); return; }
  if(/美甲|曼曼/.test(name)){ alert("美甲暫不放入預約系統，請使用私訊詢問。"); return; }

  const list = await c51LoadStaffDB();
  if(list.some(s => s.name === name)){ alert("此人員已存在"); return; }

  const {error} = await db.from("staff_members").insert({
    name,
    type,
    active:true,
    color:"green",
    sort_order:(list.length + 1) * 10
  });

  if(error){
    alert("新增失敗，請確認已執行 V5.1 SQL。");
    console.error(error);
    return;
  }

  document.getElementById("c51StaffName").value = "";
  await c51RenderStaffList();
  alert("人員已新增，前台重新整理後會同步。");
};

window.c51ToggleStaff = async function(id, active){
  const {error} = await db.from("staff_members").update({active}).eq("id", id);
  if(error){
    alert("更新失敗");
    console.error(error);
    return;
  }
  await c51RenderStaffList();
};

window.c51DeleteStaff = async function(id){
  if(!confirm("確定刪除這位人員？")) return;
  const {error} = await db.from("staff_members").delete().eq("id", id);
  if(error){
    alert("刪除失敗");
    console.error(error);
    return;
  }
  await c51RenderStaffList();
};

window.c49AdminActiveStaff = function(){
  try{
    const cached = JSON.parse(localStorage.getItem("constonic_staff_members") || "[]");
    const active = cached.filter(s => s.active !== false && s.type !== "美甲" && !/美甲|曼曼/.test(String(s.name || "")));
    return active.length ? active : [
      {name:"雅潔老師", active:true, type:"SPA"},
      {name:"巧萱美容師", active:true, type:"SPA"}
    ];
  }catch(e){
    return [
      {name:"雅潔老師", active:true, type:"SPA"},
      {name:"巧萱美容師", active:true, type:"SPA"}
    ];
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(c51InjectStaffPanel, 800);
  setTimeout(async () => {
    await c51LoadStaffDB();
    if(typeof renderBookings === "function") renderBookings();
  }, 1200);
});


/* CONSTONIC ADMIN V6.0 Beta
   穩定後台：今日 / 本週 / 本月預約查詢、生日月份顯示
*/
window.CONSTONIC_ADMIN_VERSION = "V6.0 Beta";

function c60DateISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function c60StartOfWeek(d){const x=new Date(d);const day=x.getDay()||7;x.setDate(x.getDate()-day+1);return x;}
function c60EndOfWeek(d){const x=c60StartOfWeek(d);x.setDate(x.getDate()+6);return x;}
function c60StartOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function c60EndOfMonth(d){return new Date(d.getFullYear(),d.getMonth()+1,0);}
function c60ItemText(b){return (b.items||[]).map((i,idx)=>`${idx+1}. ${i.name||"-"}（${i.duration||0}分）`).join("、");}
function c60Status(s){return ({pending:"待確認",confirmed:"已確認",completed:"已完成",cancelled:"已取消"}[s]||s||"待確認");}
function c60StaffLabel(b){const names=Array.from(new Set((b.items||[]).map(i=>i.therapist||b.therapist).filter(Boolean)));return names.join("、")||b.therapist||"-";}
async function c60FetchRange(start,end,staff){
  const {data,error}=await db.from("bookings").select("*").gte("date",start).lte("date",end).order("date",{ascending:true}).order("slot",{ascending:true});
  if(error){console.error(error);return[];}
  let list=data||[];
  if(staff&&staff!=="全部")list=list.filter(b=>b.therapist===staff||(b.items||[]).some(i=>i.therapist===staff));
  return list.filter(b=>b.status!=="cancelled");
}
function c60InjectQueryPanel(){
  if(document.getElementById("c60QueryPanel"))return;
  const main=document.getElementById("adminMain")||document.querySelector("main")||document.body;
  const card=document.createElement("section");
  card.id="c60QueryPanel"; card.className="card c60-query-panel";
  card.innerHTML=`<h2>預約查詢</h2><p class="hint">依今天、本週、本月查看客戶預約資料。</p><div class="c60-query-actions"><select id="c60QueryStaff"><option value="全部">全部美容師</option></select><button type="button" onclick="c60LoadQuery('today')">今天</button><button type="button" onclick="c60LoadQuery('week')">本週</button><button type="button" onclick="c60LoadQuery('month')">本月</button></div><div id="c60QueryResult" class="c60-query-result"></div>`;
  const cal=document.getElementById("calendarView")?.closest(".card")||main.firstElementChild;
  if(cal)cal.insertAdjacentElement("beforebegin",card);else main.prepend(card);
  c60PopulateStaffSelect();
}
async function c60PopulateStaffSelect(){
  const sel=document.getElementById("c60QueryStaff"); if(!sel)return;
  let staff=["雅潔老師","巧萱美容師"];
  try{
    const {data}=await db.from("staff_members").select("*").eq("active",true).order("sort_order",{ascending:true});
    const names=(data||[]).filter(s=>s.type!=="美甲"&&!/美甲|曼曼/.test(s.name)).map(s=>s.name);
    if(names.length)staff=names;
  }catch(e){}
  sel.innerHTML=`<option value="全部">全部美容師</option>`+staff.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}
window.c60LoadQuery=async function(mode){
  const box=document.getElementById("c60QueryResult"); if(!box)return;
  const staff=document.getElementById("c60QueryStaff")?.value||"全部";
  const now=new Date(); let start,end,title;
  if(mode==="today"){start=end=c60DateISO(now);title="今日預約";}
  else if(mode==="week"){start=c60DateISO(c60StartOfWeek(now));end=c60DateISO(c60EndOfWeek(now));title="本週預約";}
  else{start=c60DateISO(c60StartOfMonth(now));end=c60DateISO(c60EndOfMonth(now));title="本月預約";}
  box.innerHTML="讀取中...";
  const list=await c60FetchRange(start,end,staff);
  const groups={}; list.forEach(b=>{groups[b.date]=groups[b.date]||[];groups[b.date].push(b);});
  let html=`<div class="c60-query-summary"><strong>${title}</strong><span>${start}${start!==end?" ～ "+end:""}</span><b>共 ${list.length} 筆</b></div>`;
  if(!list.length)html+=`<p class="muted">目前沒有預約。</p>`;
  else Object.keys(groups).sort().forEach(date=>{
    html+=`<h3 class="c60-date-title">${date}</h3>`;
    html+=groups[date].map(b=>`<div class="c60-booking-row" onclick="openBookingModal('${escapeHtml(b.id)}')"><div class="c60-time">${escapeHtml(b.slot||"-")}</div><div class="c60-client"><strong>${escapeHtml(b.customer_name||"-")}</strong><span>${escapeHtml(b.phone||"-")}</span></div><div class="c60-items">${escapeHtml(c60ItemText(b))}</div><div class="c60-staff">${escapeHtml(c60StaffLabel(b))}</div><div class="c60-status">${escapeHtml(c60Status(b.status))}</div></div>`).join("");
  });
  box.innerHTML=html;
};
function c60PatchBookingModalBirthday(){
  const oldOpen=window.openBookingModal;
  if(typeof oldOpen==="function"&&!oldOpen.c60Patched){
    const patched=async function(id){
      await oldOpen.apply(this,arguments);
      setTimeout(()=>{
        const modal=document.querySelector(".modal-card,.booking-modal,.modal-content");
        if(!modal||modal.querySelector(".c60-birthday-view"))return;
        const booking=(window.currentBookings||[]).find(b=>b.id===id);
        const birthday=booking?.birthday_month||"-";
        const area=modal.querySelector(".detail-grid,.booking-detail,.modal-body")||modal;
        const div=document.createElement("div");
        div.className="info-box c60-birthday-view";
        div.innerHTML=`<strong>生日月份</strong><br>${escapeHtml(birthday)}`;
        area.appendChild(div);
      },300);
    };
    patched.c60Patched=true; window.openBookingModal=patched;
  }
}
document.addEventListener("DOMContentLoaded",()=>{setTimeout(c60InjectQueryPanel,900);setTimeout(c60PatchBookingModalBirthday,1000);});
document.addEventListener("click",()=>setTimeout(c60PatchBookingModalBirthday,200));


/* CONSTONIC ADMIN V6.0 RC1
   後台正式整合：
   - 只保留 Supabase 人員管理
   - 新增療程管理，前台同步
   - 技術服務薪資方式：30% / 40% / 固定薪資
   - 取消平台固定欄位
   - 本次實收自動加總：技術金額 + 商品 + 新課程 + 新儲值
   - 預約開放區間設定
*/
window.CONSTONIC_ADMIN_VERSION = "V6.0 RC1";

function c60Money(n){ return Number(n || 0).toLocaleString("zh-TW"); }

window.defaultCheckout = function(b){
  const c = b.checkout || {};
  return {
    room: c.room || "未指定",
    payment_status: c.payment_status || "未收款",
    payment_method: c.payment_method || "現金",
    tech_rows: c.tech_rows || (b.items || []).map((i, idx) => ({
      item_name:i.name || `技術${idx+1}`,
      amount:Number(i.price || 0),
      rate:i.salary_type || "30",
      fixed_salary:Number(i.fixed_salary || 0)
    })),
    product_amount: Number(c.product_amount || 0),
    course_amount: Number(c.course_amount || 0),
    stored_value_new_amount: Number(c.stored_value_new_amount || 0),
    total_received: Number(c.total_received || 0),
    invoice_status: c.invoice_status || "未開",
    receipt_note: c.receipt_note || ""
  };
};

window.checkoutTotals = function(c){
  let tech30Bonus = 0, tech40Bonus = 0, fixedBonus = 0, techReceived = 0;
  (c.tech_rows || []).forEach(r => {
    const amount = Number(r.amount || 0);
    techReceived += amount;
    if(String(r.rate) === "30") tech30Bonus += Math.round(amount * .3);
    else if(String(r.rate) === "40") tech40Bonus += Math.round(amount * .4);
    else if(String(r.rate) === "fixed") fixedBonus += Number(r.fixed_salary || amount || 0);
  });
  const product = Number(c.product_amount || 0);
  const course = Number(c.course_amount || 0);
  const stored = Number(c.stored_value_new_amount || 0);
  const productBonus = Math.round(product * .1);
  const courseBonus = Math.round((course + stored) * .02);
  const totalReceived = techReceived + product + course + stored;
  return {tech30Bonus, tech40Bonus, fixedBonus, productBonus, courseBonus, totalReceived, salaryTotal:tech30Bonus+tech40Bonus+fixedBonus+productBonus+courseBonus};
};

function c60RateOptions(rate){
  return `<option value="30" ${String(rate)==="30"?"selected":""}>30%</option>
    <option value="40" ${String(rate)==="40"?"selected":""}>40%</option>
    <option value="fixed" ${String(rate)==="fixed"?"selected":""}>固定薪資</option>`;
}

window.renderCheckoutPanel = function(b){
  const c = defaultCheckout(b);
  const t = checkoutTotals(c);
  const rows = c.tech_rows.map((r,idx)=>`
    <div class="tech-row c60-tech-row">
      <div class="field"><label>項目</label><input id="techName_${idx}" value="${escapeHtml(r.item_name || "")}"></div>
      <div class="field"><label>技術金額</label><input id="techAmount_${idx}" type="number" min="0" value="${Number(r.amount || 0)}" oninput="c60RecalcCheckout()"></div>
      <div class="field"><label>薪資方式</label><select id="techRate_${idx}" onchange="c60ToggleFixedSalary(${idx}); c60RecalcCheckout();">${c60RateOptions(r.rate)}</select></div>
      <div class="field c60-fixed-field" id="fixedSalaryField_${idx}" style="${String(r.rate)==='fixed'?'':'display:none'}"><label>固定薪資</label><input id="fixedSalary_${idx}" type="number" min="0" value="${Number(r.fixed_salary || r.amount || 0)}" oninput="c60RecalcCheckout()"></div>
    </div>`).join("");

  return `<div class="panel cashier-panel"><h3>收銀／薪資</h3>
    <div class="form-grid compact">
      <div class="field"><label>收款狀態</label><select id="paymentStatus">${["已收款","部分收款","未收款"].map(v=>`<option ${c.payment_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>收款方式</label><select id="paymentMethod">${PAYMENT_METHODS.map(v=>`<option ${c.payment_method===v?"selected":""}>${v}</option>`).join("")}</select></div>
    </div>
    <details open class="collapse"><summary>技術服務</summary><div id="techRows" data-count="${c.tech_rows.length}">${rows}</div></details>
    <details open class="collapse"><summary>商品／課程／儲值</summary>
      <div class="form-grid compact">
        <div class="field"><label>商品銷售金額</label><input id="productAmount" type="number" min="0" value="${c.product_amount}" oninput="c60RecalcCheckout()"></div>
        <div class="field"><label>新購課程金額</label><input id="courseAmount" type="number" min="0" value="${c.course_amount}" oninput="c60RecalcCheckout()"></div>
        <div class="field"><label>新儲值金額</label><input id="storedValueAmount" type="number" min="0" value="${c.stored_value_new_amount}" oninput="c60RecalcCheckout()"></div>
        <div class="field"><label>本次實收（自動加總）</label><input id="totalReceived" type="number" readonly value="${t.totalReceived}"></div>
        <div class="field"><label>發票</label><select id="invoiceStatus">${["未開","已開","免開"].map(v=>`<option ${c.invoice_status===v?"selected":""}>${v}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>備註</label><textarea id="receiptNote" rows="2">${escapeHtml(c.receipt_note)}</textarea></div>
    </details>
    <div class="salary-card" id="salaryCard">
      <div><span>技術30%</span><strong id="salary30">NT$ ${c60Money(t.tech30Bonus)}</strong></div>
      <div><span>技術40%</span><strong id="salary40">NT$ ${c60Money(t.tech40Bonus)}</strong></div>
      <div><span>固定薪資</span><strong id="salaryFixed">NT$ ${c60Money(t.fixedBonus)}</strong></div>
      <div><span>商品10%</span><strong id="salaryProduct">NT$ ${c60Money(t.productBonus)}</strong></div>
      <div><span>課程／儲值2%</span><strong id="salaryCourse">NT$ ${c60Money(t.courseBonus)}</strong></div>
      <div class="total"><span>本次薪資</span><strong id="salaryTotal">NT$ ${c60Money(t.salaryTotal)}</strong></div>
    </div>
  </div>`;
};

window.c60ToggleFixedSalary = function(idx){
  const rate = $("techRate_"+idx)?.value;
  const field = $("fixedSalaryField_"+idx);
  if(field) field.style.display = rate === "fixed" ? "" : "none";
};

window.c60CollectCheckoutPreview = function(){
  const rows = [...document.querySelectorAll("#techRows .tech-row")].map((row,idx)=>({
    item_name:$("techName_"+idx)?.value || "",
    amount:Number($("techAmount_"+idx)?.value || 0),
    rate:$("techRate_"+idx)?.value || "30",
    fixed_salary:Number($("fixedSalary_"+idx)?.value || 0)
  }));
  return {
    tech_rows: rows,
    product_amount:Number($("productAmount")?.value || 0),
    course_amount:Number($("courseAmount")?.value || 0),
    stored_value_new_amount:Number($("storedValueAmount")?.value || 0)
  };
};

window.c60RecalcCheckout = function(){
  const c = c60CollectCheckoutPreview();
  const t = checkoutTotals(c);
  if($("totalReceived")) $("totalReceived").value = t.totalReceived;
  if($("salary30")) $("salary30").textContent = "NT$ " + c60Money(t.tech30Bonus);
  if($("salary40")) $("salary40").textContent = "NT$ " + c60Money(t.tech40Bonus);
  if($("salaryFixed")) $("salaryFixed").textContent = "NT$ " + c60Money(t.fixedBonus);
  if($("salaryProduct")) $("salaryProduct").textContent = "NT$ " + c60Money(t.productBonus);
  if($("salaryCourse")) $("salaryCourse").textContent = "NT$ " + c60Money(t.courseBonus);
  if($("salaryTotal")) $("salaryTotal").textContent = "NT$ " + c60Money(t.salaryTotal);
};

window.collectCheckoutFromForm = function(existing={}){
  const rows = [...document.querySelectorAll("#techRows .tech-row")].map((row,idx)=>({
    item_name:$("techName_"+idx)?.value || "",
    amount:Number($("techAmount_"+idx)?.value || 0),
    rate:$("techRate_"+idx)?.value || "30",
    fixed_salary:Number($("fixedSalary_"+idx)?.value || 0)
  }));
  const checkout = {
    ...existing,
    room:$("roomSelect")?.value || existing.room || "未指定",
    payment_status:$("paymentStatus")?.value || "未收款",
    payment_method:$("paymentMethod")?.value || "現金",
    tech_rows:rows,
    product_amount:Number($("productAmount")?.value || 0),
    course_amount:Number($("courseAmount")?.value || 0),
    stored_value_new_amount:Number($("storedValueAmount")?.value || 0),
    total_received:Number($("totalReceived")?.value || 0),
    invoice_status:$("invoiceStatus")?.value || "未開",
    receipt_note:$("receiptNote")?.value || ""
  };
  checkout.calculated = checkoutTotals(checkout);
  return checkout;
};

/* 療程管理 */
async function c60LoadCategories(){
  const {data,error} = await db.from("service_categories").select("*").order("sort_order",{ascending:true});
  if(error){ console.error(error); return []; }
  return (data || []).filter(c => !/美甲|曼曼/.test(c.name));
}
async function c60LoadItems(){
  const {data,error} = await db.from("service_items").select("*").order("category_name",{ascending:true}).order("sort_order",{ascending:true});
  if(error){ console.error(error); return []; }
  return (data || []).filter(i => !/美甲|曼曼/.test(String(i.name+i.category_name)));
}
function c60InjectServicePanel(){
  if(document.getElementById("c60ServicePanel")) return;
  const main = document.getElementById("adminMain") || document.querySelector("main") || document.body;
  const card = document.createElement("section");
  card.id = "c60ServicePanel";
  card.className = "card c60-service-panel";
  card.innerHTML = `
    <h2>療程管理</h2>
    <p class="hint">這裡新增、修改、停用後，前台會同步顯示。美甲暫不放入預約系統。</p>
    <div class="form-grid compact">
      <div class="field"><label>類別名稱</label><input id="newCategoryName" placeholder="例如：臉部保養"></div>
      <div class="field"><label>排序</label><input id="newCategorySort" type="number" value="100"></div>
    </div>
    <button type="button" onclick="c60AddCategory()">＋新增類別</button>
    <hr>
    <div class="form-grid compact">
      <div class="field"><label>療程類別</label><select id="serviceCategorySelect"></select></div>
      <div class="field"><label>療程名稱</label><input id="serviceName" placeholder="例如：眼部護膚"></div>
      <div class="field"><label>時間（分鐘）</label><input id="serviceDuration" type="number" value="60"></div>
      <div class="field"><label>價格</label><input id="servicePrice" type="number" value="0"></div>
      <div class="field"><label>預設人員</label><select id="serviceDefaultStaff"></select></div>
      <div class="field"><label>薪資方式</label><select id="serviceSalaryType" onchange="c60ToggleServiceFixed()"><option value="30">30%</option><option value="40">40%</option><option value="fixed">固定薪資</option></select></div>
      <div class="field" id="serviceFixedSalaryField" style="display:none"><label>固定薪資</label><input id="serviceFixedSalary" type="number" value="0"></div>
    </div>
    <button type="button" class="primary" onclick="c60SaveServiceItem()">＋新增療程</button>
    <div id="c60ServiceList" class="c60-service-list"></div>
  `;
  main.appendChild(card);
  c60RefreshServicePanel();
}
window.c60ToggleServiceFixed = function(){
  const field = $("serviceFixedSalaryField");
  if(field) field.style.display = $("serviceSalaryType")?.value === "fixed" ? "" : "none";
};
async function c60RefreshServicePanel(){
  const cats = await c60LoadCategories();
  const staff = await c60LoadStaffForService();
  const catSel = $("serviceCategorySelect");
  if(catSel) catSel.innerHTML = cats.map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const staffSel = $("serviceDefaultStaff");
  if(staffSel) staffSel.innerHTML = staff.map(s => `<option>${escapeHtml(s.name)}</option>`).join("");
  const list = await c60LoadItems();
  const box = $("c60ServiceList");
  if(box){
    box.innerHTML = list.map(i => `
      <div class="c60-service-row">
        <div><strong>${escapeHtml(i.name)}</strong><span>${escapeHtml(i.category_name)}｜${Number(i.duration)}分｜NT$ ${c60Money(i.price)}｜${i.salary_type==="fixed"?"固定薪資 NT$ "+c60Money(i.fixed_salary):i.salary_type+"%"}</span></div>
        <div>
          <button type="button" onclick="c60ToggleServiceItem('${i.id}', ${i.active === false ? "true" : "false"})">${i.active === false ? "啟用" : "停用"}</button>
          <button type="button" onclick="c60DeleteServiceItem('${i.id}')">刪除</button>
        </div>
      </div>`).join("");
  }
}
async function c60LoadStaffForService(){
  try{
    const {data} = await db.from("staff_members").select("*").eq("active",true).order("sort_order",{ascending:true});
    const list = (data || []).filter(s => s.type !== "美甲" && !/美甲|曼曼/.test(s.name));
    return list.length ? list : [{name:"雅潔老師"},{name:"巧萱美容師"}];
  }catch(e){ return [{name:"雅潔老師"},{name:"巧萱美容師"}]; }
}
window.c60AddCategory = async function(){
  const name = $("newCategoryName")?.value?.trim();
  if(!name){ alert("請輸入類別名稱"); return; }
  if(/美甲|曼曼/.test(name)){ alert("美甲暫不放入預約系統"); return; }
  const {error} = await db.from("service_categories").insert({name, active:true, sort_order:Number($("newCategorySort")?.value || 100)});
  if(error){ alert("新增類別失敗，請確認已執行 V6.0 RC1 SQL"); console.error(error); return; }
  $("newCategoryName").value = "";
  await c60RefreshServicePanel();
};
window.c60SaveServiceItem = async function(){
  const sel = $("serviceCategorySelect");
  const category_id = sel?.value;
  const category_name = sel?.selectedOptions?.[0]?.dataset?.name || sel?.selectedOptions?.[0]?.textContent || "";
  const name = $("serviceName")?.value?.trim();
  if(!category_id || !name){ alert("請選擇類別並輸入療程名稱"); return; }
  const payload = {
    category_id,
    category_name,
    name,
    duration:Number($("serviceDuration")?.value || 60),
    price:Number($("servicePrice")?.value || 0),
    active:true,
    default_staff:$("serviceDefaultStaff")?.value || "",
    salary_type:$("serviceSalaryType")?.value || "30",
    fixed_salary:Number($("serviceFixedSalary")?.value || 0),
    sort_order:100
  };
  const {error} = await db.from("service_items").insert(payload);
  if(error){ alert("新增療程失敗"); console.error(error); return; }
  $("serviceName").value = "";
  await c60RefreshServicePanel();
};
window.c60ToggleServiceItem = async function(id, active){
  const {error} = await db.from("service_items").update({active}).eq("id",id);
  if(error){ alert("更新失敗"); console.error(error); return; }
  await c60RefreshServicePanel();
};
window.c60DeleteServiceItem = async function(id){
  if(!confirm("確定刪除此療程？已成立的舊預約不會消失。")) return;
  const {error} = await db.from("service_items").delete().eq("id",id);
  if(error){ alert("刪除失敗"); console.error(error); return; }
  await c60RefreshServicePanel();
};

/* 預約開放設定 */
function c60InjectBookingSettings(){
  if(document.getElementById("c60BookingSettings")) return;
  const main = document.getElementById("adminMain") || document.querySelector("main") || document.body;
  const card = document.createElement("section");
  card.id = "c60BookingSettings";
  card.className = "card";
  card.innerHTML = `
    <h2>預約開放設定</h2>
    <div class="form-grid compact">
      <div class="field"><label>開放方式</label><select id="bookingOpenMode" onchange="c60ToggleManualRange()"><option value="auto_2_months">自動開放未來 2 個月</option><option value="manual_range">手動指定日期區間</option></select></div>
      <div class="field c60-manual-range"><label>開始日期</label><input id="manualStart" type="date"></div>
      <div class="field c60-manual-range"><label>結束日期</label><input id="manualEnd" type="date"></div>
    </div>
    <button type="button" onclick="c60SaveBookingSettings()">儲存預約開放設定</button>
  `;
  main.appendChild(card);
  c60LoadBookingSettings();
}
window.c60ToggleManualRange = function(){
  const mode = $("bookingOpenMode")?.value;
  document.querySelectorAll(".c60-manual-range").forEach(el => el.style.display = mode === "manual_range" ? "" : "none");
};
async function c60LoadBookingSettings(){
  try{
    const {data} = await db.from("booking_settings").select("*").eq("id",1).single();
    if(data){
      $("bookingOpenMode").value = data.booking_open_mode || "auto_2_months";
      $("manualStart").value = data.manual_start || "";
      $("manualEnd").value = data.manual_end || "";
    }
  }catch(e){}
  c60ToggleManualRange();
}
window.c60SaveBookingSettings = async function(){
  const payload = {id:1, booking_open_mode:$("bookingOpenMode")?.value || "auto_2_months", manual_start:$("manualStart")?.value || null, manual_end:$("manualEnd")?.value || null, updated_at:new Date().toISOString()};
  const {error} = await db.from("booking_settings").upsert(payload);
  if(error){ alert("儲存失敗，請確認已執行 V6.0 RC1 SQL"); console.error(error); return; }
  alert("預約開放設定已儲存，前台重新整理後同步。");
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(c60InjectServicePanel, 1200);
  setTimeout(c60InjectBookingSettings, 1400);
});
