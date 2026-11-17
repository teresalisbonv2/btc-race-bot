// Dip-buy bot for the make.fun BTC race (agent-fun/bars-replay/v1).
//
// Idea: on 1-minute bars the asset is noisy (about 6 bps per minute) and a
// full-size round trip costs about 26 bps in fees, slippage and impact, so
// fast signals (EMA crosses, RSI/Bollinger, breakouts) all lose money on the
// dev window. What works is few trades with long holds: buy a real dip and
// let the range pay. The rules, all in integer arithmetic so two runs agree
// byte for byte:
//
//   - Entry: the close is at least 1.5% below the highest close of the last
//     480 bars (8 hours), the bar closed up on the previous bar (the dip is
//     turning, not still falling), and the 240-bar (4-hour) return is above
//     -2% (no buying into a waterfall). One position, full cash.
//   - Exit: take profit at +1.2% over the position's cost, stop loss at
//     -0.8% under it. After a sell, wait 15 bars before the next entry.
//   - No new entries in the last 20 bars, and any position still held is
//     sold 30 bars before the end instead of riding the forced flatten:
//     exiting on your own terms beats being sold at whatever the last
//     close is.
//
// On the dev window this grades at +$29.32 net PnL on 6 trades with a
// 0.76% maximum drawdown (local grade; see README.md). The parameter
// neighbourhood is flat: 79 of 81 nearby combinations are profitable, so
// the edge is the rule, not one tuned number.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Rolling-high window for the dip: 480 one-minute bars (8 hours). */
const LOOKBACK_BARS = 480;
/** Buy when the close is this far below the rolling high, in bps. */
const DIP_BPS = 150;
/** 4-hour return window for the downtrend guard. */
const TREND_BARS = 240;
/** Skip a dip-buy when the 4-hour return is below this, in bps. */
const TREND_MIN_BPS = -200;
/** Take profit, in bps over the position's cost. */
const TP_BPS = 120;
/** Stop loss, in bps under the position's cost. */
const SL_BPS = 80;
/** Bars to wait after a sell before the next entry. */
const COOLDOWN_BARS = 15;
/** No new entries once this many bars of history have been seen. */
const LAST_ENTRY_BAR = 1420;
/** Sell any position still held once this many bars have been seen. */
const END_EXIT_BAR = 1410;
/** Slippage cap per order, in bps from the latest close. */
const MAX_SLIPPAGE_BPS = 100;

/** Raw closes seen so far (price_scale units), oldest first. */
const closes: bigint[] = [];
/** Bars remaining in the post-sell cooldown. */
let cooldown = 0;

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) closes.push(BigInt(bar.c));
    if (state.warmingUp || bar === undefined) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      // Take profit at +TP_BPS over cost, stop loss at -SL_BPS under it,
      // or exit on your own terms shortly before the forced flatten.
      if (
        value * 10_000n >= held.cost * BigInt(10_000 + TP_BPS) ||
        value * 10_000n <= held.cost * BigInt(10_000 - SL_BPS) ||
        closes.length >= END_EXIT_BAR
      ) {
        cooldown = COOLDOWN_BARS;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (cooldown > 0) {
      cooldown -= 1;
      return [];
    }
    if (closes.length < LOOKBACK_BARS || closes.length > LAST_ENTRY_BAR) return [];

    const close = closes[closes.length - 1]!;
    const prev = closes[closes.length - 2]!;
    // Highest close of the last LOOKBACK_BARS bars, current bar included.
    let high = 0n;
    for (let i = closes.length - LOOKBACK_BARS; i < closes.length; i++) {
      if (closes[i]! > high) high = closes[i]!;
    }
    // Dip: at least DIP_BPS below the rolling high.
    if (close * 10_000n > high * BigInt(10_000 - DIP_BPS)) return [];
    // Reversal: the dip is turning up, not still falling.
    if (close <= prev) return [];
    // Downtrend guard: the 4-hour return is not worse than TREND_MIN_BPS.
    const fourHourAgo = closes[closes.length - 1 - TREND_BARS]!;
    if (close * 10_000n < fourHourAgo * BigInt(10_000 + TREND_MIN_BPS)) return [];

    const notional = state.cash < state.weightRoom(SYMBOL) ? state.cash : state.weightRoom(SYMBOL);
    if (notional === 0n || notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
