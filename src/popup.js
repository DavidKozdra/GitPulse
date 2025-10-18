document.addEventListener("DOMContentLoaded", async () => {
  const formsContainer = document.querySelector(".forms-container");
  if (!formsContainer) return;

  // ---------------------------
  // Storage helpers
  // ---------------------------
  const loadPAT = () => ext.storage.local.get(["githubPAT"]).then(({ githubPAT } = {}) => githubPAT || "");

  const savePAT = (pat) => ext.storage.local.set({ githubPAT: pat }).then(() => true);

  const loadConfig = async () => {
    const { repoCheckerConfig } = await ext.storage.local.get(["repoCheckerConfig"]);
    const mergedConfig = { ...defaultConfig };
    if (repoCheckerConfig) {
      Object.keys(repoCheckerConfig).forEach(key => {
        if (mergedConfig[key]) mergedConfig[key] = { ...mergedConfig[key], ...repoCheckerConfig[key] };
        else mergedConfig[key] = repoCheckerConfig[key];
      });
    }
    return mergedConfig;
  };

  const saveConfig = (newConfig) => ext.storage.local.set({ repoCheckerConfig: newConfig }).then(() => true);

  const clearRepoCache = () => ext.sendMessage({ action: "clearCache" });

  // ---------------------------
  // Load config and PAT
  // ---------------------------
  const config = await loadConfig();
  const pat = await loadPAT();

  // Clear container
  formsContainer.innerHTML = "";

  // ---------------------------
  // Dynamically generate form fields
  // ---------------------------
  const sortedKeys = Object.keys(config)
    .filter(key => config[key] && config[key].value !== undefined)
    .sort((a, b) => (config[a].order ?? 999) - (config[b].order ?? 999));

  sortedKeys.forEach(key => {
    const field = config[key];

    const formGroup = document.createElement("div");
    formGroup.className = "form-group";
    formGroup.style.display = "flex";
    formGroup.style.alignItems = "center";
    formGroup.style.justifyContent = "space-between";
    formGroup.style.flexDirection = "row";

    // Label
    const label = document.createElement("label");
    label.htmlFor = key;
    label.textContent = field.name || key;
    label.style.flex = "1";

    // Value input
    let input;
    if (field.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!field.value;
      input.style.flex = "0";
      input.style.marginLeft = "8px";
    } else {
      input = document.createElement("input");
      input.type = field.type === "number" ? "number" : "text";
      input.value = field.value;
      input.style.flex = "1";
      if (field.type === "text" && String(field.value).length <= 2) input.maxLength = 2;
    }
    input.id = key;

    // Toggle checkbox
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = field.active;
    toggle.style.marginLeft = "8px";
    toggle.addEventListener("change", () => field.active = toggle.checked);

    formGroup.appendChild(label);
    formGroup.appendChild(input);
    formGroup.appendChild(toggle);

    formsContainer.appendChild(formGroup);
  });

  // ---------------------------
  // PAT field
  // ---------------------------
  const patInput = document.getElementById("pat");
  patInput.value = pat;
  document.getElementById("togglePat").addEventListener("click", () => {
    patInput.type = patInput.type === "password" ? "text" : "password";
  });

  // ---------------------------
  // Helper to update UI inputs and toggles
  // ---------------------------
  const updateUI = (configToApply) => {
    sortedKeys.forEach(key => {
      const field = configToApply[key];
      const input = document.getElementById(key);
      let toggle;
      // Structure: label -> input -> toggle
      if (input) toggle = input.nextSibling?.nextSibling;
      if (!input) return;
      if (field.type === "boolean") input.checked = !!field.value;
      else input.value = field.value;
      if (toggle && toggle.type === "checkbox") toggle.checked = field.active;
    });
  };

  // ---------------------------
  // Save button
  // ---------------------------
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const newConfig = {};
    sortedKeys.forEach(key => {
      const input = document.getElementById(key);
      if (!input) return;
      const field = config[key];
      if (field.type === "number") {
        const val = Number(input.value);
        newConfig[key] = { ...field, value: isNaN(val) ? field.value : val };
      } else if (field.type === "boolean") {
        newConfig[key] = { ...field, value: !!input.checked };
      } else {
        newConfig[key] = { ...field, value: input.value || field.value };
      }
    });

    await saveConfig(newConfig);
    await savePAT(patInput.value.trim());
    await clearRepoCache();
    alert("Configuration saved!");
  });

  // ---------------------------
  // Reset button
  // ---------------------------
  document.getElementById("clearBtn").addEventListener("click", async () => {
    const confirmReset = confirm("Are you sure you want to reset your configuration to the default settings?");
    if (!confirmReset) return;

    const defaultConfigCopy = await resetConfig(); // from config.js now returns the defaults
    await saveConfig(defaultConfigCopy);           // persist defaults
    patInput.value = "";                           // clear PAT
    await clearRepoCache();
    alert("✅ Configuration has been reset to defaults.");

    updateUI(defaultConfigCopy);                   // update form inputs
  });
});
