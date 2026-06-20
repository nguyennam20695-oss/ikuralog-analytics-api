import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const app = express();
app.use(cors());

const port = Number(process.env.PORT || 8787);
const propertyId = process.env.GA4_PROPERTY_ID;
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';

function requireDashboardAuth(req, res, next) {
  if (!dashboardPassword) return next();

  const password = req.query.password || req.headers['x-dashboard-password'];

  if (password === dashboardPassword) return next();

  return res.status(401).type('html').send(`<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IkuraLog Analytics Login</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f6fb;margin:0;display:flex;align-items:center;justify-content:center;height:100vh">
<form method="GET" action="/dashboard" style="background:white;padding:28px;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.12);width:min(360px,90vw)">
<h1 style="margin-top:0">IkuraLog Analytics</h1>
<p style="color:#64748b">Nhập mật khẩu dashboard.</p>
<input name="password" type="password" placeholder="Password" autofocus style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px">
<button style="margin-top:14px;width:100%;padding:14px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:800;font-size:16px">Đăng nhập</button>
</form>
</body>
</html>`);
}


const client = serviceAccountJson
  ? new BetaAnalyticsDataClient({
      credentials: JSON.parse(serviceAccountJson),
    })
  : new BetaAnalyticsDataClient();

async function report({ startDate='30daysAgo', endDate='today', dimensions=[], metrics=[], limit=20 }) {
  const [res] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map(name => ({ name })),
    metrics: metrics.map(name => ({ name })),
    limit
  });

  return (res.rows || []).map(row => ({
    dimensions: Object.fromEntries((row.dimensionValues || []).map((v, i) => [dimensions[i], v.value])),
    metrics: Object.fromEntries((row.metricValues || []).map((v, i) => [metrics[i], Number(v.value || 0)]))
  }));
}

async function safeReport(args) {
  try { return await report(args); }
  catch (e) { return [{ dimensions: { error: String(e.message || e) }, metrics: { error: 1 } }]; }
}


