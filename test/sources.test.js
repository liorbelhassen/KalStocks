import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceLinks, sourcesHtml, siteName } from '../lib/sources.js'

test('sourceLinks: each source becomes a short name linking to its page (old host/Yahoo strings included)', () => {
  assert.deepEqual(sourceLinks([
    { name: 'גלובס', url: 'https://www.globes.co.il/news/article.aspx?did=1' },
    'Yahoo Finance',
    'calcalist.co.il',
    'גלובס',
    { url: 'https://www.reuters.com/markets/x' },
    'מקור כלשהו',
  ], 'DSCT.TA'), [
    { name: 'גלובס', url: 'https://www.globes.co.il/news/article.aspx?did=1' },
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/DSCT.TA' },
    { name: 'כלכליסט', url: 'https://calcalist.co.il' },
    { name: 'Reuters', url: 'https://www.reuters.com/markets/x' },
    { name: 'מקור כלשהו', url: null },
  ])
  assert.deepEqual(sourceLinks([{ name: 'x', url: 'javascript:alert(1)' }]), [{ name: 'x', url: null }])
})

test('sourcesHtml: email sources are anchor tags showing only the site name', () => {
  assert.equal(sourcesHtml([{ name: 'גלובס', url: 'https://www.globes.co.il/a?b=1&c=2' }, 'Yahoo Finance'], 'MSFT'),
    '<a href="https://www.globes.co.il/a?b=1&amp;c=2" style="color:#0969da;text-decoration:underline;">גלובס</a>, <a href="https://finance.yahoo.com/quote/MSFT" style="color:#0969da;text-decoration:underline;">Yahoo Finance</a>')
})

test('sourceLinks: stored URLs with trailing punctuation are cleaned; subdomains get the site name', () => {
  assert.deepEqual(sourceLinks([{ name: 'passportnews.co.il', url: 'https://passportnews.co.il/article/210323`' }]), [{ name: 'passportnews.co.il', url: 'https://passportnews.co.il/article/210323' }])
  assert.equal(siteName('finance.walla.co.il'), 'וואלה')
  assert.equal(siteName('www.passportnews.co.il'), 'PassportNews')
})
