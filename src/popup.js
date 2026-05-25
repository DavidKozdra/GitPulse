document.addEventListener("DOMContentLoaded", async () => {
  const formsContainer = document.querySelector(".forms-container");
  if (!formsContainer) return;

  // ---------------------------
  // Storage helpers
  // ---------------------------
  const loadPAT = () =>
    ext.storage.local.get(["githubPAT"]).then(({ githubPAT } = {}) => githubPAT || "");

  const savePAT = (pat) =>
    ext.storage.local.set({ githubPAT: pat }).then(() => true);

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

  const saveConfig = (newConfig) =>
    ext.storage.local.set({ repoCheckerConfig: newConfig }).then(() => true);

  const clearRepoCache = () => ext.sendMessage({ action: "clearCache" });

  // ---------------------------
  // Load config, PAT, and recent emoji
  // ---------------------------
  const config = await loadConfig();
  const pat = await loadPAT();

  const emojiRecentKey = "emojiRecents";
  let recentEmojis = [];
  try {
    const stored = await ext.storage.local.get([emojiRecentKey]);
    const value = stored && stored[emojiRecentKey];
    if (Array.isArray(value)) {
      recentEmojis = value.filter(ch => typeof ch === "string");
    }
  } catch (_) {
    recentEmojis = [];
  }

  const recordEmojiRecent = (char) => {
    if (!char) return;
    recentEmojis = [char, ...recentEmojis.filter(c => c !== char)].slice(0, 24);
    try {
      ext.storage.local.set({ [emojiRecentKey]: recentEmojis });
    } catch (_) {
      // best-effort; picker still works without persistence
    }
  };

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
    formGroup.className = "form-group-row";
    formGroup.style.display = "flex";
    formGroup.style.alignItems = "center";
    formGroup.style.justifyContent = "space-between";
    formGroup.style.gap = "12px";
    formGroup.style.position = "relative";
    formGroup.style.padding = "8px 12px";
    formGroup.style.background = "var(--section-bg)";
    formGroup.style.borderRadius = "6px";
    formGroup.style.border = "1px solid var(--divider-color)";

    // Label
    const label = document.createElement("label");
    label.htmlFor = key;
    label.textContent = field.name || key;
    label.className = "form-label";
    label.style.flex = "1";
    label.style.margin = "0";
    label.style.fontSize = "13px";
    label.style.cursor = "pointer";

    // Value input
    let input;
    if (field.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!field.value;
      input.style.flex = "0";
      input.style.cursor = "pointer";
    } else {
      input = document.createElement("input");
      input.type = field.type === "number" ? "number" : "text";
      input.value = field.value;
      input.className = "form-input";
      input.style.flex = "1";
      input.style.maxWidth = "120px";
      if (field.type === "text" && String(field.value).length <= 2) input.maxLength = 2;
    }
    input.id = key;

    // Toggle checkbox (enable/disable this setting)
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = field.active;
    toggle.className = "toggle-checkbox";
    toggle.style.flex = "0";
    toggle.style.cursor = "pointer";
    toggle.title = "Enable/disable this setting";
    toggle.addEventListener("change", () => field.active = toggle.checked);

    formGroup.appendChild(label);
    formGroup.appendChild(input);

    // Emoji picker for emoji_* fields
    if (key.startsWith("emoji_")) {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "emoji-btn emoji-trigger";
      trigger.textContent = input.value && input.value.trim() ? input.value : "🙂";
      Object.assign(trigger.style, {
        width: "auto",
        display: "inline-flex",
        marginTop: "0",
        marginLeft: "8px",
        padding: "6px 8px",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center"
      });

      const picker = document.createElement("div");
      picker.className = "emoji-picker";
      picker.style.display = "none";

      const searchWrap = document.createElement("div");
      searchWrap.className = "emoji-search-wrap";
      const search = document.createElement("input");
      search.type = "text";
      search.placeholder = "Search emoji...";
      search.className = "emoji-search";
      searchWrap.appendChild(search);

      const grid = document.createElement("div");
      grid.className = "emoji-grid";

      picker.appendChild(searchWrap);
      picker.appendChild(grid);
      formGroup.appendChild(trigger);
      formGroup.appendChild(picker);

      function openPicker() {
        picker.style.display = "block";
        renderGrid("");
        search.focus();
        document.addEventListener("click", outsideClose, { capture: true });
      }
      function closePicker() {
        picker.style.display = "none";
        document.removeEventListener("click", outsideClose, { capture: true });
      }
      function togglePicker() {
        if (picker.style.display === "none") openPicker(); else closePicker();
      }
      function outsideClose(e) {
        if (!picker.contains(e.target) && e.target !== trigger) {
          closePicker();
        }
      }
      function renderGrid(q) {
        grid.innerHTML = "";
        const hasSearch = window.EmojiData && typeof window.EmojiData.search === "function";
        const query = (q || "").trim();

        const baseData = hasSearch ? window.EmojiData.search(query, 250) : [];
        let data = baseData;

        // When no query, show recently used emoji first
        if (!query && Array.isArray(recentEmojis) && recentEmojis.length && window.EmojiData && Array.isArray(window.EmojiData.list)) {
          const byChar = new Map();
          window.EmojiData.list.forEach(item => {
            if (item && typeof item.char === "string" && !byChar.has(item.char)) {
              byChar.set(item.char, item);
            }
          });

          const recentItems = [];
          const seenRecent = new Set();
          for (const ch of recentEmojis) {
            if (seenRecent.has(ch)) continue;
            seenRecent.add(ch);
            const item = byChar.get(ch) || { char: ch, name: "" };
            recentItems.push(item);
          }

          const recentSet = new Set(recentEmojis);
          const rest = baseData.filter(item => !recentSet.has(item.char));
          data = [...recentItems, ...rest];
        }

        data.forEach(item => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "emoji-choice";
          btn.title = item.name || "";
          btn.textContent = item.char;
          btn.addEventListener("click", () => {
            input.value = item.char;
            trigger.textContent = item.char;
            recordEmojiRecent(item.char);
            closePicker();
          });
          grid.appendChild(btn);
        });
      }

      trigger.addEventListener("click", (e) => { e.stopPropagation(); togglePicker(); });
      search.addEventListener("input", () => renderGrid(search.value));
    }

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

