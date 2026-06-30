
const cfg = window.CONSTONIC_CONFIG || {};
let db = null;
let dbReady = false;

if (
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes("請貼上") &&
  !cfg.SUPABASE_ANON_KEY.includes("請貼上") &&
  window.supabase
) {
  db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  dbReady = true;
}

const categoryTherapists = {
  "臉部保養": ["雅潔老師", "巧萱美容師"],
  "身體舒壓": ["雅潔老師", "巧萱美容師"],
  "熱蠟除毛": ["雅潔老師"],
  "瘦身管理": ["巧萱美容師"],
  "胸部保養": ["雅潔老師", "巧萱美容師"],
  "霧眉設計": ["雅潔老師"],
  "美甲設計": ["曼曼美甲師"]
};

const services = {
  "臉部保養": [
    {name:"小氣泡毛孔洗淨",duration:60},
    {name:"臉部護膚",duration:90},
    {name:"日式護膚",duration:120},
    {name:"法式護膚",duration:120},
    {name:"痘痘粉刺",duration:120},
    {name:"眼部護膚",duration:40}
  ],
  "身體舒壓": [
    {name:"滑罐刮痧",duration:20,teacherFee:false},
    {name:"背部按摩",duration:30,teacherFee:true},
    {name:"全背部按摩",duration:60,teacherFee:true},
    {name:"全身按摩",duration:90,teacherFee:true},
    {name:"全身按摩",duration:120,teacherFee:true},
    {name:"孕婦按摩",duration:90,teacherFee:true},
    {name:"貴妃浴全身角質更新",duration:50,teacherFee:false},
    {name:"貴妃美白敷體",duration:50,teacherFee:false},
    {name:"頭舒壓好眠",duration:60,teacherFee:false}
  ],
  "熱蠟除毛": [
    {name:"腋下",duration:10},
    {name:"小腿",duration:30},
    {name:"全腿",duration:40},
    {name:"私密處",duration:40},
    {name:"鼻毛",duration:20},
    {name:"臉部",duration:50}
  ],
  "瘦身管理": [
    {name:"岩盤浴",duration:40},
    {name:"魔塑曲雕",duration:30},
    {name:"魔塑三合一",duration:80},
    {name:"腹部磁力雕塑",duration:40}
  ],
  "胸部保養": [
    {name:"基礎美胸",duration:30},
    {name:"五行美胸",duration:60}
  ],
  "霧眉設計": [
    {name:"眉型霧眉設計",duration:180},
    {name:"隱形眼線設計",duration:120}
  ],
  "美甲設計": [
    {name:"手部單色",duration:90},
    {name:"手部造型",duration:120},
    {name:"手部保養",duration:30},
    {name:"足部單色",duration:90},
    {name:"足部造型",duration:120},
    {name:"足部基礎保養",duration:60},
    {name:"足部深層保養（含去繭）",duration:90}
  ]
};

let cart = [];
let selectedSlot = "";
let bookingsCache = [];

const $ = id => document.getElementById(id);

function pad(n){return String(n).padStart(2,"0")}
function timeToMinutes(t){const [h,m]=t.split(":").map(Number);return h*60+m}
function minutesToTime(min){return `${pad(Math.floor(min/60))}:${pad(min%60)}`}
function dayConfig(dateStr){
  if(!dateStr)return null;
  const day=new Date(dateStr+"T00:00:00").getDay();
  if(day===0)return{closed:true};
  if(day===6)return{open:600,close:1080};
  return{open:600,close:1200};
}
function overlaps(aStart,aEnd,bStart,bEnd){return aStart<bEnd&&bStart<aEnd}

function itemBuffer(item){
  if(item.category==="身體舒壓") return 20;
  if(item.category==="臉部保養") return 10;
  return 0;
}

function itemBlock(item){
  return item.duration + itemBuffer(item);
}

function isSameLocalDate(dateStr){
  const now = new Date();
  return dateStr === now.toISOString().slice(0,10);
}

function currentMinutesRoundedUp(){
  const now = new Date();
  const min = now.getHours()*60 + now.getMinutes();
  return Math.ceil(min/30)*30;
}

