import test from 'node:test';
import assert from 'node:assert/strict';
import {decoderModuleUrl} from '../../lib/football/media-registry.mjs';

test('decoder module URL is a valid file URL for Windows paths with spaces', async () => {
  assert.equal(await decoderModuleUrl('C:\\Users\\Jane Doe\\Mnemba Tips', true), 'file:///C:/Users/Jane%20Doe/Mnemba%20Tips/lib/football/image-validation.mjs');
});

test('decoder module URL keeps the production Linux location', async () => {
  assert.equal(await decoderModuleUrl('/app', false), 'file:///app/lib/football/image-validation.mjs');
  assert.equal(await decoderModuleUrl('/srv/my app/', false), 'file:///srv/my%20app/lib/football/image-validation.mjs');
});

test('decoder module URL resolves and imports on the current platform', async () => {
  const url = await decoderModuleUrl();
  assert.match(url, /^file:\/\//);
  const mod = await import(url);
  assert.equal(typeof mod.downloadLogo, 'function');
  assert.equal(typeof mod.validateLogoBytes, 'function');
});
