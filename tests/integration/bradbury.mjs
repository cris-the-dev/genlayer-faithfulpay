// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/faithful_pay.py build/faithful_pay.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... node tests/integration/bradbury.mjs build/faithful_pay.py [contract]
//
// GL_PK0 is the client (evidence/notice.html, hosted at EVIDENCE); GL_PK1 translates it into
// Vietnamese. A source that differs from its hash and a job for oneself are rejected; the client
// cannot submit for the translator; a draft missing a paragraph is rejected with an omission and
// nothing paid; a translation changed after it was hashed reverts and uses no attempt; the fixed
// translation is paid and its hash stored; a paid job takes no more submissions. A second job is
// declined by the translator (not by the client), refunding the client. Both payouts settle from
// their own transfers. Every transaction carries a fee deposit; a paying one also allocates its
// payout's gas.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAccount, createClient, MessageType, encodeExternalMessageFeeParams } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const FEE = 10n ** 15n, SMALL = 10n ** 14n;
const EVIDENCE = "https://faithfulpay.cristhedev.com/evidence/";
const SOURCE = EVIDENCE + "notice.html", GOOD = EVIDENCE + "notice-vi.html", DRAFT = EVIDENCE + "notice-vi-draft.html", EDITED = EVIDENCE + "notice-vi-edited.html";
const TERMS = JSON.stringify(["Hill Street", "20"]);
const CONSENSUS_MAIN = "0x2e2766cbc3e5e61ce93bbcdcbb3eacb82082a019";
const T_FINALIZED = "0x24196ec40f90671b7144e716978686b4f3c7d6b00b23da3971ef2b52af27d87f";
const PAYOUT_GAS = 100000n, PAYOUT_GAS_PRICE = 1000000000n;
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const sha = (t) => createHash("sha256").update(t).digest("hex");
const page = async (url) => sha(Buffer.from(await (await fetch(url)).arrayBuffer()));
const fees = async (c, payee) => {
  const messageAllocations = payee && [{
    messageType: MessageType.External, onAcceptance: false, recipient: payee, budget: PAYOUT_GAS * PAYOUT_GAS_PRICE,
    callKey: "0x" + "00".repeat(32), feeParams: encodeExternalMessageFeeParams({ gasLimit: PAYOUT_GAS, maxGasPrice: PAYOUT_GAS_PRICE }),
  }];
  const e = await c.estimateTransactionFees(payee ? { messageAllocations } : {});
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
const rpc = async (method, params) => {
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "faithfulpay-e2e" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
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
const [sSha, gSha, dSha] = [await page(SOURCE), await page(GOOD), await page(DRAFT)];
check(sha(Buffer.from(await (await fetch(EDITED)).arrayBuffer())) !== gSha, "the edited copy differs from the hashed translation");
const client = a0.address, translator = a1.address;
const jid = Number((await read("get_jobs", [0, 1])).total);

// Jobs: the source must match its hash; the translator must be someone else.
await fails("a source that differs from its hash is rejected", c0, "create with a stale source hash", "create_job", [translator, SOURCE, "0".repeat(64), "Vietnamese", TERMS, 1], { value: FEE });
await fails("the translator must be someone else", c0, "create for oneself", "create_job", [client, SOURCE, sSha, "Vietnamese", TERMS, 1], { value: FEE });
await ok(c0, "create_job", "create_job", [translator, SOURCE, sSha, "Vietnamese", TERMS, 1], { value: FEE });
let j = await settled("get_job", [jid], (x) => x.status === "OPEN");
check(j.translator.toLowerCase() === translator.toLowerCase() && BigInt(j.amount) === FEE && j.source_sha256 === sSha, "job escrows the fee, source pinned");

// Submissions: a draft with a missing paragraph is rejected, nothing paid.
await fails("only the translator submits", c0, "submit by the client", "submit", [jid, GOOD, gSha], { payee: translator });
await ok(c1, "submit the draft", "submit", [jid, DRAFT, dSha], { payee: translator });
j = await settled("get_job", [jid], (x) => Number(x.attempts) === 1);
let subs = (await read("get_submissions", [jid, 0, 10])).items;
check(j.status === "OPEN" && j.attempts_left == 2 && subs[0].issues.includes("omission"), `draft rejected: ${subs[0].issues.join(", ")}; 2 attempts left`);
console.log("    note (unverified):", subs[0].note);
// A page that changed after it was hashed: reverts, no attempt used.
check((await tx(c1, "submit a changed page", "submit", [jid, EDITED, gSha], { payee: translator })).txExecutionResultName !== "FINISHED_WITH_RETURN", "content changed after hashing reverts");
check(Number((await read("get_job", [jid])).attempts) === 1, "no attempt used");

// The fixed translation is paid and pinned.
const pid = Number((await read("get_accounting")).payout_count);
const paid = await ok(c1, "submit the fixed translation", "submit", [jid, GOOD, gSha], { payee: translator });
j = await settled("get_job", [jid], (x) => x.status === "PAID");
subs = (await read("get_submissions", [jid, 0, 10])).items;
check(j.status === "PAID" && j.translation_sha256 === gSha && j.translation_url === GOOD && subs.length === 2 && subs[1].issues.length === 0, "PAID, translation hash stored");
console.log("    note (unverified):", subs[1].note);
await fails("a paid job takes no more submissions", c1, "submit again", "submit", [jid, GOOD, gSha], { payee: translator });
const tr = await read("get_translator", [translator]);
check(Number(tr.paid) >= 1, `translator record: ${tr.paid} paid, ${tr.rejected} rejected`);

// A second job, declined by the translator: the client is refunded.
await ok(c0, "create a second job", "create_job", [translator, SOURCE, sSha, "Vietnamese", "[]", 1], { value: SMALL });
await fails("only the translator declines", c0, "decline by the client", "decline", [jid + 1], { payee: client });
const declined = await ok(c1, "decline", "decline", [jid + 1], { payee: client });
check((await settled("get_job", [jid + 1], (x) => x.status === "REFUNDED")).status === "REFUNDED", "declined job REFUNDED");

const p0 = await read("get_payout", [pid]), p1 = await settled("get_payout", [pid + 1], (x) => x.kind === "declined");
check(p0.kind === "paid" && BigInt(p0.amount) === FEE && p0.to.toLowerCase() === translator.toLowerCase(), `payout ${pid}: fee to the translator`);
check(BigInt(p1.amount) === SMALL && p1.to.toLowerCase() === client.toLowerCase(), `payout ${pid + 1}: refund to the client`);
await settle(pid, paid, fromBlock);
await settle(pid + 1, declined, fromBlock);
check(BigInt((await read("get_accounting")).unaccounted) === stray, `balance matches what the contract expects to hold (+${stray} from unexecuted or reverted txs)`);
console.log("contract", address, "jobs", jid, jid + 1);
