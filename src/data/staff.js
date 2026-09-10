/**
 * Staff roles. Salary is monthly. Each role feeds one of five bonus channels
 * the simulation actually reads.
 */
export const STAFF_ROLES = [
  { id: 'gm',        name: 'General Manager',   dept: 'Management', salary: 22_000, channel: 'management', effect: 0.10, desc: 'Improves every other department slightly.' },
  { id: 'finance',   name: 'Finance Director',  dept: 'Management', salary: 16_000, channel: 'finance',    effect: 0.10, desc: 'Cuts running costs by up to 10%.' },
  { id: 'eventdir',  name: 'Event Director',    dept: 'Management', salary: 19_000, channel: 'events',     effect: 0.12, desc: 'Raises bid strength and event delivery.' },
  { id: 'maint',     name: 'Maintenance Manager',dept:'Operations', salary: 11_000, channel: 'operations', effect: 0.10, desc: 'Reduces facility wear and maintenance cost.' },
  { id: 'grounds',   name: 'Head Groundskeeper',dept: 'Operations', salary: 9_000,  channel: 'operations', effect: 0.08, desc: 'Keeps playing surfaces at regulation standard.' },
  { id: 'cleaning',  name: 'Cleaning Manager',  dept: 'Operations', salary: 7_500,  channel: 'operations', effect: 0.06, desc: 'Higher fan satisfaction, lower cleaning cost.' },
  { id: 'coord',     name: 'Event Coordinator', dept: 'Events',     salary: 10_000, channel: 'events',     effect: 0.08, desc: 'Smoother event days, fewer incidents.' },
  { id: 'hosp',      name: 'Hospitality Manager',dept: 'Events',    salary: 12_000, channel: 'hospitality',effect: 0.12, desc: 'Increases VIP and hospitality revenue.' },
  { id: 'ticket',    name: 'Ticketing Manager', dept: 'Events',     salary: 9_500,  channel: 'marketing',  effect: 0.08, desc: 'Improves attendance conversion.' },
  { id: 'secmgr',    name: 'Security Manager',  dept: 'Security',   salary: 12_500, channel: 'security',   effect: 0.14, desc: 'Reduces the chance of security incidents.' },
  { id: 'stewards',  name: 'Steward Team',      dept: 'Security',   salary: 15_000, channel: 'security',   effect: 0.10, desc: 'Faster gate processing on event day.' },
  { id: 'marketing', name: 'Marketing Director',dept: 'Marketing',  salary: 14_000, channel: 'marketing',  effect: 0.14, desc: 'Raises attendance across all events.' },
  { id: 'social',    name: 'Social Media Manager',dept:'Marketing', salary: 6_500,  channel: 'marketing',  effect: 0.07, desc: 'Small attendance and reputation gains.' },
  { id: 'coach',     name: 'Coaching Staff',    dept: 'Sports',     salary: 13_000, channel: 'sports',     effect: 0.10, desc: 'Attracts resident teams and training income.' },
  { id: 'medic',     name: 'Sports Medicine',   dept: 'Sports',     salary: 11_500, channel: 'sports',     effect: 0.10, desc: 'Raises athlete reputation.' },
];

export const STAFF_CHANNELS = ['management', 'finance', 'events', 'operations', 'hospitality', 'marketing', 'security', 'sports'];

export function makeHire(role, rng) {
  const skill = Math.round(rng.range(38, 92));
  const experience = Math.round(rng.range(1, 22));
  return {
    uid: `S${Math.floor(rng() * 1e9)}`,
    roleId: role.id,
    name: randomName(rng),
    skill,
    experience,
    morale: 72,
    salary: Math.round(role.salary * (0.7 + (skill / 100) * 0.7) * (1 + experience / 60)),
  };
}

const FIRST = ['Ada', 'Rune', 'Nora', 'Idris', 'Sol', 'Mira', 'Kaito', 'Elin', 'Osei', 'Tova', 'Reza', 'Juno', 'Lech', 'Sanne', 'Amara', 'Bo'];
const LAST = ['Vance', 'Okonjo', 'Halvorsen', 'Marchetti', 'Ferreira', 'Lindqvist', 'Aziz', 'Brennan', 'Novak', 'Delacroix', 'Sato', 'Adeyemi', 'Kaur', 'Weiss'];
function randomName(rng) { return `${rng.pick(FIRST)} ${rng.pick(LAST)}`; }
