// ---------- Configuration ----------
const CONFIG_KEY = "config";
const defaultConfig = {
  // Rules used by background.js
  require_not_archived: {
    name: "Require repository not archived",
    value: true,
    type: "boolean",
    active: true,
    order: 1
  },
  max_repo_update_time: {
    name: "Max days since last commit",
    value: 365,
    type: "number",
    active: true,
    order: 2
  },
  open_prs_max: {
    name: "Max number of open PRs",
    value: 50,
    type: "number",
    active: false,
    order: 3
  },
  last_closed_pr_max_days: {
    name: "Max days since last closed PR",
    value: 90,
    type: "number",
    active: false,
    order: 4
  },

  // Additional, not yet enforced by background.js (future use)
  max_issues_update_time: {
    name: "Max days since last issue activity",
    value: 365,
    type: "number",
    active: false,
    order: 20
  },
  max_days_since_last_release: {
    name: "Max days since last release",
    value: 180,
    type: "number",
    active: false,
    order: 21
  },
  max_days_since_last_contributor: {
    name: "Max days since last active contributor",
    value: 180,
    type: "number",
    active: false,
    order: 22
  },
  max_avg_commit_per_week: {
    name: "Max average commits per week",
    value: 0.5,
    type: "number",
    active: false,
    order: 23
  },
  max_open_issue_age: {
    name: "Max age of open issues in days",
    value: 90,
    type: "number",
    active: false,
    order: 24
  },

  // UI emoji
  emoji_active: {
    name: "Emoji for active repo",
    value: "✅",
    type: "text",
    active: true,
    order: 90
  },
  emoji_inactive: {
    name: "Emoji for inactive repo",
    value: "❌",
    type: "text",
    active: true,
    order: 91
  }
};



// ---------------------------
// Load config via background
// ---------------------------
async function loadConfig() {
  const response = await ext.sendMessage({ action: "getConfig" });
  const stored = response?.config;
  if (stored) return { ...defaultConfig, ...stored };
  return { ...defaultConfig };
}

// ---------------------------
// Save config via background
// ---------------------------
async function saveConfig(config) {
  const response = await ext.sendMessage({ action: "setConfig", config });
  return response?.success || false;
}



async function resetConfig() {
  const configCopy = JSON.parse(JSON.stringify(defaultConfig));
  try {
    await ext.sendMessage({ action: "setConfig", config: configCopy });
  } catch (e) {
    // best-effort: allow caller to persist via direct storage if needed
  }
  return configCopy;
}

