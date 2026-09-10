import { DAYS_PER_MONTH } from './constants.js';

export const LEDGER_CATEGORIES = {
  tickets: 'Ticketing', vip: 'VIP & Hospitality', food: 'Food & Beverage',
  merch: 'Merchandise', parking: 'Parking', sponsorship: 'Sponsorship',
  broadcast: 'Broadcasting', venueFee: 'Venue Fees', revenueShare: 'Revenue Share',
  retail: 'Retail & Advertising', training: 'Training & Memberships',
  operations: 'Daily Operations', construction: 'Construction', maintenance: 'Maintenance', staff: 'Staff Salaries',
  utilities: 'Utilities', security: 'Security', insurance: 'Insurance',
  marketing: 'Marketing', eventCosts: 'Event Operations', land: 'Land Purchase',
  research: 'Research', loan: 'Loan Interest', misc: 'Other',
};

/** Compute the complex's recurring monthly position. */
export function monthlyFinance(state, analysis) {
  const complex = analysis?.complex;
  const income = {};
  const expense = {};

  // --- income -------------------------------------------------------------
  let sponsorship = 0;
  for (const s of state.sponsors) sponsorship += s.annual / 12;
  income.sponsorship = Math.round(sponsorship);

  const passive = complex ? complex.passiveRevenue : 0;
  income.retail = Math.round(passive * 30);

  const trainingVox = state.derived.trainingVoxels || 0;
  income.training = Math.round(trainingVox * 220 + state.staffBonus.sports * 40_000);

  // --- expense ------------------------------------------------------------
  const financeCut = 1 - state.staffBonus.finance * 0.10;
  const maintFactor = (1 - state.staffBonus.operations * 0.14) * state.wearFactor;
  expense.maintenance = Math.round((complex ? complex.maintenance : 0) * 30 * maintFactor * financeCut);
  expense.staff = Math.round(state.staff.reduce((s, h) => s + h.salary, 0) * state.salaryMult);
  expense.utilities = Math.round(((complex ? complex.powerDemand : 0) * 900 + 12_000) * financeCut);
  expense.insurance = Math.round((5_000 + (state.derived.bestCapacity || 0) * 1.1) * financeCut);
  expense.marketing = Math.round(8_000 + state.staff.filter((h) => h.roleId === 'marketing').length * 4_000);
  expense.loan = Math.round(state.loans.reduce((s, l) => s + l.balance * l.rate / 12, 0));

  const totalIncome = Object.values(income).reduce((a, b) => a + b, 0);
  const totalExpense = Object.values(expense).reduce((a, b) => a + b, 0);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

/** Apply one day's share of the recurring position. */
export function applyDailyFinance(state, analysis, record) {
  const m = monthlyFinance(state, analysis);
  const perDay = 1 / DAYS_PER_MONTH;
  for (const [k, v] of Object.entries(m.income)) if (v) record(k, v * perDay);
  for (const [k, v] of Object.entries(m.expense)) if (v) record(k, -v * perDay);
  return m;
}

export function takeLoan(state, amount, years = 5) {
  const rate = 0.055 + Math.max(0, (0.4 - state.reputation.venue / 100)) * 0.06;
  state.loans.push({
    id: `L${Date.now().toString(36)}`,
    principal: amount, balance: amount, rate: +rate.toFixed(4),
    years, takenDay: state.day,
  });
  return rate;
}

export function loanCapacity(state, analysis) {
  const assetValue = (analysis?.complex.totalBlocks || 0) * 65 + (state.derived.bestCapacity || 0) * 180;
  const outstanding = state.loans.reduce((s, l) => s + l.balance, 0);
  return Math.max(0, Math.round(assetValue * 0.55 - outstanding));
}

export function repayLoan(state, loanId, amount) {
  const l = state.loans.find((x) => x.id === loanId);
  if (!l) return 0;
  const pay = Math.min(amount, l.balance);
  l.balance -= pay;
  if (l.balance <= 1) state.loans = state.loans.filter((x) => x.id !== loanId);
  return pay;
}

export const fmtMoney = (v, opts = {}) => {
  const n = Math.round(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : (opts.sign && n > 0 ? '+' : '');
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${abs.toLocaleString()}`;
};

export const fmtNum = (v) => Math.round(v).toLocaleString();
