// A hand-built fixture standing in for real board data, used by the preview
// script and as a stable input for rendering checks.
import { PHASES } from '../src/phases.js';

const scope = (names) =>
  Object.fromEntries(PHASES.filter((p) => names.includes(p.name)).map((p) => [p.scope, 'Yes']));
const rels = (names, prefix) =>
  Object.fromEntries(names.map((n) => [n, `${prefix}:${n}`]));

function home(id, name, address, inScope) {
  return { id, name, address, scope: scope(inScope), taskIdByPhase: rels(inScope, id) };
}

const PIERCE = ['Site Check', 'Pad', 'Foundation', 'Break and Wrap', 'Delivery', 'Tie Downs',
  'Set Up', 'Steps', 'Skirting', 'Electric Hookup', 'Trim Out'];
const DURAN = ['Site Check', 'Pad', 'Foundation', 'Delivery', 'Tie Downs', 'Set Up', 'Steps',
  'Skirting', 'Trim Out'];
const ROJAS = ['Site Check', 'Pad', 'Foundation', 'Break and Wrap', 'Delivery', 'Tie Downs',
  'Set Up', 'Steps', 'Skirting', 'Electric Hookup', 'Trim Out'];

const t = (job, phase, status, extra = {}) => ({ id: `${job}:${phase}`, status, ...extra });

export const week = { start: '2026-08-17', end: '2026-08-23' };

export const vendor = { id: '9001', name: 'Titan Midland' };

export const jobs = [
  home('p', 'William Pierce', '1204 CR 210, Seminole, TX 79360', PIERCE),
  home('d', 'Keyla Duran', '3417 W Ohio Ave, Midland, TX 79703', DURAN),
  home('r', 'Andrea Rojas', '905 E Cuthbert Ave, Midland, TX 79701', ROJAS),
];

export const tasksById = new Map([
  // William Pierce — 7 of 11, two finished this week
  t('p', 'Site Check', 'Done', { finishedDate: '2026-07-14' }),
  t('p', 'Foundation', 'Done', { finishedDate: '2026-08-04' }),
  t('p', 'Break and Wrap', 'Invoiced', { finishedDate: '2026-08-11' }),
  t('p', 'Tie Downs', 'Done', { finishedDate: '2026-08-12' }),
  t('p', 'Steps', 'Done', { finishedDate: '2026-08-13' }),
  t('p', 'Pad', 'Done', { finishedDate: '2026-08-18' }),
  t('p', 'Delivery', 'Done', { finishedDate: '2026-08-20' }),
  t('p', 'Set Up', 'Working on it', { scheduleStart: '2026-08-21' }),
  t('p', 'Skirting', 'Not done', { scheduleStart: '2026-08-24' }),
  t('p', 'Electric Hookup', 'Not done', { scheduleStart: '2026-08-26' }),
  t('p', 'Trim Out', 'Not done'),
  // Keyla Duran — finished, last task closed this week
  ...DURAN.map((p) => t('d', p, 'Done', { finishedDate: '2026-08-05' })),
  t('d', 'Trim Out', 'Done', { finishedDate: '2026-08-19' }),
  // Andrea Rojas — early, nothing closed this week
  t('r', 'Site Check', 'Done', { finishedDate: '2026-08-06' }),
  t('r', 'Foundation', 'Invoiced', { finishedDate: '2026-08-10' }),
  t('r', 'Pad', 'Not done', { scheduleStart: '2026-08-25' }),
  t('r', 'Delivery', 'Not done', { scheduleStart: '2026-08-28' }),
  t('r', 'Electric Hookup', 'Waiting'),
].map((x) => [x.id, x]));
