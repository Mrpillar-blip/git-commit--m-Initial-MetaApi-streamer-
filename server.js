import express from "express";
import cors from "cors";
import MetaApi from "metaapi.cloud-sdk/dist/node";

const app = express();
app.use(cors());

const METAAPI_TOKEN = process.env.METAAPI_TOKEN;
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;

if (!METAAPI_TOKEN || !ACCOUNT_ID) {
  throw new Error("Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID");
}

const latest = new Map();
const clients = new Set();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of clients) sendSse(res, event, data);
}

app.get("/stream/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.add(res);

  if (latest.has(symbol)) {
    sendSse(res, "price", latest.get(symbol));
  }

  req.on("close", () => clients.delete(res));
});

async function startMetaApi() {
  const api = new MetaApi(METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);
  const connection = account.getStreamingConnection();

  await connection.connect();
  await connection.waitSynchronized();

  await connection.subscribeToMarketData("EURUSD", [
    { type: "ticks", intervalInMilliseconds: 250 }
  ]);

  connection.addSynchronizationListener({
    onSymbolPriceUpdated: (i, price) => {
      if (!price?.symbol) return;
      const payload = { ts: Date.now(), price };
      latest.set(price.symbol, payload);
      broadcast("price", payload);
    }
  });

  console.log("✅ MetaApi Connected & Streaming");
}

app.listen(8080, async () => {
  console.log("✅ Server running → http://localhost:8080");
  await startMetaApi();
});
