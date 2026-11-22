// Sign-before-reveal arms against real Rekor entries (swipepredictbot, 10-31, KNOWN-ISSUES). On 2026-10-30 piiiico/errata-witness-scratch
// signed one intent blob twice with keyless cosign, from two pushes of its table.yml (commits 3074d98 "sign 1" and 0361cf3 "sign 2"),
// and Rekor logged both: 3584424831 and 3584436939, 41 s apart. These arms re-run that check with this repo's own entries() and
// bindFail(), so a later edit to scripts/witness.ts that breaks the binding fails here. Network: Rekor and Fulcio, as validate.ts uses.
// Usage: bun scripts/intent-arms.ts — exits 1 if an arm fails.
import { entries, intentBlob, boundRound, bindFail, IDENTITY } from "./witness.ts";
import { roundTime } from "./draw.ts";

const fails: string[] = [];
const arm = (name: string, ok: boolean, got: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}`); if (!ok) fails.push(name); };

const SCRATCH = "https://github.com/piiiico/errata-witness-scratch/.github/workflows/table.yml@refs/heads/main";
const SERIAL = "ZT1793333804-01"; // the scratch repo's intent.txt; the blob is "agent-errata serial ZT1793333804-01\n"
const FIRST = { logIndex: 3584424831, at: "3074d983a7a1edecf888125c274f55f949d03bc3" };
const SECOND = { logIndex: 3584436939, at: "0361cf35a16d2f6b87d8ede1b7649415df0c4349" };

const { ok, reasons } = await entries(intentBlob({ serial: SERIAL }), SCRATCH);
// Both signatures verify (log signature, hashedrekord, Fulcio cert naming the scratch workflow, push trigger), lowest logIndex first,
// each with the commit its run was at.
arm("both entries verify, earliest first, each at its own push", reasons.length === 0 && ok.length === 2
  && ok[0].logIndex === FIRST.logIndex && ok[0].at === FIRST.at && ok[1].logIndex === SECOND.logIndex && ok[1].at === SECOND.at,
  { ok: ok.map((e) => [e.logIndex, e.integratedTime, String(e.at).slice(0, 7)]), reasons });
if (ok.length !== 2) { console.error("cannot run the binding arms without both entries"); process.exit(1); }

const [e1, e2] = ok;
const r1 = boundRound(e1.integratedTime), r2 = boundRound(e2.integratedTime);
// The second signature would bind a later round, so "re-signing changes nothing" is a real claim on this data, not a tie.
arm("the two entries would bind different rounds", r1 !== r2, { first: r1, second: r2, gap_s: e2.integratedTime - e1.integratedTime });
arm("the earliest entry's round is published at least 90 s after it was logged", roundTime(r1) - e1.integratedTime >= 90, roundTime(r1) - e1.integratedTime);

// The earliest entry binds: a beacon with its round and logIndex is green.
const g = bindFail({ round: r1, witness: e1.logIndex }, ok);
arm("beacon on the earliest entry's round is green", g === "", g);
// Control (the one that ran on 10-30): the latest entry binds instead of the earliest. Re-signing must not move the round.
const late = bindFail({ round: r2, witness: e2.logIndex }, ok);
arm("control: beacon on the latest entry's round is red", late !== "", late);
// Earliest round, but naming the later entry as witness: also red, the witness must be the earliest entry.
const mixed = bindFail({ round: r1, witness: e2.logIndex }, ok);
arm("control: earliest round with the later entry as witness is red", mixed !== "", mixed);
// No entry at all (the blob never signed before the round): red.
const none = bindFail({ round: r1, witness: e1.logIndex }, []);
arm("control: no intent entry is red", none !== "", none);

// Identity: the same entries do not verify as this repo's table.yml, so a signature from another repo's workflow binds nothing here.
const here = await entries(intentBlob({ serial: SERIAL }), IDENTITY);
arm("the scratch repo's entries do not verify as this repo's table.yml", here.ok.length === 0 && here.reasons.length === 2, here.reasons);

if (fails.length) { console.error(`${fails.length} arm(s) failed`); process.exit(1); }
