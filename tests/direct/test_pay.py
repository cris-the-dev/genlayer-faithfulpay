"""Jobs of sections, open jobs, the issue list, resubmissions, pinning, refunds and payout settlement."""

import json

import pytest

from tests.direct.conftest import (
    DAY,
    FEE,
    GOOD,
    GOOD2,
    SHORT,
    SOURCE,
    SOURCE2,
    SOURCE2_URL,
    SOURCE_URL,
    TERMS,
    URL,
    URL2,
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
    assert (j["amount"], j["share"], j["status"], j["terms"], j["paid"], j["refunded"]) == (2 * FEE, FEE, "ASSIGNED", TERMS, 0, 0)
    assert [x["source_url"] for x in j["sections"]] == [SOURCE_URL, SOURCE2_URL] and j["sections"][1]["source_sha256"] == sha(SOURCE2)
    assert [x["attempts_left"] for x in j["sections"]] == [3, 3] and j["deadline"] == j["at"] + 7 * DAY
    assert job.get_accounting()["expected_balance"] == 2 * FEE

@pytest.mark.parametrize(
    "kw, msg",
    [
        ({"value": 0}, "splits equally"),
        ({"value": 2 * FEE + 1}, "splits equally"),
        ({"days": 0}, "1-90"),
        ({"terms": "x"}, "JSON list"),
        ({"terms": [""]}, "JSON list"),
        ({"terms": ["t"] * 21}, "JSON list"),
        ({"s_sha": "abc"}, "64 hex"),
        ({"sources": []}, "1-10 [url, sha256]"),
        ({"sources": [[SOURCE_URL, "0" * 64]] * 11}, "1-10 [url, sha256]"),
        ({"sources": [[SOURCE_URL, "0" * 64], [SOURCE_URL, "1" * 64]]}, "its own source url"),
    ],
)
def test_create_validation(job, direct_vm, direct_alice, direct_bob, kw, msg):
    with direct_vm.expect_revert(msg):
        create(direct_vm, job, direct_alice, direct_bob, **kw)

def test_every_source_is_checked_at_creation(job, direct_vm, direct_alice, direct_bob):
    with direct_vm.expect_revert("source 0 does not match its sha256"):
        create(direct_vm, job, direct_alice, direct_bob, s_sha="0" * 64)
    with direct_vm.expect_revert("source 1 does not match its sha256"):
        create(direct_vm, job, direct_alice, direct_bob, sources=[[SOURCE_URL, sha(SOURCE)], [SOURCE2_URL, "0" * 64]])
    with direct_vm.expect_revert("source 0 unavailable (HTTP 404)"):
        create(direct_vm, job, direct_alice, direct_bob, status=404)
    long = "<p>" + "word " * 3000 + "</p>"
    with direct_vm.expect_revert("over 12000 characters"):
        create(direct_vm, job, direct_alice, direct_bob, source=long)
    with direct_vm.expect_revert("someone else"):
        create(direct_vm, job, direct_alice, direct_alice)
    assert job.get_jobs(0, 10)["total"] == 1

def test_each_section_is_paid_on_its_own(job, direct_vm, direct_bob, ledger):
    assert submit(direct_vm, job, direct_bob) == []
    assert ledger.paid_to(direct_bob) == FEE
    j = job.get_job(0)
    assert (j["status"], j["paid"], j["sections"][0]["status"], j["sections"][1]["status"]) == ("ASSIGNED", FEE, "PAID", "OPEN")
    assert (j["sections"][0]["translation_url"], j["sections"][0]["translation_sha256"]) == (URL, sha(GOOD))
    assert job.get_payout(0)["kind"] == "paid" and job.get_payout(0)["ref"] == 0
    with direct_vm.expect_revert("section is PAID"):
        submit(direct_vm, job, direct_bob)
    assert submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1) == []
    j = job.get_job(0)
    assert (j["status"], j["paid"], ledger.paid_to(direct_bob)) == ("DONE", 2 * FEE, 2 * FEE)
    assert job.get_translator(to_hex(direct_bob)) == {"paid": 2, "rejected": 0}
    assert job.get_accounting()["expected_balance"] == 0
    with direct_vm.expect_revert("job is DONE"):
        submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1)

