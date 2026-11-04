import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ponytail: pinned to GOAT Cam plan-1 commit f1a6460; update the pins only by re-copying when plan 1 files change
const PINNED = {
  'extension/lib/banner-core.js': '876fdf2bea928f725dece0e29c0da3ae417f30a166db27a8c6d19e1a0368ff80',
  'extension/lib/banner-machine.js': 'bb456db1f0c07db1185f1f3fe3c313b841e54bd55753cdb2c9b5b02af60492d1',
  'extension/lib/banner-fetch.js': '7b4e004e61a6cf91bd54acde6973d69ec1750c36be771435b968fd49f77d6896',
  'extension/lib/banner-key.js': 'cf2710c3724b3df1fca9eb646fbe09218437f299e02e449e8762acec4e0723f5',
  'test/banner/client/banner-core.test.mjs': '23e61e3187bbe57deaf11a41368859625d5a27fc3fd4d7b7d698038307a6dcb2',
  'test/banner/client/banner-machine.test.mjs': '18bc5b81846189e9d890e11bba87701608cc1c320b42471f935453885240d68b',
  'test/banner/vectors/cases.json': 'b75e96e0eeffe4dd4158a7d8c86cc4f3a8db7b1eabb9bf09764cd32ebfbf154b',
  'test/banner/vectors/transitions.json': 'aed41ab6fdf6791e3e6f95cf5a10f3d4f763d558315082485db72c620168b63b',
  'test/banner/vectors/RULES.md': '0314154a4e78e5e840e4998acf0602ecc4b2c5f56ecdee79046afbe8c666c1f8',
};

test('GOAT Cam plan-1 files remain byte-exact copies', () => {
  for (const [relative, expected] of Object.entries(PINNED)) {
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, relative);
  }
});
