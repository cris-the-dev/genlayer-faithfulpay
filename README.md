# FaithfulPay — translation escrow paid when the translation is faithful

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A client who orders a translation into a language they cannot read has no way
to tell whether a paragraph was dropped or a number changed. Freelance
platforms settle that with a support ticket weeks later. **FaithfulPay** puts
the fee in escrow and lets GenLayer validators check the delivered
translation against the source: nothing left out, nothing changed, the right
language, the required terms used. A faithful translation is paid in the same
transaction; otherwise the translator gets a list of issues to fix, up to
three attempts, and then the client is refunded.

```
client     ── create_job(translator, source_url, source_sha256, language, terms, days) + fee ─▶ FaithfulPay
              validators fetch the source now: it must match its hash and fit 12,000 characters
translator ── submit(job, url, sha256)
              validators fetch both pages, check both hashes, check required terms by text, then
              agree on the exact issue list: omission, mistranslation, wrong_language, missing_term:<n>
              []      ─▶ PAID: fee to the translator; translation url + sha256 stored on the job
              issues  ─▶ recorded; fix and resubmit (3 attempts)
anyone     ── refund(job) after the 3rd rejected attempt or the deadline ─▶ REFUNDED: fee to the client
translator ── decline(job) ─▶ REFUNDED
anyone     ── settle_payout(payout, tx, finalize_tx) / payee ── recover(to)
```

No waiting windows: a submission is judged and paid when it is decided.

## Live deployment