def test_a_section_is_judged_against_its_own_source(job, direct_vm, direct_bob):
    # Section 0's translation submitted for section 1: its source says something else.
    pages(direct_vm, translation=GOOD, url=URL, omission=True, mistranslation=True)
    direct_vm.sender = direct_bob
    assert job.submit(1, URL, sha(GOOD)) == ["omission", "mistranslation"]
    assert job.get_submission(0)["section_id"] == 1

def test_omission_is_rejected_then_fixed(job, direct_vm, direct_bob, ledger):
    assert submit(direct_vm, job, direct_bob, translation=SHORT, omission=True) == ["omission", "missing_term:0"]
    s = job.get_submission(0)
    assert s["issues"] == ["omission", "missing_term:0"] and s["sha256"] == sha(SHORT)
    assert ledger.transfers == [] and job.get_job(0)["sections"][0]["attempts_left"] == 2
    assert submit(direct_vm, job, direct_bob) == []
    assert ledger.paid_to(direct_bob) == FEE and len(job.get_submissions(0, 0, 10)["items"]) == 2

def test_required_terms_are_checked_by_text(job, direct_vm, direct_bob):
    # The LLM finds nothing wrong, but "Hill Street" is not there.
    renamed = GOOD.replace("Hill Street", "phố Hill")
    assert submit(direct_vm, job, direct_bob, translation=renamed) == ["missing_term:0"]
    # Case, spacing and inline markup do not matter.
    styled = GOOD.replace("Hill Street", "<b>HILL</b>   street")
    assert submit(direct_vm, job, direct_bob, translation=styled) == []

def test_a_section_out_of_attempts_is_refunded_alone(job, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    assert submit(direct_vm, job, direct_bob) == []  # section 0 paid
    for left in (2, 1):
        submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1, mistranslation=True)
        assert job.get_job(0)["sections"][1]["attempts_left"] == left
    assert submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1, wrong_language=True) == ["wrong_language"]
    assert job.get_job(0)["refundable"] is True
    with direct_vm.expect_revert("no attempts left"):
        submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1)
    direct_vm.sender = direct_charlie
    assert job.refund(0) == FEE
    assert ledger.paid_to(direct_alice) == FEE and ledger.paid_to(direct_bob) == FEE
    j = job.get_job(0)
    assert (j["status"], j["paid"], j["refunded"]) == ("DONE", FEE, FEE) and job.get_payout(1)["kind"] == "refund"
    assert job.get_translator(to_hex(direct_bob)) == {"paid": 1, "rejected": 1}

def test_refund_only_takes_what_is_due(job, direct_vm, direct_bob, direct_charlie, ledger):
    for _ in range(3):
        submit(direct_vm, job, direct_bob, mistranslation=True)
    direct_vm.sender = direct_charlie
    assert job.refund(0) == FEE  # section 0 only; section 1 still has attempts and time
    assert [x["status"] for x in job.get_job(0)["sections"]] == ["REFUNDED", "OPEN"]
    tick(direct_vm)
    with direct_vm.expect_revert("nothing to refund"):
        job.refund(0)
    assert submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=1) == []
    assert job.get_job(0)["status"] == "DONE" and ledger.paid_to(direct_bob) == FEE

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
    assert job.get_job(0)["sections"][0]["attempts"] == 0

