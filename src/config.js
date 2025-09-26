// ---------- Configuration ----------
const CONFIG_KEY = "repoCheckerConfig";
const defaultConfig = {
  max_repo_update_time: 365,
  max_issues_update_time: 30,
  max_count_unmerged_Prs: 5,
  emoji_active: "✅",
  emoji_inactive: "❌"
};


function loadConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
  } catch {
    return { ...defaultConfig };
  }
}

  // ---------------------------
  // Save config to localStorage
  // ---------------------------
  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

