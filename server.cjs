require("dotenv").config();

const express = require("express");
const cors = require("cors");

const MetaApiImport = require("metaapi.cloud-sdk");
const MetaApi = MetaApiImport.default || MetaApiImport;

const app = express();
app.use(cors());

const METAAPI_TOKEN = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;

if (!METAAPI_TOKEN || !ACCOUNT_ID) {
  throw new Error("Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID");
}

const LOVABLE_SYMBOLS = [
  "EURUSD.a","GBPUSD.a","USDJPY.a","AUDUSD.a","USDCAD.a","USDCHF.a","NZDUSD.a",
  "EURGBP.a","EURJPY.a","GBPJPY.a","EURAUD.a","GBPAUD.a","AUDJPY.a","AUDNZD.a",
  "BTCUSD.a","ETHUSD.a","XRPUSD.a","LTCUSD.a","ADAUSD.a","SOLUSD.a",
  "DOGEUSD.a","AVAXUSD.a","DOTUSD.a","LINKUSD.a",
  "AAPL.US.a","MSFT.US.a","GOOG.US.a","GOOGL.US.a","TSLA.US.a","NVDA.US.a",
  "AMZN.US.a","META.US.a","NOVOB.DK.a","0700.HK.a","HSBA.GB.a","SAPd.DE.a",
  "SIEd.DE.a","OR.FR.a","AMD.US.a","PYPL.US.a","UBER.US.a","SHOP.US.a","NFLX.US.a",
  "US500.a","US30.a","NAS100.a","UK100.a","GER40.a","JPN225.a",
  "AUS200.a","HKNG.a","CN50.a","US2000.a",
  "XAUUSD.a","XAGUSD.a","SpotCrude.a","SpotBrent.a","NatGas.a","Copper.a"
];

const latest = new Map();
const clients = new Map();
const subscribed = new Set();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastPrice(payload) {
  const sym = payload?.price?.symbol;
  if (!sym) return;

  for (const [res, wanted] of clients.entries()) {
    if (wanted === sym) sendSse(res, "price", payload);
  }
}

let connection;

async function subscribeIfNeeded(symbol) {
  if (subscribed.has(symbol)) return;

  console.log("📡 Subscribing:", symbol);
  await connection.subscribeToMarketData(symbol, [
    { type: "ticks", intervalInMilliseconds: 250 }
  ]);
  subscribed.add(symbol);
  console.log("✅ Subscribed:", symbol);
}

app.get("/stream/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  if (!LOVABLE_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: "Unknown symbol" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.set(res, symbol);

  await subscribeIfNeeded(symbol);

  if (latest.has(symbol)) sendSse(res, "price", latest.get(symbol));

  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { ts: Date.now(), symbol });
  }, 2000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get("/latest/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(latest.get(symbol) || null);
});

async function startMetaApi() {
  const api = new MetaApi(METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);

  connection = account.getStreamingConnection();

  await connection.connect();
  await connection.waitSynchronized();

  connection.addSynchronizationListener({
    onSymbolPriceUpdated: (instanceIndex, price) => {
      if (!price?.symbol) return;
      const payload = { ts: Date.now(), price };
      latest.set(price.symbol, payload);
      broadcastPrice(payload);
    }
  });

  console.log("✅ MetaApi Connected & Ready");
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`✅ Server running → port ${PORT}`);
  await startMetaApi();
});
