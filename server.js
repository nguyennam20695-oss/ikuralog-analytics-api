import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const app = express();
app.use(cors());

const port = Number(process.env.PORT || 8787);
const propertyId = process.env.GA4_PROPERTY_ID;
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

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

app.get('/dashboard', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IkuraLog Analytics</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f6fb;margin:0;color:#0f172a}
header{padding:24px 28px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
h1{margin:0;font-size:28px}
button{background:#2563eb;color:#fff;border:0;border-radius:12px;padding:12px 18px;font-weight:800;cursor:pointer}
main{padding:24px;max-width:1180px;margin:auto}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
.label{color:#64748b;font-weight:700}
.num{font-size:38px;font-weight:900;margin-top:8px}
.ok{color:#16a34a;font-weight:800}
.section{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb}
th{color:#64748b;background:#f8fafc}
.status{margin-top:12px;color:#16a34a;font-weight:800}
@media(max-width:800px){.grid,.section{grid-template-columns:1fr}header{display:block}button{margin-top:12px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>IkuraLog Analytics</h1>
    <div id="status" class="status">Đang tải dữ liệu GA4...</div>
  </div>
  <button onclick="loadData()">Cập nhật dữ liệu</button>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="label">Người dùng hôm nay</div><div class="num" id="dau">-</div></div>
    <div class="card"><div class="label">Người dùng 30 ngày</div><div class="num" id="mau">-</div></div>
    <div class="card"><div class="label">Người dùng ở Nhật</div><div class="num" id="japan">-</div></div>
    <div class="card"><div class="label">Ngôn ngữ chính</div><div class="num" id="lang">-</div></div>
  </div>

  <div class="section">
    <div class="card"><h2>Quốc gia</h2><table><thead><tr><th>Quốc gia</th><th>User</th></tr></thead><tbody id="countries"></tbody></table></div>
    <div class="card"><h2>Phiên bản app</h2><table><thead><tr><th>Version</th><th>User</th></tr></thead><tbody id="versions"></tbody></table></div>
    <div class="card"><h2>Sự kiện</h2><table><thead><tr><th>Event</th><th>Số lần</th></tr></thead><tbody id="events"></tbody></table></div>
    <div class="card"><h2>Thiết bị</h2><table><thead><tr><th>Thiết bị</th><th>User</th></tr></thead><tbody id="devices"></tbody></table></div>
    <div class="card"><h2>Ngôn ngữ</h2><table><thead><tr><th>Ngôn ngữ</th><th>User</th></tr></thead><tbody id="languages"></tbody></table></div>
    <div class="card"><h2>Màn hình</h2><table><thead><tr><th>Màn hình</th><th>Lượt mở</th></tr></thead><tbody id="screens"></tbody></table></div>
  </div>
</main>
<script>
function cleanName(v){ return (!v || v === '(not set)') ? 'Không xác định' : v; }
function rows(data, dim, metric){
  return (data||[]).map(r => '<tr><td>'+cleanName(r.dimensions?.[dim])+'</td><td>'+(r.metrics?.[metric]??0)+'</td></tr>').join('');
}
async function loadData(){
  const status = document.getElementById('status');
  status.textContent = 'Đang tải dữ liệu GA4...';
  try{
    const res = await fetch('/api/summary');
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'API error');

    document.getElementById('dau').textContent = data.dau;
    document.getElementById('mau').textContent = data.mau;

    const japan = (data.countries||[]).find(r => r.dimensions?.country === 'Japan')?.metrics?.activeUsers || 0;
    document.getElementById('japan').textContent = japan;

    const topLang = data.languages?.[0]?.dimensions?.language || '-';
    document.getElementById('lang').textContent = cleanName(topLang);

    document.getElementById('countries').innerHTML = rows(data.countries,'country','activeUsers');
    document.getElementById('versions').innerHTML = rows(data.versions,'appVersion','activeUsers');
    document.getElementById('events').innerHTML = rows(data.events,'eventName','eventCount');
    document.getElementById('devices').innerHTML = rows(data.devices,'deviceModel','activeUsers');
    document.getElementById('languages').innerHTML = rows(data.languages,'language','activeUsers');
    document.getElementById('screens').innerHTML = rows(data.screens,'unifiedScreenName','screenPageViews');

    status.textContent = 'Đã cập nhật: ' + new Date(data.updatedAt).toLocaleString();
  }catch(e){
    status.textContent = 'Lỗi: ' + e.message;
  }
}
loadData();
</script>
</body>
</html>`);
});

app.get('/api/summary', async (req, res) => {
  try {
    const [dau, mau, countries, events, devices, versions, languages, screens] = await Promise.all([
      safeReport({ startDate:'today', metrics:['activeUsers'] }),
      safeReport({ startDate:'30daysAgo', metrics:['activeUsers'] }),
      safeReport({ dimensions:['country'], metrics:['activeUsers'], limit:10 }),
      safeReport({ dimensions:['eventName'], metrics:['eventCount'], limit:40 }),
      safeReport({ dimensions:['deviceModel'], metrics:['activeUsers'], limit:10 }),
      safeReport({ dimensions:['appVersion'], metrics:['activeUsers'], limit:10 }),
      safeReport({ dimensions:['language'], metrics:['activeUsers'], limit:10 }),
      safeReport({ dimensions:['unifiedScreenName'], metrics:['screenPageViews'], limit:20 })
    ]);

    res.json({
      ok: true,
      dau: dau[0]?.metrics?.activeUsers || 0,
      mau: mau[0]?.metrics?.activeUsers || 0,
      countries,
      events,
      devices,
      versions,
      languages,
      screens,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.listen(port, () => console.log(`IkuraLog analytics server: http://localhost:${port}`));