function plannedSchedule(startTime){
  let cursor = startTime;
  return cart.map(item=>{
    const serviceStart = cursor;
    const serviceEnd = serviceStart + item.duration;
    const buffer = itemBuffer(item);
    const blockEnd = serviceEnd + buffer;
    cursor = serviceEnd; // 下一個療程接在「服務結束」後，不被整理時間延後
    return {
      item,
      therapist: item.therapist,
      start: serviceStart,
      serviceEnd,
      buffer,
      blockEnd
    };
  });
}

function plannedTotalBlockFromStart(){
  if(!cart.length) return 0;
  const plan = plannedSchedule(0);
  return Math.max(...plan.map(p=>p.blockEnd));
}

function totals(){
  const serviceMinutes=cart.reduce((s,i)=>s+i.duration,0);
  const hasFace=cart.some(i=>i.category==="臉部保養");
  const hasBody=cart.some(i=>i.category==="身體舒壓");
  const internalBuffer=hasBody?20:(hasFace?10:0);
  return{serviceMinutes,internalBuffer,totalBlock:serviceMinutes+internalBuffer};
}


function hasNailService(){
  return cart.some(i => i.category === "美甲設計");
}
function toggleNailRequestUI(){
  const isNail = hasNailService();
  const nailCard = $("nailRequestCard");
  const slotCard = $("slotCard");
  if(nailCard) nailCard.classList.toggle("hidden", !isNail);
  if(slotCard) slotCard.classList.toggle("hidden", isNail);
}
function nailRequestSummary(){
  if(!hasNailService()) return null;
  return {
    preferred_period: $("nailPreferredPeriod") ? $("nailPreferredPeriod").value : "",
    preferred_time: $("nailPreferredTime") ? $("nailPreferredTime").value : "",
    part: $("nailPart") ? $("nailPart").value : "",
    style: $("nailStyle") ? $("nailStyle").value : "",
    nail_note: $("nailNote") ? $("nailNote").value : ""
  };
}

function renderCategories(){
  const box=$("categoryButtons");
  box.innerHTML="";
  Object.keys(services).forEach(cat=>{
    const btn=document.createElement("button");
    btn.type="button";
    btn.textContent=cat;
    btn.onclick=()=>selectCategory(cat);
    box.appendChild(btn);
  });
}

function selectCategory(cat){
  [...$("categoryButtons").children].forEach(b=>b.classList.toggle("active",b.textContent===cat));
  const box=$("serviceList");
  box.innerHTML="";
  box.className="service-list";
  services[cat].forEach(svc=>{
    const div=document.createElement("div");
    div.className="service-item";
    div.innerHTML=`${svc.name}<small>${svc.duration} 分鐘｜點擊加入本次預約</small>`;
    div.onclick=()=>addToCart({...svc,category:cat,cartId:Date.now()+Math.random(),therapist:categoryTherapists[cat][0]});
    box.appendChild(div);
  });
}

function addToCart(item){
  cart.push(item);
  selectedSlot="";
  renderCart();
  renderTeacherFee();
  toggleNailRequestUI();
  loadBookingsAndSlots();
  updateSummary();
}

function removeFromCart(id){
  cart=cart.filter(i=>i.cartId!==id);
  selectedSlot="";
  renderCart();
  renderTeacherFee();
  toggleNailRequestUI();
  loadBookingsAndSlots();
  updateSummary();
}

function clearCart(){
  cart=[];
  selectedSlot="";
  renderCart();
  renderTeacherFee();
  toggleNailRequestUI();
  renderSlots();
  updateSummary();
}

function changeItemTherapist(cartId, therapist){
  const item=cart.find(i=>String(i.cartId)===String(cartId));
  if(item){
    item.therapist=therapist;
    selectedSlot="";
    renderCart();
    renderTeacherFee();
  toggleNailRequestUI();
    loadBookingsAndSlots();
    updateSummary();
  }
}

