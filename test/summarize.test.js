import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRepo } from '../summarize.js'

test('summarizeRepo uses description when present', () => {
  const s = summarizeRepo({ description: 'Parse markdown to html', topics: [], language: 'javascript' })
  assert.equal(s, 'Parse markdown to html')
})

test('summarizeRepo truncates long description with ellipsis', () => {
  const long = 'x'.repeat(200)
  const s = summarizeRepo({ description: long })
  assert.ok(s.endsWith('…'))
  assert.ok(s.length <= 100)
})

test('summarizeRepo falls back to topics when no description', () => {
  const s = summarizeRepo({ description: '', topics: ['markdown', 'parser', 'cli', 'tools', 'extra'], language: 'go' })
  assert.match(s, /^主题：markdown、parser、cli、tools$/)
})

test('summarizeRepo mentions language when only that is known', () => {
  const s = summarizeRepo({ description: null, topics: [], language: 'Rust' })
  assert.equal(s, '一个 Rust 开源项目')
})

test('summarizeRepo returns placeholder when nothing known', () => {
  assert.equal(summarizeRepo({}), '（暂无描述）')
})

test('summarizeRepo tolerates undefined / garbage input', () => {
  assert.equal(summarizeRepo(undefined), '（暂无描述）')
  assert.ok(summarizeRepo({ topics: 'not-array' }).length > 0)
})
