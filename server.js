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
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f6fb;margin:0;color:#0f172a}
header{padding:24px 28px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:16px}
h1{margin:0;font-size:28px}h2{margin:0 0 12px;font-size:18px}
button{background:#2563eb;color:#fff;border:0;border-radius:12px;padding:12px 16px;font-weight:800;cursor:pointer}
button.secondary{background:#e2e8f0;color:#0f172a}
main{padding:24px;max-width:1220px;margin:auto}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.section{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
.label{color:#64748b;font-weight:700;font-size:13px}.num{font-size:34px;font-weight:900;margin-top:8px}
.status{color:#16a34a;font-weight:800;margin-top:8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px}th{color:#64748b;background:#f8fafc}
.bar{height:10px;background:#e5e7eb;border-radius:99px;overflow:hidden}.fill{height:100%;background:#2563eb;border-radius:99px}
.chart{height:210px;display:flex;align-items:end;gap:6px;border-bottom:1px solid #e5e7eb;padding-top:18px}
.col{flex:1;background:#2563eb;border-radius:6px 6px 0 0;min-width:4px;position:relative}
.col span{display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-size:11px;background:#0f172a;color:#fff;padding:3px 6px;border-radius:6px;white-space:nowrap}.col:hover span{display:block}
.note{color:#64748b;font-size:13px;margin-top:10px}
.filters{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:900px){.grid,.section{grid-template-columns:1fr}header{display:block}.filters{margin-top:12px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>IkuraLog Analytics</h1>
    <div id="status" class="status">Đang tải dữ liệu GA4...</div>
  </div>
  <div class="filters">
    <button class="secondary" onclick="loadData(7)">7 ngày</button>
    <button class="secondary" onclick="loadData(30)">30 ngày</button>
    <button class="secondary" onclick="loadData(90)">90 ngày</button>
    <button onclick="loadData(currentDays)">Cập nhật</button>
  </div>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="label">Người dùng hôm nay</div><div class="num" id="dau">-</div></div>
    <div class="card"><div class="label">Người dùng 30 ngày</div><div class="num" id="mau">-</div></div>
    <div class="card"><div class="label">User mới</div><div class="num" id="newUsers">-</div></div>
    <div class="card"><div class="label">User quay lại ước tính</div><div class="num" id="returningUsers">-</div></div>
    <div class="card"><div class="label">Người dùng ở Nhật</div><div class="num" id="japan">-</div></div>
  </div>

  <section class="card">
    <h2>Người dùng theo ngày</h2>
    <div id="dailyChart" class="chart"></div>
    <div class="note">Dùng active users theo ngày từ GA4. Bộ lọc 7/30/90 ngày ở góc trên.</div>
  </section>

  <div class="section">
    <div class="card"><h2>Quốc gia</h2><table><thead><tr><th>Quốc gia</th><th>User</th><th></th></tr></thead><tbody id="countries"></tbody></table></div>
    <div class="card"><h2>Ngôn ngữ</h2><table><thead><tr><th>Ngôn ngữ</th><th>User</th><th></th></tr></thead><tbody id="languages"></tbody></table></div>
    <div class="card"><h2>Phiên bản app</h2><table><thead><tr><th>Version</th><th>User</th><th></th></tr></thead><tbody id="versions"></tbody></table></div>
    <div class="card"><h2>Thiết bị</h2><table><thead><tr><th>Thiết bị</th><th>User</th><th></th></tr></thead><tbody id="devices"></tbody></table></div>
    <div class="card"><h2>Sự kiện quan trọng</h2><table><thead><tr><th>Event</th><th>Số lần</th><th></th></tr></thead><tbody id="events"></tbody></table></div>
    <div class="card"><h2>Màn hình được mở nhiều</h2><table><thead><tr><th>Màn hình</th><th>Lượt mở</th><th></th></tr></thead><tbody id="screens"></tbody></table><div class="note">Nếu còn “Không xác định”, cần chờ user dùng bản app mới có screen tracking.</div></div>
  </div>
</main>
<script>
let currentDays = 30;
function cleanName(v){ return (!v || v === '(not set)') ? 'Không xác định' : v; }
function maxMetric(rows, metric){ return Math.max(...(rows||[]).map(r => r.metrics?.[metric] || 0), 1); }
function rows(data, dim, metric){
  const max = maxMetric(data, metric);
  return (data||[]).map(r => {
    const name = cleanName(r.dimensions?.[dim]);
    const value = r.metrics?.[metric] ?? 0;
    const width = Math.round((value / max) * 100);
    return '<tr><td>'+name+'</td><td>'+value+'</td><td><div class="bar"><div class="fill" style="width:'+width+'%"></div></div></td></tr>';
  }).join('');
}
function dateLabel(v){
  if(!v || v.length !== 8) return v || '';
  return v.slice(4,6)+'/'+v.slice(6,8);
}
function drawDailyChart(rows){
  const el = document.getElementById('dailyChart');
  const max = maxMetric(rows, 'activeUsers');
  el.innerHTML = (rows||[]).map(r => {
    const value = r.metrics?.activeUsers || 0;
    const h = Math.max(4, Math.round((value / max) * 190));
    return '<div class="col" style="height:'+h+'px"><span>'+dateLabel(r.dimensions?.date)+': '+value+'</span></div>';
  }).join('');
}
async function loadData(days=30){
  currentDays = days;
  const status = document.getElementById('status');
  status.textContent = 'Đang tải dữ liệu GA4 '+days+' ngày...';
  try{
    const res = await fetch('/api/summary?days='+days);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'API error');

    const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeUsers || 0;
    document.getElementById('dau').textContent = data.dau || 0;
    document.getElementById('mau').textContent = data.mau || 0;
    document.getElementById('newUsers').textContent = data.newUsers || 0;
    document.getElementById('returningUsers').textContent = data.returningUsersEstimate || 0;
    document.getElementById('japan').textContent = japan;

    drawDailyChart(data.dailyUsers);
    document.getElementById('countries').innerHTML = rows(data.countries,'country','activeUsers');
    document.getElementById('languages').innerHTML = rows(data.languages,'language','activeUsers');
    document.getElementById('versions').innerHTML = rows(data.versions,'appVersion','activeUsers');
    document.getElementById('devices').innerHTML = rows(data.devices,'deviceModel','activeUsers');
    document.getElementById('events').innerHTML = rows(data.events,'eventName','eventCount');
    document.getElementById('screens').innerHTML = rows(data.screens,'unifiedScreenName','screenPageViews');

    status.textContent = 'Đã cập nhật '+days+' ngày: ' + new Date(data.updatedAt).toLocaleString();
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
    const days = Math.min(Math.max(Number(req.query.days || 30), 7), 90);
    const startDate = `${days}daysAgo`;
    const [dau, mau, countries, events, devices, versions, languages, screens, dailyUsers, newUsers] = await Promise.all([
      safeReport({ startDate:'today', metrics:['activeUsers'] }),
      safeReport({ startDate:'30daysAgo', metrics:['activeUsers'] }),
      safeReport({ startDate, dimensions:['country'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['eventName'], metrics:['eventCount'], limit:40 }),
      safeReport({ startDate, dimensions:['deviceModel'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['appVersion'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['language'], metrics:['activeUsers'], limit:10 }),
      safeReport({ startDate, dimensions:['unifiedScreenName'], metrics:['screenPageViews'], limit:20 }),
      safeReport({ startDate, dimensions:['date'], metrics:['activeUsers','newUsers','sessions'], limit:120 }),
      safeReport({ startDate, metrics:['newUsers'] })
    ]);

    res.json({
      ok: true,
      days,
      dau: dau[0]?.metrics?.activeUsers || 0,
      mau: mau[0]?.metrics?.activeUsers || 0,
      newUsers: newUsers[0]?.metrics?.newUsers || 0,
      returningUsersEstimate: Math.max((mau[0]?.metrics?.activeUsers || 0) - (newUsers[0]?.metrics?.newUsers || 0), 0),
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