function renderTherapistSelect(item){
  const options=(categoryTherapists[item.category]||["不指定"]).map(t=>{
    const label=(item.category==="身體舒壓"&&item.teacherFee&&t==="雅潔老師")?`${t}（指定+300）`:t;
    return `<option value="${t}" ${item.therapist===t?"selected":""}>${label}</option>`;
  }).join("");
  return `<div class="field" style="margin-top:8px;margin-bottom:0;">
    <label>服務人員</label>
    <select onchange="changeItemTherapist('${item.cartId}', this.value)">${options}</select>
  </div>`;
}

function renderCart(){
  const box=$("cartList");
  if(!cart.length){
    box.className="muted";
    box.textContent="尚未加入療程";
    $("cartTotal").textContent="請先加入至少一項療程";
    $("cartTotal").className="summary muted";
    return;
  }
  box.className="";
  box.innerHTML=cart.map((item,idx)=>`
    <div class="cart-row">
      <div style="width:100%;">
        <strong>${idx+1}. ${item.name}</strong><br>
        <span class="hint">${item.category}｜${item.duration} 分鐘</span>
        ${renderTherapistSelect(item)}
      </div>
      <button type="button" onclick="removeFromCart(${item.cartId})">移除</button>
    </div>
  `).join("");
  const t=totals();
  $("cartTotal").className="summary";
  $("cartTotal").innerHTML=`療程時間合計：<strong>${t.serviceMinutes} 分鐘</strong><br><span class="hint">每個療程可個別指定服務人員。實際預約安排會由店家確認。</span>`;
}

function renderTeacherFee(){
  const has=cart.some(i=>i.category==="身體舒壓"&&i.teacherFee&&i.therapist==="雅潔老師");
  $("teacherFee").textContent=has?"本次含身體按摩項目，指定雅潔老師需加收 300 元。":"";
}

async function loadBookingsAndSlots(){
  const date=$("date").value;
  bookingsCache=[];
  if(!date||!cart.length){renderSlots();return}
  if(!dbReady){renderSlots();return}
  const {data,error}=await db.from("bookings").select("*").eq("date",date).neq("status","cancelled");
  if(error){
    $("slotList").textContent="讀取預約資料失敗，請稍後再試。";
    $("slotList").className="slot-list muted";
    console.error(error);
    return;
  }
  bookingsCache=data||[];
  renderSlots();
}

function selectedTherapists(){
  return [...new Set(cart.map(i=>i.therapist))];
}

function isTherapistBusy(therapist,start,end){
  if(!dbReady) return false;
  return bookingsCache.some(b=>{
    const bTherapist=b.therapist;
    if(bTherapist!==therapist) return false;
    const bStart=timeToMinutes(b.slot);
    const bEnd=bStart+Number(b.total_block||0);
    return overlaps(start,end,bStart,bEnd);
  });
}

function renderSlots(){
  if(hasNailService()){
    const slotList=$("slotList");
    if(slotList){
      slotList.textContent="美甲採人工確認制，請填寫希望時段後送出申請。";
      slotList.className="slot-list muted";
    }
    return;
  }
  const date=$("date").value,slotList=$("slotList");
  slotList.innerHTML="";
  if(!cart.length||!date){
    slotList.textContent="請先加入療程並選擇日期";
    slotList.className="slot-list muted";
    return;
  }
  const cfgDay=dayConfig(date);
  if(cfgDay.closed){
    slotList.textContent="週日店休，請選擇其他日期。";
    slotList.className="slot-list muted";
    return;
  }
  slotList.className="slot-list";

  const totalNeeded = plannedTotalBlockFromStart();
  const latestStart = cfgDay.close - totalNeeded;
  const todayCutoff = isSameLocalDate(date) ? currentMinutesRoundedUp() : cfgDay.open;
  let availableCount = 0;

  for(let time=cfgDay.open;time<=latestStart;time+=30){
    if(time < todayCutoff) continue;
    const plan = plannedSchedule(time);
    let busy=false;
    for(const p of plan){
      if(isTherapistBusy(p.therapist,p.start,p.blockEnd)){
        busy=true;
        break;
      }
    }
    const btn=document.createElement("button");
    btn.className="slot";
    btn.textContent=minutesToTime(time);
    if(busy){
      btn.classList.add("disabled");
      btn.textContent+=" 已滿";
      btn.disabled=true;
    }else{
      availableCount++;
      btn.onclick=()=>{
        selectedSlot=minutesToTime(time);
        [...slotList.children].forEach(el=>el.classList.remove("active"));
        btn.classList.add("active");
        updateSummary();
      }
    }
    slotList.appendChild(btn);
  }

  if(availableCount===0){
    slotList.textContent="今天目前已無可預約空檔，請選擇其他日期或電話洽詢 06-2723611。";
    slotList.className="slot-list muted";
  }
}

