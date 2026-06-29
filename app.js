
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

function totals(){
  const serviceMinutes=cart.reduce((s,i)=>s+i.duration,0);
  const hasFace=cart.some(i=>i.category==="臉部保養");
  const hasBody=cart.some(i=>i.category==="身體舒壓");
  const internalBuffer=hasBody?20:(hasFace?10:0);
  return{serviceMinutes,internalBuffer,totalBlock:serviceMinutes+internalBuffer};
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
  loadBookingsAndSlots();
  updateSummary();
}

function removeFromCart(id){
  cart=cart.filter(i=>i.cartId!==id);
  selectedSlot="";
  renderCart();
  renderTeacherFee();
  loadBookingsAndSlots();
  updateSummary();
}

function clearCart(){
  cart=[];
  selectedSlot="";
  renderCart();
  renderTeacherFee();
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
  const maxBlock=Math.max(...cart.map(itemBlock));
  const latestStart=cfgDay.close-maxBlock-20;
  for(let time=cfgDay.open;time<=latestStart;time+=30){
    let busy=false;
    for(const item of cart){
      const start=time;
      const end=time+itemBlock(item);
      if(isTherapistBusy(item.therapist,start,end)){
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
      btn.onclick=()=>{
        selectedSlot=minutesToTime(time);
        [...slotList.children].forEach(el=>el.classList.remove("active"));
        btn.classList.add("active");
        updateSummary();
      }
    }
    slotList.appendChild(btn);
  }
}

function updateSummary(){
  const s=$("summary");
  if(!cart.length||!$("date").value||!selectedSlot){
    s.textContent="尚未選擇完整預約內容";
    s.className="summary muted";
    return;
  }
  const t=totals();
  const fee=cart.some(i=>i.category==="身體舒壓"&&i.teacherFee&&i.therapist==="雅潔老師")?"｜含雅潔老師身體指定費 +300 元":"";
  s.className="summary";
  s.innerHTML=`<strong>預約確認</strong><br>項目：<br>${cart.map((item,idx)=>`${idx+1}. ${item.category}｜${item.name}（${item.duration} 分鐘）｜${item.therapist}`).join("<br>")}<br><br>療程時間合計：${t.serviceMinutes} 分鐘${fee}<br>日期：${$("date").value}<br>時間：${selectedSlot}`;
}

$("date").addEventListener("change",()=>{selectedSlot="";loadBookingsAndSlots();updateSummary()});

$("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!cart.length||!$("date").value||!selectedSlot){
    alert("請先加入療程、選擇日期與可預約時段。");
    return;
  }
  if(!dbReady){
    $("formMessage").textContent="目前是本機測試模式：服務項目與時間可測試，但尚未連接 Supabase，不能正式送出預約。";
    return;
  }
  const btn=$("submitBtn");
  btn.disabled=true;
  $("formMessage").textContent="預約送出中，請稍候...";

  const groups={};
  cart.forEach(item=>{
    if(!groups[item.therapist]) groups[item.therapist]=[];
    groups[item.therapist].push(item);
  });

  const payloads=Object.entries(groups).map(([therapist,items])=>{
    const serviceMinutes=items.reduce((s,i)=>s+i.duration,0);
    const hasFace=items.some(i=>i.category==="臉部保養");
    const hasBody=items.some(i=>i.category==="身體舒壓");
    const internalBuffer=hasBody?20:(hasFace?10:0);
    return {
      items:items.map(i=>({category:i.category,name:i.name,duration:i.duration,therapist:i.therapist})),
      service_minutes:serviceMinutes,
      internal_buffer:internalBuffer,
      total_block:serviceMinutes+internalBuffer,
      therapist,
      date:$("date").value,
      slot:selectedSlot,
      customer_name:$("name").value,
      phone:$("phone").value,
      line_name:$("lineName").value,
      first_visit:$("firstVisit").value,
      note:$("note").value,
      status:"pending"
    };
  });

  const {error}=await db.from("bookings").insert(payloads);
  btn.disabled=false;
  if(error){
    $("formMessage").textContent="送出失敗，請確認網路或聯繫店家。";
    console.error(error);
    return;
  }
  $("formMessage").textContent="";
  $("successDetail").innerHTML=`<div class="summary">姓名：${$("name").value}<br>項目：<br>${cart.map((i,idx)=>`${idx+1}. ${i.name}（${i.duration}分）｜${i.therapist}`).join("<br>")}<br>日期：${$("date").value}<br>時間：${selectedSlot}</div>`;
  $("successModal").classList.remove("hidden");
});

function closeModal(){
  $("successModal").classList.add("hidden");
  location.reload();
}

renderCategories();
renderCart();
const today=new Date();
today.setDate(today.getDate()+1);
$("date").min=today.toISOString().slice(0,10);
