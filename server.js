const express = require("express");
const cors = require("cors");
const { BetaAnalyticsDataClient } = require("@google-analytics/data");

const app = express();
app.use(cors());
app.use(express.static("../public"));

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;



const client = credentialsJson
  ? new BetaAnalyticsDataClient({ credentials: JSON.parse(credentialsJson) })
  : new BetaAnalyticsDataClient();

async function report(body, label = "report") {
  try {
    const [r] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      ...body
    });
    return r.rows || [];
  } catch (e) {
    console.log("Report failed:", label, e.message);
    return [];
  }
}

function rowObj(r, dimNames, metricNames) {
  const dimensions = {};
  const metrics = {};
  dimNames.forEach((k, i) => dimensions[k] = r.dimensionValues?.[i]?.value || "");
  metricNames.forEach((k, i) => metrics[k] = Number(r.metricValues?.[i]?.value || 0));
  return { dimensions, metrics };
}

app.get("/api/summary", async (req, res) => {
  try {
    if (!PROPERTY_ID) return res.json({ error: "Missing GA4_PROPERTY_ID" });

    const [
      pagesRaw, screensRaw, eventsRaw, devicesRaw, modelsRaw,
      browsersRaw, osRaw, countriesRaw, languagesRaw, sourcesRaw,
      landingRaw, dailyRaw, tabsRaw, levelsRaw, sessionsRaw
    ] = await Promise.all([
      report({ dimensions:[{name:"pagePath"}], metrics:[{name:"screenPageViews"},{name:"activeUsers"}] }, "pages"),
      report({ dimensions:[{name:"unifiedScreenName"}], metrics:[{name:"screenPageViews"},{name:"activeUsers"}] }, "screens"),
      report({ dimensions:[{name:"eventName"}], metrics:[{name:"eventCount"}], orderBys:[{metric:{metricName:"eventCount"},desc:true}] }, "events"),
      report({ dimensions:[{name:"deviceCategory"}], metrics:[{name:"activeUsers"}] }, "devices"),
      report({ dimensions:[{name:"deviceModel"}], metrics:[{name:"activeUsers"}] }, "models"),
      report({ dimensions:[{name:"browser"}], metrics:[{name:"activeUsers"}] }, "browsers"),
      report({ dimensions:[{name:"operatingSystem"}], metrics:[{name:"activeUsers"}] }, "os"),
      report({ dimensions:[{name:"country"}], metrics:[{name:"activeUsers"}] }, "countries"),
      report({ dimensions:[{name:"language"}], metrics:[{name:"activeUsers"}] }, "languages"),
      report({ dimensions:[{name:"sessionSourceMedium"}], metrics:[{name:"sessions"},{name:"activeUsers"}] }, "sources"),
      report({ dimensions:[{name:"landingPagePlusQueryString"},{name:"hostName"}], metrics:[{name:"sessions"},{name:"activeUsers"}] }, "landing"),
      report({ dimensions:[{name:"date"}], metrics:[{name:"activeUsers"},{name:"newUsers"},{name:"sessions"}] }, "daily"),
      report({
        dimensions:[{name:"eventName"}],
        metrics:[{name:"eventCount"}],
        dimensionFilter:{ filter:{ fieldName:"eventName", stringFilter:{ matchType:"BEGINS_WITH", value:"vietstay_tab_" }}}
      }, "tabs"),
      report({
        dimensions:[{name:"eventName"}],
        metrics:[{name:"eventCount"}],
        dimensionFilter:{ filter:{ fieldName:"eventName", inListFilter:{ values:["vietstay_level_1","vietstay_level_2","vietstay_level_3"] }}}
      }, "levels"),
      report({ dimensions:[{name:"sessionDefaultChannelGroup"}], metrics:[{name:"sessions"}] }, "sessions")
    ]);

    const events = eventsRaw.map(r => rowObj(r, ["eventName"], ["eventCount"]));
    const screens = screensRaw.map(r => rowObj(r, ["unifiedScreenName"], ["screenPageViews","activeUsers"]));
    const pages = pagesRaw.map(r => rowObj(r, ["pagePath"], ["screenPageViews","activeUsers"]));
    const dailyUsers = dailyRaw.map(r => rowObj(r, ["date"], ["activeUsers","newUsers","sessions"]));

    const activeUsers = screens.reduce((s,r)=>s+r.metrics.activeUsers,0);
    const pageViews = screens.reduce((s,r)=>s+r.metrics.screenPageViews,0);
    const sessions = sessionsRaw.reduce((s,r)=>s+Number(r.metricValues?.[0]?.value || 0),0);
    const newUsers = dailyUsers.reduce((s,r)=>s+r.metrics.newUsers,0);

    res.json({
      ok: true,
      days: 30,
      dau: dailyUsers.at(-1)?.metrics.activeUsers || 0,
      mau: activeUsers,
      wau: activeUsers,
      mau30: activeUsers,
      sessionsPerUser: activeUsers ? +(sessions / activeUsers).toFixed(1) : 0,
      screensPerUser: activeUsers ? +(pageViews / activeUsers).toFixed(1) : 0,
      newUsers,
      returningUsersEstimate: Math.max(activeUsers - newUsers, 0),

      pages,
      screens,
      events,
      dailyUsers,
      tabUsageRange: screens.map(r => ({
        tab: r.dimensions.unifiedScreenName,
        views: r.metrics.screenPageViews,
        users: r.metrics.activeUsers,
        avgPerUser: r.metrics.activeUsers ? +(r.metrics.screenPageViews / r.metrics.activeUsers).toFixed(1) : 0
      })),

      tabEvents: tabsRaw.map(r => rowObj(r, ["eventName"], ["eventCount"])),
      levelClicks: levelsRaw.map(r => rowObj(r, ["eventName"], ["eventCount"])),

      devices: devicesRaw.map(r => rowObj(r, ["deviceCategory"], ["activeUsers"])),
      deviceModels: modelsRaw.map(r => rowObj(r, ["deviceModel"], ["activeUsers"])),
      browsers: browsersRaw.map(r => rowObj(r, ["browser"], ["activeUsers"])),
      operatingSystems: osRaw.map(r => rowObj(r, ["operatingSystem"], ["activeUsers"])),
      countries: countriesRaw.map(r => rowObj(r, ["country"], ["activeUsers"])),
      languages: languagesRaw.map(r => rowObj(r, ["language"], ["activeUsers"])),
      sources: sourcesRaw.map(r => rowObj(r, ["sessionSourceMedium"], ["sessions","activeUsers"])),
      landingPages: landingRaw.map(r => rowObj(r, ["landingPagePlusQueryString","hostName"], ["sessions","activeUsers"])),

      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("VietStay Analytics running:", process.env.PORT || 3000);
});
