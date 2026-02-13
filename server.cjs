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

// ✅ Your Lovable symbols
const LOVABLE_SYMBOLS = [
  // Forex
  "EURUSD.a","GBPUSD.a","USDJPY.a","AUDUSD.a","USDCAD.a","USDCHF.a","NZDUSD.a",
  "EURGBP.a","EURJPY.a","GBPJPY.a","EURAUD.a","GBPAUD.a","AUDJPY.a","AUDNZD.a",

  // Crypto
  "BTCUSD.a","ETHUSD.a","XRPUSD.a","LTCUSD.a","ADAUSD.a","SOLUSD.a",
  "DOGEUSD.a","AVAXUSD.a","DOTUSD.a","LINKUSD.a",

  // Stocks
  "AAPL.US.a","MSFT.US.a","GOOG.US.a","GOOGL.US.a","TSLA.US.a","NVDA.US.a",
  "AMZN.US.a","META.US.a","NOVOB.DK.a","0700.HK.a","HSBA.GB.a","SAPd.DE.a",
  "SIEd.DE.a","OR.FR.a","AMD.US.a","PYPL.US.a","UBER.US.a","SHOP.US.a","NFLX.US.a",

  // Indices
  "US500.a","US30.a","NAS100.a","UK100.a","GER40.a","JPN225.a",
  "AUS200.a","HKNG.a","CN50.a","US2000.a",

  // Commodities
  "XAUUSD.a","XAGUSD.a","SpotCrude.a","SpotBrent.a","NatGas.a","Copper.a"
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
    if (wanted === sym) {
      sendSse(res, "price", payload);
    }
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

// ✅ Streaming endpoint (SSE)
app.get("/stream/:symbol", async (req, res) => {
  const symbol = req.p
