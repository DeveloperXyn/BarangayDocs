'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, ts } = require('./helpers');
const { hashPassword } = require('../server/security');
const API = '/api/v1';

describe('Barangay Hall open/closed switch', () => {
  let S, admin, maria;
  const mkUser = async (email, name, role = 'resident') => {
    const h = await hashPassword('Str0ng!Pass'), now = ts();
    S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, phone, date_of_birth, role, account_status, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'approved', 1, ?, ?)")
      .run('CID-' + email, name, email, h, '09170000000', '1990-01-01', role, now, now);
    const c = new Client(S.base); assert.equal((await c.login(email, 'Str0ng!Pass')).status, 200); return c;
  };
  before(async () => { S = await startServer(); admin = await mkUser('admin@x.ph', 'Ana Reyes', 'admin'); maria = await mkUser('maria@x.ph', 'Maria Santos'); });
  after(() => S.close());

  test('defaults to open; admin can close and reopen; residents can read but not change it', async () => {
    assert.equal((await new Client(S.base).req('GET', API + '/hall-status')).status, 401);
    let r = await maria.req('GET', API + '/hall-status'); assert.equal(r.status, 200); assert.equal(r.data.open, true);
    r = await maria.req('PATCH', API + '/admin/hall-status', { json: { open: false } }); assert.equal(r.status, 403);
    r = await admin.req('PATCH', API + '/admin/hall-status', { json: { open: 'no' } }); assert.equal(r.status, 422);
    r = await admin.req('PATCH', API + '/admin/hall-status', { json: { open: false } }); assert.equal(r.status, 200); assert.equal(r.data.open, false);
    assert.equal((await maria.req('GET', API + '/hall-status')).data.open, false);
    r = await admin.req('PATCH', API + '/admin/hall-status', { json: { open: true } }); assert.equal(r.data.open, true);
    assert.equal((await maria.req('GET', API + '/hall-status')).data.open, true);
  });
});
