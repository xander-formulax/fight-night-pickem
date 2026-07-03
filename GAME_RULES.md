# Fight Night — Game Rules & Money Mechanics

Reference doc pulled directly from source (`lib/scoring.ts`, `lib/types.ts`, and the
`/api/*` routes) as of 2026-07-03. Two independent games run per event:

1. **Pick'em** — predict every fight, score points, split a prize pool.
2. **Stoppage Jackpot** — guess the exact stoppage time of one fight at a time, winner takes the pot.

They share an entry pool of players but have separate money flows.

---

## Game 1: Pick'em

### What a player predicts, per fight
- **Winner** — Fighter A or Fighter B
- **Method** — `KO/TKO`, `Submission`, or `Decision`
- **Round** — only if method ≠ Decision; must be between 1 and the fight's round count

A pick is "complete" only when winner + method (+ round, if applicable) are all set.

### Scoring (`lib/scoring.ts`)
Points are **only awarded if the winner pick is correct.** Get the winner wrong → 0 points for that fight, full stop (method/round points don't matter).

**1. Winner points — derived from the American odds of the fighter you picked:**
| Odds sign | Formula | Example |
|---|---|---|
| Underdog (`odds > 0`) | `winner_pts = odds` | +250 underdog correct → 250 pts |
| Favorite (`odds < 0`) | `winner_pts = round(100 / abs(odds) * 100)` | -200 favorite correct → 50 pts |
| Even (`odds == 0`) | `winner_pts = 100` | — |

This means **picking the underdog correctly is worth dramatically more** than picking the favorite. A +400 dog is worth 400 points; a -400 favorite is worth 25 points — a 16x spread for the same "correct winner" outcome.

**2. Method points — only if winner is also correct, and method matches exactly:**
| Method | Points |
|---|---|
| KO/TKO | 100 |
| Submission | 150 |
| Decision | 50 |

Submission is intentionally the highest-value method guess; Decision is the lowest (and also the "safest"/most common outcome in many cards, so it's priced down).

**3. Round points — only if winner AND method are both correct, and method ≠ Decision:**
- Exact round match → **+100 points** flat, regardless of which round or how many rounds the fight is scheduled for.

**Fight total = winner_pts + method_pts + round_pts.**

There is no partial credit anywhere in the model (no "off by one round" bonus, no partial method credit). It's all-or-nothing at each layer, gated by the layer above being correct.

### Player total
Sum of `fight_total` across every fight in the card. No fight is weighted differently from another (no "main event counts double" mechanic) — a prelim upset pick can outscore the main event if the odds/method math favors it.

### Ties
Leaderboard rank uses shared-rank logic (`computeRankMap`): tied totals share a rank (1, 2, 2, 4 …). There's no secondary tiebreaker field wired into scoring (a legacy `tiebreaker` field exists in the schema but isn't used in scoring math).

### Entry / pools
- Each event can have multiple **prize pools** ("competitions") — e.g. "$25 entry" vs "Big Money $100" — each with its own entry fee, its own prize split, and optionally multiple **entries per player** (`max_entries`, tracked via `entry_number`).
- A player's pick set is scored independently per entry; a player with 2 entries in the same pool submits two independent pick sets and both are scored/ranked normally.
- Players must be marked `paid` + `activated` by the admin before their picks count toward money (unactivated players can still submit picks, but the UI flags them as "locked until payment is confirmed").

### Prize pool math (`calcPrizePool` in leaderboard, `calcExpenseRecovery` in admin)
For each pool:
```
totalPaid = paidCount × entry_fee
expenseContrib = totalPaid × (expense_cut_pct / 100)     // this pool's contribution to the "party cost" target
basePrize = totalPaid × (1 - expense_cut_pct / 100)       // pool's own prize money before surplus
```
Then, **across all pools + the jackpot**, contributions are pooled against a single `party_cost_target` (a flat $ amount the organizer needs to recoup, e.g. venue/food cost):
```
totalExpenseContrib = Σ(pool expenseContrib) + jackpotExpenseContrib
expenseCovered = min(totalExpenseContrib, party_cost_target)
surplus        = max(0, totalExpenseContrib - party_cost_target)
```
Any surplus (money collected beyond the target) is **redistributed back into prize pools proportionally** to how much each pool/jackpot contributed:
```
poolSurplus = (pool.expenseContrib / totalExpenseContrib) × surplus
actualPrizePool = basePrize + poolSurplus
```
So `expense_cut_pct` per pool isn't a flat "house cut" — it's a *recoupment* mechanism that stops taking once the target is hit, then flows back to players as prize money. Default `expense_cut_pct` is 50%.

Prize payouts within a pool use admin-defined **place splits** (`prize_splits`: `{place, pct}[]`) — e.g. 1st = 60%, 2nd = 30%, 3rd = 10% — applied to that pool's `actualPrizePool`.

---

## Game 2: Stoppage Jackpot

Optional side game, toggled globally by the admin (`jackpot_enabled`). When on, **one fight's jackpot window is open at a time** (sequenced through the card automatically as fights complete — see Lifecycle below).

### Entry
- Flat entry fee, admin-set (`jackpot_fee`, e.g. $20), can be overridden per-fight (`stoppage_bet_fee`).
- Player picks: **Round**, **Minute** (0–4, i.e. minute_pick 1–5 internally), **Second** (0–59) — the exact clock time they think the fight stops.
- Only meaningful for fights that end early (KO/TKO/Submission); if the fight goes to Decision the jackpot **has no winner and rolls over** regardless of any picks made.
- **Picks are final at submission** — no edits, no re-picks (`stoppage-bet` route rejects a second submission from the same player for the same fight with 409).
- **Uniqueness constraint**: the exact (round, minute, second) triple can only be claimed by one player per fight — a DB unique constraint returns 409 "That exact second is already taken" on collision. This is the core scarcity mechanic: popular/likely stoppage windows (e.g. late Round 1) fill up fast, pushing later entrants toward contrarian picks.

### Winner determination — "Price Is Right" rule
Convert both the actual stoppage time and every bet to a single `totalSeconds` value:
```
seconds = (round - 1) × 300 + (minute_pick - 1) × 60 + second_pick
```
(300s = 5 min/round assumption baked into the timeline math, regardless of the fight's actual round length setting)

**Winner = the highest bet ≤ actual stoppage time.** Bets that guessed *later* than the actual stoppage are eliminated entirely — going over loses, same as the show. If no bet is ≤ actual time (everyone went over, or nobody entered), there's no winner and the pot rolls over.

### Pot math
```
potTotal = (activated_entries_this_fight × fee) × (1 - jackpot_expense_cut_pct/100) + rollover_from_previous_fights
```
- `jackpot_expense_cut_pct` (new setting, default 0%) works the same way pick'em's `expense_cut_pct` does — a cut off new entries, contributing toward the shared `party_cost_target`, with surplus flowing back into the jackpot pot.
- **A rollover amount is already net of the cut** — the cut only applies once, at the point money enters the pot, not every time it rolls forward (see `/api/jackpot-rollover`).
- Decision or no-valid-bet outcomes: the *entire* net pot (new entries this fight, net of cut, + any incoming rollover) carries to the next fight's jackpot, stacking indefinitely until someone wins.

### Lifecycle (sequential jackpot windows)
1. Event moves Setup → Open: jackpot betting opens automatically for **Fight 1** (if jackpot enabled).
2. Event moves Open → Live (Fight 1 begins): Fight 1's jackpot window **closes** — no more entries once the fight starts.
3. When Fight 1 completes and is scored: if nobody won (decision / no valid bet), the pot **rolls to Fight 2** and Fight 2's jackpot window opens automatically. If Fight 1 had a winner, the pot resets to $0 for Fight 2 and its window opens fresh.
4. Repeats fight-to-fight for the rest of the card.

So only one fight's jackpot is ever "live" for entries at a time — it's a running side-game threaded through the card, not N independent jackpots.

---

## Money flow — the two games interact through one shared target

`party_cost_target` (admin-set, e.g. $1500 for the party) is the single number both games' expense cuts are trying to collectively recoup. Contributions are proportional and any overshoot is returned to prize pools *and* the jackpot pot proportionally to how much each contributed. Setting either cut to 0% removes that pool/game from expense recovery entirely — 100% of its money either pays winners (jackpot) or funds prizes (pick'em).

---

## Levers available for analysis / optimization

If you want to go deeper on strategy or balance in a follow-up conversation, these are the tunable variables as implemented:

**Pick'em**
- `odds_a` / `odds_b` per fight (drives winner point value — asymmetric, favors underdog picks)
- Method point weights: KO/TKO=100, Submission=150, Decision=50 (fixed constants, not currently configurable per event)
- Round-match bonus: flat +100 (fixed constant)
- `expense_cut_pct` per prize pool (0–100%, default 50%)
- `prize_splits` per pool (place → % of pool)
- `max_entries` per pool (multi-entry gambling behavior)

**Stoppage Jackpot**
- `jackpot_fee` (entry cost, global default + per-fight override)
- `jackpot_expense_cut_pct` (0–100%, default 0% — new)
- Round timeline assumption: fixed 5-min/round regardless of actual scheduled round length
- Second-level scarcity (unique claim per exact second) — no configurable "bucket size" (e.g. could theoretically bucket by 5-second windows instead of 1-second)

**Shared**
- `party_cost_target` — the expense-recovery target both games contribute to and take surplus from
