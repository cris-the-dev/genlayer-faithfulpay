# FaithfulPay — translation escrow paid when the translation is faithful

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A client who orders a translation into a language they cannot read has no way
to tell whether a paragraph was dropped or a number changed. Freelance
platforms settle that with a support ticket weeks later. **FaithfulPay** puts
the fee in escrow and lets GenLayer validators check the delivered
translation against the source: nothing left out, nothing changed, the right
language, the required terms used. A long document is split into up to ten
sections, each pinned and paid on its own: a faithful section is paid in the
same transaction; otherwise the translator gets a list of issues to fix, up to
three attempts per section, and then that section is refunded. A client who
has no translator yet posts an open job, and picks one of the applicants by
their on-chain record.

```
client     ── create_job(translator or "", [[url, sha256], …], language, terms, days) + fee ─▶ FaithfulPay
              validators fetch every source now: each must match its hash and fit 12,000 characters
              fee splits equally per section; no translator ─▶ OPEN
translator ── apply(job) / withdraw_application(job)           (OPEN, up to 20 applicants)
client     ── assign(job, applicant) ─▶ ASSIGNED, the days start now   |   cancel(job) ─▶ REFUNDED
translator ── submit(section, url, sha256)
              validators fetch both pages, check both hashes, check required terms by text, then
              agree on the exact issue list: omission, mistranslation, wrong_language, missing_term:<n>
              []      ─▶ section PAID: its share to the translator; url + sha256 stored
              issues  ─▶ recorded; fix and resubmit (3 attempts per section)
              every section settled ─▶ DONE (REFUNDED if none was paid)
anyone     ── refund(job): sections out of attempts, or every unpaid one after the deadline ─▶ to the client
translator ── decline(job): every unpaid section back to the client; paid ones stay paid
anyone     ── settle_payout(payout, tx, finalize_tx) / payee ── recover(to)
```

No waiting windows: a submission is judged and paid when it is decided.

## Live deployment

