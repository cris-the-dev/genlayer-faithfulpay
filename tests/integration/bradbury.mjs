// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/faithful_pay.py build/faithful_pay.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... GL_PK2=0x... node tests/integration/bradbury.mjs build/faithful_pay.py [contract]
//
// GL_PK0 is the client (evidence/notice*.html, hosted at EVIDENCE); GL_PK1 translates into
// Vietnamese; GL_PK2 is a second applicant. Job 1 has two sections: a stale source hash, a job for
// oneself and a fee that does not split are rejected; the client cannot submit; a draft missing a
// paragraph is rejected on section 1 and nothing paid; a changed page reverts and uses no attempt;
// each section is paid on its own when it passes, and the job is DONE. Job 2 is open: the client
// cannot apply, two translators apply, one withdraws, only the client assigns, the assigned
// translator declines and the client is refunded. Job 3 is open and cancelled by the client. Every
// payout settles from its own transfer. Every transaction carries a fee deposit; a paying one also
// allocates its payout's gas.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAccount, createClient, MessageType, encodeExternalMessageFeeParams } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const SHARE = 5n * 10n ** 14n, SMALL = 10n ** 14n;
const EVIDENCE = "https://faithfulpay.cristhedev.com/evidence/";
const SOURCE = EVIDENCE + "notice.html", GOOD = EVIDENCE + "notice-vi.html", DRAFT = EVIDENCE + "notice-vi-draft.html", EDITED = EVIDENCE + "notice-vi-edited.html";
const SOURCE2 = EVIDENCE + "notice-2.html", GOOD2 = EVIDENCE + "notice-2-vi.html";
const TERMS = JSON.stringify(["Hill Street", "20"]);
const CONSENSUS_MAIN = "0x2e2766cbc3e5e61ce93bbcdcbb3eacb82082a019";
const T_FINALIZED = "0x24196ec40f90671b7144e716978686b4f3c7d6b00b23da3971ef2b52af27d87f";
const PAYOUT_GAS = 100000n, PAYOUT_GAS_PRICE = 1000000000n;
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const a2 = createAccount(process.env.GL_PK2);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const c2 = createClient({ chain: testnetBradbury, endpoint, account: a2 });
const sha = (t) => createHash("sha256").update(t).digest("hex");
const page = async (url) => sha(Buffer.from(await (await fetch(url)).arrayBuffer()));
const fees = async (c, payee) => {
  const messageAllocations = payee && [{
    messageType: MessageType.External, onAcceptance: false, recipient: payee, budget: PAYOUT_GAS * PAYOUT_GAS_PRICE,
    callKey: "0x" + "00".repeat(32), feeParams: encodeExternalMessageFeeParams({ gasLimit: PAYOUT_GAS, maxGasPrice: PAYOUT_GAS_PRICE }),
  }];
  // A read, so retrying a dropped connection is safe.
  let e;
  for (let i = 0; !e; i++) {
    try { e = await c.estimateTransactionFees(payee ? { messageAllocations } : {}); }
    catch (err) { if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(err?.details ?? err?.message))) throw err; await new Promise((r) => setTimeout(r, 10000)); }
  }
  return { distribution: e.distribution, feeValue: e.feeValue, ...(payee && { messageAllocations: e.messageAllocations }) };
};
// The public RPC drops connections now and then; retry the wait, never the write.
async function wait(c, hash, waitUntil = "decided") {
  for (let i = 0; ; i++) {
    try {
      return await c.waitForTransactionReceipt({ hash, waitUntil, interval: 10000, retries: 360 });
    } catch (e) {
      if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) process.exit(1);
};
// A leader timeout (NOT_VOTED) executed nothing, so sending the call again is safe. Bradbury still
// moves the value of such a transaction, and of a reverted one, into the contract, where
// get_accounting shows it as unaccounted.
let stray = 0n;
async function tx(c, label, functionName, args, { value = 0n, payee } = {}) {
  for (let i = 0; ; i++) {
    const hash = await c.writeContract({ address, functionName, args, value, fees: await fees(c, payee) });
    const r = await wait(c, hash);
    console.log(`${label}: ${hash} ${r.txExecutionResultName}`);
    if (r.txExecutionResultName !== "FINISHED_WITH_RETURN") stray += value;
    if (r.txExecutionResultName !== "NOT_VOTED" || i >= 2) return { ...r, hash };
  }
}
const ok = async (...a) => { const r = await tx(...a); check(r.txExecutionResultName === "FINISHED_WITH_RETURN", `${a[1]} succeeds`); return r; };
const fails = async (what, ...a) => check((await tx(...a)).txExecutionResultName !== "FINISHED_WITH_RETURN", what);
const read = async (functionName, args = []) => {
  const v = await c0.readContract({ address, functionName, args });
  const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, y]) => [k, plain(y)])) : Array.isArray(x) ? x.map(plain) : x);
  return plain(v);
};
// RPC nodes behind the edge can lag the one that reported the receipt: re-read until `ok` holds (or give up).
async function settled(fn, args, ok) {
  for (let i = 0; ; i++) {
    const v = await read(fn, args);
    if (ok(v) || i >= 12) return v;
    await new Promise((r) => setTimeout(r, 10000));
  }
}
// Reads only, so retrying a dropped connection is safe.
const rpc = async (method, params) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "faithfulpay-e2e" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (await r.json()).result;
    } catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
};
// The consensus-layer transaction that finalized `hash`: it emits TransactionFinalized(txId).
async function finalizeTx(hash, fromBlock) {
  for (;;) {
    const to = BigInt(await rpc("eth_blockNumber", []));
    for (let b = fromBlock; b <= to; b += 1000n) {
      const end = b + 999n > to ? to : b + 999n;
      const logs = await rpc("eth_getLogs", [{ address: CONSENSUS_MAIN, topics: [T_FINALIZED, hash], fromBlock: "0x" + b.toString(16), toBlock: "0x" + end.toString(16) }]);
      if (logs?.length) return logs[0].transactionHash;
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
}
async function settle(id, paid, fromBlock) {
  await wait(c0, paid.hash, "finalized");
  const fin = await finalizeTx(paid.hash, fromBlock);
  console.log(`finalized by ${fin}`);
  await ok(c1, `settle payout ${id}`, "settle_payout", [id, paid.hash, fin]);
  check((await settled("get_payout", [id], (x) => x.status === "DELIVERED")).status === "DELIVERED", `payout ${id} DELIVERED`);
  await fails("a payout settles once", c1, "settle again", "settle_payout", [id, paid.hash, fin]);
}

let address = process.argv[3];
if (!address) {
  const hash = await c0.deployContract({ code: readFileSync(process.argv[2], "utf8"), args: [], fees: await fees(c0) });
  const r = await wait(c0, hash);
  address = r.txDataDecoded?.contractAddress;
  console.log(`deploy: ${hash} ${r.txExecutionResultName} -> ${address}`);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", "deployed");
}
const fromBlock = BigInt(await rpc("eth_blockNumber", []));
stray = BigInt((await read("get_accounting")).unaccounted);
const [sSha, gSha, dSha, s2Sha, g2Sha] = await Promise.all([SOURCE, GOOD, DRAFT, SOURCE2, GOOD2].map(page));
check((await page(EDITED)) !== gSha, "the edited copy differs from the hashed translation");
const client = a0.address, translator = a1.address, other = a2.address, low = (x) => x?.toLowerCase();
const jid = Number((await read("get_jobs", [0, 1])).total);
const both = JSON.stringify([[SOURCE, sSha], [SOURCE2, s2Sha]]);

// Job 1, two sections: every source must match its hash; the translator must be someone else; the fee splits.
await fails("a source that differs from its hash is rejected", c0, "create with a stale hash on section 2", "create_job", [translator, JSON.stringify([[SOURCE, sSha], [SOURCE2, "0".repeat(64)]]), "Vietnamese", TERMS, 1], { value: 2n * SHARE });
await fails("the translator must be someone else", c0, "create for oneself", "create_job", [client, both, "Vietnamese", TERMS, 1], { value: 2n * SHARE });
await fails("a fee that does not split equally is rejected", c0, "create with an odd fee", "create_job", [translator, both, "Vietnamese", TERMS, 1], { value: 2n * SHARE + 1n });
await ok(c0, "create_job (2 sections)", "create_job", [translator, both, "Vietnamese", TERMS, 1], { value: 2n * SHARE });
let j = await settled("get_job", [jid], (x) => x.status === "ASSIGNED");
const [s0, s1] = j.sections.map((x) => Number(x.id));
check(low(j.translator) === low(translator) && BigInt(j.amount) === 2n * SHARE && BigInt(j.share) === SHARE && j.sections[1].source_sha256 === s2Sha, "job escrows the fee, 2 sections pinned");

// Section 1: a draft with a missing paragraph is rejected, nothing paid.
await fails("only the translator submits", c0, "submit by the client", "submit", [s0, GOOD, gSha], { payee: translator });
await ok(c1, "submit the draft for section 1", "submit", [s0, DRAFT, dSha], { payee: translator });
j = await settled("get_job", [jid], (x) => Number(x.sections[0].attempts) === 1);
let subs = (await read("get_submissions", [jid, 0, 10])).items;
check(j.sections[0].status === "OPEN" && Number(j.sections[0].attempts_left) === 2 && subs[0].issues.includes("omission") && BigInt(j.paid) === 0n, `draft rejected: ${subs[0].issues.join(", ")}; 2 attempts left`);
console.log("    note (unverified):", subs[0].note);
// A page that changed after it was hashed: reverts, no attempt used.
check((await tx(c1, "submit a changed page", "submit", [s0, EDITED, gSha], { payee: translator })).txExecutionResultName !== "FINISHED_WITH_RETURN", "content changed after hashing reverts");
check(Number((await read("get_job", [jid])).sections[0].attempts) === 1, "no attempt used");

// Each section is paid on its own.
const pid = Number((await read("get_accounting")).payout_count);
const paid0 = await ok(c1, "submit the fixed section 1", "submit", [s0, GOOD, gSha], { payee: translator });
j = await settled("get_job", [jid], (x) => x.sections[0].status === "PAID");
check(j.status === "ASSIGNED" && BigInt(j.paid) === SHARE && j.sections[0].translation_sha256 === gSha && j.sections[1].status === "OPEN", "section 1 PAID alone, hash stored; section 2 still open");
await fails("a paid section takes no more submissions", c1, "submit section 1 again", "submit", [s0, GOOD, gSha], { payee: translator });
const paid1 = await ok(c1, "submit section 2", "submit", [s1, GOOD2, g2Sha], { payee: translator });
j = await settled("get_job", [jid], (x) => x.status === "DONE");
check(j.status === "DONE" && BigInt(j.paid) === 2n * SHARE && j.sections[1].translation_url === GOOD2, "section 2 PAID, job DONE");
const tr = await read("get_translator", [translator]);
check(Number(tr.paid) >= 2, `translator record: ${tr.paid} paid, ${tr.rejected} rejected`);

// Job 2, open: applications, assignment by the client, then a decline refunds the client.
await ok(c0, "create an open job", "create_job", ["", JSON.stringify([[SOURCE, sSha]]), "Vietnamese", "[]", 1], { value: SMALL });
await fails("the client cannot apply", c0, "apply as the client", "apply", [jid + 1]);
await ok(c1, "apply", "apply", [jid + 1]);
await ok(c2, "apply (second translator)", "apply", [jid + 1]);
await ok(c2, "withdraw_application", "withdraw_application", [jid + 1]);
j = await settled("get_job", [jid + 1], (x) => x.applicants.length === 1);
check(j.status === "OPEN" && j.translator === null && low(j.applicants[0].address) === low(translator) && Number(j.applicants[0].paid) >= 2, "one applicant left, with a record");
await fails("only the client assigns", c1, "assign by the translator", "assign", [jid + 1, translator]);
await fails("only an applicant can be assigned", c0, "assign a non-applicant", "assign", [jid + 1, other]);
await ok(c0, "assign", "assign", [jid + 1, translator]);
j = await settled("get_job", [jid + 1], (x) => x.status === "ASSIGNED");
check(low(j.translator) === low(translator) && Number(j.deadline) > Number(j.at), "assigned; the deadline starts now");
await fails("only the translator declines", c0, "decline by the client", "decline", [jid + 1], { payee: client });
const declined = await ok(c1, "decline", "decline", [jid + 1], { payee: client });
check((await settled("get_job", [jid + 1], (x) => x.status === "REFUNDED")).status === "REFUNDED", "declined job REFUNDED");

// Job 3, open, cancelled by the client before anyone is assigned.
await ok(c0, "create a second open job", "create_job", ["", JSON.stringify([[SOURCE2, s2Sha]]), "Vietnamese", "[]", 1], { value: SMALL });
await fails("only the client cancels", c1, "cancel by the translator", "cancel", [jid + 2], { payee: client });
const cancelled = await ok(c0, "cancel", "cancel", [jid + 2], { payee: client });
check((await settled("get_job", [jid + 2], (x) => x.status === "REFUNDED")).status === "REFUNDED", "cancelled job REFUNDED");

const ps = [];
for (let i = 0; i < 4; i++) ps.push(await settled("get_payout", [pid + i], (x) => !!x?.kind));
const want = [["paid", SHARE, translator], ["paid", SHARE, translator], ["declined", SMALL, client], ["cancelled", SMALL, client]];
want.forEach(([kind, amount, to], i) => check(ps[i].kind === kind && BigInt(ps[i].amount) === amount && low(ps[i].to) === low(to), `payout ${pid + i}: ${kind} ${amount} to ${to.slice(0, 8)}`));
for (const [i, t] of [paid0, paid1, declined, cancelled].entries()) await settle(pid + i, t, fromBlock);
check(BigInt((await read("get_accounting")).unaccounted) === stray, `balance matches what the contract expects to hold (+${stray} from unexecuted or reverted txs)`);
console.log("contract", address, "jobs", jid, jid + 1, jid + 2);