@pytest.mark.parametrize(
    "kw, msg",
    [({"url": SOURCE_URL}, "another http(s) url"), ({"url": "javascript:x"}, "another http(s) url"), ({"sha256": "xyz"}, "64 hex"), ({"section": 2}, "section not found")],
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
    assert submit(direct_vm, job, direct_bob) == []
    direct_vm.sender = direct_bob
    tick(direct_vm)
    assert job.decline(0) == FEE  # section 0 stays paid
    j = job.get_job(0)
    assert (j["status"], j["paid"], j["refunded"]) == ("DONE", FEE, FEE)
    assert ledger.paid_to(direct_alice) == FEE and job.get_payout(1)["kind"] == "declined"

def test_declining_before_any_payment_refunds_the_job(job, direct_vm, direct_alice, direct_bob, ledger):
    direct_vm.sender = direct_bob
    assert job.decline(0) == 2 * FEE
    assert job.get_job(0)["status"] == "REFUNDED" and ledger.paid_to(direct_alice) == 2 * FEE

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
    assert job.refund(0) == 2 * FEE
    assert ledger.paid_to(direct_alice) == 2 * FEE and job.get_job(0)["status"] == "REFUNDED"
    assert job.get_translator(to_hex(direct_bob)) == {"paid": 0, "rejected": 0}  # late is not rejected

def test_a_payout_needs_the_balance(job, direct_vm, direct_bob):
    chain_balance(direct_vm, 2 * FEE - 1)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("contract balance below payout"):
        job.decline(0)
    assert job.get_job(0)["status"] == "ASSIGNED"

# ── Open jobs ───────────────────────────────────────────────────────────────

@pytest.fixture
def open_job(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2030-01-01T10:00:00Z")
    c = direct_deploy("contracts/faithful_pay.py")
    create(direct_vm, c, direct_alice, None)
    chain_balance(direct_vm, 2 * FEE)
    return c

def test_open_job_takes_applications(open_job, direct_vm, direct_alice, direct_bob, direct_charlie):
    j = open_job.get_job(0)
    assert (j["status"], j["translator"], j["deadline"], j["refundable"]) == ("OPEN", None, 0, False)
    with direct_vm.expect_revert("job is OPEN"):
        submit(direct_vm, open_job, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("someone else"):
        open_job.apply(0)
    for who in (direct_bob, direct_charlie):
        direct_vm.sender = who
        open_job.apply(0)
    with direct_vm.expect_revert("already applied"):
        open_job.apply(0)
    open_job.withdraw_application(0)
    with direct_vm.expect_revert("not an applicant"):
        open_job.withdraw_application(0)
    apps = open_job.get_job(0)["applicants"]
    assert [a["address"] for a in apps] == [to_hex(direct_bob).lower()] and apps[0]["paid"] == 0

def test_the_client_assigns_an_applicant(open_job, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    direct_vm.sender = direct_bob
    open_job.apply(0)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("not authorised"):
        open_job.assign(0, to_hex(direct_bob))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("has not applied"):
        open_job.assign(0, to_hex(direct_charlie))
    tick(direct_vm, DAY)
    open_job.assign(0, to_hex(direct_bob))
    j = open_job.get_job(0)
    assert j["status"] == "ASSIGNED" and j["translator"].lower() == to_hex(direct_bob).lower()
    assert j["deadline"] == j["at"] + DAY + 7 * DAY and j["applicants"] == []  # time starts at assignment
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("job is ASSIGNED"):
        open_job.apply(0)
    assert submit(direct_vm, open_job, direct_bob) == [] and ledger.paid_to(direct_bob) == FEE

def test_the_client_cancels_an_unassigned_job(open_job, direct_vm, direct_alice, direct_bob, ledger):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("not authorised"):
        open_job.cancel(0)
    direct_vm.sender = direct_alice
    open_job.cancel(0)
    assert ledger.paid_to(direct_alice) == 2 * FEE and open_job.get_job(0)["status"] == "REFUNDED"
    assert open_job.get_payout(0)["kind"] == "cancelled"
    with direct_vm.expect_revert("job is REFUNDED"):
        open_job.cancel(0)

def test_applicants_are_capped(open_job, direct_vm):
    from genlayer.types import Address

    for i in range(20):
        direct_vm.sender = Address(bytes([i + 1] * 20))
        open_job.apply(0)
    direct_vm.sender = Address(bytes([99] * 20))
    with direct_vm.expect_revert("20 applicants"):
        open_job.apply(0)

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


def test_a_term_is_required_only_where_its_source_has_it(job, direct_vm, direct_alice, direct_bob):
    # "14:00" is only in section 0's source: section 1 is paid without it.
    create(direct_vm, job, direct_alice, direct_bob, terms=["Hill Street", "14:00"])
    assert submit(direct_vm, job, direct_bob, translation=GOOD2, url=URL2, section=3) == []
    assert submit(direct_vm, job, direct_bob, translation=GOOD.replace("14:00", "2 giờ chiều"), section=2) == ["missing_term:1"]


def test_a_sentence_listed_as_missing_is_an_omission(job, direct_vm, direct_bob):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"client\.example", {"status": 200, "body": SOURCE})
    direct_vm.mock_web(r"translator\.example", {"status": 200, "body": SHORT})
    direct_vm.mock_llm(r"whether a translation is faithful", json.dumps({"missing": ["Bring a container"], "omission": False, "mistranslation": False, "wrong_language": False, "note": "x"}))
    direct_vm.sender = direct_bob
    assert job.submit(0, URL, sha(SHORT)) == ["omission", "missing_term:0"]
