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

// ✅ Symbols your Lovable app can request (add more later)
const LOVABLE_SYMBOLS = [
  "EURUSD.a",
  "GBPUSD.a",
  "BTCUSD.a",
  "XAUUSD.a"
];

// symbol -> latest payload (ts always updates every 1s once subscribed)
const latest = new Map();

// symbol -> last real tick price object received from MetaApi
const lastTick = new Map();

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

  // store last real tick
  lastTick.set(price.symbol, price);

  // update latest immediately on every real tick
  const payload = { ts: Date.now(), price };
  latest.set(price.symbol, payload);
  broadcastPrice(payload);
}

let connection;

async function subscribeIfNeeded(symbol) {
  if (subscribed.has(symbol)) return;

  console.log("📡 Subscribing:", symbol);

  // ✅ Most compatible subscription (avoids TTL/interval validation errors)
  await connection.subscribeToMarketData(symbol, [{ type: "ticks" }]);

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

  // triggers MetaApi subscription for this symbol
  await subscribeIfNeeded(symbol);

  // send immediate snapshot if we have one
  if (latest.has(symbol)) sendSse(res, "price", latest.get(symbol));

  // keep connection alive
  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { ts: Date.now(), symbol });
  }, 2000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ✅ JSON endpoint (Lovable polling)
app.get("/latest/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  if (!LOVABLE_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: "Unknown symbol" });
  }

  // OPTIONAL: auto-subscribe on first poll so you don't need /stream open
  await subscribeIfNeeded(symbol);

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
    onDealUpdated: () => {},
    onHealthStatus: () => {},
    onBrokerConnectionStatusChanged: () => {}
  });

  // ✅ 1-second snapshot fix:
  // After a symbol is subscribed AND we have at least one real tick,
  // we refresh latest.ts every 1000ms so Lovable always sees a new update each second.
  setInterval(() => {
    for (const symbol of subscribed) {
      const price = lastTick.get(symbol);
      if (!price) continue;

      const payload = { ts: Date.now(), price };
      latest.set(symbol, payload);
      // (optional) you can also broadcast here if you want stream clients to get
      // a message every second even when price doesn't change:
      // broadcastPrice(payload);
    }
  }, 1000);

  console.log("✅ MetaApi Connected & Ready");
}

// ✅ Render-compatible PORT
const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await startMetaApi();
});
