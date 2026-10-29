// Asserts which FaithfulPay app controls appear per role and job state, and that GEN amounts are exact
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
const make = new Function("esc", "gen", "B", "ctx", `let me = ctx.me; ${body}; return { actions, verdict };`);
const T = "0xTranslator", NOW = 1000;
const job = { id: 0, client: "0xClient", translator: T, amount: 10n ** 15n, status: "OPEN", attempts: 0, attempts_left: 3, deadline: NOW + 1, refundable: false };
const fns = (me) => make(esc, gen, BigInt, { me });
const run = (me, j = {}, recov = 0) => fns(me).actions({ ...job, ...j }, recov, NOW);
const check = (name, ok) => { console.log(ok ? "ok  " : "FAIL", name); if (!ok) process.exitCode = 1; };

check("no wallet: prompt only", run(null).includes("Connect a wallet") && !run(null).includes("form"));
check("translator (case-insensitive): submit with url and hash, attempts left, decline", /data-form="submit"[\s\S]*name="url"[\s\S]*name="sha"/.test(run("0xtranslator")) && run(T).includes("3 attempts left") && run(T).includes('data-form="decline"'));
check("client and others: no submit, no decline", ["0xClient", "0xother"].every((m) => !run(m).includes('data-form="submit"') && !run(m).includes("decline")));
check("no submit after the deadline or with no attempts left", !run(T, { deadline: NOW - 1 }).includes('data-form="submit"') && !run(T, { attempts_left: 0 }).includes('data-form="submit"'));
check("refund only when the contract says refundable, for anyone", run("0xother", { refundable: true }).includes('data-form="refund"') && !run("0xother").includes("refund"));
check("refund explains why", run("0xother", { refundable: true, attempts_left: 0 }).includes("All attempts were rejected") && run("0xother", { refundable: true }).includes("deadline has passed"));
check("closed job: no job controls", ["PAID", "REFUNDED"].every((s) => !/data-form="(submit|decline|refund)"/.test(run(T, { status: s, refundable: true }))));
check("recover only with a failed transfer", run("0xother", {}, 5n).includes('data-form="recover"') && !run("0xother", {}, 0n).includes("recover"));
const v = fns(T).verdict;
check("verdict: faithful, note kept apart", /faithful[\s\S]*not verified by consensus\): all there/.test(v({ issues: [], note: "all there" }, [])));
check("verdict: issue codes named, terms resolved", /omission[\s\S]*missing term “Hill Street”/.test(v({ issues: ["omission", "missing_term:0"], note: "" }, ["Hill Street"])));
check("verdict: note and terms are escaped", !v({ issues: ["missing_term:0"], note: "<img src=x onerror=alert(1)>" }, ["x"]).includes("<img") && !v({ issues: ["missing_term:0"], note: "" }, ["<script>x"]).includes("<script>"));

// Money: exact in both directions, no floating point.
check("exact amounts", gen(10n ** 14n) === "0.0001" && gen(1) === "0.000000000000000001" && gen(0) === "0");
check("amounts past 2^53 stay exact", gen(9007199254740993n) === "0.009007199254740993" && toWei("0.009007199254740993") === 9007199254740993n);
check("toWei rejects bad input", ["", ".", "1e3", "-1", "0.1234567890123456789", "1,5"].every((s) => { try { toWei(s); return false; } catch { return true; } }));
