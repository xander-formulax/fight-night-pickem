// The 16 optional build phases on the Jobs board.
//
// `scope` is the Yes/No column saying whether this phase applies to a given home.
// `rel` is the Jobs -> Tasks board-relation column pointing at the task that does it.
//
// Order here is the natural build order, and is the tie-breaker when sorting
// pending work that has no scheduled date.
//
// NOTE: Jobs currently has TWO *Site Checks relation columns
// (board_relation_mm2q8sc1 and board_relation_mm33z95n). Delete one in monday
// before going live or Site Check double-counts in every report.
export const PHASES = [
  { name: 'Site Check',       scope: 'color_mm2qm6zb', rel: 'board_relation_mm2q8sc1' },
  { name: 'Pad',              scope: 'color_mm2k7s99', rel: 'board_relation_mm2m2958' },
  { name: 'Foundation',       scope: 'color_mm2qs16d', rel: 'board_relation_mm2qtwjy' },
  { name: 'Break and Wrap',   scope: 'color_mm2qtpcz', rel: 'board_relation_mm2qgcwy' },
  { name: 'Delivery',         scope: 'color_mm2k79p8', rel: 'board_relation_mm2m6y9s' },
  { name: 'Tie Downs',        scope: 'color_mm66xtqf', rel: 'board_relation_mm665mqd' },
  { name: 'Set Up',           scope: 'color_mm2kyeav', rel: 'board_relation_mm2ms4mb' },
  { name: 'Steps',            scope: 'color_mm2p7ksn', rel: 'board_relation_mm2tkzqz' },
  { name: 'Skirting',         scope: 'color_mm2q5cjc', rel: 'board_relation_mm2qg0cj' },
  { name: 'Electric Service', scope: 'color_mm2q2npg', rel: 'board_relation_mm2qgtf4' },
  { name: 'Electric Hookup',  scope: 'color_mm2mtqf1', rel: 'board_relation_mm2vbqvw' },
  { name: 'Water Well',       scope: 'color_mm2nt68q', rel: 'board_relation_mm2nfkr9' },
  { name: 'Water Hookup',     scope: 'color_mm2qy1ht', rel: 'board_relation_mm2qdf8f' },
  { name: 'Septic Install',   scope: 'color_mm2q78hf', rel: 'board_relation_mm2qm8xv' },
  { name: 'Septic Hookup',    scope: 'color_mm2qa62q', rel: 'board_relation_mm2q32n9' },
  { name: 'Trim Out',         scope: 'color_mm2qqrab', rel: 'board_relation_mm2qxtvf' },
];

export const BOARDS = {
  vendors: 18409503080,
  jobs:    18409503078,
  tasks:   18409523534,
};

export const TASK_COLUMNS = {
  status:   'color_mm2v7xnr',
  schedule: 'timerange_mm2wxekj',
  finished: 'date_mm35m8t7',
};

// Invoiced is a billing state, not a work state. To a vendor it reads as
// finished work, so it counts as complete alongside Done.
export const COMPLETE_STATUSES = new Set(['Done', 'Invoiced']);
