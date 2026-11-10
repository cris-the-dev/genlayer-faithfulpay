// Asserts which FaithfulPay app controls appear per role, job state and section state, and that GEN amounts are exact
// (run: node app/check-actions.mjs app/index.html).
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = js.slice(js.indexOf("function actions"), js.indexOf("async function show"));
// gen / toWei come straight from gl.js (which imports the browser bundle, so it is not loaded whole).
const gl = readFileSync(new URL("./gl.js", import.meta.url), "utf8");
const pick = (name) => gl.slice(gl.indexOf(`export const ${name} =`), gl.indexOf("\n};\n", gl.indexOf(`export const ${name} =`)) + 3).replace("export ", "");
const { gen, toWei } = new Function(`${pick("gen")}\n${pick("toWei")}\nreturn { gen, toWei };`)();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = js.match(/const plural = .*;/)[0];
const make = new Function("esc", "gen", "B", "ctx", `let me = ctx.me; ${plural} ${body}; return { actions, verdict };`);
const T = "0xTranslator", NOW = 1000, SHARE = 5n * 10n ** 14n;
const sec = (id, o = {}) => ({ id, status: "OPEN", attempts: 0, attempts_left: 3, refundable: false, ...o });
const job = { id: 0, client: "0xClient", translator: T, amount: 2n * SHARE, share: SHARE, status: "ASSIGNED", days: 7, deadline: NOW + 1, refundable: false, applicants: [], sections: [sec(4), sec(5)] };
const fns = (me) => make(esc, gen, BigInt, { me });
const run = (me, j = {}, recov = 0) => fns(me).actions({ ...job, ...j }, recov, NOW);
const count = (s, x) => s.split(x).length - 1;
const check = (name, ok) => { console.log(ok ? "ok  " : "FAIL", name); if (!ok) process.exitCode = 1; };

check("no wallet: prompt only", run(null).includes("Connect a wallet") && !run(null).includes("form"));
check("translator (case-insensitive): one submit per open section, by section id", count(run("0xtranslator"), 'data-form="submit"') === 2 && run(T).includes('data-section="5"') && /name="url"[\s\S]*name="sha"/.test(run(T)) && run(T).includes("Submit section 2 (3 attempts left)"));
check("paid or exhausted sections take no submit", count(run(T, { sections: [sec(4, { status: "PAID", attempts_left: 0 }), sec(5, { attempts_left: 0, attempts: 3 })] }), 'data-form="submit"') === 0);
check("decline refunds only the unpaid sections", run(T, { sections: [sec(4, { status: "PAID" }), sec(5)] }).includes("0.0005 GEN for the unpaid") && !run(T, { sections: [sec(4, { status: "PAID" })] }).includes("decline"));
check("client and others: no submit, no decline", ["0xClient", "0xother"].every((m) => !run(m).includes('data-form="submit"') && !run(m).includes("decline")));
check("no submit after the deadline", !run(T, { deadline: NOW - 1 }).includes('data-form="submit"'));
check("refund only when the contract says refundable, for what is due", run("0xother", { refundable: true, sections: [sec(4, { refundable: true }), sec(5)] }).includes("Refund 0.0005 GEN") && !run("0xother").includes("refund"));
check("refund explains why", run("0xother", { refundable: true, deadline: NOW - 1 }).includes("deadline has passed") && run("0xother", { refundable: true }).includes("All attempts were rejected"));
check("closed job: no job controls", ["DONE", "REFUNDED"].every((s) => !/data-form="(submit|decline|refund|apply|assign|cancel)"/.test(run(T, { status: s, refundable: true }))));
const open = { status: "OPEN", translator: null, deadline: 0 };
check("open job: others apply, the client cannot", run("0xother", open).includes('data-form="apply"') && !run("0xClient", open).includes('data-form="apply"'));
check("open job: an applicant can withdraw instead", run("0xother", { ...open, applicants: [{ address: "0xOTHER", paid: 1, rejected: 0 }] }).includes('data-form="withdraw_application"'));
check("open job: no apply past 20 applicants", !run("0xother", { ...open, applicants: Array.from({ length: 20 }, (_, i) => ({ address: `0x${i}`, paid: 0, rejected: 0 })) }).includes("<button>Apply"));
check("open job: the client assigns an applicant or cancels", /data-form="assign"[\s\S]*0xA1 · 2 paid, 1 refunded[\s\S]*data-form="cancel"/.test(run("0xClient", { ...open, applicants: [{ address: "0xA1", paid: 2, rejected: 1 }] })) && !run("0xClient", open).includes('data-form="assign"') && !run("0xother", open).includes('data-form="cancel"'));
check("open job: no submit, decline or refund", !/data-form="(submit|decline|refund)"/.test(run(T, { ...open, refundable: true })));
check("recover only with a failed transfer", run("0xother", {}, 5n).includes('data-form="recover"') && !run("0xother", {}, 0n).includes("recover"));
const v = fns(T).verdict;
check("verdict: faithful, note kept apart", /faithful[\s\S]*not verified by consensus\): all there/.test(v({ issues: [], note: "all there" }, [])));
check("verdict: issue codes named, terms resolved", /omission[\s\S]*missing term “Hill Street”/.test(v({ issues: ["omission", "missing_term:0"], note: "" }, ["Hill Street"])));
check("verdict: note and terms are escaped", !v({ issues: ["missing_term:0"], note: "<img src=x onerror=alert(1)>" }, ["x"]).includes("<img") && !v({ issues: ["missing_term:0"], note: "" }, ["<script>x"]).includes("<script>"));
check("applicant addresses are escaped", !run("0xClient", { ...open, applicants: [{ address: "<img src=x>", paid: 0, rejected: 0 }] }).includes("<img"));

// Money: exact in both directions, no floating point.
check("exact amounts", gen(10n ** 14n) === "0.0001" && gen(1) === "0.000000000000000001" && gen(0) === "0");
check("amounts past 2^53 stay exact", gen(9007199254740993n) === "0.009007199254740993" && toWei("0.009007199254740993") === 9007199254740993n);
check("toWei rejects bad input", ["", ".", "1e3", "-1", "0.1234567890123456789", "1,5"].every((s) => { try { toWei(s); return false; } catch { return true; } }));
