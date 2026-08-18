import type { Policy } from './types.js';

export const DEFAULT_POLICIES: Policy[] = [
  {
    id: 'block-destructive-shell',
    tool: '*',
    action: 'block',
    condition: 'arg_contains',
    value: 'rm -rf',
  },
  {
    id: 'block-fork-bomb',
    tool: '*',
    action: 'block',
    condition: 'arg_contains',
    value: ':(){',
  },
  {
    id: 'block-sql-destructive',
    tool: '*',
    action: 'block',
    condition: 'arg_contains',
    value: 'DROP TABLE',
  },
  {
    id: 'block-sql-truncate',
    tool: '*',
    action: 'block',
    condition: 'arg_contains',
    value: 'TRUNCATE',
  },
  {
    id: 'block-path-traversal',
    tool: '*',
    action: 'block',
    condition: 'arg_contains',
    value: '..\\',
  },
  {
    id: 'review-network-commands',
    tool: '*',
    action: 'review',
    condition: 'arg_contains',
    value: 'curl ',
  },
];
