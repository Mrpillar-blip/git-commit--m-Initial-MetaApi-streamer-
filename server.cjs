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

// ✅ Symbols your Lovable app can request
const LOVABLE_SYMBOLS = [
  "EURUSD.a",
  "GBPUSD.a",
  "BTCUSD.a",
  "XAUUSD.a"
];

// symbol -> latest tick payload
const latest = new Map();

// res -> symbol requested
const clients = new Map();

// Track subscriptions so we never double-subscribe
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

function handlePrice(price) {
  if (!price?.symbol) return;

  const payload = { ts: Date.now(), price };
  latest.set(price.symbol, payload);
  broadcastPrice(payload);
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

// ✅ Streaming endpoint (SSE)
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

// ✅ Optional JSON endpoint (for polling)
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

    // ✅ Prices (handle BOTH SDK variants)
    onSymbolPriceUpdated: (instanceIndex, price) => {
      handlePrice(price);
    },

    onSymbolPricesUpdated: (instanceIndex, prices) => {
      if (!Array.isArray(prices)) return;
      for (const price of prices) handlePrice(price);
    },

    // ✅ Ignore noisy MetaApi events (prevents red errors)
    onSymbolSpecificationUpdated: () => {},
    onSymbolSpecificationsUpdated: () => {},
    onAccountInformationUpdated: () => {},
    onPositionsUpdated: () => {},
    onPositionUpdated: () => {},
    onOrdersUpdated: () => {},
    onOrderUpdated: () => {},
    onHistoryOrdersUpdated: () => {},
    onDealsUpdated: () => {},
    onDealUpdated: () => {}
  });

  console.log("✅ MetaApi Connected & Ready");
}

// ✅ Render-compatible PORT
const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await startMetaApi();
});
