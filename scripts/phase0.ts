import { readFile } from 'node:fs/promises';

type Evidence = { device?: { model: string; ios: string }; channels?: Record<string, { eligible: number; automatic: number; falseMerges: number; incomplete: number; lockedPassed: boolean; offlinePassed: boolean; retryPassed: boolean; locationDeniedPassed: boolean }>;
  totalTransactions?: number; bankProfilesVerified?: boolean; fullPeriodReconciled?: boolean; backupRestoreVerified?: boolean;
  hostedAuthVerified?: boolean; pwaVerified?: boolean; dependencyAuditVerified?: boolean; monthlyEstimateUSD?: number; actualBillingMonthUSD?: number };
const path = process.argv.find(a => a.endsWith('.json')) ?? '.local/phase0.json';
let evidence: Evidence = {};
try { evidence = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const checks: [string, boolean][] = [
  ['Exact iPhone model and iOS recorded', Boolean(evidence.device?.model && evidence.device?.ios)],
  ['At least 20 real-world transactions observed', (evidence.totalTransactions ?? 0) >= 20],
  ...['sms', 'wallet'].map(channel => { const c = evidence.channels?.[channel]; return [`${channel}: >=5 events, >=90% automatic, zero false merges, lock/offline/retry/location tests`, Boolean(c && c.eligible >= 5 && c.automatic <= c.eligible && c.automatic / c.eligible >= .9 && c.falseMerges === 0 && c.lockedPassed && c.offlinePassed && c.retryPassed && c.locationDeniedPassed)] as [string, boolean]; }),
  ['Actual Bancolombia CSV/XLSX profiles verified', evidence.bankProfilesVerified === true],
  ['Complete account periods reconciled to independent statements', evidence.fullPeriodReconciled === true],
  ['Backup restored into isolated environment', evidence.backupRestoreVerified === true],
  ['Hosted Cognito callback/logout/session expiry verified', evidence.hostedAuthVerified === true],
  ['Installed PWA launch verified on the iPhone', evidence.pwaVerified === true],
  ['Current dependency advisory audit reviewed', evidence.dependencyAuditVerified === true],
  ['Estimated monthly total below USD 5 (including taxes)', evidence.monthlyEstimateUSD !== undefined && evidence.monthlyEstimateUSD >= 0 && evidence.monthlyEstimateUSD < 5],
  ['Actual complete billing month below USD 5', evidence.actualBillingMonthUSD !== undefined && evidence.actualBillingMonthUSD >= 0 && evidence.actualBillingMonthUSD < 5],
];
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'PENDING'} ${name}`);
for (const channel of ['sms', 'wallet']) { const c = evidence.channels?.[channel]; if (c) console.log(`${channel}: ${c.incomplete}/${c.eligible} observations missing financial fields; capture coverage is not field completeness.`); }
const pending = checks.filter(([, pass]) => !pass).length;
console.log(pending ? `\nNot release-ready: ${pending} evidence gates remain. See docs/PHASE_0.md.` : '\nAll recorded release gates pass; retain the supporting private evidence.');
if (process.argv.includes('--check') && pending) process.exitCode = 1;
