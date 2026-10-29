"""Jobs, the issue list, resubmissions, pinning, refunds and payout settlement."""

import json

import pytest

from tests.direct.conftest import (
    DAY,
    FEE,
    GOOD,
    SHORT,
    SOURCE,
    SOURCE_URL,
    TERMS,
    URL,
    chain_balance,
    create,
    pages,
    sha,
    submit,
    tick,
    to_hex,
)

OTHER = "0x" + "77" * 20


def test_create(job, direct_alice, direct_bob):
    j = job.get_job(0)
    assert j["client"].lower() == to_hex(direct_alice).lower() and j["translator"].lower() == to_hex(direct_bob).lower()
    assert (j["amount"], j["status"], j["attempts"], j["attempts_left"], j["terms"]) == (FEE, "OPEN", 0, 3, TERMS)
    assert j["source_sha256"] == sha(SOURCE) and j["deadline"] == j["at"] + 7 * DAY
    assert job.get_accounting()["expected_balance"] == FEE


@pytest.mark.parametrize(
    "kw, msg",
    [
        ({"value": 0}, "translation fee"),
        ({"days": 0}, "1-90"),
        ({"terms": "x"}, "JSON list"),
        ({"terms": [""]}, "JSON list"),
        ({"terms": ["t"] * 21}, "JSON list"),
        ({"s_sha": "abc"}, "64 hex"),
    ],
)
def test_create_validation(job, direct_vm, direct_alice, direct_bob, kw, msg):
    with direct_vm.expect_revert(msg):
        create(direct_vm, job, direct_alice, direct_bob, **kw)


def test_source_is_checked_at_creation(job, direct_vm, direct_alice, direct_bob):
    with direct_vm.expect_revert("source does not match its sha256"):
        create(direct_vm, job, direct_alice, direct_bob, s_sha="0" * 64)
    with direct_vm.expect_revert("source unavailable (HTTP 404)"):
        create(direct_vm, job, direct_alice, direct_bob, status=404)
    long = "<p>" + "word " * 3000 + "</p>"
    with direct_vm.expect_revert("over 12000 characters"):
        create(direct_vm, job, direct_alice, direct_bob, source=long, s_sha=sha(long))
    with direct_vm.expect_revert("someone else"):
        create(direct_vm, job, direct_alice, direct_alice)
    assert job.get_jobs(0, 10)["total"] == 1


def test_faithful_translation_is_paid_and_pinned(job, direct_vm, direct_bob, ledger):
    assert submit(direct_vm, job, direct_bob) == []
    assert ledger.paid_to(direct_bob) == FEE
    j = job.get_job(0)
    assert (j["status"], j["attempts"], j["translation_url"], j["translation_sha256"]) == ("PAID", 1, URL, sha(GOOD))
    assert job.get_payout(0)["kind"] == "paid" and job.get_translator(to_hex(direct_bob)) == {"paid": 1, "rejected": 0}
    assert job.get_accounting()["expected_balance"] == 0
    with direct_vm.expect_revert("job is PAID"):
        submit(direct_vm, job, direct_bob)


def test_omission_is_rejected_then_fixed(job, direct_vm, direct_bob, ledger):
    assert submit(direct_vm, job, direct_bob, translation=SHORT, omission=True) == ["omission", "missing_term:0"]
    s = job.get_submission(0)
    assert s["issues"] == ["omission", "missing_term:0"] and s["sha256"] == sha(SHORT)
    assert ledger.transfers == [] and job.get_job(0)["attempts_left"] == 2
    assert submit(direct_vm, job, direct_bob) == []
    assert ledger.paid_to(direct_bob) == FEE and len(job.get_submissions(0, 0, 10)["items"]) == 2


def test_required_terms_are_checked_by_text(job, direct_vm, direct_bob):
    # The LLM finds nothing wrong, but "Hill Street" is not there.
    renamed = GOOD.replace("Hill Street", "phố Hill")
    assert submit(direct_vm, job, direct_bob, translation=renamed) == ["missing_term:0"]
    # Case, spacing and inline markup do not matter.
    styled = GOOD.replace("Hill Street", "<b>HILL</b>   street")
    assert submit(direct_vm, job, direct_bob, translation=styled) == []


def test_after_three_rejections_the_client_is_refunded(job, direct_vm, direct_alice, direct_bob, ledger):
    for left in (2, 1):
        submit(direct_vm, job, direct_bob, mistranslation=True)
        assert job.get_job(0)["attempts_left"] == left
    assert submit(direct_vm, job, direct_bob, wrong_language=True) == ["wrong_language"]
    assert ledger.transfers == [] and job.get_job(0)["refundable"] is True
    with direct_vm.expect_revert("no attempts left"):
        submit(direct_vm, job, direct_bob)
    job.refund(0)
    assert ledger.paid_to(direct_alice) == FEE and ledger.paid_to(direct_bob) == 0
    assert job.get_job(0)["status"] == "REFUNDED" and job.get_payout(0)["kind"] == "rejected"
    assert job.get_translator(to_hex(direct_bob)) == {"paid": 0, "rejected": 1}