app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'ikuralog-analytics-api',
    endpoints: ['/healthz', '/api/summary', '/dashboard'],
    updatedAt: new Date().toISOString()
  });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, status: 'healthy', service: 'ikuralog-analytics-api' });
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IkuraLog Analytics</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7fb;margin:0;color:#0f172a}
header{position:sticky;top:0;z-index:5;padding:22px 28px;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:16px}
h1{margin:0;font-size:30px}h2{margin:0 0 14px;font-size:20px}.sub{color:#64748b;font-weight:700;margin-top:6px}
button{background:#2563eb;color:#fff;border:0;border-radius:14px;padding:12px 16px;font-weight:900;cursor:pointer}
button.secondary{background:#e2e8f0;color:#0f172a}.active{background:#0f172a!important;color:#fff!important}
main{padding:24px;max-width:1240px;margin:auto}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}.section{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:20px;box-shadow:0 10px 28px rgba(15,23,42,.06)}
.label{color:#64748b;font-weight:800;font-size:13px}.num{font-size:38px;font-weight:950;margin-top:8px}.good{color:#16a34a}.warn{color:#f59e0b}.bad{color:#dc2626}
.status{color:#16a34a;font-weight:900;margin-top:8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px}th{color:#64748b;background:#f8fafc}
.bar{height:9px;background:#e5e7eb;border-radius:999px;overflow:hidden;min-width:70px}.fill{height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:999px}
.chartBox{height:280px;border-radius:18px;background:linear-gradient(180deg,#f8fbff,#fff);border:1px solid #e5e7eb;padding:12px;overflow:hidden}
svg{width:100%;height:100%}.axis{stroke:#e5e7eb;stroke-width:1}.line{fill:none;stroke:#2563eb;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.area{fill:#2563eb;opacity:.10}.dot{fill:#2563eb}.tick{fill:#64748b;font-size:11px}
.note{color:#64748b;font-size:13px;margin-top:10px;line-height:1.5}.insight{background:#f8fafc;border-left:5px solid #2563eb;padding:12px 14px;border-radius:14px;margin-top:12px;font-weight:700}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.summaryGrid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px;margin-bottom:18px}
.summaryBox{background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:20px;box-shadow:0 10px 28px rgba(15,23,42,.06)}
.summaryTitle{font-size:20px;font-weight:950;margin-bottom:10px}
.summaryLine{padding:8px 0;border-bottom:1px solid #eef2f7;font-weight:750}
.summaryLine:last-child{border-bottom:0}
.tag{display:inline-block;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:900;margin-right:6px}
.tag.good{background:#dcfce7;color:#166534}.tag.warn{background:#fef3c7;color:#92400e}.tag.bad{background:#fee2e2;color:#991b1b}
.todo{margin:0;padding-left:18px}.todo li{margin:8px 0;font-weight:750}
@media(max-width:950px){.grid,.section,.summaryGrid{grid-template-columns:1fr}header{display:block}.filters{margin-top:12px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>IkuraLog Analytics</h1>
    <div class="sub">Bảng theo dõi tình hình sử dụng IkuraLog</div>
    <div id="status" class="status">Đang tải dữ liệu GA4...</div>
  </div>
  <div class="filters">
    <button id="btn7" class="secondary" onclick="loadData(7)">7 ngày</button>
    <button id="btn30" class="secondary" onclick="loadData(30)">30 ngày</button>
    <button id="btn90" class="secondary" onclick="loadData(90)">90 ngày</button>
    <button onclick="loadData(currentDays)">Cập nhật</button>
  </div>
</header>
<main>
  <section class="summaryGrid">
    <div class="summaryBox">
      <div class="summaryTitle">Tổng quan vận hành</div>
      <div id="autoSummary">Đang phân tích dữ liệu...</div>
    </div>
    <div class="summaryBox">
      <div class="summaryTitle">Cảnh báo</div>
      <div id="autoWarnings">Đang kiểm tra...</div>
    </div>
    <div class="summaryBox">
      <div class="summaryTitle">Việc nên làm tiếp</div>
      <ul id="autoTodos" class="todo"></ul>
    </div>
  </section>

  <div class="grid">
    <div class="card"><div class="label">Người dùng hôm nay</div><div class="num" id="dau">-</div></div>
    <div class="card"><div class="label">Người dùng 30 ngày</div><div class="num" id="mau">-</div></div>
    <div class="card"><div class="label">Người dùng mới</div><div class="num" id="newNgười dùngs">-</div></div>
    <div class="card"><div class="label">Người dùng quay lại</div><div class="num" id="returningNgười dùngs">-</div></div>
    <div class="card"><div class="label">Người dùng tại Nhật</div><div class="num" id="japan">-</div></div>
  </div>

  <section class="card" style="margin-top:18px">
    <h2>Xu hướng người dùng từng ngày</h2>
    <div id="dailyChart" class="chartBox"></div>
    <div id="growthInsight" class="insight">Đang phân tích xu hướng...</div>
  </section>

  <div class="section">
    <div class="card"><h2>Quốc gia</h2><table><thead><tr><th>Quốc gia</th><th>Người dùng</th><th>Mức độ</th></tr></thead><tbody id="countries"></tbody></table></div>
    <div class="card"><h2>Ngôn ngữ</h2><table><thead><tr><th>Ngôn ngữ</th><th>Người dùng</th><th>Mức độ</th></tr></thead><tbody id="languages"></tbody></table></div>
    <div class="card"><h2>Phiên bản ứng dụng</h2><table><thead><tr><th>Phiên bản</th><th>Người dùng</th><th>Mức độ</th></tr></thead><tbody id="versions"></tbody></table></div>
    <div class="card"><h2>Thiết bị</h2><table><thead><tr><th>Thiết bị</th><th>Người dùng</th><th>Mức độ</th></tr></thead><tbody id="devices"></tbody></table></div>
    <div class="card"><h2>Hoạt động quan trọng</h2><table><thead><tr><th>Sự kiện</th><th>Số lần</th><th>Mức độ</th></tr></thead><tbody id="events"></tbody></table></div>
    <div class="card"><h2>Màn hình người dùng hay mở</h2><table><thead><tr><th>Màn hình</th><th>Lượt mở</th><th>Mức độ</th></tr></thead><tbody id="screens"></tbody></table><div class="note">Nếu còn “Không xác định”, nghĩa là app chưa gửi tên màn hình đủ rõ. Cần user dùng bản mới có theo dõi màn hình.</div></div>
  </div>
</main>
<script>
let currentDays = 30;

const eventNames = {
  user_engagement:'Tương tác người dùng',
  screen_view:'Xem màn hình',
  app_open_test:'Mở app bản test',
  main_shell_opened:'Mở khung chính',
  session_start:'Bắt đầu phiên',
  shift_created:'Tạo ca làm',
  mở ứng dụng lần đầu:'Mở ứng dụng lần đầu',
  onboarding_completed:'Hoàn thành giới thiệu',
  job_created:'Tạo nơi làm việc',
  app_update:'Cập nhật ứng dụng',
  app_open_custom:'Mở app',
  app_remove:'Gỡ ứng dụng',
  shift_started:'Bắt đầu ca',
  shift_finished:'Kết thúc ca'
};

const screenNames = {
  home_screen:'Trang chủ',
  home:'Trang chủ',
  shifts_screen:'Lịch làm',
  jobs_screen:'Công việc',
  stats_screen:'Thống kê',
  settings_screen:'Cài đặt'
};

function cleanName(v){
  if(!v || v === '(not set)') return 'Chưa có dữ liệu';
  return v;
}
function displayName(v, type){
  v = cleanName(v);
  if(type === 'event') return eventNames[v] || v;
  if(type === 'screen') return (v === 'Chưa có dữ liệu' ? 'Chưa có dữ liệu màn hình' : (screenNames[v] || v));
  return v;
}
function maxMetric(rows, metric){ return Math.max(...(rows||[]).map(r => r.metrics?.[metric] || 0), 1); }
function rows(data, dim, metric, type=''){
  const max = maxMetric(data, metric);
  return (data||[]).map(r => {
    const raw = cleanName(r.dimensions?.[dim]);
    const name = displayName(raw, type);
    const value = r.metrics?.[metric] ?? 0;
    const width = Math.round((value / max) * 100);
    return '<tr><td title="'+raw+'">'+name+'</td><td>'+value+'</td><td><div class="bar"><div class="fill" style="width:'+width+'%"></div></div></td></tr>';
  }).join('');
}
function dateLabel(v){
  if(!v || v.length !== 8) return v || '';
  return v.slice(4,6)+'/'+v.slice(6,8);
}
function drawDailyChart(rows){
  const box = document.getElementById('dailyChart');
  rows = (rows||[]).filter(r=>r.dimensions?.date).sort((a,b)=>String(a.dimensions.date).localeCompare(String(b.dimensions.date)));
  const values = rows.map(r=>r.metrics?.activeNgười dùngs||0);
  const max = Math.max(...values, 1);
  const w = 1100, h = 250, pad = 34;
  const step = rows.length > 1 ? (w-pad*2)/(rows.length-1) : 0;
  const points = rows.map((r,i)=>{
    const x = pad + i*step;
    const y = h - pad - ((r.metrics?.activeNgười dùngs||0)/max)*(h-pad*2);
    return {x,y,v:r.metrics?.activeNgười dùngs||0,date:dateLabel(r.dimensions.date)};
  });
  const line = points.map(p=>p.x+','+p.y).join(' ');
  const area = points.length ? pad+','+(h-pad)+' '+line+' '+(w-pad)+','+(h-pad) : '';
  const ticks = points.filter((_,i)=> i===0 || i===points.length-1 || i%Math.ceil(points.length/6)===0);
  box.innerHTML = '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    + '<line class="axis" x1="'+pad+'" y1="'+(h-pad)+'" x2="'+(w-pad)+'" y2="'+(h-pad)+'"></line>'
    + '<line class="axis" x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(h-pad)+'"></line>'
    + '<polygon class="area" points="'+area+'"></polygon>'
    + '<polyline class="line" points="'+line+'"></polyline>'
    + points.map(p=>'<circle class="dot"><title>'+p.date+': '+p.v+' user</title></circle>'.replace('<circle class="dot"', '<circle class="dot" cx="'+p.x+'" cy="'+p.y+'" r="5"')).join('')
    + ticks.map(p=>'<text class="tick" x="'+p.x+'" y="'+(h-8)+'" text-anchor="middle">'+p.date+'</text>').join('')
    + '<text class="tick" x="8" y="'+(pad+4)+'">'+max+'</text><text class="tick" x="8" y="'+(h-pad)+'">0</text>'
    + '</svg>';

  const first = values[0] || 0, last = values[values.length-1] || 0;
  const diff = last - first;
  const insight = document.getElementById('growthInsight');
  if(values.length < 2) insight.textContent = 'Chưa đủ dữ liệu để nhận định xu hướng.';
  else if(diff > 0) insight.innerHTML = '<span class="good">Tín hiệu tốt:</span> người dùng cuối kỳ cao hơn đầu kỳ +' + diff + '.';
  else if(diff < 0) insight.innerHTML = '<span class="bad">Cần chú ý:</span> người dùng cuối kỳ thấp hơn đầu kỳ ' + diff + '. Cần kiểm tra phần giới thiệu ban đầu, bản cập nhật và nguồn tải.';
  else insight.innerHTML = '<span class="warn">Chưa tăng rõ:</span> user chưa tăng rõ. Cần thêm cách kéo người dùng mới.';
}
function metricByHoạt động(data, eventName){
  return (data.events||[]).find(r => r.dimensions?.eventName === eventName)?.metrics?.eventCount || 0;
}
function activeByPhiên bản(data, version){
  return (data.versions||[]).find(r => r.dimensions?.appPhiên bản === version)?.metrics?.activeNgười dùngs || 0;
}
function latestPhiên bản(data){
  const versions = (data.versions||[])
    .map(r => r.dimensions?.appPhiên bản)
    .filter(Boolean)
    .sort((a,b)=>b.localeCompare(a, undefined, {numeric:true}));
  return versions[0] || '';
}
function pct(a,b){
  if(!b) return 0;
  return Math.round((a/b)*1000)/10;
}
function renderAutoSummary(data){
  const mau = data.mau || 0;
  const newNgười dùngs = data.newNgười dùngs || 0;
  const returning = data.returningNgười dùngsEstimate || 0;
  const returnRate = pct(returning, mau);

  const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeNgười dùngs || 0;
  const japanRate = pct(japan, mau);

  const firstOpen = metricByHoạt động(data, 'mở ứng dụng lần đầu');
  const onboarding = metricByHoạt động(data, 'onboarding_completed');
  const jobCreated = metricByHoạt động(data, 'job_created');
  const shiftCreated = metricByHoạt động(data, 'shift_created');

  const onboardingRate = pct(onboarding, firstOpen);
  const jobRate = pct(jobCreated, firstOpen);
  const shiftRate = pct(shiftCreated, firstOpen);

  const latest = latestPhiên bản(data);
  const latestNgười dùngs = activeByPhiên bản(data, latest);
  const latestRate = pct(latestNgười dùngs, mau);

  const unknownMàn hìnhs = (data.screens||[])
    .filter(r => !r.dimensions?.unifiedMàn hìnhName || r.dimensions?.unifiedMàn hìnhName === '(not set)')
    .reduce((sum,r)=>sum+(r.metrics?.screenPageViews||0),0);
  const totalMàn hìnhs = (data.screens||[]).reduce((sum,r)=>sum+(r.metrics?.screenPageViews||0),0);
  const unknownMàn hìnhRate = pct(unknownMàn hìnhs, totalMàn hìnhs);

  const health =
    returnRate >= 20 ? ['good','Ổn'] :
    returnRate >= 10 ? ['warn','Cần theo dõi'] :
    ['bad','Người dùng quay lại thấp'];

  document.getElementById('autoSummary').innerHTML = [
    '<div class="summaryLine"><span class="tag '+health[0]+'">'+health[1]+'</span> Tỷ lệ người dùng quay lại: <b>'+returnRate+'%</b></div>',
    '<div class="summaryLine">Người dùng mới: <b>'+newNgười dùngs+'</b> / người dùng 30 ngày <b>'+mau+'</b></div>',
    '<div class="summaryLine">Người dùng tại Nhật: <b>'+japan+'</b> ('+japanRate+'%)</div>',
    '<div class="summaryLine">Giới thiệu ban đầu: <b>'+onboarding+'</b> / mở ứng dụng lần đầu <b>'+firstOpen+'</b> ('+onboardingRate+'%)</div>',
    '<div class="summaryLine">Tạo nơi làm việc: <b>'+jobCreated+'</b> ('+jobRate+'% so với mở ứng dụng lần đầu)</div>',
    '<div class="summaryLine">Tạo ca làm: <b>'+shiftCreated+'</b> ('+shiftRate+'% so với mở ứng dụng lần đầu)</div>',
    '<div class="summaryLine">Bản mới nhất '+latest+': <b>'+latestNgười dùngs+'</b> user ('+latestRate+'%)</div>'
  ].join('');

  const warnings = [];
  if(returnRate < 10) warnings.push('<div class="summaryLine"><span class="tag bad">Cao</span> Người dùng quay lại thấp. Cần cải thiện onboarding và lý do quay lại app.</div>');
  if(unknownMàn hìnhRate > 50) warnings.push('<div class="summaryLine"><span class="tag bad">Cao</span> Màn hình tracking chưa rõ: '+unknownMàn hìnhRate+'% lượt mở màn hình chưa biết rõ tên.</div>');
  if(latestRate < 50) warnings.push('<div class="summaryLine"><span class="tag warn">Vừa</span> Dưới 50% người dùng đang dùng bản mới nhất. Cần khuyến khích cập nhật.</div>');
  if(japanRate >= 60) warnings.push('<div class="summaryLine"><span class="tag good">Tốt</span> Nhật Bản đang là thị trường chính, đúng hướng của IkuraLog.</div>');
  if(firstOpen > 0 && onboardingRate < 70) warnings.push('<div class="summaryLine"><span class="tag warn">Vừa</span> Giới thiệu ban đầu chưa đủ mạnh: '+onboardingRate+'%.</div>');
  document.getElementById('autoWarnings').innerHTML = warnings.join('') || '<div class="summaryLine"><span class="tag good">OK</span> Chưa có cảnh báo lớn.</div>';

  const todos = [];
  if(unknownMàn hìnhRate > 50) todos.push('Gắn logMàn hìnhView cho Trang chủ, Lịch làm, Công việc, Thống kê, Cài đặt.');
  if(returnRate < 10) todos.push('Tạo lý do để người dùng mở lại app: nhắc ca làm, báo lương tháng, thẻ thống kê nhanh.');
  if(onboardingRate < 70) todos.push('Rút gọn phần giới thiệu ban đầu và dẫn người dùng tới bước tạo nơi làm việc đầu tiên.');
  if(latestRate < 50) todos.push('Đưa bản mới ổn định lên store và theo dõi tỷ lệ cập nhật theo phiên bản.');
  todos.push('Theo dõi lại luồng sử dụng sau 3–7 ngày để tránh kết luận quá sớm.');
  document.getElementById('autoTodos').innerHTML = todos.map(t=>'<li>'+t+'</li>').join('');
}

async function loadData(days=30){
  currentDays = days;
  document.querySelectorAll('.filters .secondary').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('btn'+days); if(btn) btn.classList.add('active');

  const status = document.getElementById('status');
  status.textContent = 'Đang tải dữ liệu GA4 '+days+' ngày...';
  try{
    const res = await fetch('/api/summary?days='+days+'&t='+Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'API error');

    const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeNgười dùngs || 0;
    document.getElementById('dau').textContent = data.dau || 0;
    document.getElementById('mau').textContent = data.mau || 0;
    document.getElementById('newNgười dùngs').textContent = data.newNgười dùngs || 0;
    document.getElementById('returningNgười dùngs').textContent = data.returningNgười dùngsEstimate || 0;
    document.getElementById('japan').textContent = japan;

    renderAutoSummary(data);
    drawDailyChart(data.dailyNgười dùngs);
    document.getElementById('countries').innerHTML = rows(data.countries,'country','activeNgười dùngs');
    document.getElementById('languages').innerHTML = rows(data.languages,'language','activeNgười dùngs');
    document.getElementById('versions').innerHTML = rows(data.versions,'appPhiên bản','activeNgười dùngs');
    document.getElementById('devices').innerHTML = rows(data.devices,'deviceModel','activeNgười dùngs');
    document.getElementById('events').innerHTML = rows(data.events,'eventName','eventCount','event');
    document.getElementById('screens').innerHTML = rows(data.screens,'unifiedMàn hìnhName','screenPageViews','screen');

    status.textContent = 'Đã cập nhật dữ liệu '+days+' ngày: ' + new Date(data.updatedAt).toLocaleString();
  }catch(e){
    status.textContent = 'Lỗi: ' + e.message;
  }
}
loadData(30);
</script>
</body>
</html>`);
});


app.get('/api/summary', async (req, res) => {
  try {
    const requestedDays = Number(req.query.days || 30);
    const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
    const startDate = days + 'daysAgo';
    const [dau, mau, countries, events, devices, versions, languages, screens, dailyNgười dùngs, newNgười dùngs] = await Promise.all([
      safeReport({ startDate:'today', metrics:['activeNgười dùngs'] }),
      safeReport({ startDate:'30daysAgo', metrics:['activeNgười dùngs'] }),
      safeReport({ startDate, dimensions:['country'], metrics:['activeNgười dùngs'], limit:10 }),
      safeReport({ startDate, dimensions:['eventName'], metrics:['eventCount'], limit:40 }),
      safeReport({ startDate, dimensions:['deviceModel'], metrics:['activeNgười dùngs'], limit:10 }),
      safeReport({ startDate, dimensions:['appPhiên bản'], metrics:['activeNgười dùngs'], limit:10 }),
      safeReport({ startDate, dimensions:['language'], metrics:['activeNgười dùngs'], limit:10 }),
      safeReport({ startDate, dimensions:['unifiedMàn hìnhName'], metrics:['screenPageViews'], limit:20 }),
      safeReport({ startDate, dimensions:['date'], metrics:['activeNgười dùngs','newNgười dùngs','sessions'], limit:120 }),
      safeReport({ startDate, metrics:['newNgười dùngs'] })
    ]);

    res.json({
      ok: true,
      days,
      dau: dau[0]?.metrics?.activeNgười dùngs || 0,
      mau: mau[0]?.metrics?.activeNgười dùngs || 0,
      newNgười dùngs: newNgười dùngs[0]?.metrics?.newNgười dùngs || 0,
      returningNgười dùngsEstimate: Math.max((mau[0]?.metrics?.activeNgười dùngs || 0) - (newNgười dùngs[0]?.metrics?.newNgười dùngs || 0), 0),
      countries,
      events,
      devices,
      versions,
      languages,
      screens,
      dailyNgười dùngs,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.listen(port, () => console.log(`IkuraLog analytics server: http://localhost:${port}`));
