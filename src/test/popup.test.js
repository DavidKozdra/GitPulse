const fs = require('fs');

const popupHtml = fs.readFileSync(require.resolve('../popup.html'), 'utf8');
const { defaultConfig, validateConfig } = require('../config');

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('popup workflow', () => {
  let messages;
  let stored;

  beforeEach(async () => {
    document.documentElement.innerHTML = popupHtml;
    messages = [];
    stored = { githubPAT: 'ghp_existing', emojiRecents: [] };

    global.validateConfig = validateConfig;
    global.resetConfig = jest.fn(async () => JSON.parse(JSON.stringify(defaultConfig)));
    global.alert = jest.fn();
    global.confirm = jest.fn(() => true);
    global.ext = {
      storage: {
        local: {
          get: jest.fn(async keys => {
            const result = {};
            keys.forEach(key => { if (stored[key] !== undefined) result[key] = stored[key]; });
            return result;
          }),
          set: jest.fn(async value => Object.assign(stored, value)),
        },
      },
      sendMessage: jest.fn(async message => {
        messages.push(message);
        if (message.action === 'getConfig') return { config: defaultConfig };
        return { success: true };
      }),
    };

    jest.isolateModules(() => require('../popup.js'));
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
  });

  test('renders saved configuration and PAT', () => {
    expect(document.querySelectorAll('.form-group-row').length).toBeGreaterThan(5);
    expect(document.getElementById('pat').value).toBe('ghp_existing');
    expect(document.getElementById('max_repo_update_time').value).toBe(
      String(defaultConfig.max_repo_update_time.value)
    );
  });

  test('saves edited configuration and PAT', async () => {
    document.getElementById('max_repo_update_time').value = '90';
    document.getElementById('pat').value = 'ghp_changed';
    document.getElementById('saveBtn').click();
    await flush();

    const configMessage = messages.find(message => message.action === 'setConfig');
    expect(configMessage.config.max_repo_update_time.value).toBe(90);
    expect(messages).toContainEqual({ action: 'setPAT', pat: 'ghp_changed' });
    expect(alert).toHaveBeenCalledWith('Configuration saved!');
  });

  test('resets configuration and clears a saved PAT', async () => {
    document.getElementById('max_repo_update_time').value = '90';
    document.getElementById('clearBtn').click();
    await flush();

    expect(confirm).toHaveBeenCalled();
    expect(global.resetConfig).toHaveBeenCalled();
    expect(messages).toContainEqual({ action: 'setPAT', pat: '' });
    expect(document.getElementById('pat').value).toBe('');
    expect(document.getElementById('max_repo_update_time').value).toBe(
      String(defaultConfig.max_repo_update_time.value)
    );
  });
});
