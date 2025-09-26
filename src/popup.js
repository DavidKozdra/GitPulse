document.addEventListener("DOMContentLoaded", async () => {
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
    return new Promise(resolve => {
      chrome.storage.local.set({ githubPAT: pat }, () => resolve(true));
    });
  }

  // ---------------------------
  // Load config (async now)
  // ---------------------------
  const config = await loadConfig();

  // ---------------------------
  // Populate form fields
  // ---------------------------
  document.getElementById("max_repo_update_time").value = config.max_repo_update_time || 0;
  document.getElementById("max_issues_update_time").value = config.max_issues_update_time || 0;
  document.getElementById("max_count_unmerged_prs").value = config.max_count_unmerged_prs || 0;
  document.getElementById("emoji_active").value = config.emoji_active;
  document.getElementById("emoji_inactive").value = config.emoji_inactive;

  const pat = await loadPAT();
  document.getElementById("pat").value = pat;

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
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const parseOrDefault = (val, def) => {
      const num = Number(val);
      return isNaN(num) ? def : num;
    };

    const newConfig = {
      max_repo_update_time: parseOrDefault(
        document.getElementById("max_repo_update_time").value,
        defaultConfig.max_repo_update_time
      ),
      max_issues_update_time: parseOrDefault(
        document.getElementById("max_issues_update_time").value,
        defaultConfig.max_issues_update_time
      ),
      max_count_unmerged_prs: parseOrDefault(
        document.getElementById("max_count_unmerged_prs").value,
        defaultConfig.max_count_unmerged_prs
      ),
      emoji_active: document.getElementById("emoji_active").value || defaultConfig.emoji_active,
      emoji_inactive: document.getElementById("emoji_inactive").value || defaultConfig.emoji_inactive
    };

    await saveConfig(newConfig);

    // Save PAT separately
    const patValue = document.getElementById("pat").value.trim();
    await savePAT(patValue);

    alert("Configuration saved!");
  });
});
