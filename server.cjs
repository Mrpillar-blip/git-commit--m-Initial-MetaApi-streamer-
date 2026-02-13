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

const LOVABLE_SYMBOLS = ["EURUSD.a","GBPUSD.a","BTCUSD.a","XAUUSD.a"];

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

function handlePrice(price) {
  if (!price?.symbol) return;

  const payload = { ts: Date.now(), price };
  latest.set(price.symbol, payload);
  broadcastPrice(payload);
}

let connection;

async function subscribeIfNeeded(symbol) {
  if (subscribed.has(symbol)) return;

  await connection.subscribeToMarketData(symbol, [
    { type: "ticks", intervalInMilliseconds: 250 }
  ]);

  subscribed.add(symbol);
}

app.get("/stream/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.set(res, symbol);

  await subscribeIfNeeded(symbol);

  if (latest.has(symbol)) sendSse(res, "price", latest.get(symbol));

  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { ts: Date.now() });
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

    // ✅ Handles singular events
    onSymbolPriceUpdated: (instanceIndex, price) => {
      handlePrice(price);
    },

    // ✅ Handles plural events
    onSymbolPricesUpdated: (instanceIndex, prices) => {
      if (!Array.isArray(prices)) return;
      for (const price of prices) handlePrice(price);
    }
  });

  console.log("✅ MetaApi Connected");
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await startMetaApi();
});
