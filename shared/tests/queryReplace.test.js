import assert from 'node:assert/strict';
import { buildRequest } from '../queryReplace.js';

const base = (over = {}) => ({
  method: 'post',
  url: 'https://api.test/search',
  headers: { 'content-type': 'application/json', authorization: 'bearer abc', 'content-length': '5' },
  body: '{"searchString":"{{QUERY}}","n":1}',
  ...over,
});

it('replaces token in JSON body with JSON escaping', () => {
  const r = buildRequest(base(), 'say "hi"\\ ünï 日本語');
  assert.equal(JSON.parse(r.data).searchString, 'say "hi"\\ ünï 日本語');
  assert.equal(r.headers.authorization, 'bearer abc');
  assert.equal(r.headers['content-length'], undefined);
  assert.equal(r.method, 'POST');
});

it('URL-encodes the query in the URL (raw and pre-encoded token)', () => {
  const a = buildRequest(base({ url: 'https://x/s?q={{QUERY}}&p=1', body: null }), 'a b&c=d/é');
  assert.equal(a.url, 'https://x/s?q=a%20b%26c%3Dd%2F%C3%A9&p=1');
  const b = buildRequest(base({ url: 'https://x/s?q=%7B%7BQUERY%7D%7D', body: null }), 'x y');
  assert.equal(b.url, 'https://x/s?q=x%20y');
});

it('replaces an original query string used as the token', () => {
  const r = buildRequest(base({ url: 'https://x/s?q=old+value', body: null }), 'new one', { token: 'old value' });
  assert.equal(r.url, 'https://x/s?q=new%20one');
});

it('form-encoded body', () => {
  const r = buildRequest(
    base({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'q={{QUERY}}&a=1' }),
    'a&b',
  );
  assert.equal(r.data, 'q=a%26b&a=1');
});

it('JSON path sets query on empty field; overrides blank aggregations; survives stray newlines', () => {
  const body = '{"searchString":"","sid":"12\nE\nn","aggregations":[{"type":"Language"}],"from":0}';
  const r = buildRequest(base({ body }), 'hello', {
    token: '{{NOPE}}',
    queryJsonPath: 'searchString',
    bodyOverrides: { aggregations: [] },
  });
  const obj = JSON.parse(r.data);
  assert.equal(obj.searchString, 'hello');
  assert.deepEqual(obj.aggregations, []);
  assert.equal(obj.from, 0);
});

it('throws when the query location cannot be found', () => {
  assert.throws(() => buildRequest(base({ body: '{"a":1}' }), 'x'), /query location/);
});

import { parseLooseJson } from '../looseJson.js';
it('parseLooseJson accepts JS-style objects', () => {
  assert.deepEqual(parseLooseJson('[{type: "_index", filter: ["1_14_navex_sf_staging"]}]'), [{ type: '_index', filter: ['1_14_navex_sf_staging'] }]);
  assert.deepEqual(parseLooseJson("[{type: 'a:b, c', filter: ['x',],},]"), [{ type: 'a:b, c', filter: ['x'] }]);
  assert.deepEqual(parseLooseJson('[{"type":"A","filter":["b"]}]'), [{ type: 'A', filter: ['b'] }]);
  assert.throws(() => parseLooseJson('[{type: }]'));
});