function updateSummary(){
  const s=$("summary");
  if(!cart.length||!$("date").value||(!selectedSlot && !hasNailService())){
    s.textContent="尚未選擇完整預約內容";
    s.className="summary muted";
    return;
  }
  const start=timeToMinutes(selectedSlot);
  const plan=plannedSchedule(start);
  const fee=cart.some(i=>i.category==="身體舒壓"&&i.teacherFee&&i.therapist==="雅潔老師")?"｜含雅潔老師身體指定費 +300 元":"";
  s.className="summary";
  s.innerHTML=`<strong>預約確認</strong><br>項目：<br>${plan.map((p,idx)=>`${idx+1}. ${p.item.category}｜${p.item.name}（${p.item.duration} 分鐘）｜${p.therapist}｜${minutesToTime(p.start)}-${minutesToTime(p.serviceEnd)}`).join("<br>")}<br><br>療程時間合計：${cart.reduce((sum,i)=>sum+i.duration,0)} 分鐘${fee}<br>日期：${$("date").value}<br>開始時間：${hasNailService() ? "待店家確認" : selectedSlot}`;
}

$("date").addEventListener("change",()=>{selectedSlot="";loadBookingsAndSlots();updateSummary()});

$("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!cart.length||!$("date").value||(!selectedSlot && !hasNailService())){
    alert(hasNailService() ? "請先加入美甲項目並選擇希望日期。" : "請先加入療程、選擇日期與可預約時段。");
    return;
  }
  if(!dbReady){
    $("formMessage").textContent="目前是本機測試模式：服務項目與時間可測試，但尚未連接 Supabase，不能正式送出預約。";
    return;
  }
  const btn=$("submitBtn");
  btn.disabled=true;
  $("formMessage").textContent="預約送出中，請稍候...";

  const startMin=timeToMinutes(selectedSlot);
  const plan=plannedSchedule(startMin);
  const payloads=plan.map(p=>({
    items:[{category:p.item.category,name:p.item.name,duration:p.item.duration,therapist:p.item.therapist}],
    service_minutes:p.item.duration,
    internal_buffer:p.buffer,
    total_block:p.item.duration+p.buffer,
    therapist:p.therapist,
    date:$("date").value,
    slot:minutesToTime(p.start),
    customer_name:$("name").value,
    phone:$("phone").value,
    line_name:$("lineName").value,
    first_visit:$("firstVisit").value,
    note:$("note").value, nail_request:nailRequestSummary(),
    status: hasNailService() ? "nail_request" : "pending"
  }));

  const {error}=await db.from("bookings").insert(payloads);
  btn.disabled=false;
  if(error){
    $("formMessage").textContent="送出失敗，請確認網路或聯繫店家。";
    console.error(error);
    return;
  }
  $("formMessage").textContent="";
  $("successDetail").innerHTML=`<div class="summary">姓名：${$("name").value}<br>項目：<br>${plan.map((p,idx)=>`${idx+1}. ${p.item.name}（${p.item.duration}分）｜${p.therapist}｜${minutesToTime(p.start)}-${minutesToTime(p.serviceEnd)}`).join("<br>")}<br>日期：${$("date").value}<br>時間：${hasNailService() ? "待店家確認" : selectedSlot}</div>`;
  $("successModal").classList.remove("hidden");
});

function closeModal(){
  $("successModal").classList.add("hidden");
  location.reload();
}

renderCategories();
toggleNailRequestUI();
renderCart();
const today=new Date();
$("date").min=today.toISOString().slice(0,10);



/* =========================
   CONSTONIC V2.1 FRONT BLOCKS
   前台自動判斷關閉日 / 美容師休假
========================= */

