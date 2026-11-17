# Dip-buy BTC bot — make.fun `btc-race-24h-20261117-0603`

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a
time, on $1,000 of paper money. It races live for 24 hours after the entry
deadline; this repository holds the bot that the dev window graded.

## Strategy

On 1-minute bars cbBTC is noisy (about 6 bps per minute) and a full-size
round trip costs about 26 bps in fees, slippage and price impact, so fast
signals all lose on the dev window: the kit's EMA-cross baseline loses
−$106 on 68 trades, RSI/Bollinger −$24, ADX-momentum −$33. What works is
few trades with long holds — buy a real dip and let the range pay:

- **Entry:** the close is at least 1.5% below the highest close of the last
  480 bars (8 hours), the bar closed up on the previous bar (the dip is
  turning, not still falling), and the 240-bar (4-hour) return is above −2%
  (no buying into a waterfall). One position, full cash.
- **Exit:** take profit at +1.2% over the position's cost, stop loss at
  −0.8% under it. After a sell, wait 15 bars before the next entry.
- **End of window:** no new entries in the last 20 bars, and any position
  still held is sold 30 bars before the end instead of riding the forced
  flatten.

Everything is integer arithmetic (bigint closes, costs and values), so two
executions on the same data produce the same orders. No network, no wall
clock, no files outside the repository, no randomness.

## Dev-window grade (local, `grade-local --driver process`)

| Bot | Net PnL | Trades | Max drawdown |
| --- | --- | --- | --- |
| **dip-buy (this bot)** | **+$29.32** | 6 | 0.76% |
| momentum (best baseline) | +$2.45 | 1 | 2.12% |
| buy-and-hold | +$1.07 | 1 | 2.12% |
| hold-cash | $0.00 | 0 | 0% |
| rsi-bollinger | −$24.25 | 11 | 2.79% |
| adx-momentum | −$32.66 | 26 | 3.60% |
| ema-cross | −$106.21 | 68 | 10.96% |

Fees $2.44; at 2x fees the net PnL is still +$26.86. Guardrails met
(≥1 trade, drawdown ≤ 25%). The L1 regrade reproduces the run byte for
byte. The parameter neighbourhood is flat: 79 of 81 nearby combinations
(dip 1.2–1.8%, lookback 360–600, take-profit 1.0–1.6%, stop 0.6–1.2%) are
profitable on the dev window, median +$10.63 — the edge is the rule, not
one tuned number.

## Grade it yourself

From the unpacked kit directory (docker is the server's sandbox; `process`
runs the Node bot on this machine, unisolated, and is the documented
fallback when docker is unavailable):

```
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `LICENSE` — MIT
- `.makefun/owner.json` — payout wallet that owns this entry
