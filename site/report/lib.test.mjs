import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, applies, score, grade, gain, needsWork, tally } from './lib.js';

test('normalizeUrl accepts bare domains and strips www', () => {
  assert.deepEqual(normalizeUrl(' Alliance.xyz/apply '), { host: 'alliance.xyz' });
  assert.deepEqual(normalizeUrl('https://www.example.co.uk'), { host: 'example.co.uk' });
  assert.ok(normalizeUrl('').error);
  assert.ok(normalizeUrl('localhost').error);
  assert.ok(normalizeUrl('ftp://example.com').error);
  assert.ok(normalizeUrl('http://exa mple.com').error);
});

const checks = [
  { id: 'F1', layer: 'find', strength: 'MUST', status: 'pass' },
  { id: 'F4', layer: 'find', strength: 'MAY', status: 'fail' },
  { id: 'R8', layer: 'read', strength: 'SHOULD', status: 'warn' },
  { id: 'R4', layer: 'read', strength: 'SHOULD', status: 'fail', when: ['docs'] },
  { id: 'A3', layer: 'act', strength: 'SHOULD', status: 'fail', when: ['act'] },
  { id: 'A7', layer: 'act', strength: 'SHOULD', status: 'untested', when: ['act'] },
];
const readOnly = { act: false, docs: false };
const operated = { act: true, docs: false };

test('checks that do not apply are left out of the score instead of failing it', () => {
  assert.equal(applies(checks[3], readOnly), false);
  // find: 3 / (3 + 1) = 75; read: 1 / 2 = 50; overall: 4 / 6 = 67
  assert.deepEqual(score(checks, readOnly), { overall: { value: 67, checks: 3 }, layers: { find: { value: 75, checks: 2 }, read: { value: 50, checks: 1 }, act: null } });
  // act adds a 0/2 check; untested is never scored: 4 / 8 = 50
  assert.equal(score(checks, operated).overall.value, 50);
});

test('gain is weighted by strength and partial credit', () => {
  assert.equal(gain(checks[1], checks, readOnly), 17);  // 1 / 6
  assert.equal(gain(checks[2], checks, readOnly), 17);  // 2 * 0.5 / 6
  assert.equal(gain(checks[0], checks, readOnly), 0);
  assert.equal(gain(checks[4], checks, readOnly), 0);   // doesn't apply
});

test('needsWork ranks by strength, then failures first', () => {
  assert.deepEqual(needsWork(checks, readOnly).map(c => c.id), ['R8', 'F4']);
  assert.deepEqual(needsWork(checks, operated).map(c => c.id), ['A3', 'R8', 'F4']);
  assert.deepEqual(tally(checks, readOnly), { pass: 1, warn: 1, fail: 1, untested: 0, na: 3 });
});

test('grade bands', () => {
  assert.equal(grade(92), 'A');
  assert.equal(grade(76), 'C');
  assert.equal(grade(50), 'D');
  assert.equal(grade(12), 'F');
});
