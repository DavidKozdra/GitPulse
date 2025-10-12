// ---------- Configuration ----------
const CONFIG_KEY = "config";
const defaultConfig = {
  max_repo_update_time: {
    name: "Max days since last commit",
    value: 365,
    type: "number",
    active: true,
    order: 1
  },
  max_issues_update_time: {
    name: "Max days since last issue activity",
    value: 365,
    type: "number",
    active: true,
    order: 2
  },
  max_count_unmerged_Prs: {
    name: "Max number of open PRs",
    value: 50,
    type: "number",
    active: true,
    order: 3
  },
  max_days_since_last_pr: {
    name: "Max days since last PR update",
    value: 30,
    type: "number",
    active: false,
    order: 4
  },
  max_days_since_last_release: {
    name: "Max days since last release",
    value: 180,
    type: "number",
    active: false,
    order: 5
  },
  max_days_since_last_contributor: {
    name: "Max days since last active contributor",
    value: 180,
    type: "number",
    active: false,
    order: 6
  },
  max_avg_commit_per_week: {
    name: "Max average commits per week",
    value: 0.5,
    type: "number",
    active: false,
    order: 7
  },
  max_open_issue_age: {
    name: "Max age of open issues in days",
    value: 90,
    type: "number",
    active: false,
    order: 8
  },
  emoji_active: {
    name: "Emoji for active repo",
    value: "✅",
    type: "text",
    active: true,
    order: 9
  },
  emoji_inactive: {
    name: "Emoji for inactive repo",
    value: "❌",
    type: "text",
    active: true,
    order: 10
  }
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
async function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "setConfig", config }, (response) => {
      resolve(response?.success || false);
    });
  });
}



async function resetConfig() {
  const configCopy = JSON.parse(JSON.stringify(defaultConfig)); // deep copy
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "setConfig", config: configCopy }, (response) => {
      resolve(response?.success || false);
    });
  });
}

