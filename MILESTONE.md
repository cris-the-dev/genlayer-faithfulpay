# Milestone: FaithfulPay v2 — long documents paid per section, open jobs

Base version: [`v1.0.0`](https://github.com/cris-the-dev/genlayer-faithfulpay/tree/v1.0.0) (submitted 2026-11-02).
Full diff: https://github.com/cris-the-dev/genlayer-faithfulpay/compare/v1.0.0...v2.0.0

## Summary

v1 escrowed one fee for one page, translated by an address the client had to
know in advance. Real translation work differs on two counts:

1. **Documents are longer than one page.** A manual or a contract runs past the
   12,000 characters validators can judge in one call. v1 refused it outright;
   splitting it into separate jobs meant separate fees, deadlines and terms.
2. **Clients look for a translator.** A client posting work usually has no
   translator yet, and the one thing worth comparing (how often someone's work
   was paid) was already on-chain but could not be used to choose.

v2 makes a job **N sections under one fee, one language, one set of required
terms and one deadline**, each section pinned by its own hash and **paid on its
own** when it passes. A job may be **open**: translators apply, the client
sees each one's paid and refunded counts and assigns one.

## What changed

| Area | v1 | v2 |
|---|---|---|
| Size | one page ≤ 12,000 characters | 1–10 sections, each a page ≤ 12,000 characters, all fetched and hash-checked at `create_job` |
| Fee | one amount | split equally per section (`share`); a fee that does not split is rejected |
| Payment | all on the one accepted submission | each section's share on its own accepted submission; job DONE when every section is settled |
| Attempts | 3 per job | 3 per section; a section judged only against its own source |
| Required terms | must appear in the translation | must appear in each section whose source uses them |
| Refund | whole fee after 3 rejections or the deadline | only what is due: sections out of attempts, or every unpaid one after the deadline; paid sections stay paid |
| Decline | refunds the job | refunds the unpaid sections |
| Translator | fixed at creation | fixed, or `""` = OPEN: `apply` / `withdraw_application` (≤ 20), client `assign`s an applicant or `cancel`s |
| Deadline | from creation | from assignment |
| Record | jobs paid / refunded | sections paid / refunded after rejections, shown per applicant |
| Payouts | `paid`, `refund`, `declined`, `recover` | + `cancelled`; a `paid` payout references its section |
| Views | `get_job` | `get_job` with sections, `share`, `paid`, `refunded`, applicants with records; submissions carry `section_id` |
| App | one job, one submit form | sections table, a submit form per open section, apply / withdraw / assign / cancel, amounts the contract would return, multi-section post form |
| Tests | 32 direct | 46 direct (sections, partial refunds, open jobs), app checks for every role and section state |
| E2E | one job paid, one declined | a 2-section job paid section by section, an open job applied to, assigned and declined, an open job cancelled; every payout settled |

## Why per-section pay is safe

A section is paid only when validators agree on an empty issue list for that
section's translation against that section's source, both pinned by hash. The
refund paths can only return sections that are not paid, so no path can take
back money already earned or pay twice. Sections the client split badly (a
sentence cut in two) are judged on each side separately; the README states it.

## Evidence

Bradbury Phase 2 run, transaction by transaction: [README → Bradbury evidence](README.md#bradbury-evidence).
Live app: https://faithfulpay.cristhedev.com
