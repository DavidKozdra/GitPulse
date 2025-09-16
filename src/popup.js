document.addEventListener("DOMContentLoaded", () => {
  const CONFIG_KEY = "repoCheckerConfig";
  const defaultConfig = {
    max_repo_update_time: 365,
    max_issues_update_time: 30,
    max_count_unmerged_prs: 5,
    emoji_active: "✅",
    emoji_inactive: "❌"
  };

  function loadConfig() {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
    } catch { return defaultConfig; }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    alert("Configuration saved!");
  }

  const config = loadConfig();

  document.getElementById("max_repo_update_time").value = config.max_repo_update_time;
  document.getElementById("max_issues_update_time").value = config.max_issues_update_time;
  document.getElementById("max_count_unmerged_prs").value = config.max_count_unmerged_prs;
  document.getElementById("emoji_active").value = config.emoji_active;
  document.getElementById("emoji_inactive").value = config.emoji_inactive;

  document.getElementById("saveBtn").addEventListener("click", () => {
    const parseOrDefault = (val, def) => {
      const num = Number(val);
      return isNaN(num) ? def : num;
    };

    const newConfig = {
      max_repo_update_time: parseOrDefault(document.getElementById("max_repo_update_time").value, defaultConfig.max_repo_update_time),
      max_issues_update_time: parseOrDefault(document.getElementById("max_issues_update_time").value, defaultConfig.max_issues_update_time),
      max_count_unmerged_prs: parseOrDefault(document.getElementById("max_count_unmerged_prs").value, defaultConfig.max_count_unmerged_prs),
      emoji_active: document.getElementById("emoji_active").value || defaultConfig.emoji_active,
      emoji_inactive: document.getElementById("emoji_inactive").value || defaultConfig.emoji_inactive
    };
    saveConfig(newConfig);
  });
});