import assert from 'node:assert/strict';
import { normalize, valuesMatch, getByPath, extractResults, findRank } from '../matcher.js';

it('normalize strips case, query, hash, trailing slash', () => {
  assert.equal(normalize('  HTTPS://A.com/Page/?x=1#top '), 'https://a.com/page');
});

it('match modes', () => {
  assert.equal(valuesMatch('https://a.com/p/?x=1', 'https://A.com/p', 'normalized'), true);
  assert.equal(valuesMatch('https://a.com/p/', 'https://a.com/p', 'exact'), false);
  assert.equal(valuesMatch('Foo Bar Baz', 'bar', 'contains'), true);
  assert.equal(valuesMatch('anything', '', 'contains'), false);
  assert.equal(valuesMatch(['x', 'y'], 'y', 'exact'), true);
  assert.equal(valuesMatch(undefined, 'y', 'exact'), false);
});

it('getByPath / extractResults', () => {
  const data = { result: { hits: [{ _source: { url: 'u1' } }, { _source: { url: 'u2' } }] } };
  assert.equal(getByPath(data, 'result.hits.1._source.url'), 'u2');
  assert.equal(extractResults(data, 'result.hits', 1).length, 1);
  assert.throws(() => extractResults(data, 'result.nope'), /did not return an array/);
});

it('findRank is 1-based and handles empty results / non-ASCII', () => {
  const items = [{ u: 'a' }, { u: 'b/' }, { u: 'ça-va' }];
  assert.equal(findRank(items, 'b', { matchField: 'u' }), 2);
  assert.equal(findRank(items, 'ÇA-VA', { matchField: 'u' }), 3);
  assert.equal(findRank(items, 'zzz', { matchField: 'u' }), null);
  assert.equal(findRank([], 'a', { matchField: 'u' }), null);
});

it('titles keep their punctuation; paths are case-insensitive', () => {
  assert.equal(valuesMatch('How do I reset?', 'how do i reset?', 'normalized'), true);
  assert.equal(valuesMatch('How do I reset?', 'how do i reset', 'normalized'), false);
  assert.equal(getByPath({ titleToDisplayString: 'T' }, 'titletodisplaystring'), 'T');
});

it('matches array-valued titles with HTML entities / tags (SearchUnify highlight)', () => {
  const items = [{ highlight: { TitleToDisplayString: ['Other'] } }, { highlight: { TitleToDisplayString: ['12 Steps for Communicating with Incident Reporters &amp; <em>Whistleblowers</em>'] } }];
  const opts = { matchField: 'highlight.TitleToDisplayString', matchMode: 'normalized' };
  assert.equal(findRank(items, '12 Steps for Communicating with Incident Reporters & Whistleblowers', opts), 2);
  assert.equal(findRank(items, 'other', opts), 1);
});
