import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProjectPath } from '../client-util.js'

test('resolveProjectPath prefers workspace.path', () => {
  const ctx = { workspace: { path: 'D:\\proj\\ws' }, session: { cwd: 'D:\\proj\\ws\\sub' } }
  assert.equal(resolveProjectPath(ctx), 'D:\\proj\\ws')
})

test('resolveProjectPath falls back to session.cwd', () => {
  const ctx = { workspace: null, session: { cwd: 'D:\\proj' } }
  assert.equal(resolveProjectPath(ctx), 'D:\\proj')
})

test('resolveProjectPath returns null when nothing resolves', () => {
  assert.equal(resolveProjectPath({}), null)
  assert.equal(resolveProjectPath(null), null)
  assert.equal(resolveProjectPath(undefined), null)
})
