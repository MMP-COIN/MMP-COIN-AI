/* MMP live coherence layer — one quote clock for the benchmark cards.
   Live values are shown only while their source timestamps remain inside the freshness window. */
(function () {
  "use strict";

  const MAX_CRYPTO_AGE_MS = 90000;
  const MAX_GOLD_AGE_MS = 180000;
  const TETHER_POLL_MS = 30000;
  const GOLD_POLL_MS = 60000;
  const REST_FALLBACK_MS = 20000;
  const RADAR_POLL_MS = 60000;

  let socket = null;
  let reconnectTimer = null;
  let reconnectDelay = 2000;
  let lastSocketMessageAt = 0;
  let goldQuote = null;
  let tetherBusy = false;
  let goldBusy = false;
  let restBusy = false;

  const byId = id => document.getElementById(id);
  const readGoldCache = () => { try { return JSON.parse(localStorage.getItem("mmp_gold_quote_v1") || "null"); } catch (error) { return null; } };
  const number = (value, digits = 2) => Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  const timeLabel = value => new Date(value).toLocaleTimeString("fa-IR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

  function freshQuote(symbol) {
    const quote = lastMarket?.crypto?.[symbol];
    if (!quote || !(Number(quote.usd) > 0)) return null;
    const age = Date.now() - Number(quote.updatedAt || 0);
    return age >= 0 && age <= MAX_CRYPTO_AGE_MS ? quote : null;
  }

  function setCardValue(valueId, subId, value, subtitle) {
    const valueNode = byId(valueId);
    const subNode = byId(subId);
    if (valueNode) valueNode.textContent = value;
    if (subNode) subNode.textContent = subtitle;
  }

  function renderFixedCards() {
    const btc = freshQuote("BTC");
    const eth = freshQuote("ETH");
    const renderCrypto = (quote, valueId, subId, symbol) => {
      if (!quote) {
        setCardValue(valueId, subId, "—", "قیمت زنده " + symbol + " در دسترس نیست؛ داده قدیمی نمایش داده نمی‌شود");
        return;
      }
      const change = Number(quote.change24h);
      const tomanText = typeof isTetherRateFresh === "function" && isTetherRateFresh()
        ? "معادل " + Math.round(Number(quote.usd) * Number(currentTetherPrice)).toLocaleString("en-US") + " تومان"
        : "معادل تومانی در انتظار نرخ زنده تتر";
      const changeText = Number.isFinite(change)
        ? " · ۲۴ ساعت: " + (change >= 0 ? "+" : "") + change.toFixed(2) + "%"
        : "";
      setCardValue(valueId, subId, number(quote.usd, 2) + " USDT",
        tomanText + " · " + (quote.sources || "منبع زنده") + changeText + " · " + timeLabel(quote.exchangeTimestamp || quote.updatedAt));
    };
    renderCrypto(btc, "btc", "btc-sub", "BTC");
    renderCrypto(eth, "eth", "eth-sub", "ETH");

    if (goldQuote && Date.now() - goldQuote.updatedAt <= MAX_GOLD_AGE_MS) {
      setCardValue("gold", "gold-sub", number(goldQuote.price, 2) + " USDT",
        (typeof isTetherRateFresh === "function" && isTetherRateFresh()
          ? "معادل " + Math.round(Number(goldQuote.price) * Number(currentTetherPrice)).toLocaleString("en-US") + " تومان · "
          : "معادل تومانی در انتظار نرخ زنده تتر · ")
          + "منبع: Gold-API · قیمت زنده · " + timeLabel(goldQuote.updatedAt));
    } else {
      setCardValue("gold", "gold-sub", "—", "قیمت زنده طلا در دسترس نیست؛ قیمت ذخیره‌شده نمایش داده نمی‌شود");
    }

    const tetherFresh = typeof isTetherRateFresh === "function" && isTetherRateFresh()
      && Date.now() - Number(currentTetherUpdatedAt || 0) <= 120000;
    if (tetherFresh) {
      setCardValue("usdt", "usdt-source", number(currentTetherPrice, 0) + " تومان",
        "نرخ زنده USDT/IRT · " + (currentTetherSources || []).join(" + ")
          + " · " + timeLabel(currentTetherUpdatedAt));
    } else {
      setCardValue("usdt", "usdt-source", "—",
        currentTetherWarning || "نرخ زنده تتر در دسترس نیست؛ نرخ قدیمی نمایش داده نمی‌شود");
    }
  }

  function acceptTicker(data) {
    const symbol = String(data?.s || "").toUpperCase();
    if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") return;
    const price = Number(data.c);
    const eventTime = Number(data.E) || Date.now();
    if (!(price > 0) || !Number.isFinite(price) || Date.now() - eventTime > 15000) return;
    const key = symbol.slice(0, 3);
    lastSocketMessageAt = Date.now();
    lastMarket.crypto = lastMarket.crypto || {};
    lastMarket.crypto[key] = {
      usd: price,
      change24h: Number(data.P),
      updatedAt: eventTime,
      exchangeTimestamp: eventTime,
      sources: "Binance Spot WebSocket"
    };
    if (Array.isArray(cachedCoinsData)) {
      const coin = cachedCoinsData.find(item => String(item?.symbol || "").toUpperCase() === key);
      if (coin) {
        coin.current_price = price;
        coin.price_change_percentage_24h = Number(data.P);
        coin.price_updated_at = new Date(eventTime).toISOString();
        coin.price_source = "Binance Spot WebSocket";
        coin.price_is_stale = false;
      }
    }
    renderFixedCards();
    document.dispatchEvent(new CustomEvent("mmp-live-quote-updated", {
      detail: { symbol: key, price, change24h: Number(data.P), timestamp: eventTime }
    }));
  }

  const socketHosts = [
    "wss://stream.binance.com:9443",
    "wss://stream.binance.com:443",
    "wss://data-stream.binance.vision"
  ];
  let socketHostIndex = 0;

  function connectSocket() {
    if (document.visibilityState === "hidden") return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    try {
      const host = socketHosts[socketHostIndex % socketHosts.length];
      socket = new WebSocket(host + "/stream?streams=btcusdt@ticker/ethusdt@ticker");
      socket.addEventListener("open", () => { reconnectDelay = 2000; });
      socket.addEventListener("message", event => {
        try {
          const payload = JSON.parse(event.data);
          acceptTicker(payload?.data || payload);
        } catch (error) {
          console.warn("MMP live ticker payload rejected:", error);
        }
      });
      socket.addEventListener("error", () => {
        try { socket.close(); } catch (error) {}
      });
      socket.addEventListener("close", () => {
        socket = null;
        socketHostIndex = (socketHostIndex + 1) % socketHosts.length;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, reconnectDelay);
        reconnectDelay = Math.min(30000, reconnectDelay * 2);
      });
    } catch (error) {
      socket = null;
      socketHostIndex = (socketHostIndex + 1) % socketHosts.length;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSocket, reconnectDelay);
      reconnectDelay = Math.min(30000, reconnectDelay * 2);
    }
  }

  async function refreshRestFallback() {
    if (restBusy || document.visibilityState === "hidden") return;
    if (socket?.readyState === WebSocket.OPEN && Date.now() - lastSocketMessageAt < 12000) return;
    if (typeof refreshBenchmarkQuotes !== "function") return;
    restBusy = true;
    try { await refreshBenchmarkQuotes(); }
    catch (error) { console.warn("MMP benchmark REST fallback failed:", error); }
    finally { restBusy = false; renderFixedCards(); }
  }

  async function refreshTether() {
    if (tetherBusy || document.visibilityState === "hidden" || typeof fetchTetherRate !== "function") return;
    tetherBusy = true;
    try {
      const quote = await fetchTetherRate();
      const age = quote?.updatedAt ? Date.now() - Number(quote.updatedAt) : Infinity;
      if (quote && Number(quote.price) >= 1000 && Number(quote.price) <= 100000000
        && quote.stale !== true && age >= 0 && age <= 120000) {
        currentTetherPrice = Number(quote.price);
        currentTetherSources = Array.isArray(quote.sources) ? quote.sources : [];
        currentTetherWarning = String(quote.warning || "");
        currentTetherUpdatedAt = Number(quote.updatedAt);
        currentTetherStale = false;
        try {
          localStorage.setItem("mmp_tether_cache_v1", JSON.stringify({
            price: currentTetherPrice, sources: currentTetherSources,
            updatedAt: currentTetherUpdatedAt, stale: false
          }));
        } catch (error) {}
      } else {
        currentTetherPrice = 0;
        currentTetherSources = [];
        currentTetherStale = true;
        currentTetherWarning = "منابع زنده تتر پاسخ معتبر ندادند؛ نرخ قدیمی پنهان شد";
      }
    } catch (error) {
      currentTetherPrice = 0;
      currentTetherSources = [];
      currentTetherStale = true;
      currentTetherWarning = "اتصال زنده تتر قطع است؛ نرخ قدیمی نمایش داده نمی‌شود";
      console.warn("MMP tether refresh failed:", error);
    } finally {
      tetherBusy = false;
      renderFixedCards();
    }
  }

  async function refreshGold() {
    if (goldBusy || document.visibilityState === "hidden" || typeof refreshGoldQuote !== "function") return;
    goldBusy = true;
    try {
      const ok = await refreshGoldQuote();
      const saved = readGoldCache();
      const price = Number(saved?.price);
      const updatedAt = Number(saved?.updatedAt);
      if (ok && price > 0 && updatedAt > 0 && Date.now() - updatedAt <= MAX_GOLD_AGE_MS) {
        goldQuote = { price, updatedAt };
      } else {
        goldQuote = null;
      }
    } catch (error) {
      goldQuote = null;
      console.warn("MMP gold refresh failed:", error);
    } finally {
      goldBusy = false;
      renderFixedCards();
    }
  }

  const originalRenderHeroCards = window.renderHeroCards;
  if (typeof originalRenderHeroCards === "function") {
    window.renderHeroCards = function () {
      const result = originalRenderHeroCards.apply(this, arguments);
      renderFixedCards();
      return result;
    };
  }
  const originalRenderTetherCard = window.renderTetherCard;
  if (typeof originalRenderTetherCard === "function") {
    window.renderTetherCard = function () {
      const result = originalRenderTetherCard.apply(this, arguments);
      renderFixedCards();
      return result;
    };
  }
  const originalGoldRefresh = window.refreshGoldQuote;
  if (typeof originalGoldRefresh === "function") {
    window.refreshGoldQuote = async function () {
      const ok = await originalGoldRefresh.apply(this, arguments);
      const saved = readGoldCache();
      const price = Number(saved?.price);
      const updatedAt = Number(saved?.updatedAt);
      goldQuote = ok && price > 0 && updatedAt > 0 && Date.now() - updatedAt <= MAX_GOLD_AGE_MS
        ? { price, updatedAt } : null;
      renderFixedCards();
      return ok;
    };
  }

  connectSocket();
  refreshRestFallback();
  refreshTether();
  refreshGold();
  renderFixedCards();

  setInterval(renderFixedCards, 2000);
  setInterval(refreshRestFallback, REST_FALLBACK_MS);
  setInterval(refreshTether, TETHER_POLL_MS);
  setInterval(refreshGold, GOLD_POLL_MS);

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const section = byId("opportunities");
    if (section && section.getBoundingClientRect().top < window.innerHeight + 650
      && typeof loadUnifiedRadarSnapshot === "function") loadUnifiedRadarSnapshot();
  }, RADAR_POLL_MS);

  window.addEventListener("online", connectSocket);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      connectSocket();
      refreshRestFallback();
      refreshTether();
      refreshGold();
    } else if (socket) {
      try { socket.close(); } catch (error) {}
    }
  });
})();