App: https://faithfulpay.cristhedev.com (jobs, sections, applicants, submissions with their issues, translator records and every role's actions; source in [`app/`](app/))  
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): [`0x2185071D4F99bfFcD8F1EA613546bd5CFe83eb39`](https://explorer-bradbury.genlayer.com/address/0x2185071D4F99bfFcD8F1EA613546bd5CFe83eb39)

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) on Bradbury Phase 2 (all checks passed). Contract `0x2185071D4F99bfFcD8F1EA613546bd5CFe83eb39` (deploy [`0x58b5bc29…`](https://explorer-bradbury.genlayer.com/tx/0x58b5bc295507e7be1990f363046802744d6c682703974b6781ccfe8803ead3f0)), code `build/faithful_pay.py` (sha256 `4a9feeea…`). Client, translator and a second applicant are separate accounts. Pages are served from [`evidence/`](evidence/) and pinned by hash. The leader's note on the draft (not part of consensus): "Two source sentences about cloudy water and running the tap are missing." (The run lost its RPC connection after the client's rejected decline; it was resumed on the same contract from the next step.)

| Step | Transaction | Outcome |
|---|---|---|
| create a job whose second source has a stale hash | [`0xacf3a4cd…`](https://explorer-bradbury.genlayer.com/tx/0xacf3a4cd713e4a1757d81c16a195bb6967f2ce9e426ab96e46dc4e33dffdc2b0) | reverts: source 1 does not match its sha256 |
| create a job naming oneself as translator | [`0xecb1df95…`](https://explorer-bradbury.genlayer.com/tx/0xecb1df95119122de873826ded4983f26e352b936c6344fb6731fa57f834016fe) | rejected: the translator must be someone else |
| create with a fee that does not split equally (+1 wei) | [`0x317904d2…`](https://explorer-bradbury.genlayer.com/tx/0x317904d2c0bfc3ba34b5cbca9bdca38179cc2d72f71e0ff505cbba4598ed535d) | rejected |
| create job #0: two sections, fee 0.001 GEN, into Vietnamese, terms "Hill Street", "20" | [`0x46121416…`](https://explorer-bradbury.genlayer.com/tx/0x46121416259f720d8157ebb90b278865f7df02ac9cb2b4fbd26208989467c26d) | ok: 0.0005 GEN per section, both sources pinned |
| the client tries to submit | [`0xd9a03c2b…`](https://explorer-bradbury.genlayer.com/tx/0xd9a03c2bcdb49e212266d1f8bf2e544637df8feb651e4f2cd37e0a0a75747e03) | rejected: translator only |
| submit a draft of section 1 (one paragraph missing) | [`0xa336a8f5…`](https://explorer-bradbury.genlayer.com/tx/0xa336a8f573472c584cead583177c3c7a0a490a78b049c21faf4efd75a3881d7a) | `["omission"]`; 2 attempts left, nothing paid |
| submit a page changed after hashing | [`0x3f09e4c5…`](https://explorer-bradbury.genlayer.com/tx/0x3f09e4c5aa9e5ca91f16bf939b1a51b51cdd25f9c6bb1c297e011d7a7d515b66) | reverts; no attempt used |
| submit the fixed section 1 | [`0x90bf473e…`](https://explorer-bradbury.genlayer.com/tx/0x90bf473e10681faee66b265b462a74008a1608009a2d1a99cfb2ab82f94cb271) | **`[]`: section 1 PAID** alone = payout 0; section 2 still open |
| submit section 1 again | [`0xc2be23d7…`](https://explorer-bradbury.genlayer.com/tx/0xc2be23d779b2ea197a9369abbf04a887ad032794c915d2590f27b24aa6b06d3c) | rejected: section is PAID |
| submit section 2 | [`0x5063a388…`](https://explorer-bradbury.genlayer.com/tx/0x5063a388dc24aecd22d231ba7db4f8ff3c9f3a795337ddcbb626171b0ebf5779) | **`[]`: section 2 PAID** = payout 1; job DONE |
| create open job #1 (no translator), 0.0001 GEN | [`0x9d35fdef…`](https://explorer-bradbury.genlayer.com/tx/0x9d35fdefa5f2c843fd05a86373ea952bb4d0ff7e52fc498b6341afb100d93283) | ok: OPEN |
| the client tries to apply | [`0x35516abf…`](https://explorer-bradbury.genlayer.com/tx/0x35516abf89c740960c11a3676e288c7eb26ba2251db86c1677d4a3d612a2773b) | rejected |
| translator applies | [`0x9fd308fa…`](https://explorer-bradbury.genlayer.com/tx/0x9fd308faf8f5593b87dba2af4bb9bca10118d8d8aeaa10b2341cdceb21130c7a) | ok, with their record (2 paid) |
| a second translator applies, then withdraws | [`0x38daa947…`](https://explorer-bradbury.genlayer.com/tx/0x38daa947abfab092c3b6cee54542df24f7ddfaf038c7e1352afbc23cd6f1a056), [`0x6f3c31b0…`](https://explorer-bradbury.genlayer.com/tx/0x6f3c31b04e233b1a47eda50ec1148411c5e2404bd34b93155c477330480e255e) | ok: one applicant left |
| the translator tries to assign | [`0xb6b35e23…`](https://explorer-bradbury.genlayer.com/tx/0xb6b35e23ed01b9f00163bef08e51f5c19aafbabebd715a1884b23c969283a0c6) | rejected: client only |
| the client assigns someone who did not apply | [`0x6941c581…`](https://explorer-bradbury.genlayer.com/tx/0x6941c581c46c3afe871741cd7aed3d5eb3d7980064c2bc67f6a910f3040ede02) | rejected |
| the client assigns the applicant | [`0x1832e763…`](https://explorer-bradbury.genlayer.com/tx/0x1832e763ba881490be7a6fb88840bdd6e25d24e7ecff71dd79028619458c4018) | ASSIGNED; the deadline starts now |
| the client tries to decline | [`0x3c9211d9…`](https://explorer-bradbury.genlayer.com/tx/0x3c9211d97545beccc11af5c122122421b8dba371c1ff6d9a677f8f764d5ce220) | rejected: translator only |
| the translator declines | [`0x6237fc11…`](https://explorer-bradbury.genlayer.com/tx/0x6237fc11ca0ab8d04ac16c2f237b223df34be389ab68e805464fc8b59c9fc7dc) | REFUNDED to the client = payout 2 |
| create open job #2, 0.0001 GEN | [`0x68ef2e98…`](https://explorer-bradbury.genlayer.com/tx/0x68ef2e98dc84d652a1209e6b2dbe0cf7cd95756c76f0384fd54fd1a4ea389da9) | ok: OPEN |
| the translator tries to cancel it | [`0xc90c445a…`](https://explorer-bradbury.genlayer.com/tx/0xc90c445adfa1867ad38a673d34d478e8aa574e0ff9dc4ee2a69d7a9b4968401a) | rejected: client only |
| the client cancels | [`0xc7226fbb…`](https://explorer-bradbury.genlayer.com/tx/0xc7226fbb17046b1cfef6b1c9571b789f93a1ab31c0153d192208b59217a176d8) | REFUNDED to the client = payout 3 |

Translator record afterwards: 2 paid, 0 rejected. Every payout was settled from its own transfer once the paying transaction finalized:

| Payout | Kind | Paid by | Finalized by | `settle_payout` | Result |
|---|---|---|---|---|---|
| 0 | fee → translator (section 1) | [`0x90bf473e…`](https://explorer-bradbury.genlayer.com/tx/0x90bf473e10681faee66b265b462a74008a1608009a2d1a99cfb2ab82f94cb271) | [`0xccb2f3ee…`](https://explorer-bradbury.genlayer.com/tx/0xccb2f3ee89767aa9d842131c9c8d08883ed30e344c994c781d4e9b03ec738de7) | [`0xc0ea26bd…`](https://explorer-bradbury.genlayer.com/tx/0xc0ea26bd47a67a1d6fd291c66c5631627e1072a347391cbdaa738438d8dc37fc) | DELIVERED |
| 1 | fee → translator (section 2) | [`0x5063a388…`](https://explorer-bradbury.genlayer.com/tx/0x5063a388dc24aecd22d231ba7db4f8ff3c9f3a795337ddcbb626171b0ebf5779) | [`0x79f4c40a…`](https://explorer-bradbury.genlayer.com/tx/0x79f4c40ab5cb6cfb3177c0826889bea92fba48187cfbfcae9e985d23337d4dad) | [`0xa7454429…`](https://explorer-bradbury.genlayer.com/tx/0xa745442986eea78db6303e1df75fab5070943c2c357f07ff43b3e6d61458a62b) | DELIVERED |
| 2 | decline → client | [`0x6237fc11…`](https://explorer-bradbury.genlayer.com/tx/0x6237fc11ca0ab8d04ac16c2f237b223df34be389ab68e805464fc8b59c9fc7dc) | [`0x2117067c…`](https://explorer-bradbury.genlayer.com/tx/0x2117067ca6c5b08b457fc83b0713f1b71f650d046a03ca7279c0d34e1c381db9) | [`0x309a4201…`](https://explorer-bradbury.genlayer.com/tx/0x309a4201f939c4c944d357d464ad301f9879ab0012fdac9e35f10d57c9c6beae) | DELIVERED |
| 3 | cancel → client | [`0xc7226fbb…`](https://explorer-bradbury.genlayer.com/tx/0xc7226fbb17046b1cfef6b1c9571b789f93a1ab31c0153d192208b59217a176d8) | [`0x6205f41f…`](https://explorer-bradbury.genlayer.com/tx/0x6205f41fbc5a3f42051693cb4d74e1760e9df33baa17f2db39dbc13ed187b45e) | [`0x5a40891d…`](https://explorer-bradbury.genlayer.com/tx/0x5a40891dbf39d3065b085f530d1ff5cfe012cc0618013b41e1b56d373aae0a50) | DELIVERED |

Settling the same payout again is rejected ([`0x900dee6e…`](https://explorer-bradbury.genlayer.com/tx/0x900dee6e579ab942e3a6d096c2c678a4268fffcf93eac02ec522281394a57fe7), [`0x95774ec2…`](https://explorer-bradbury.genlayer.com/tx/0x95774ec2cf0ebe99c4dc9e0ae68757e298cf336a824d9b957b12ef9085d31a40), [`0x949f3b51…`](https://explorer-bradbury.genlayer.com/tx/0x949f3b51e3576ebf765f4e087a04abdb7d373ccb07a48e55d2f2d9930d355369), [`0x6755bb35…`](https://explorer-bradbury.genlayer.com/tx/0x6755bb35e4d07009fc491843d7fe6ab568fc245350e488e1c1452b1fdce240ee)). Afterwards `get_accounting` reports `unaccounted: 0.003000000000000001` GEN: exactly the value attached to the three rejected `create_job` transactions. On Bradbury a reverted payable transaction leaves its value in the contract; the contract never recorded it, so no one can withdraw it, and the E2E counts it explicitly.

v1 (single-section jobs, assigned only) is tagged `v1.0.0`; its evidence is in that tag's README.

## How a translation is judged

1. **Pinned pages.** The client gives the source's SHA-256 when posting the
   job and validators check it then, so a job only exists for a source that
   is reachable and pinned. The translator gives the translation's SHA-256
   when submitting. Each validator fetches both pages and checks the bytes. A
   page that changed or cannot be fetched reverts the submission: nothing is
   recorded and no attempt is used. The paid translation's URL and hash stay
   on the section, so what was paid for is fixed even if the page changes later.
   Each section is judged against its own source only.
2. **Whole pages only.** Visible text (scripts and styles removed, entities
   decoded, inline tags joined) over 12,000 characters is refused, never cut:
   a translation is never judged on part of its text. Every source is checked
   at `create_job`, so a client learns that before paying; a longer document
   is posted as several sections (up to ten), each a page of its own.
3. **Required terms are text, not judgment.** A required term found in a
   section's source must appear in that section's translation (ignoring case,
   spacing, quote marks and dash style); a section whose source never uses it
   is not asked for it. A missing one is `missing_term:<index>`, decided
   without the LLM.
4. **Three narrow questions.** The LLM sees the source, the translation and
   the target language, fenced as data, and answers booleans: is anything of
   the source missing (`omission`), does anything say something different
   (`mistranslation`), is it in the wrong language (`wrong_language`)? Style
   and word choice do not count. It first lists each source sentence with no
   counterpart; any listed sentence is an omission, so a model that finds a gap
   cannot still answer "nothing missing".
5. **Consensus on the issue list.** Every validator re-derives the full list
   from its own fetch and LLM call and accepts the leader's result only if the
   list is identical: the same issues lead to the same state. The leader's
   one-sentence note is stored and labelled unverified. The same fetch error
   is agreed on only when a validator reproduces it; an LLM error never is.

## Where the money goes

- The fee is escrowed per job at `create_job` and must split equally between
  its sections. Each section's share leaves only one way:
  - **PAID:** to the translator, on a submission for that section with no issues.
  - **REFUNDED:** to the client, by `refund` (anyone may call) once the section
    has three rejected attempts or the deadline has passed, by the
    translator's `decline`, or by the client's `cancel` while no one is assigned.
- `refund` and `decline` take only what is due: sections already paid stay
  paid, and a section that still has attempts and time is left alone.
- A rejected submission pays nothing and uses one attempt of its section. A
  reverted one (hash mismatch, page unavailable, LLM error) uses none.
- `submit` only ever pays the translator and `refund`/`decline`/`cancel` only
  the client (one transfer for all the sections it closes), so each paying
  transaction has one payee.
- Each translator's record (`get_translator`) counts sections paid and
  sections refunded after three rejections; a client sees it for every
  applicant before assigning.

## Payments and settlement

Every transfer is a recorded payout (with its sender and creation time). A
payout is judged by its own transfer, never by the contract balance:
`settle_payout(payout_id, tx_hash, finalize_tx)` has validators read the paying
transaction (it must be this contract's `submit` for that section, or its
`refund`, `decline`, `cancel` or `recover` call for that job, sent by the recorded sender at the recorded time,
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
- An open job takes applications, not bids: the price is the client's. The
  deadline starts at assignment; an applicant who is never assigned is not
  paid for waiting, and the client can cancel until someone is assigned.
- Sections are split by the client. A sentence cut across two pages is judged
  on each side separately.

## The app

https://faithfulpay.cristhedev.com ([`app/`](app/)) reads the **finalized**
state and treats a write as done only when it is `FINALIZED` with
`FINISHED_WITH_RETURN` **and** reading the contract back shows the change.
Each job shows its sections (pinned source, status, attempts, the paid
translation), required terms, applicants with their records, every submission
with its section, issue codes (terms named) and the leader's note labelled
unverified. On an open job others apply or withdraw, and the client assigns an
applicant or cancels. Submit appears per section only for the translator, with
attempts left and before the deadline; decline and refund show the amount the
contract would return, refund only when the contract reports `refundable`.
The post form takes one `URL SHA-256` line per section and an optional
translator. "Fill hash"
computes a page's SHA-256 in the browser where the site allows it, otherwise
`curl -s URL | shasum -a 256`. GEN amounts use BigInt only. "Settle" finds the
paying transaction and looks up its finalization from the
`TransactionFinalized` log. `node app/check-actions.mjs app/index.html` (CI)
asserts the controls per role, job and section state and exact money formatting.

## API

| Method | Who | Notes |
|---|---|---|
| `create_job(translator, sources_json, language, terms_json, days)` payable | client | sources: JSON list of 1–10 `[url, sha256]`, one per section; fee = `msg.value`, split equally; translator `""` = open job; terms: JSON list, ≤ 20; days 1–90; fetches every source |
| `apply(job_id)` / `withdraw_application(job_id)` | anyone but the client | open jobs, ≤ 20 applicants |
| `assign(job_id, translator)` / `cancel(job_id)` | client | open jobs; assign an applicant (the deadline starts) or refund everything |
| `submit(section_id, url, sha256)` | translator | before the deadline, ≤ 3 attempts per section; returns the issue list (`[]` = section paid) |
| `decline(job_id)` / `refund(job_id)` | translator / anyone | return the unpaid sections / those out of attempts, or all unpaid after the deadline |
| `settle_payout(payout_id, tx_hash, finalize_tx)` / `recover(to)` | anyone / payee | |
| `get_job`, `get_jobs(start, limit)`, `get_submission`, `get_submissions(job_id or -1, start, limit)`, `get_translator(addr)`, `get_payout`, `get_payouts(start, limit, only_unsettled)`, `get_accounting`, `get_recoverable` | view | |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/faithful_pay.py
pytest tests/direct -v                         # 46 tests
# end-to-end on Bradbury Phase 2, against the packed code (keys in GL_PK0..2)
python deploy/shrink.py contracts/faithful_pay.py build/faithful_pay.py --pack
npm i genlayer-js@2.0.0-rc.2   # plus the fee-estimate patch in app/README.md
node tests/integration/bradbury.mjs build/faithful_pay.py
```

Bradbury rejects deploys above ~20 KB of code; deploy the output of
`deploy/shrink.py` (AST-checked, 37.3 KB → 10.0 KB packed). CI re-runs all
direct tests against the packed code. The pages the E2E uses are in
[`evidence/`](evidence/), served byte for byte at
`https://faithfulpay.cristhedev.com/evidence/`.

## Tests (46 direct, Bradbury E2E)

- **Jobs** — the fee is escrowed and must split equally per section; every source is fetched at creation (wrong hash on any section, 404, over 12,000 characters rejected); 1–10 sections, each its own url; input validation; no job for oneself.
- **Sections** — each section is paid on its own and judged against its own source; a paid section takes no more submissions; the job is DONE when every section is settled; a section out of attempts is refunded alone while the others continue; refund and decline take only the unpaid sections.
- **Open jobs** — apply, duplicate apply, withdraw; the client cannot apply; only the client assigns, and only an applicant; the deadline starts at assignment; no apply once assigned; cancel before assignment refunds everything; at most 20 applicants.
- **Judging** — a faithful translation is paid and its URL and hash stored; an omission is listed and a fixed resubmission is paid; required terms checked by text, only in sections whose source has them (missing one listed even when the LLM finds nothing; markup and case ignored); three rejections then a refund of that section, no fourth attempt.
- **Pinning** — a wrong translation hash, a translation changed after hashing and a source changed after the job was posted all revert and use no attempt.
- **Roles and deadline** — only the translator submits or declines; refund rejected before the deadline (to the second) and allowed after; no submission after it; no payout beyond the contract balance.
- **Settlement** — delivered and failed payments, recovery to another address; wrong method, args, sender, time, result, or a transaction that sent nothing are rejected and the payout stays `SENT`.
- **Consensus (validator replay)** — agreement on the issue list, disagreement when a validator finds an omission, the note outside consensus, forged payloads rejected, an LLM error reverts and is never agreed.
- **App** — `check-actions.mjs`: controls per role, job and section state (submit per open section, apply/withdraw/assign/cancel on open jobs), decline and refund amounts, refund only when refundable, issue codes and terms named, escaping, exact GEN amounts beyond 2^53.

## License

MIT