def test_translation_is_pinned_by_hash(job, direct_vm, direct_bob):
    with direct_vm.expect_revert("translation does not match its sha256"):
        submit(direct_vm, job, direct_bob, sha256="0" * 64)
    # Changed after the translator hashed it.
    edited = GOOD.replace("14:00", "16:00")
    pages(direct_vm, translation=edited)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("translation does not match its sha256"):
        job.submit(0, URL, sha(GOOD))
    # The client's source changed after the job was created.
    with direct_vm.expect_revert("source does not match its sha256"):
        submit(direct_vm, job, direct_bob, source=SOURCE.replace("Tuesday", "Wednesday"))
    assert job.get_job(0)["attempts"] == 0


@pytest.mark.parametrize(
    "kw, msg",
    [({"url": SOURCE_URL}, "another http(s) url"), ({"url": "javascript:x"}, "another http(s) url"), ({"sha256": "xyz"}, "64 hex")],
)
def test_submit_validation(job, direct_vm, direct_bob, kw, msg):
    with direct_vm.expect_revert(msg):
        submit(direct_vm, job, direct_bob, **kw)


def test_only_the_translator_submits_or_declines(job, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    with direct_vm.expect_revert("not authorised"):
        submit(direct_vm, job, direct_charlie)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("not authorised"):
        job.decline(0)
    direct_vm.sender = direct_bob
    job.decline(0)
    assert ledger.paid_to(direct_alice) == FEE and job.get_job(0)["status"] == "REFUNDED"


def test_deadline(job, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("deadline has not passed"):
        job.refund(0)
    tick(direct_vm, 7 * DAY)  # exactly the deadline: still the translator's
    with direct_vm.expect_revert("deadline has not passed"):
        job.refund(0)
    tick(direct_vm)
    with direct_vm.expect_revert("deadline has passed"):
        submit(direct_vm, job, direct_bob)
    direct_vm.sender = direct_charlie
    job.refund(0)
    assert ledger.paid_to(direct_alice) == FEE and job.get_payout(0)["kind"] == "expired"


def test_a_payout_needs_the_balance(job, direct_vm, direct_bob):
    chain_balance(direct_vm, FEE - 1)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("contract balance below payout"):
        job.decline(0)
    assert job.get_job(0)["status"] == "OPEN"


# ── Consensus ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mine, ok", [({}, True), ({"omission": True}, False)])
def test_agreement_is_on_the_issue_list(job, direct_vm, direct_bob, mine, ok):
    submit(direct_vm, job, direct_bob)
    pages(direct_vm, **mine)
    assert direct_vm.run_validator() is ok


def test_the_note_is_not_part_of_consensus(job, direct_vm, direct_bob):
    submit(direct_vm, job, direct_bob)
    pages(direct_vm)
    assert direct_vm.run_validator(leader_result={"issues": [], "note": "other words"}) is True


def test_forged_payloads_are_rejected(job, direct_vm, direct_bob):
    submit(direct_vm, job, direct_bob, omission=True)
    pages(direct_vm, omission=True)
    for bad in ({"issues": []}, {"issues": "omission"}, {}, {"issues": ["omission"], "note": "x" * 5000}, ["omission"]):
        assert direct_vm.run_validator(leader_result=bad) is False


def test_an_llm_error_reverts_and_is_never_agreed(job, direct_vm, direct_bob):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"client\.example", {"status": 200, "body": SOURCE})
    direct_vm.mock_web(r"translator\.example", {"status": 200, "body": GOOD})
    direct_vm.mock_llm(r"whether a translation is faithful", json.dumps({"omission": "maybe"}))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("expected booleans"):
        job.submit(0, URL, sha(GOOD))
    assert direct_vm.run_validator(leader_error="[LLM_ERROR] expected booleans") is False


# ── Each payout settles from its own transfer ───────────────────────────────


def test_delivered_payment_settles(job, direct_vm, direct_bob, chain):
    submit(direct_vm, job, direct_bob)
    tx, fin = chain.pay(job, 0, "submit", [0, URL, sha(GOOD)])
    assert job.settle_payout(0, tx, fin) == "DELIVERED"
    with direct_vm.expect_revert("already settled"):
        job.settle_payout(0, tx, fin)


def test_failed_payment_is_recoverable(job, direct_vm, direct_bob, chain, ledger):
    submit(direct_vm, job, direct_bob)
    tx, fin = chain.pay(job, 0, "submit", [0, URL, sha(GOOD)], delivered=False)
    assert job.settle_payout(0, tx, fin) == "FAILED"
    assert job.get_recoverable(to_hex(direct_bob)) == FEE
    tick(direct_vm)
    direct_vm.sender = direct_bob
    assert job.recover(OTHER) == FEE and ledger.paid_to(OTHER) == FEE
    with direct_vm.expect_revert("nothing to recover"):
        job.recover(OTHER)


@pytest.mark.parametrize(
    "kw",
    [{"method": "decline"}, {"args": [1]}, {"sender": "0x" + "99" * 20}, {"at": 1}, {"result": 2}, {"delivered": None}],
)
def test_settle_rejects_a_transaction_that_is_not_this_payout(kw, job, direct_vm, direct_bob, chain):
    submit(direct_vm, job, direct_bob)
    method, a = kw.pop("method", "submit"), kw.pop("args", [0, URL, sha(GOOD)])
    tx, fin = chain.pay(job, 0, method, a, **{"delivered": False, **kw})
    with direct_vm.expect_revert("did not create this payout"):
        job.settle_payout(0, tx, fin)
    assert job.get_payout(0)["status"] == "SENT"
