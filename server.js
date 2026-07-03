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


function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

const client = serviceAccountJson
  ? new BetaAnalyticsDataClient({
      credentials: JSON.parse(serviceAccountJson),
    })
  : new BetaAnalyticsDataClient();


async function getTotalDownloads() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${GA4_PROPERTY_ID}`,
    dateRanges: [
      {
        startDate: '2020-01-01',
        endDate: 'today',
      },
    ],
    metrics: [
      {
        name: 'eventCount',
      },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: {
          matchType: 'EXACT',
          value: 'first_open',
        },
      },
    },
  });

  const value = response.rows?.[0]?.metricValues?.[0]?.value || '0';
  return Number(value) || 0;
}


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
    totalDownloads,
    ok: true,
    service: 'ikuralog-analytics-api',
    endpoints: ['/healthz', '/api/summary', '/dashboard'],
    updatedAt: new Date().toISOString()
  });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, status: 'healthy', service: 'ikuralog-analytics-api' });
});


function normalizeTabName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Không rõ';

  const lower = raw.toLowerCase();
  const pairs = [
    ['home', 'Trang chủ'],
    ['main', 'Trang chủ'],
    ['dashboard', 'Trang chủ'],
    ['shift', 'Ca làm / Nhập giờ'],
    ['shifts', 'Ca làm / Nhập giờ'],
    ['work', 'Ca làm / Nhập giờ'],
    ['job', 'Công việc'],
    ['jobs', 'Công việc'],
    ['salary', 'Lương tháng'],
    ['wage', 'Lương tháng'],
    ['income', 'Lương tháng'],
    ['history', 'Lịch sử'],
    ['record', 'Lịch sử'],
    ['stat', 'Thống kê'],
    ['chart', 'Thống kê'],
    ['setting', 'Cài đặt'],
    ['settings', 'Cài đặt'],
    ['notification', 'Thông báo'],
  ];

  for (const pair of pairs) {
    if (lower.includes(pair[0])) return pair[1];
  }

  return raw
    .replace(/^screen[_\- ]*/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || raw;
}

function toNumberMetric(row, key) {
  return Number(row && row.metrics && row.metrics[key] ? row.metrics[key] : 0);
}

function buildTabUsage(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const screen =
      (row.dimensions && (row.dimensions.unifiedScreenName || row.dimensions.screenName || row.dimensions.firebaseScreen)) || '';
    const label = normalizeTabName(screen);
    const current = map.get(label) || {
      tab: label,
      views: 0,
      users: 0,
      avgPerUser: 0,
    };

    current.views += toNumberMetric(row, 'screenPageViews');
    current.users += toNumberMetric(row, 'activeUsers');
    map.set(label, current);
  }

  return Array.from(map.values())
    .map(x => ({
      tab: x.tab,
      views: x.views,
      users: x.users,
      avgPerUser: Number((x.views / Math.max(x.users, 1)).toFixed(1)),
    }))
    .sort((a, b) => b.users - a.users || b.views - a.views)
    .slice(0, 20);
}

function weekKeyFromDate(yyyymmdd) {
  const text = String(yyyymmdd || '');
  if (!/^\d{8}$/.test(text)) return 'Không rõ tuần';

  const y = Number(text.slice(0, 4));
  const m = Number(text.slice(4, 6)) - 1;
  const d = Number(text.slice(6, 8));

  const date = new Date(Date.UTC(y, m, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  return String(date.getUTCFullYear()) + '-W' + String(weekNo).padStart(2, '0');
}

function buildWeeklyTabUsage(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const date = row.dimensions && row.dimensions.date ? row.dimensions.date : '';
    const screen =
      (row.dimensions && (row.dimensions.unifiedScreenName || row.dimensions.screenName || row.dimensions.firebaseScreen)) || '';

    const week = weekKeyFromDate(date);
    const tab = normalizeTabName(screen);
    const key = week + '|||' + tab;

    const current = map.get(key) || {
      week,
      tab,
      views: 0,
      users: 0,
      avgPerUser: 0,
    };

    current.views += toNumberMetric(row, 'screenPageViews');
    current.users += toNumberMetric(row, 'activeUsers');
    map.set(key, current);
  }

  return Array.from(map.values())
    .map(x => ({
      week: x.week,
      tab: x.tab,
      views: x.views,
      users: x.users,
      avgPerUser: Number((x.views / Math.max(x.users, 1)).toFixed(1)),
    }))
    .sort((a, b) => String(b.week).localeCompare(String(a.week)) || b.users - a.users || b.views - a.views)
    .slice(0, 80);
}


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

    .tabUsageGrid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}
    .miniTitle{font-size:16px;font-weight:900;color:#111827;margin:8px 0 10px}
    .usageTable{width:100%;border-collapse:collapse;font-size:14px}
    .usageTable th,.usageTable td{padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:left}
    .usageTable th{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .usageTable td.num{text-align:right;font-weight:800;color:#111827}
    .usageHint{font-size:13px;color:#64748b;line-height:1.45;margin-top:8px}
    .weekBadge{display:inline-block;background:#eef2ff;color:#1e3a8a;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:800}

  </style>
</head>
<body>
<header>
  <div>
    <h1>IkuraLog Analytics</h1>
    <div class="sub">Số liệu đo được từ Google Analytics + phân tích nội bộ</div>
  <div class="hint" style="margin-top:8px">
Các ô người dùng, quốc gia, phiên bản, màn hình và hành động là dữ liệu đo được từ Google Analytics. 
Các mục đánh giá, cảnh báo và gợi ý là phân tích nội bộ của IkuraLog.
</div>
    <div class="hint" style="margin-top:8px">Trang này chỉ giữ số quan trọng để quyết định: user, quay lại, bản app, hành động chính.</div>
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
      <div class="summaryTitle">Phân tích nội bộ của IkuraLog</div>
      <div id="autoSummary">Đang phân tích dữ liệu...</div>
    </div>
    <div class="summaryBox">
      <div class="summaryTitle">Cảnh báo tự động</div>
      <div id="autoWarnings">Đang kiểm tra...</div>
    </div>
    <div class="summaryBox">
      <div class="summaryTitle">Gợi ý nên làm tiếp</div>
      <ul id="autoTodos" class="todo"></ul>
    </div>
  </section>

  <div class="grid">


    <div class="card">
      <div class="label">Đánh giá tổng quan</div>
      <div class="num" id="appHealthScore">-</div>
      <div class="hint" id="appHealthText">Phân tích nội bộ, không phải chỉ số chính thức của Google</div>
    </div>
    <div class="card"><div class="label">Hôm nay</div><div class="num" id="dau">-</div></div>
    <div class="card"><div class="label">7 ngày</div><div class="num" id="wau">-</div></div>
    <div class="card"><div class="label">Người dùng 30 ngày</div><div class="num" id="mau30">-</div></div>
    <div class="card"><div class="label">Người dùng hoạt động</div><div class="num" id="mau">-</div></div>
    <div class="card"><div class="label">Người dùng mới</div><div class="num" id="newUsers">-</div></div>
    <div class="card"><div class="label">Người quay lại</div><div class="num" id="returningUsers">-</div></div>
    <div class="card"><div class="label">Ở Nhật</div><div class="num" id="japan">-</div></div>
  </div>

  
      <section class="card">
        <div class="summaryTitle">Hành vi mở tab / màn hình</div>
        <div class="usageHint">
          Dùng để biết người dùng thực sự vào app để làm gì. Nên nhìn cả <b>user riêng biệt</b> và <b>lượt mở</b>, không chỉ nhìn lượt thô.
        </div>

        <div class="tabUsageGrid">
          <div>
            <div class="miniTitle">Hôm nay</div>
            <div id="tabUsageToday">Đang tải...</div>
          </div>

          <div>
            <div class="miniTitle">Khoảng đang chọn</div>
            <div id="tabUsageRange">Đang tải...</div>
          </div>

          <div>
            <div class="miniTitle">Theo tuần gần đây</div>
            <div id="tabUsageWeekly">Đang tải...</div>
          </div>
        </div>
      </section>

<section class="card" style="margin-top:18px">
    <h2>Người dùng hoạt động mỗi ngày</h2>
    <div id="dailyChart" class="chartBox"></div>
    <div id="growthInsight" class="insight">Đang phân tích xu hướng...</div>
  </section>

  <div class="section">
    <div class="card"><h2>Quốc gia</h2><table><thead><tr><th>Quốc gia</th><th>Người dùng</th><th>Tỷ lệ</th></tr></thead><tbody id="countries"></tbody></table></div>
    <div class="card"><h2>Ngôn ngữ</h2><table><thead><tr><th>Ngôn ngữ</th><th>Người dùng</th><th>Tỷ lệ</th></tr></thead><tbody id="languages"></tbody></table></div>
    <div class="card"><h2>Phiên bản app</h2><table><thead><tr><th>Phiên bản</th><th>Người dùng</th><th>Tỷ lệ</th></tr></thead><tbody id="versions"></tbody></table></div>
    <div class="card"><h2>Thiết bị</h2><table><thead><tr><th>Thiết bị</th><th>Người dùng</th><th>Tỷ lệ</th></tr></thead><tbody id="devices"></tbody></table></div>
    <div class="card"><h2>Hành động chính</h2><table><thead><tr><th>Sự kiện</th><th>Số lần</th><th>Tỷ lệ</th></tr></thead><tbody id="events"></tbody></table></div>
    <div class="card"><h2>Màn hình được dùng nhiều</h2><table><thead><tr><th>Màn hình</th><th>Lượt mở</th><th>Tỷ lệ</th></tr></thead><tbody id="screens"></tbody></table><div class="note">Nếu còn “Không xác định”, nghĩa là app chưa gửi tên màn hình đủ rõ. Cần user dùng bản mới có theo dõi màn hình.</div></div>
  </div>
</main>
<script>
let currentDays = 30;

function setText(id, value){
  const el = document.getElementById(id);
  if(el) el.textContent = value;
}


const eventNames = {
  user_engagement:'Tương tác người dùng',
  screen_view:'Xem màn hình',
  main_shell_opened:'Mở khung chính',
  session_start:'Bắt đầu phiên',
  first_open:'Mở ứng dụng lần đầu',
  onboarding_completed:'Hoàn thành giới thiệu',
  job_created:'Tạo nơi làm việc',
  shift_created:'Tạo ca làm',
  app_update:'Cập nhật ứng dụng',
  app_open_custom:'Mở app',
  app_remove:'Gỡ ứng dụng',
  home_tab_opened:'Mở Trang chủ',
  shifts_tab_opened:'Mở Lịch làm',
  jobs_tab_opened:'Mở Nơi làm việc',
  stats_tab_opened:'Mở Thống kê'
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
  if(type === 'screen') return (v === 'Chưa có dữ liệu' ? 'Chưa rõ tên màn hình' : (screenNames[v] || v));
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
  const values = rows.map(r=>r.metrics?.activeUsers||0);
  const max = Math.max(...values, 1);
  const w = 1100, h = 250, pad = 34;
  const step = rows.length > 1 ? (w-pad*2)/(rows.length-1) : 0;
  const points = rows.map((r,i)=>{
    const x = pad + i*step;
    const y = h - pad - ((r.metrics?.activeUsers||0)/max)*(h-pad*2);
    return {x,y,v:r.metrics?.activeUsers||0,date:dateLabel(r.dimensions.date)};
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
  else if(diff < 0) insight.innerHTML = '<span class="bad">Cần chú ý:</span> hôm nay thấp hơn đầu kỳ ' + diff + '. Nếu vài ngày tới vẫn giảm, cần kiểm tra nguồn tải, bản cập nhật và màn giới thiệu ban đầu.';
  else insight.innerHTML = '<span class="warn">Chưa tăng rõ:</span> người dùng chưa tăng rõ. Cần thêm cách kéo người dùng mới.';
}
function metricByEvent(data, eventName){
  return (data.events||[]).find(r => r.dimensions?.eventName === eventName)?.metrics?.eventCount || 0;
}
function activeByVersion(data, version){
  return (data.versions||[]).find(r => r.dimensions?.appVersion === version)?.metrics?.activeUsers || 0;
}
function latestVersion(data){
  const versions = (data.versions||[])
    .map(r => r.dimensions?.appVersion)
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
  const newUsers = data.newUsers || 0;
  const returning = data.returningUsersEstimate || 0;
  const returnRate = pct(returning, mau);

  const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeUsers || 0;
  const japanRate = pct(japan, mau);

  const firstOpen = metricByEvent(data, 'first_open');
  const onboarding = metricByEvent(data, 'onboarding_completed');
  const jobCreated = metricByEvent(data, 'job_created');
  const shiftCreated = metricByEvent(data, 'shift_created');

  const onboardingRate = pct(onboarding, firstOpen);
  const jobRate = pct(jobCreated, firstOpen);
  const shiftRate = pct(shiftCreated, firstOpen);

  const latest = latestVersion(data);
  const latestUsers = activeByVersion(data, latest);
  const latestRate = pct(latestUsers, mau);

  const unknownScreens = (data.screens||[])
    .filter(r => !r.dimensions?.unifiedScreenName || r.dimensions?.unifiedScreenName === '(not set)')
    .reduce((sum,r)=>sum+(r.metrics?.screenPageViews||0),0);
  const totalScreens = (data.screens||[]).reduce((sum,r)=>sum+(r.metrics?.screenPageViews||0),0);
  const unknownScreenRate = pct(unknownScreens, totalScreens);

  const health =
    returnRate >= 20 ? ['good','Ổn'] :
    returnRate >= 10 ? ['warn','Cần theo dõi'] :
    ['bad','Ít người quay lại'];

  document.getElementById('autoSummary').innerHTML = [
    '<div class="summaryLine"><span class="tag '+health[0]+'">'+health[1]+'</span> Tỷ lệ quay lại: <b>'+returnRate+'%</b></div>',
    '<div class="summaryLine">Người dùng mới: <b>'+newUsers+'</b> / tổng người dùng hoạt động <b>'+mau+'</b></div>',
    '<div class="summaryLine">Ở Nhật: <b>'+japan+'</b> ('+japanRate+'%)</div>',
    '<div class="summaryLine">Giới thiệu ban đầu: <b>'+onboarding+'</b> / mở ứng dụng lần đầu <b>'+firstOpen+'</b> ('+onboardingRate+'%)</div>',
    '<div class="summaryLine">Số lần tạo nơi làm việc: <b>'+jobCreated+'</b></div>',
    '<div class="summaryLine">Số lần tạo ca làm: <b>'+shiftCreated+'</b></div>',
    '<div class="summaryLine">Bản mới nhất '+latest+': <b>'+latestUsers+'</b> user ('+latestRate+'%)</div>'
  ].join('');

  const warnings = [];
  if(returnRate < 10) warnings.push('<div class="summaryLine"><span class="tag bad">Cao</span> Ít người quay lại. Cần tạo lý do để người dùng mở lại app.</div>');
  if(unknownScreenRate > 50) warnings.push('<div class="summaryLine"><span class="tag bad">Cao</span> Theo dõi màn hình chưa rõ: '+unknownScreenRate+'% lượt mở màn hình chưa biết rõ tên.</div>');
  if(latestRate < 50) warnings.push('<div class="summaryLine"><span class="tag warn">Vừa</span> Nhiều người chưa lên bản mới. Cần nhắc cập nhật.</div>');
  if(japanRate >= 60) warnings.push('<div class="summaryLine"><span class="tag good">Tốt</span> Nhật Bản đang là thị trường chính, đúng hướng của IkuraLog.</div>');
  if(firstOpen > 0 && onboardingRate < 70) warnings.push('<div class="summaryLine"><span class="tag warn">Vừa</span> Màn giới thiệu chưa đủ tốt: '+onboardingRate+'%.</div>');
  document.getElementById('autoWarnings').innerHTML = warnings.join('') || '<div class="summaryLine"><span class="tag good">OK</span> Chưa có cảnh báo lớn.</div>';

  const todos = [];
  if(unknownScreenRate > 50) todos.push('Gắn logScreenView cho Trang chủ, Lịch làm, Công việc, Thống kê, Cài đặt.');
  if(returnRate < 10) todos.push('Tạo lý do để người dùng mở lại app: nhắc ca làm, báo lương tháng, thẻ thống kê nhanh.');
  if(onboardingRate < 70) todos.push('Rút gọn phần giới thiệu ban đầu và dẫn người dùng tới bước tạo nơi làm việc đầu tiên.');
  if(latestRate < 50) todos.push('Đưa bản mới ổn định lên store và theo dõi tỷ lệ cập nhật theo phiên bản.');
  todos.push('Theo dõi lại luồng sử dụng sau 3–7 ngày để tránh kết luận quá sớm.');
  document.getElementById('autoTodos').innerHTML = todos.map(t=>'<li>'+t+'</li>').join('');
}


function hideLessImportantSections(){
  const ids = ['devices','languages'];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    const box = el ? el.closest('section, .summaryBox, .stat-card, .card, .box, .panel, div') : null;
    if(box && box !== document.body) box.style.display = 'none';
  });

  // Thu gọn bảng phiên bản: chỉ giữ vài dòng đầu
  const versions = document.getElementById('versions');
  if(versions){
    [...versions.querySelectorAll('tr')].forEach((tr,i)=>{
      if(i >= 5) tr.style.display = 'none';
    });
  }

  // Thu gọn bảng hành động: chỉ giữ hành động quan trọng, bỏ event kỹ thuật
  const events = document.getElementById('events');
  if(events){
    const keep = ['Xem màn hình','Tương tác người dùng','Mở Trang chủ','Mở Lịch làm','Mở Thống kê','Mở Nơi làm việc','Tạo ca làm','Mở ứng dụng lần đầu'];
    [...events.querySelectorAll('tr')].forEach(tr=>{
      const name = (tr.children[0]?.textContent || '').trim();
      if(name && !keep.some(k=>name.includes(k))) tr.style.display = 'none';
    });
  }

  // Ẩn dòng chưa rõ màn hình nếu còn quá nhiều dòng rác
  const screens = document.getElementById('screens');
  if(screens){
    [...screens.querySelectorAll('tr')].forEach(tr=>{
      const name = (tr.children[0]?.textContent || '').trim();
      if(name === 'Chưa rõ tên màn hình' || name === 'Chưa có dữ liệu') tr.style.opacity = '0.45';
    });
  }
}


function updatePeriodLabels(days){
  const activeLabel = document.querySelector('#mau')?.closest('.card')?.querySelector('.label');
  if(activeLabel) activeLabel.textContent = 'Người dùng hoạt động ' + days + ' ngày';

  const newLabel = document.querySelector('#newUsers')?.closest('.card')?.querySelector('.label');
  if(newLabel) newLabel.textContent = 'Người dùng mới ' + days + ' ngày';

  const returningLabel = document.querySelector('#returningUsers')?.closest('.card')?.querySelector('.label');
  if(returningLabel) returningLabel.textContent = 'Người quay lại ' + days + ' ngày';

  const totalBox = document.querySelector('#totalDownloads')?.closest('.card');
  if(totalBox) totalBox.style.display = 'none';

  const wauBox = document.querySelector('#wau')?.closest('.card');
  if(wauBox) wauBox.style.display = days === 30 ? '' : 'none';

  const mau30Box = document.querySelector('#mau30')?.closest('.card');
  if(mau30Box) mau30Box.style.display = days === 7 ? '' : 'none';
}


function setAppHealthScore(data){
  const mau = data.mau || 0;
  const returning = data.returningUsersEstimate || 0;
  const returnRate = mau ? Math.round((returning / mau) * 100) : 0;
  const latest = latestVersion(data);
  const latestUsers = activeByVersion(data, latest);
  const latestRate = mau ? Math.round((latestUsers / mau) * 100) : 0;
  const dau = data.dau || 0;

  let score = 50;
  if(dau >= 5) score += 10;
  if(mau >= 50) score += 10;
  if(returnRate >= 20) score += 15;
  else if(returnRate >= 10) score += 8;
  if(latestRate >= 50) score += 10;
  else if(latestRate >= 25) score += 5;
  if(score > 100) score = 100;

  const scoreEl = document.getElementById('appHealthScore');
  const textEl = document.getElementById('appHealthText');
  if(scoreEl) scoreEl.textContent = score + '/100';
  if(textEl){
    const notes = [];
    if(dau >= 5) notes.push('User hôm nay ổn');
    else notes.push('User hôm nay thấp');

    if(returnRate >= 20) notes.push('quay lại tốt');
    else notes.push('quay lại thấp');

    if(latestRate >= 50) notes.push('bản mới ổn');
    else notes.push('nhiều người chưa cập nhật');

    if(score >= 80) textEl.textContent = 'Tốt: ' + notes.join(', ') + '.';
    else if(score >= 60) textEl.textContent = 'Tạm ổn: ' + notes.join(', ') + '.';
    else textEl.textContent = 'Cần chú ý: ' + notes.join(', ') + '.';
  }
}

function cleanOwnerTables(){
  // Chỉ giữ hành động dễ hiểu, có giá trị theo dõi sản phẩm
  const events = document.getElementById('events');
  if(events){
    const keep = [
      'Mở app',
      'Mở Trang chủ',
      'Mở Lịch làm',
      'Mở Thống kê',
      'Mở Nơi làm việc',
      'Tạo ca làm',
      'Tạo nơi làm việc',
      'Cập nhật ứng dụng',
      'Mở ứng dụng lần đầu'
    ];
    [...events.querySelectorAll('tr')].forEach(tr=>{
      const name = (tr.children[0]?.textContent || '').trim();
      if(name && !keep.some(k => name.includes(k))) tr.remove();
    });
  }

  // Bỏ màn hình chưa rõ tên để dashboard sạch
  const screens = document.getElementById('screens');
  if(screens){
    [...screens.querySelectorAll('tr')].forEach(tr=>{
      const name = (tr.children[0]?.textContent || '').trim();
      if(
        name.includes('Chưa rõ') ||
        name.includes('Chưa có dữ liệu') ||
        name.includes('Không xác định') ||
        name === '(not set)' ||
        name === ''
      ){
        tr.remove();
      }
    });
  }

  // Đổi "Chưa có dữ liệu" trong quốc gia thành "Không xác định"
  const countries = document.getElementById('countries');
  if(countries){
    [...countries.querySelectorAll('td')].forEach(td=>{
      if(td.textContent.trim() === 'Chưa có dữ liệu') td.textContent = 'Không xác định';
    });
  }
}


function limitOwnerTables(){
  const versions = document.getElementById('versions');
  if(versions){
    [...versions.querySelectorAll('tr')].forEach((tr,i)=>{
      if(i >= 5) tr.remove();
    });
  }

  const countries = document.getElementById('countries');
  if(countries){
    [...countries.querySelectorAll('tr')].forEach((tr,i)=>{
      if(i >= 5) tr.remove();
    });
  }

  const events = document.getElementById('events');
  if(events){
    [...events.querySelectorAll('tr')].forEach(tr=>{
      const name = (tr.children[0]?.textContent || '').trim();
      if(name.includes('bản test')) tr.remove();
    });
  }
}


    function renderUsageTable(items, weekly=false) {
      if (!items || !items.length) {
        return '<div class="usageHint">Chưa có dữ liệu. Nếu app mới ghi analytics, GA có thể cần vài giờ đến 24 giờ để hiện đủ.</div>';
      }

      const head = weekly
        ? '<tr><th>Tuần</th><th>Tab / màn hình</th><th>User</th><th>Lượt</th><th>TB/user</th></tr>'
        : '<tr><th>Tab / màn hình</th><th>User</th><th>Lượt</th><th>TB/user</th></tr>';

      const body = items.map(function(x) {
        if (weekly) {
          return '<tr>' +
            '<td><span class="weekBadge">' + escapeHtml(x.week || '') + '</span></td>' +
            '<td>' + escapeHtml(x.tab || '') + '</td>' +
            '<td class="num">' + Number(x.users || 0).toLocaleString() + '</td>' +
            '<td class="num">' + Number(x.views || 0).toLocaleString() + '</td>' +
            '<td class="num">' + Number(x.avgPerUser || 0).toLocaleString() + '</td>' +
          '</tr>';
        }

        return '<tr>' +
          '<td>' + escapeHtml(x.tab || '') + '</td>' +
          '<td class="num">' + Number(x.users || 0).toLocaleString() + '</td>' +
          '<td class="num">' + Number(x.views || 0).toLocaleString() + '</td>' +
          '<td class="num">' + Number(x.avgPerUser || 0).toLocaleString() + '</td>' +
        '</tr>';
      }).join('');

      return '<table class="usageTable">' + head + body + '</table>';
    }

async function loadData(days=30){
  currentDays = days;
  updatePeriodLabels(days);
  document.querySelectorAll('.filters .secondary').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('btn'+days); if(btn) btn.classList.add('active');

  const status = document.getElementById('status');
  status.textContent = 'Đang tải dữ liệu GA4 '+days+' ngày...';
  try{
    const res = await fetch('/api/summary?days='+days+'&t='+Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'API error');

    const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeUsers || 0;
    setText('dau', data.dau || 0);
    setText('mau', data.mau || 0);
    setText('newUsers', data.newUsers || 0);    setText('returningUsers', data.returningUsersEstimate || 0);
    setText('japan', japan);
    setText('wau', data.wau || 0);
    setText('mau30', data.mau30 || 0);
    setText('sessionsPerUser', data.sessionsPerUser || 0);
    setText('screensPerUser', data.screensPerUser || 0);

    renderAutoSummary(data);
    setAppHealthScore(data);
    drawDailyChart(data.dailyUsers);
    hideLessImportantSections();
    document.getElementById('countries').innerHTML = rows(data.countries,'country','activeUsers');
    document.getElementById('languages').innerHTML = rows(data.languages,'language','activeUsers');
    document.getElementById('versions').innerHTML = rows(data.versions,'appVersion','activeUsers');
    document.getElementById('devices').innerHTML = rows(data.devices,'deviceModel','activeUsers');
    document.getElementById('events').innerHTML = rows(data.events,'eventName','eventCount','event');
    document.getElementById('screens').innerHTML = rows(data.screens,'unifiedScreenName','screenPageViews','screen');

    if (document.getElementById('tabUsageToday')) document.getElementById('tabUsageToday').innerHTML = renderUsageTable(data.tabUsageToday || []);
    if (document.getElementById('tabUsageRange')) document.getElementById('tabUsageRange').innerHTML = renderUsageTable(data.tabUsageRange || []);
    if (document.getElementById('tabUsageWeekly')) document.getElementById('tabUsageWeekly').innerHTML = renderUsageTable(data.tabUsageWeekly || [], true);

    cleanOwnerTables();
    limitOwnerTables();

    status.textContent = 'Đã cập nhật dữ liệu '+days+' ngày: ' + new Date(data.updatedAt).toLocaleString();
  }catch(e){
    console.error(e);
    status.textContent = 'Lỗi tải dữ liệu: ' + (e && e.stack ? e.stack : e.message);
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
    const [dau, mau, wau, mau30, sessionsTotal, screenViewsTotal, countries, events, devices, versions, languages, screens, dailyUsers, newUsers, tabUsageTodayRaw, tabUsageRangeRaw, tabUsageDailyRaw] = await Promise.all([
      safeReport({ startDate:'today', metrics:['activeUsers'] }),
      safeReport({ startDate, metrics:['activeUsers'] }),
      safeReport({ startDate:'7daysAgo', metrics:['activeUsers'] }),
      safeReport({ startDate:'30daysAgo', metrics:['activeUsers'] }),
      safeReport({ startDate, metrics:['sessions'] }),
      safeReport({ startDate, metrics:['screenPageViews'] }),
      safeReport({ startDate, dimensions:['country'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['eventName'], metrics:['eventCount'], limit:40 }),
      safeReport({ startDate, dimensions:['deviceModel'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['appVersion'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['language'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['unifiedScreenName'], metrics:['screenPageViews'], limit:20 }),
      safeReport({ startDate, dimensions:['date'], metrics:['activeUsers','newUsers','sessions'], limit:120 }),
      safeReport({ startDate:'today', dimensions:['unifiedScreenName'], metrics:['screenPageViews','activeUsers'], limit:50 }),
      safeReport({ startDate, dimensions:['unifiedScreenName'], metrics:['screenPageViews','activeUsers'], limit:50 }),
      safeReport({ startDate:'28daysAgo', dimensions:['date','unifiedScreenName'], metrics:['screenPageViews','activeUsers'], limit:500 }),
      safeReport({ startDate, metrics:['newUsers'] })
    ]);

    res.json({
      ok: true,
      days,
      dau: dau[0]?.metrics?.activeUsers || 0,
      mau: mau[0]?.metrics?.activeUsers || 0,
      wau: wau[0]?.metrics?.activeUsers || 0,
      mau30: mau30[0]?.metrics?.activeUsers || 0,
      sessionsPerUser: Number(((sessionsTotal[0]?.metrics?.sessions || 0) / Math.max(mau[0]?.metrics?.activeUsers || 0, 1)).toFixed(1)),
      screensPerUser: Number(((screenViewsTotal[0]?.metrics?.screenPageViews || 0) / Math.max(mau[0]?.metrics?.activeUsers || 0, 1)).toFixed(1)),
      newUsers: newUsers[0]?.metrics?.newUsers || 0,
      returningUsersEstimate: Math.max((mau[0]?.metrics?.activeUsers || 0) - (newUsers[0]?.metrics?.newUsers || 0), 0),
      tabUsageToday: buildTabUsage(tabUsageTodayRaw),
      tabUsageRange: buildTabUsage(tabUsageRangeRaw),
      tabUsageWeekly: buildWeeklyTabUsage(tabUsageDailyRaw),
      countries,
      events,
      devices,
      versions,
      languages,
      screens,
      dailyUsers,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.listen(port, () => console.log(`IkuraLog analytics server: http://localhost:${port}`));
