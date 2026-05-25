// ---------- Configuration ----------
const CONFIG_KEY = "repoCheckerConfig";
const defaultConfig = {
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
  },
  emoji_private: {
    name: "Emoji for private repo",
    value: "🔒",
    type: "text",
    active: true,
    order: 92
  },
  emoji_rate_limited: {
    name: "Emoji for rate limited",
    value: "⏳",
    type: "text",
    active: true,
    order: 93
  }
};

function cloneConfigShape(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateConfig(storedConfig) {
  const merged = cloneConfigShape(defaultConfig);

  if (!storedConfig || typeof storedConfig !== "object" || Array.isArray(storedConfig)) {
    return merged;
  }

  Object.entries(storedConfig).forEach(([key, rawField]) => {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
      return;
    }

    const base = merged[key] ? { ...merged[key] } : {};
    const next = { ...base, ...rawField };

    if (next.type === "number") {
      const numeric = typeof rawField.value === "number" ? rawField.value : Number(rawField.value);
      next.value = Number.isFinite(numeric) && numeric >= 0 ? numeric : base.value;
    } else if (next.type === "text") {
      const fallback = typeof base.value === "string" ? base.value : "";
      const text = typeof rawField.value === "string" ? rawField.value : fallback;
      next.value = text.slice(0, 8);
    } else if (Object.prototype.hasOwnProperty.call(rawField, "value")) {
      next.value = rawField.value;
    }

    if (rawField.active === false) next.active = false;
    else if (rawField.active === true) next.active = true;
    else if (typeof base.active === "boolean") next.active = base.active;
    else next.active = true;

    merged[key] = next;
  });

  return merged;
}

// ---------------------------
// Load config via background
// ---------------------------
async function loadConfig() {
  const response = await ext.sendMessage({ action: "getConfig" });
  return validateConfig(response?.config);
}

// ---------------------------
// Save config via background
// ---------------------------
async function saveConfig(config) {
  const safeConfig = validateConfig(config);
  const response = await ext.sendMessage({ action: "setConfig", config: safeConfig });
  return response?.success || false;
}

async function resetConfig() {
  const configCopy = cloneConfigShape(defaultConfig);
  try {
    await ext.sendMessage({ action: "setConfig", config: configCopy });
  } catch (e) {
    // best-effort: allow caller to persist via direct storage if needed
  }
  return configCopy;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONFIG_KEY, defaultConfig, validateConfig, loadConfig, saveConfig, resetConfig };
}

