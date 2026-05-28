// ---------- Configuration ----------
//
// defaultConfig is the single source of truth for popup field metadata and the
// default rule values used by the content/background flow. Stored config is
// always sanitized through validateConfig before the popup saves or renders it.
const CONFIG_KEY = "repoCheckerConfig";
const defaultConfig = {
  max_repo_update_time: {
    name: "Max days since last commit",
    value: 180,
    type: "number",
    active: true,
    order: 2
  },
  // These GitHub-only secondary checks each trigger extra API requests, so
  // keep them opt-in by default and let users enable them when they want a
  // richer score.
  open_prs_max: {
    name: "Max number of open PRs",
    value: 20,
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
  max_issues_update_time: {
    name: "Max days since last issue activity",
    value: 180,
    type: "number",
    active: false,
    order: 20
  },
  max_days_since_last_release: {
    name: "Max days since last release",
    value: 365,
    type: "number",
    active: false,
    order: 21
  },
  max_open_issue_age: {
    name: "Max age of open issues in days",
    value: 365,
    type: "number",
    active: false,
    order: 24
  },
  grading_enabled: {
    name: "Show GitPulse grade badge",
    value: true,
    type: "boolean",
    active: true,
    order: 30
  },
  score_decides_status: {
    name: "Use score for active status",
    value: true,
    type: "boolean",
    active: true,
    order: 31
  },
  min_active_score: {
    name: "Minimum active score",
    value: 70,
    type: "number",
    active: true,
    order: 32
  },
  marker_display: {
    name: "Link marker display",
    value: "emoji",
    type: "select",
    options: [
      { value: "emoji", label: "Emoji" },
      { value: "badge", label: "Grade badge" },
      { value: "both", label: "Emoji + badge" }
    ],
    active: true,
    order: 33
  },
  banner_display: {
    name: "Banner display",
    value: "emoji",
    type: "select",
    options: [
      { value: "emoji", label: "Emoji" },
      { value: "badge", label: "Grade badge" },
      { value: "both", label: "Emoji + badge" }
    ],
    active: true,
    order: 34
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
  },
  emoji_unsupported: {
    name: "Emoji for unsupported host",
    value: "❔",
    type: "text",
    active: true,
    order: 94
  }
};

function cloneConfigShape(value) {
  // Config entries are plain data. JSON cloning keeps reset/default operations
  // from sharing object references with the exported defaultConfig.
  return JSON.parse(JSON.stringify(value));
}

function validateConfig(storedConfig) {
  // Merge user-provided config over defaults and sanitize every editable value.
  // This protects the popup from corrupted storage and lets future config keys
  // survive extension upgrades.
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
      // Numeric thresholds must be finite and non-negative. Invalid values fall
      // back to the default/base field value instead of being saved as NaN.
      const numeric = typeof rawField.value === "number" ? rawField.value : Number(rawField.value);
      next.value = Number.isFinite(numeric) && numeric >= 0 ? numeric : base.value;
    } else if (next.type === "text") {
      // Emoji/text fields are short UI tokens. Clamp length so a pasted sentence
      // cannot break the popup, banner, or link marker layout.
      const fallback = typeof base.value === "string" ? base.value : "";
      const text = typeof rawField.value === "string" ? rawField.value : fallback;
      next.value = text.slice(0, 8);
    } else if (next.type === "boolean") {
      const fallback = typeof base.value === "boolean" ? base.value : false;
      next.value = typeof rawField.value === "boolean" ? rawField.value : fallback;
    } else if (next.type === "select") {
      const allowed = Array.isArray(next.options) ? next.options.map(option => option.value) : [];
      next.value = allowed.includes(rawField.value) ? rawField.value : base.value;
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
  // Popup/content callers load config through background so the same storage key
  // is used everywhere and the response is sanitized before rendering.
  const response = await ext.sendMessage({ action: "getConfig" });
  return validateConfig(response?.config);
}

// ---------------------------
// Save config via background
// ---------------------------
async function saveConfig(config) {
  // Save only a validated shape. The background worker decides whether changed
  // rules require cache invalidation.
  const safeConfig = validateConfig(config);
  const response = await ext.sendMessage({ action: "setConfig", config: safeConfig });
  return response?.success || false;
}

async function resetConfig() {
  // Reset returns a fresh copy to the caller so UI code can update immediately
  // without mutating defaultConfig by reference.
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
