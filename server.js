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
