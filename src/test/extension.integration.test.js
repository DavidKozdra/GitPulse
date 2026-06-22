/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

function referencedScripts(manifest) {
  const scripts = manifest.content_scripts.flatMap(entry => entry.js);
  if (manifest.background.service_worker) scripts.push(manifest.background.service_worker);
  if (manifest.background.scripts) scripts.push(...manifest.background.scripts);
  return scripts;
}

function referencedAssets(manifest) {
  const iconValues = object => Object.values(object || {});
  const webResources = (manifest.web_accessible_resources || []).flatMap(entry =>
    typeof entry === 'string' ? [entry] : entry.resources || []
  );
  return [
    ...referencedScripts(manifest),
    manifest.action?.default_popup,
    manifest.action?.default_icon,
    manifest.browser_action?.default_popup,
    ...iconValues(manifest.browser_action?.default_icon),
    ...iconValues(manifest.icons),
    ...webResources,
  ].filter(value => typeof value === 'string');
}

describe('packaged extension smoke checks', () => {
  test.each(['manifest.json', 'manifest.firefox.json'])('%s references existing files', name => {
    const manifest = readJson(name);
    referencedAssets(manifest).forEach(reference => {
      expect(fs.existsSync(path.join(root, reference))).toBe(true);
    });
  });

  test('Chrome content scripts parse in manifest load order', () => {
    const manifest = readJson('manifest.json');
    manifest.content_scripts[0].js.forEach(file => {
      expect(() => new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), {
        filename: file,
      })).not.toThrow();
    });
  });

  test('service worker starts and registers both message boundaries', () => {
    const listeners = { internal: [], external: [], installed: [] };
    const chrome = {
      runtime: {
        id: 'smoke-test',
        onInstalled: { addListener: fn => listeners.installed.push(fn) },
        onMessage: { addListener: fn => listeners.internal.push(fn) },
        onMessageExternal: { addListener: fn => listeners.external.push(fn) },
      },
      storage: { local: { get() {}, set() {}, remove() {} } },
    };
    const source = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

    expect(() => vm.runInNewContext(source, { chrome, console, URL, fetch: jest.fn() })).not.toThrow();
    expect(listeners.installed).toHaveLength(1);
    expect(listeners.internal).toHaveLength(1);
    expect(listeners.external).toHaveLength(1);
  });
});
