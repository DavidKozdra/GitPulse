// ---------- Configuration ----------
const CONFIG_KEY = "config";
const defaultConfig = {
  max_repo_update_time: 365,
  max_issues_update_time: 30,
  max_count_unmerged_Prs: 5,
  emoji_active: "✅",
  emoji_inactive: "❌"
};

// ---------------------------
// Load config via background
// ---------------------------
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getConfig" }, (response) => {
      const stored = response?.config;
      if (stored) {
        resolve({ ...defaultConfig, ...stored });
      } else {

        console.log("FAIL")
        resolve({ ...defaultConfig });
      }
    });
  });
}

// ---------------------------
// Save config via background
// ---------------------------
function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "setConfig", config }, (response) => {
      resolve(response?.success || false);
    });
  });
}
