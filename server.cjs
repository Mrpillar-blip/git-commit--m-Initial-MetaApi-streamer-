  const symbol = req.params.symbol.toUpperCase();

  if (!LOVABLE_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: "Unknown symbol" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.set(res, symbol);

  await subscribeIfNeeded(symbol);

  if (latest.has(symbol)) {
    sendSse(res, "price", latest.get(symbol));
  }

  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { ts: Date.now(), symbol });
  }, 2000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ✅ Optional JSON endpoint (useful for polling)
app.get("/latest/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(latest.get(symbol) || null);
});

function handleOnePrice(price) {
  if (!price?.symbol) return;

  const payload = { ts: Date.now(), price };
  latest.set(price.symbol, payload);
  broadcastPrice(payload);
}

function handleManyPrices(prices) {
  if (!Array.isArray(prices)) return;
  for (const price of prices) handleOnePrice(price);
}

async function startMetaApi() {
  const api = new MetaApi(METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);

  connection = account.getStreamingConnection();

  await connection.connect();
  await connection.waitSynchronized();

  // ✅ Support BOTH callback names (SDK differences)
  connection.addSynchronizationListener({
    onSymbolPriceUpdated: (instanceIndex, price) => {
      handleOnePrice(price);
    },
    onSymbolPricesUpdated: (instanceIndex, prices) => {
      handleManyPrices(prices);
    }
  });

  console.log("✅ MetaApi Connected & Ready");
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`✅ Server running → port ${PORT}`);
  await startMetaApi();
});
