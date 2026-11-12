const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("www/assets/mmp-chart-pro.js", "utf8");
const allSeries = [];
function makeSeries(options = {}) {
  return {
    options: { ...options }, data: [], visible: true,
    setData(data) { this.data = data; },
    applyOptions(options) { Object.assign(this.options, options); if (typeof options.visible === "boolean") this.visible = options.visible; }
  };
}
function makeChart() {
  return {
    addLineSeries(options) { const s = makeSeries(options); allSeries.push(s); return s; },
    addHistogramSeries(options) { const s = makeSeries(options); allSeries.push(s); return s; },
    applyOptions() {},
    timeScale() { return { fitContent() {}, setVisibleLogicalRange() {}, getVisibleLogicalRange() { return null; } }; }
  };
}
const host = { clientWidth: 600, children: [], appendChild(el) { this.children.push(el); } };
const elements = {
  tradingview_widget: host,
  "mmp-rsi-canvas": { style: {} },
  "mmp-chart-metrics": { innerHTML: "" },
  "mmp-chart-type-toggle": { textContent: "", setAttribute() {} }
};
const state = { chart: null, cache: new Map(), interval: "1h", market: "spot", showEMA: true, showVolume: true };
function baseCreate() {
  state.chart = makeChart();
  state.candles = makeSeries();
  state.volume = makeSeries();
  state.rsiChart = makeChart();
  state.rsiSeries = makeSeries();
  return true;
}
function baseRender(payload) {
  state.candles.setData(payload.candles.map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close })));
}
const window = {
  mmpCreateNativeChart: baseCreate,
  mmpRenderChart: baseRender,
  mmpSetChartInterval(value) { state.interval = value; },
  initTradingView() {},
  innerHeight: 900
};
const document = {
  hidden: false,
  getElementById(id) { return elements[id] || null; },
  createElement() { return { id: "", style: {} }; },
  querySelectorAll() { return []; }
};
const context = {
  window, document, mmpChartState: state, LightweightCharts: { createChart: makeChart },
  mmpChartSymbol() { return "BTCUSDT"; }, mmpLoadChart() {},
  clearInterval() {}, setInterval() { return 1; },
  Map, Math, Number, Array, Object, String, Date
};
vm.runInNewContext(source, context, { filename: "mmp-chart-pro.js" });
assert.equal(window.mmpCreateNativeChart(), true);
assert.ok(state.proSeries, "indicator series should initialize");

const candles = Array.from({ length: 90 }, (_, i) => {
  const close = 100 + i * 0.15 + Math.sin(i / 4);
  return { time: 1700000000 + i * 60, open: close - 0.2, high: close + 0.7, low: close - 0.8, close, volume: 1000 + i * 11 };
});
const payload = { symbol: "BTCUSDT", interval: "1h", market: "spot", candles };
state.cache.set("BTCUSDT:1h:spot", { payload });
window.mmpRenderChart(payload);
assert.equal(state.proSeries.sma20.data.length, 71, "SMA 20 should calculate over validated candles");
assert.equal(state.proSeries.sma50.data.length, 41, "SMA 50 should calculate over validated candles");
assert.match(elements["mmp-chart-metrics"].innerHTML, /RSI/);
assert.match(elements["mmp-chart-metrics"].innerHTML, /ATR/);
assert.match(elements["mmp-chart-metrics"].innerHTML, /MFI/);
assert.match(elements["mmp-chart-metrics"].innerHTML, /OBV/);

window.mmpToggleChartIndicator("bollinger");
assert.equal(state.proSeries.bbU.data.length, 71, "Bollinger upper band should be drawn when enabled");
window.mmpToggleChartIndicator("macd");
assert.ok(state.proMacd.hist.data.length > 0, "MACD histogram should render when enabled");
assert.equal(state.proMacd.el.style.display, "block");

window.mmpToggleChartType();
assert.equal(state.chartType, "heikin");
window.mmpToggleChartType();
assert.equal(state.chartType, "line");
assert.equal(state.candles.visible, false, "line mode should hide candle series");
assert.equal(state.proSeries.line.data.length, 90, "line mode should draw close-price series");
window.mmpToggleChartType();
assert.equal(state.chartType, "candles");
assert.equal(state.candles.visible, true, "candlestick mode should restore candles");

console.log("MMP Pro Chart: indicator calculations, toggles, MACD panel and chart modes passed.");
