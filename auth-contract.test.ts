import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenRole } from './src/auth/auth.service';

test('privileged roles normalize to stable API roles', () => {
  assert.equal(tokenRole({ role: 'super_admin', hasHqAccess: false }), 'hq_admin');
  assert.equal(tokenRole({ role: 'zone_coordinator', hasHqAccess: false }), 'zone_admin');
  assert.equal(tokenRole({ role: 'subgroup_admin', hasHqAccess: false }), 'zone_admin');
  assert.equal(tokenRole({ role: 'church_coordinator', hasHqAccess: false }), 'church_coordinator');
});

test('HQ access flag overrides the stored role', () => {
  assert.equal(tokenRole({ role: 'member', hasHqAccess: true }), 'hq_admin');
});

test('ordinary users remain ordinary users', () => {
  assert.equal(tokenRole({ role: 'user', hasHqAccess: false }), 'member');
  assert.equal(tokenRole({ role: null, hasHqAccess: null }), 'member');
});