let constonicBookingBlocks = [];

async function loadConstonicBlocks(){
  const date = $("date")?.value;
  if(!date || !window.supabase || !window.CONSTONIC_CONFIG) return [];
  const dbBlock = supabase.createClient(window.CONSTONIC_CONFIG.SUPABASE_URL, window.CONSTONIC_CONFIG.SUPABASE_ANON_KEY);
  const { data, error } = await dbBlock.from("booking_blocks").select("*").eq("date", date);
  if(error){
    console.warn("booking_blocks 尚未建立或讀取失敗", error);
    constonicBookingBlocks = [];
    return [];
  }
  constonicBookingBlocks = data || [];
  return constonicBookingBlocks;
}

function isConstonicClosedForTherapist(therapist){
  return constonicBookingBlocks.some(b => {
    const target = b.therapist || "全店";
    return target === "全店" || target === therapist;
  });
}

const originalRenderSlotsV21 = typeof renderSlots === "function" ? renderSlots : null;
if(originalRenderSlotsV21){
  window.renderSlots = function(){
    originalRenderSlotsV21();
    const slotList = $("slotList");
    if(!slotList || !constonicBookingBlocks.length) return;

    const allClosed = constonicBookingBlocks.some(b => (b.therapist || "全店") === "全店");
    if(allClosed){
      slotList.innerHTML = `<div class="closed-day-message">這一天店家暫停預約，請選擇其他日期。</div>`;
      return;
    }

    const closedNames = constonicBookingBlocks.map(b => b.therapist).filter(Boolean);
    if(closedNames.length){
      const note = document.createElement("div");
      note.className = "closed-day-message";
      note.textContent = `休假／不開放：${closedNames.join("、")}。可選時段已自動排除。`;
      slotList.prepend(note);
    }

    slotList.querySelectorAll("button").forEach(btn => {
      const txt = btn.textContent || "";
      closedNames.forEach(name => {
        if(txt.includes(name)){
          btn.disabled = true;
          btn.classList.add("disabled");
          btn.textContent = `${txt}｜${name}休假`;
        }
      });
    });
  };
}

const originalLoadBookingsAndSlotsV21 = typeof loadBookingsAndSlots === "function" ? loadBookingsAndSlots : null;
if(originalLoadBookingsAndSlotsV21){
  window.loadBookingsAndSlots = async function(){
    await loadConstonicBlocks();
    return originalLoadBookingsAndSlotsV21();
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const dateEl = $("date");
  if(dateEl){
    dateEl.addEventListener("change", async () => {
      await loadConstonicBlocks();
      if(typeof renderSlots === "function") renderSlots();
    });
  }
});


/* =========================
   CONSTONIC FRONT V3.5
   前台選取明顯 + 美甲諮詢預約提示
========================= */
function v35IsNailSelected(){try{return (cart||[]).some(i=>i.category==="美甲設計"||String(i.therapist||"").includes("曼曼"));}catch(e){return false;}}
function v35EnhanceFrontUI(){document.querySelectorAll(".service-card, .service-item, .slot-btn, .slot-button, .therapist-select").forEach(el=>{el.classList.add("v35-touch-target");});const nailCard=document.getElementById("nailRequestCard");const slotCard=document.getElementById("slotCard");if(nailCard&&slotCard){const isNail=v35IsNailSelected();nailCard.classList.toggle("hidden",!isNail);slotCard.classList.toggle("hidden",isNail);}if(v35IsNailSelected()){const msg=document.getElementById("slotList");if(msg){msg.innerHTML=`<div class="closed-day-message">美甲採諮詢預約制，請填寫希望時段、手部/足部、樣式與備註，店家會再確認正式時間。</div>`;}}}
const v35OldRenderCart=typeof renderCart==="function"?renderCart:null;if(v35OldRenderCart){window.renderCart=function(){v35OldRenderCart();setTimeout(v35EnhanceFrontUI,100);};}
const v35OldRenderSlots=typeof renderSlots==="function"?renderSlots:null;if(v35OldRenderSlots){window.renderSlots=function(){v35OldRenderSlots();setTimeout(v35EnhanceFrontUI,100);};}
document.addEventListener("click",e=>{const btn=e.target.closest("button, .service-card, .service-item, .slot-btn, .slot-button");if(btn){setTimeout(v35EnhanceFrontUI,120);}});
document.addEventListener("DOMContentLoaded",()=>setTimeout(v35EnhanceFrontUI,500));


