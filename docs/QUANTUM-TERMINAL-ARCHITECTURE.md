# MMP COIN AI — Quantum Terminal v1

## Product decisions
- One compact homepage with eight specialist workspaces.
- Existing quantum M-coin brand asset is retained in www/assets/mmp-coin-mark.svg.
- Existing IRT/Toman and USDT currency controls and current USDT/IRT rate feed are retained.
- Existing data and analysis engines are preserved during the first UI migration; features are regrouped, not silently discarded.
- Root Pages mirror remains the live site. Canonical source is this repository's www/ directory.

## Eight workspaces
1. Market Command: hero, BTC/ETH/USDT/XAU snapshot, USDT/IRT rate.
2. Hunter: Radar, Spot/Futures Hunter, Momentum Lab.
3. Advanced Charting: live market chart and candle controls.
4. Smart Money & Flow: derivatives, order flow, liquidity, candle scenarios and whale tracking.
5. Quantum Intelligence: multi-layer analyzer and Quantum Core entry.
6. Trade Strategy: risk sizing and trading tools.
7. Exchanges & Markets: heatmap, asset catalog, exchange health and market hours.
8. Quantum Lab & Performance: existing Quantum Lab page.

## Removed from primary navigation
The legacy long sidebar and duplicate deep menu are replaced by the eight workspace launcher. The old underlying modules remain in the document until each module is validated inside its assigned workspace. Site-only download and contact links remain in the footer/home.

## Release gates
- Verify desktop and mobile navigation and all eight workspace entries.
- Verify IRT/USDT switch and live USDT/IRT quote.
- Verify Worker candle endpoint and rendered chart candles.
- Verify analyzer, Radar, Hunter, order-flow and exchange health behavior.
- Publish only from canonical main through the root Pages mirror workflow.