App: https://faithfulpay.cristhedev.com (jobs, submissions with their issues, translator records and every role's actions; source in [`app/`](app/))  
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): [`0xBB122Fc6Ca64Dcfa9759bEFfd1C912cA7f9E72bb`](https://explorer-bradbury.genlayer.com/address/0xBB122Fc6Ca64Dcfa9759bEFfd1C912cA7f9E72bb)

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) on Bradbury Phase 2 (all checks passed). Contract `0xBB122Fc6Ca64Dcfa9759bEFfd1C912cA7f9E72bb` (deploy [`0x126e56e0…`](https://explorer-bradbury.genlayer.com/tx/0x126e56e067d99c33c55bfba889bd1418ed4e3b6bd76747a6c0ee0af30db28e93)), code `build/faithful_pay.py` (sha256 `e12b7065…`). Client and translator are separate accounts. Pages are served from [`evidence/`](evidence/) and pinned by hash. The leader's notes (not part of consensus): on the draft, "The instruction about running the cold tap for five minutes before drinking when water returns is omitted from the translation."; on the fix, "No omissions, mistranslations, or language errors found; the translation is faithful and in Vietnamese."

| Step | Transaction | Outcome |
|---|---|---|
| create a job with a stale source hash | [`0xe81d9489…`](https://explorer-bradbury.genlayer.com/tx/0xe81d9489556c991c529b912a7a9ca53a5b531d1127b161ed5b62f54d32673382) | reverts: source does not match its sha256 |
| create a job naming oneself as translator | [`0xf0774cfb…`](https://explorer-bradbury.genlayer.com/tx/0xf0774cfb03d5593841614b553ba1afdc8a9fc33bc20702f7c6652cdb32d9c866) | rejected: the translator must be someone else |
| create job #0: fee 0.001 GEN, into Vietnamese, terms "Hill Street", "20" | [`0xd8225b57…`](https://explorer-bradbury.genlayer.com/tx/0xd8225b5720327c6b7acf6c665f98f1bce6a0adad2e0edfb42e399fc0a7bfe77a) | ok: fee escrowed, source pinned |
| the client tries to submit | [`0x433c2596…`](https://explorer-bradbury.genlayer.com/tx/0x433c25963d7b68693f03f5663784df58990b26f611429f910ae068b10d998b5b) | rejected: translator only |
| submit the draft (one paragraph missing) | [`0xbba3ff8e…`](https://explorer-bradbury.genlayer.com/tx/0xbba3ff8e253c7f83274fe301a0550040f3143dac9ca030d8a3d09e3e4a494506) | `["omission"]`; 2 attempts left |
| submit a page changed after hashing (14:00 → 16:00) | [`0x96c9d996…`](https://explorer-bradbury.genlayer.com/tx/0x96c9d996c7324a5bed758072ac72269b95a8388034ece1a54a05bc86fd6cd5db) | reverts: translation does not match its sha256; no attempt used |
| submit the fixed translation | [`0x1ded1a94…`](https://explorer-bradbury.genlayer.com/tx/0x1ded1a94c3ded2bb65b1e61b06abae4096982dd866f935cd93a649199581bda1) | **`[]`: PAID**, fee to the translator = payout 0; translation hash stored |
| submit again | [`0x3dbbd45f…`](https://explorer-bradbury.genlayer.com/tx/0x3dbbd45f910417e607c58bfe7fe2cc663146fba21b6cd6d197a0dd4618487834) | rejected: job is PAID |
| create job #1: fee 0.0001 GEN | [`0x7ab8a931…`](https://explorer-bradbury.genlayer.com/tx/0x7ab8a93107e26d9c115f03b1bf3c113c9c712ec255226d8272011650aa8a7e6f) | ok |
| the client tries to decline | [`0x418dcb23…`](https://explorer-bradbury.genlayer.com/tx/0x418dcb23274f261af72e93bda27283cfcba6fcf0431fc8cbb0134e4de81ed6d4) | rejected: translator only |
| the translator declines | [`0x23890cd0…`](https://explorer-bradbury.genlayer.com/tx/0x23890cd067d6942f426ad3b3a514e431c77aecd8fcb25728c51a52d8512e9348) | REFUNDED: fee to the client = payout 1 |

Translator record afterwards: 1 paid, 0 rejected. Both payouts were settled from their own transfer once the paying transaction finalized:

| Payout | Kind | Paid by | Finalized by | `settle_payout` | Result |
|---|---|---|---|---|---|
| 0 | fee → translator | [`0x1ded1a94…`](https://explorer-bradbury.genlayer.com/tx/0x1ded1a94c3ded2bb65b1e61b06abae4096982dd866f935cd93a649199581bda1) | [`0x16aaf26c…`](https://explorer-bradbury.genlayer.com/tx/0x16aaf26ce17cf9c65e0056840f7c7482920d1b344cb80df0d68a10be0b183047) | [`0x91150b23…`](https://explorer-bradbury.genlayer.com/tx/0x91150b23747adc4a81765a241c2b269b5d3dd5e7f992c94176bfe3ab47b5ae71) | DELIVERED |
| 1 | refund → client | [`0x23890cd0…`](https://explorer-bradbury.genlayer.com/tx/0x23890cd067d6942f426ad3b3a514e431c77aecd8fcb25728c51a52d8512e9348) | [`0x05eb42bc…`](https://explorer-bradbury.genlayer.com/tx/0x05eb42bcd8610d7e3d441b5d3312ef5904a0c51fcc1745121ce35f1f55f4675f) | [`0x344aca75…`](https://explorer-bradbury.genlayer.com/tx/0x344aca75913c5773c38a66d24ba5c3fcd48decd4c8a18cb08ce58ad4c5706652) | DELIVERED |

Settling the same payout again is rejected ([`0x7d9b1d96…`](https://explorer-bradbury.genlayer.com/tx/0x7d9b1d96418f48179369b2bb30cb811e10f1d42e1e4079a19be830e168a45eef), [`0x54b9ece7…`](https://explorer-bradbury.genlayer.com/tx/0x54b9ece797bf366d0920af873615d883714b00b6177392cbc5ccdccae414d69e)). Afterwards `get_accounting` reports `unaccounted: 0.002` GEN: exactly the value attached to the two reverted `create_job` transactions. On Bradbury a reverted payable transaction leaves its value in the contract; the contract never recorded it, so no one can withdraw it, and the E2E counts it explicitly.

## How a translation is judged

1. **Pinned pages.** The client gives the source's SHA-256 when posting the
   job and validators check it then, so a job only exists for a source that
   is reachable and pinned. The translator gives the translation's SHA-256
   when submitting. Each validator fetches both pages and checks the bytes. A
   page that changed or cannot be fetched reverts the submission: nothing is
   recorded and no attempt is used. The paid translation's URL and hash stay
   on the job, so what was paid for is fixed even if the page changes later.
2. **Whole pages only.** Visible text (scripts and styles removed, entities
   decoded, inline tags joined) over 12,000 characters is refused, never cut:
   a translation is never judged on part of its text. The source is checked
   at `create_job`, so a client learns that before paying.
3. **Required terms are text, not judgment.** Each required term must appear
   in the translation's text (ignoring case, spacing, quote marks and dash
   style). A missing one is `missing_term:<index>`, decided without the LLM.
4. **Three narrow questions.** The LLM sees the source, the translation and
   the target language, fenced as data, and answers booleans: is anything of
   the source missing (`omission`), does anything say something different
   (`mistranslation`), is it in the wrong language (`wrong_language`)? Style
   and word choice do not count.
5. **Consensus on the issue list.** Every validator re-derives the full list
   from its own fetch and LLM call and accepts the leader's result only if the
   list is identical: the same issues lead to the same state. The leader's
   one-sentence note is stored and labelled unverified. The same fetch error
   is agreed on only when a validator reproduces it; an LLM error never is.

## Where the money goes

- The fee is escrowed per job at `create_job` and leaves only one way:
  - **PAID:** to the translator, on a submission with no issues.
  - **REFUNDED:** to the client, by `refund` after the third rejected attempt
    or after the deadline (anyone may call), or by the translator's `decline`.
- A rejected submission pays nothing and uses one attempt. A reverted one
  (hash mismatch, page unavailable, LLM error) uses none.
- `submit` only ever pays the translator and `refund`/`decline` only the
  client, so each paying transaction has one payee.
- Each translator's record (`get_translator`) counts jobs paid and jobs
  refunded after three rejections.

## Payments and settlement

Every transfer is a recorded payout (with its sender and creation time). A
payout is judged by its own transfer, never by the contract balance:
`settle_payout(payout_id, tx_hash, finalize_tx)` has validators read the paying
transaction (it must be this contract's `submit`, `refund`, `decline` or
`recover` call for that job, sent by the recorded sender at the recorded time,
and finalized with a successful result) and the consensus transaction that
finalized it, and check that the transfer to the payee was executed. Delivered
payouts are marked `DELIVERED`; a failed one is `FAILED` and its amount becomes
recoverable by the payee (by the sender, for a failed `recover`), who sends it
anywhere with `recover`. One paying transaction settles at most one payout,
and a sender can create one payout per second. `get_payouts(start, limit,
only_unsettled)` pages through payouts. `get_accounting` (balance vs.
`expected_balance`) is informational only.

## Limits

- Validators judge faithfulness, not quality: a stiff but complete and correct
  translation is paid. A client who wants style review needs a human.
- Pages are fetched as served (no JavaScript rendering); the translator should
  publish a plain page and keep it unchanged until the submission is decided.
- The translator's address is fixed at `create_job`; there is no open bidding.

## The app

https://faithfulpay.cristhedev.com ([`app/`](app/)) reads the **finalized**
state and treats a write as done only when it is `FINALIZED` with
`FINISHED_WITH_RETURN` **and** reading the contract back shows the change.
Each job shows its pinned source, required terms, attempts, every submission
with its issue codes (terms named) and the leader's note labelled unverified.
Submit appears only for the translator, with attempts left and before the
deadline; refund only when the contract reports `refundable`. "Fill hash"
computes a page's SHA-256 in the browser where the site allows it, otherwise
`curl -s URL | shasum -a 256`. GEN amounts use BigInt only. "Settle" finds the
paying transaction and looks up its finalization from the
`TransactionFinalized` log. `node app/check-actions.mjs app/index.html` (CI)
asserts the controls per role and job state and exact money formatting.

## API

| Method | Who | Notes |
|---|---|---|
| `create_job(translator, source_url, source_sha256, language, terms_json, days)` payable | client | fee = `msg.value`; terms: JSON list, ≤ 20; days 1–90; fetches the source |
| `submit(job_id, url, sha256)` | translator | before the deadline, ≤ 3 attempts; returns the issue list (`[]` = paid) |
| `decline(job_id)` / `refund(job_id)` | translator / anyone | refund after 3 rejected attempts or the deadline |
| `settle_payout(payout_id, tx_hash, finalize_tx)` / `recover(to)` | anyone / payee | |
| `get_job`, `get_jobs(start, limit)`, `get_submission`, `get_submissions(job_id or -1, start, limit)`, `get_translator(addr)`, `get_payout`, `get_payouts(start, limit, only_unsettled)`, `get_accounting`, `get_recoverable` | view | |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/faithful_pay.py
pytest tests/direct -v                         # 32 tests
# end-to-end on Bradbury Phase 2, against the packed code (keys in GL_PK0, GL_PK1)
python deploy/shrink.py contracts/faithful_pay.py build/faithful_pay.py --pack
npm i genlayer-js@2.0.0-rc.2   # plus the fee-estimate patch in app/README.md
node tests/integration/bradbury.mjs build/faithful_pay.py
```

Bradbury rejects deploys above ~20 KB of code; deploy the output of
`deploy/shrink.py` (AST-checked, 29.9 KB → 8.3 KB packed). CI re-runs all
direct tests against the packed code. The pages the E2E uses are in
[`evidence/`](evidence/), served byte for byte at
`https://faithfulpay.cristhedev.com/evidence/`.

## Tests (32 direct, Bradbury E2E)

- **Jobs** — the fee is escrowed; the source is fetched at creation (wrong hash, 404, over 12,000 characters rejected); input validation; no job for oneself.
- **Judging** — a faithful translation is paid and its URL and hash stored; an omission is listed and a fixed resubmission is paid; required terms checked by text (missing one listed even when the LLM finds nothing; markup and case ignored); three rejections then a refund, no fourth attempt.
- **Pinning** — a wrong translation hash, a translation changed after hashing and a source changed after the job was posted all revert and use no attempt.
- **Roles and deadline** — only the translator submits or declines; refund rejected before the deadline (to the second) and allowed after; no submission after it; no payout beyond the contract balance.
- **Settlement** — delivered and failed payments, recovery to another address; wrong method, args, sender, time, result, or a transaction that sent nothing are rejected and the payout stays `SENT`.
- **Consensus (validator replay)** — agreement on the issue list, disagreement when a validator finds an omission, the note outside consensus, forged payloads rejected, an LLM error reverts and is never agreed.
- **App** — `check-actions.mjs`: controls per role and job state, refund only when refundable, issue codes and terms named, escaping, exact GEN amounts beyond 2^53.

## License

MIT
