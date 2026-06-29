
const cfg = window.CONSTONIC_CONFIG;
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const staff = ["雅潔老師", "巧萱美容師", "曼曼美甲師", "不指定"];

function getCurrentUser() {
  return JSON.parse(sessionStorage.getItem("constonicStaffUser") || "null");
}

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const user = (cfg.STAFF_ACCOUNTS || []).find(a => a.username === username && a.password === password);
  if (!user) {
    document.getElementById("loginMessage").textContent = "帳號或密碼錯誤。";
    return;
  }
  sessionStorage.setItem("constonicStaffUser", JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role
  }));
  showAdmin();
}

function logout() {
  sessionStorage.removeItem("constonicStaffUser");
  location.reload();
}

function showAdmin() {
  const user = getCurrentUser();
  if (!user) return;
  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("adminMain").classList.remove("hidden");
  document.getElementById("welcomeTitle").textContent = `${user.displayName} 後台行事曆`;
  document.getElementById("therapistFilter").disabled = false;
  renderBookings();
}

function statusText(status) {
  if (status === "pending") return "待確認";
  if (status === "confirmed") return "已確認";
  if (status === "cancelled") return "已取消";
  return status || "待確認";
}

function bookingCard(b) {
  return `<div class="booking-card status-${b.status}">
    <strong>${b.slot}｜${b.customer_name}</strong>
    <div>${b.items.map((i,idx)=>`${idx+1}. ${i.name}（${i.duration}分）${i.therapist ? "｜" + i.therapist : ""}`).join("<br>")}</div>
    <div class="hint">療程 ${b.service_minutes} 分｜整理 ${b.internal_buffer||0} 分｜保留 ${b.total_block} 分</div>
    <div>美容師：${b.therapist}</div>
    <div>電話：${b.phone}</div>
    <div>LINE：${b.line_name||"-"}</div>
    <div>第一次來店：${b.first_visit||"-"}</div>
    <div>備註：${b.note||"-"}</div>
    <div class="hint">狀態：${statusText(b.status)}</div>
    <button onclick="updateStatus('${b.id}','confirmed')">已確認</button>
    <button onclick="updateStatus('${b.id}','cancelled')">取消</button>
    <button onclick="deleteBooking('${b.id}')">刪除</button>
  </div>`;
}

async function renderBookings() {
  const user = getCurrentUser();
  if (!user) return;

  const date = document.getElementById("date").value;
  const mode = document.getElementById("viewMode").value;
  const therapistFilter = document.getElementById("therapistFilter").value;
  const box = document.getElementById("calendarView");
  document.getElementById("calendarTitle").textContent = `${date} 行事曆`;
  box.innerHTML = "載入中...";

  let query = db.from("bookings").select("*").eq("date", date).order("slot", { ascending: true });

  if (therapistFilter !== "全部") {
    query = query.eq("therapist", therapistFilter);
  }

  const { data, error } = await query;
  if (error) {
    box.innerHTML = '<p class="muted">讀取失敗，請確認 Supabase 設定。</p>';
    console.error(error);
    return;
  }

  const bookings = data || [];
  if (!bookings.length) {
    box.innerHTML = '<p class="muted">這一天目前沒有預約。</p>';
    return;
  }

  if (mode === "list") {
    box.innerHTML = bookings.map(bookingCard).join("");
    return;
  }

  const visibleStaff = therapistFilter === "全部" ? staff : [therapistFilter];
  let html = `<div class="calendar-grid staff-${visibleStaff.length}"><div class="calendar-head time-head">時間</div>`;
  visibleStaff.forEach(s => html += `<div class="calendar-head">${s}</div>`);

  for (let t = 600; t <= 1200; t += 30) {
    const label = `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;
    html += `<div class="time-cell">${label}</div>`;
    visibleStaff.forEach(s => {
      const matches = bookings.filter(b => b.therapist === s && b.slot === label);
      html += `<div class="calendar-cell">${matches.map(bookingCard).join("")}</div>`;
    });
  }
  html += "</div>";
  box.innerHTML = html;
}

async function updateStatus(id, status) {
  const { error } = await db.from("bookings").update({ status }).eq("id", id);
  if (error) alert("更新失敗");
  renderBookings();
}

async function deleteBooking(id) {
  if (!confirm("確認刪除此筆預約？")) return;
  const { error } = await db.from("bookings").delete().eq("id", id);
  if (error) alert("刪除失敗");
  renderBookings();
}

const today = new Date();
document.getElementById("date").value = today.toISOString().slice(0,10);

if (getCurrentUser()) {
  showAdmin();
}
