document.addEventListener("DOMContentLoaded", () => {


  // ---------------------------
  // Load PAT from chrome.storage.local
  // ---------------------------
  function loadPAT() {
    return new Promise(resolve => {
      chrome.storage.local.get(["githubPAT"], ({ githubPAT }) => {
        resolve(githubPAT || "");
      });
    });
  }

  // ---------------------------
  // Save PAT to chrome.storage.local
  // ---------------------------
  function savePAT(pat) {
    chrome.storage.local.set({ githubPAT: pat });
  }

  const config = loadConfig();

  // ---------------------------
  // Populate form fields
  // ---------------------------
  document.getElementById("max_repo_update_time").value = config.max_repo_update_time;
  document.getElementById("max_issues_update_time").value = config.max_issues_update_time;
  document.getElementById("max_count_unmerged_prs").value = config.max_count_unmerged_prs;
  document.getElementById("emoji_active").value = config.emoji_active;
  document.getElementById("emoji_inactive").value = config.emoji_inactive;

  loadPAT().then(pat => {
    document.getElementById("pat").value = pat;
  });

  // ---------------------------
  // Toggle PAT visibility
  // ---------------------------
  document.getElementById("togglePat").addEventListener("click", () => {
    const patInput = document.getElementById("pat");
    patInput.type = patInput.type === "password" ? "text" : "password";
  });

  // ---------------------------
  // Save button click
  // ---------------------------
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

    // Save PAT separately
    const patValue = document.getElementById("pat").value.trim();
    savePAT(patValue);

    alert("Configuration saved!");
  });
});