/* =========================
   CONSTONIC FRONT V4.1
   前台空檔依每個療程服務人員分段計算
========================= */
function v41FrontTimeToMin(t){
  const m = String(t||"").match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return Number(m[1])*60+Number(m[2]);
}
function v41FrontMinToTime(m){return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");}
function v41FrontSegments(bookings){
  const segs = [];
  (bookings||[]).filter(b=>b.status!=="cancelled").forEach(b=>{
    const base = v41FrontTimeToMin(b.slot);
    if(base === null) return;
    let offset = 0;
    (b.items||[]).forEach(item=>{
      const dur = Number(item.duration||0);
      segs.push({
        therapist:item.therapist || b.therapist || "不指定",
        start:base+offset,
        end:base+offset+dur
      });
      offset += dur;
    });
  });
  return segs;
}
function v41FrontIsBusy(segs, therapist, start, end){
  return segs.some(s=>{
    if(s.therapist !== therapist) return false;
    return start < s.end && end > s.start;
  });
}


/* =========================
   CONSTONIC FRONT V4.2
   前台空檔依每個療程分段釋放
   修正：同一筆預約多位美容師時，不再整筆鎖住主美容師
========================= */

window.CONSTONIC_FRONT_VERSION = "V4.2";

function c42TimeToMin(t){
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function c42MinToTime(min){
  return String(Math.floor(min / 60)).padStart(2,"0") + ":" + String(min % 60).padStart(2,"0");
}

function c42NormalizeStaff(name){
  if(["雅潔老師","巧萱美容師","曼曼美甲師"].includes(name)) return name;
  return "不指定";
}

function c42BookingSegments(bookings){
  const segments = [];
  (bookings || []).forEach(b => {
    if(b.status === "cancelled") return;
    const base = c42TimeToMin(b.slot);
    if(base === null) return;

    const items = Array.isArray(b.items) ? b.items : [];
    if(!items.length){
      const staff = c42NormalizeStaff(b.therapist);
      segments.push({
        booking_id:b.id,
        therapist:staff,
        start:base,
        end:base + Number(b.total_block || b.service_minutes || 0)
      });
      return;
    }

    let offset = 0;
    items.forEach(item => {
      const duration = Number(item.duration || 0);
      const staff = c42NormalizeStaff(item.therapist || b.therapist);
      if(duration > 0){
        segments.push({
          booking_id:b.id,
          therapist:staff,
          start:base + offset,
          end:base + offset + duration
        });
      }
      offset += duration;
    });
  });
  return segments;
}

function c42CartSegments(startMin){
  const selectedItems = (typeof cart !== "undefined" && Array.isArray(cart)) ? cart : [];
  const segments = [];
  let offset = 0;

  selectedItems.forEach(item => {
    const duration = Number(item.duration || 0);
    const staff = c42NormalizeStaff(item.therapist || document.querySelector("[data-current-therapist]")?.dataset.currentTherapist || "不指定");
    if(duration > 0){
      segments.push({
        therapist:staff,
        start:startMin + offset,
        end:startMin + offset + duration
      });
    }
    offset += duration;
  });

  return segments;
}

function c42Overlap(aStart, aEnd, bStart, bEnd){
  return aStart < bEnd && aEnd > bStart;
}

function c42IsSlotAvailableBySegments(bookings, startTime){
  const startMin = c42TimeToMin(startTime);
  if(startMin === null) return false;

  const busy = c42BookingSegments(bookings);
  const need = c42CartSegments(startMin);

  if(!need.length){
    const total = (typeof totalBlock !== "undefined") ? Number(totalBlock || 0) : 0;
    const therapist = typeof selectedTherapist !== "undefined" ? selectedTherapist : "不指定";
    need.push({therapist:c42NormalizeStaff(therapist), start:startMin, end:startMin + total});
  }

  return need.every(n => {
    if(n.therapist === "不指定"){
      return !busy.some(b => c42Overlap(n.start, n.end, b.start, b.end));
    }
    return !busy.some(b => b.therapist === n.therapist && c42Overlap(n.start, n.end, b.start, b.end));
  });
}

/* 覆蓋前台時段渲染：以分段占用判斷 */
async function c42RenderSlots(){
  const box = document.getElementById("slotList") || document.getElementById("slots") || document.querySelector(".slot-list");
  const dateInput = document.getElementById("date") || document.getElementById("bookingDate");
  if(!box || !dateInput) return false;

  const date = dateInput.value;
  if(!date) return false;

  const {data, error} = await db.from("bookings").select("*").eq("date", date);
  if(error){
    console.error(error);
    box.innerHTML = "<p>讀取時段失敗，請稍後再試。</p>";
    return true;
  }

  const bookings = data || [];
  const times = ["10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30"];

  box.innerHTML = times.map(t => {
    const ok = c42IsSlotAvailableBySegments(bookings, t);
    return `<button type="button" class="slot-btn ${ok ? "" : "disabled"}" ${ok ? `onclick="selectSlot('${t}')"` : "disabled"}>${t}${ok ? "" : " 已滿"}</button>`;
  }).join("");

  return true;
}

const c42OldRenderSlots = typeof renderSlots === "function" ? renderSlots : null;
window.renderSlots = async function(){
  const handled = await c42RenderSlots();
  if(!handled && c42OldRenderSlots) return c42OldRenderSlots();
};

document.addEventListener("change", e => {
  if(e.target && (e.target.id === "date" || e.target.id === "bookingDate" || e.target.matches("select"))){
    setTimeout(() => {
      if(typeof renderSlots === "function") renderSlots();
    }, 150);
  }
});


/* =========================
   CONSTONIC FRONT V4.3
   美甲諮詢模式修正：
   - 只要本次預約清單含美甲／曼曼美甲師，就不顯示固定可預約時段
   - 其他 SPA / 臉部 / 身體仍照常顯示時間
========================= */

window.CONSTONIC_FRONT_VERSION = "V4.3";

function c43IsNailItem(item){
  const text = [
    item?.name,
    item?.category,
    item?.therapist,
    item?.type
  ].map(v => String(v || "")).join(" ");
  return /美甲|指甲|卸甲|手部|足部|單色|造型|曼曼/.test(text);
}

function c43HasNailInCart(){
  try{
    const list = Array.isArray(window.cart) ? window.cart : (typeof cart !== "undefined" && Array.isArray(cart) ? cart : []);
    return list.some(c43IsNailItem);
  }catch(e){
    return false;
  }
}

function c43RenderNailConsultSlots(){
  const box = document.getElementById("slotList") || document.getElementById("slots") || document.querySelector(".slot-list");
  if(!box) return false;

  if(!c43HasNailInCart()) return false;

  box.innerHTML = `
    <div class="nail-consult-box">
      <strong>美甲採諮詢預約制</strong>
      <p>因美甲時間會依手部／足部、卸甲、單色或造型而不同，請送出希望日期與需求，店家會再與您確認正式時間。</p>
      <div class="nail-consult-tags">
        <span>希望日期</span>
        <span>上午／下午／晚上</span>
        <span>手部／足部</span>
        <span>單色／造型／卸甲</span>
      </div>
    </div>
  `;
  return true;
}

const c43OldRenderSlots = typeof renderSlots === "function" ? renderSlots : null;
window.renderSlots = async function(){
  if(c43RenderNailConsultSlots()) return;
  if(typeof c42RenderSlots === "function"){
    const handled = await c42RenderSlots();
    if(handled) return;
  }
  if(c43OldRenderSlots) return c43OldRenderSlots();
};

document.addEventListener("click", () => {
  setTimeout(() => {
    if(typeof renderSlots === "function") renderSlots();
  }, 150);
});

document.addEventListener("change", () => {
  setTimeout(() => {
    if(typeof renderSlots === "function") renderSlots();
  }, 150);
});
