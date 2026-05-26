document.addEventListener("DOMContentLoaded", async () => {
  // The popup is rebuilt from stored config every time it opens. It does not
  // maintain long-lived state, so each open starts by loading PAT, config, and
  // emoji recents from extension storage.
  const formsContainer = document.querySelector(".forms-container");
  if (!formsContainer) return;

  // ---------------------------
  // Storage helpers
  // ---------------------------
  const loadPAT = () =>
    ext.storage.local.get(["githubPAT"]).then(({ githubPAT } = {}) => githubPAT || "");

  const savePAT = (nextPat) =>
    ext.sendMessage({ action: "setPAT", pat: nextPat }).then((response) => response?.success === true);

  const loadConfig = async () => {
    // Load through the background worker so popup rendering uses the same
    // sanitized config shape as content scripts.
    const response = await ext.sendMessage({ action: "getConfig" });
    return validateConfig(response?.config);
  };

  const saveConfig = (newConfig) =>
    ext.sendMessage({ action: "setConfig", config: validateConfig(newConfig) })
      .then((response) => response?.success === true);

  // ---------------------------
  // Load config, PAT, and recent emoji
  // ---------------------------
  const config = await loadConfig();
  let pat = await loadPAT();

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
    // The emoji picker keeps a small most-recently-used list. Persistence is
    // best-effort because picker usability should not depend on storage writes.
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

  const previewEls = {
    panel: document.getElementById("previewPanel"),
    tabs: Array.from(document.querySelectorAll(".preview-state-btn")),
    bannerPill: document.getElementById("previewBannerPill"),
    details: document.getElementById("previewDetails"),
    link: document.getElementById("previewLink"),
    scoreValue: document.getElementById("previewScoreValue"),
    scoreLabel: document.getElementById("previewScoreLabel"),
    scoreMode: document.getElementById("previewScoreMode"),
    breakdown: document.getElementById("previewBreakdown"),
  };
  let previewState = "active";

  const gradeColors = {
    A: "#1a8917",
    B: "#43a047",
    C: "#fbc02d",
    D: "#f57c00",
    F: "#d32f2f",
  };

  function clampScore(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  function gradeForScore(score) {
    const value = clampScore(score);
    if (value >= 90) return "A";
    if (value >= 80) return "B";
    if (value >= 70) return "C";
    if (value >= 60) return "D";
    return "F";
  }

  function gradeTextColor(grade) {
    return grade === "C" ? "#1f2933" : "#fff";
  }

  function buildDraftConfig() {
    const draft = {};
    sortedKeys.forEach(key => {
      const input = document.getElementById(key);
      const field = config[key];
      if (!field || !input) return;
      const row = input.closest(".form-group-row");
      const toggle = row?.querySelector(".toggle-checkbox");
      const active = toggle ? !!toggle.checked : field.active !== false;

      if (field.type === "number") {
        const val = Number(input.value);
        draft[key] = { ...field, active, value: Number.isFinite(val) ? val : field.value };
      } else if (field.type === "boolean") {
        draft[key] = { ...field, active, value: !!input.checked };
      } else if (field.type === "select") {
        draft[key] = { ...field, active, value: input.value };
      } else {
        draft[key] = { ...field, active, value: input.value || field.value };
      }
    });
    return draft;
  }

  function isFieldActive(draft, key) {
    const field = draft[key];
    return !!field && field.active !== false && field.value !== undefined;
  }

  function pickEmoji(draft, key, fallback) {
    const field = draft[key];
    if (field && field.active === false) return "";
    const raw = typeof field?.value === "string" ? field.value.trim() : "";
    return raw || fallback;
  }

  function displayMode(draft, key) {
    const value = draft[key]?.value;
    return value === "emoji" || value === "badge" || value === "both" ? value : "emoji";
  }

  function displayIncludes(mode, part) {
    return mode === part || mode === "both";
  }

  function sampleScoreForState(draft, state) {
    const minActive = clampScore(draft.min_active_score?.value ?? 70);
    if (state === "active") return Math.min(96, Math.max(82, minActive + 10));
    if (state === "inactive") return Math.max(12, Math.min(58, minActive - 18));
    return null;
  }

  function statusForPreview(draft, state, score) {
    if (state === "private" || state === "rate_limited") return state;
    if (draft.score_decides_status?.value === true && Number.isFinite(score)) {
      return score >= clampScore(draft.min_active_score?.value ?? 70);
    }
    return state === "active";
  }

  function badgeForScore(score) {
    const grade = gradeForScore(score);
    const badge = document.createElement("span");
    badge.className = "preview-grade-badge";
    badge.style.backgroundColor = gradeColors[grade];
    badge.style.color = gradeTextColor(grade);

    const icon = document.createElement("img");
    icon.className = "preview-grade-icon";
    icon.src = "./icon.png";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.textContent = `Grade ${grade}`;

    badge.appendChild(icon);
    badge.appendChild(label);
    return badge;
  }

  function breakdownItems(draft, state, score) {
    const active = state === "active";
    const items = [
      {
        key: "max_repo_update_time",
        label: "Activity",
        score: active ? 100 : Math.max(0, score - 6),
      },
      {
        key: "open_prs_max",
        label: "Open PRs",
        score: active ? 92 : Math.max(0, score - 12),
      },
      {
        key: "last_closed_pr_max_days",
        label: "Closed PR",
        score: active ? 88 : Math.max(0, score - 18),
      },
      {
        key: "max_issues_update_time",
        label: "Issues",
        score: active ? 86 : Math.max(0, score - 10),
      },
      {
        key: "max_days_since_last_release",
        label: "Release",
        score: active ? 84 : Math.max(0, score - 25),
      },
      {
        key: "max_open_issue_age",
        label: "Issue age",
        score: active ? 90 : Math.max(0, score - 16),
      },
    ].filter(item => isFieldActive(draft, item.key));

    return items.length ? items : [{ key: "score", label: "Score", score }];
  }

  function renderPreview() {
    if (!previewEls.panel) return;
    const draft = buildDraftConfig();
    const score = sampleScoreForState(draft, previewState);
    const status = statusForPreview(draft, previewState, score);
    const gradingEnabled = draft.grading_enabled?.value === true;
    const scoreControlsStatus = draft.score_decides_status?.value === true;
    const bannerMode = displayMode(draft, "banner_display");
    const markerMode = displayMode(draft, "marker_display");
    const showBannerEmoji = displayIncludes(bannerMode, "emoji");
    const showBannerBadge = gradingEnabled && displayIncludes(bannerMode, "badge");
    const showMarkerEmoji = displayIncludes(markerMode, "emoji");
    const showMarkerBadge = gradingEnabled && displayIncludes(markerMode, "badge");
    const minActive = clampScore(draft.min_active_score?.value ?? 70);
    const grade = Number.isFinite(score) ? gradeForScore(score) : "";
    const gradeColor = grade ? gradeColors[grade] : "";
    const statusKey = status === true ? "active" : status === false ? "inactive" : status;
    const emoji =
      status === true ? pickEmoji(draft, "emoji_active", "✅") :
      status === false ? pickEmoji(draft, "emoji_inactive", "❌") :
      status === "private" ? pickEmoji(draft, "emoji_private", "🔒") :
      status === "rate_limited" ? pickEmoji(draft, "emoji_rate_limited", "⏳") :
      "";
    const statusText =
      status === true ? "Repo is Active" :
      status === false ? "Repo is Inactive" :
      status === "private" ? "Private or Unavailable" :
      "Rate limit hit";
    const statusColor =
      gradingEnabled && gradeColor && (status === true || status === false) ? gradeColor :
      status === true ? "#1a8917" :
      status === false ? "#d32f2f" :
      status === "private" ? "#555" :
      "#f57c00";
    const textColor = gradingEnabled && grade === "C" && (status === true || status === false)
      ? "#1f2933"
      : "#fff";

    previewEls.tabs.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.previewState === previewState);
    });

    previewEls.bannerPill.innerHTML = "";
    previewEls.bannerPill.style.backgroundColor = statusColor;
    previewEls.bannerPill.style.color = textColor;
    const statusSpan = document.createElement("span");
    statusSpan.textContent = `${showBannerEmoji && emoji ? `${emoji} ` : ""}${statusText}`;
    previewEls.bannerPill.appendChild(statusSpan);
    if (showBannerBadge && Number.isFinite(score) && (status === true || status === false)) {
      previewEls.bannerPill.appendChild(badgeForScore(score));
    }

    const detailParts = [];
    if (Number.isFinite(score)) detailParts.push(`Score ${score}`);
    if (grade) detailParts.push(`Grade ${grade}`);
    detailParts.push(scoreControlsStatus ? `Active at ${minActive}+` : "Strict checks decide status");
    previewEls.details.textContent = detailParts.join(" | ");

    previewEls.link.innerHTML = "";
    const marker = document.createElement("span");
    marker.className = "preview-link-marker";
    if (showMarkerEmoji && emoji) {
      const icon = document.createElement("span");
      icon.textContent = emoji;
      marker.appendChild(icon);
    }
    if (showMarkerBadge && Number.isFinite(score) && (status === true || status === false)) {
      marker.appendChild(badgeForScore(score));
    }
    if (marker.childNodes.length) previewEls.link.appendChild(marker);
    previewEls.link.appendChild(document.createTextNode("github.com/example/project"));

    previewEls.scoreValue.textContent = Number.isFinite(score) ? String(score) : "--";
    previewEls.scoreLabel.textContent = Number.isFinite(score) ? `/ 100 ${grade ? `(${grade})` : ""}` : statusKey;
    previewEls.scoreMode.textContent = scoreControlsStatus
      ? `Score decides: ${status === true ? "active" : status === false ? "inactive" : statusKey}`
      : `Strict decides: ${statusKey}`;

    previewEls.breakdown.innerHTML = "";
    if (Number.isFinite(score) && (status === true || status === false)) {
      breakdownItems(draft, previewState, score).forEach(item => {
        const cell = document.createElement("div");
        cell.className = "preview-breakdown-item";
        const label = document.createElement("span");
        label.className = "preview-breakdown-label";
        label.textContent = item.label;
        const value = document.createElement("span");
        value.className = "preview-breakdown-score";
        value.textContent = `${clampScore(item.score)}`;
        cell.appendChild(label);
        cell.appendChild(value);
        previewEls.breakdown.appendChild(cell);
      });
    } else {
      const cell = document.createElement("div");
      cell.className = "preview-breakdown-item";
      const label = document.createElement("span");
      label.className = "preview-breakdown-label";
      label.textContent = status === "private" ? "Access" : "Limit";
      const value = document.createElement("span");
      value.className = "preview-breakdown-score";
      value.textContent = status === "private" ? "Locked" : "Retry";
      cell.appendChild(label);
      cell.appendChild(value);
      previewEls.breakdown.appendChild(cell);
    }
  }

  previewEls.tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      previewState = btn.dataset.previewState || "active";
      renderPreview();
    });
  });

  sortedKeys.forEach(key => {
    // Each config entry renders as: label, value input, optional emoji picker,
    // and an active toggle. The config object is updated in memory and then
    // serialized when the user clicks Save.
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
    } else if (field.type === "select") {
      input = document.createElement("select");
      input.value = field.value;
      input.className = "form-input";
      input.style.flex = "1";
      input.style.maxWidth = "140px";
      (field.options || []).forEach(option => {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label || option.value;
        input.appendChild(el);
      });
      input.value = field.value;
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
    input.addEventListener("input", renderPreview);
    input.addEventListener("change", renderPreview);

    // Toggle checkbox (enable/disable this setting). Boolean settings already
    // use their value checkbox as the on/off control, so a second toggle would
    // be redundant.
    let toggle = null;
    if (field.type !== "boolean") {
      toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = field.active;
      toggle.className = "toggle-checkbox";
      toggle.style.flex = "0";
      toggle.style.cursor = "pointer";
      toggle.title = "Enable/disable this setting";
      toggle.addEventListener("change", () => {
        field.active = toggle.checked;
        renderPreview();
      });
    }

    formGroup.appendChild(label);
    formGroup.appendChild(input);

    // Emoji picker for emoji_* fields
    if (key.startsWith("emoji_")) {
      // Emoji fields get a searchable picker in addition to the text input.
      // The input remains the saved source of truth so keyboard entry still
      // works even if the picker data is unavailable.
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
        // Search returns curated emoji first, then generated Unicode pictographs.
        // With no query, recently used emoji are lifted to the top.
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
            renderPreview();
            closePicker();
          });
          grid.appendChild(btn);
        });
      }

      trigger.addEventListener("click", (e) => { e.stopPropagation(); togglePicker(); });
      search.addEventListener("input", () => renderGrid(search.value));
    }

    if (toggle) formGroup.appendChild(toggle);

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
    // After reset, update the existing popup controls instead of rebuilding the
    // DOM. This keeps any event listeners attached during initial rendering.
    sortedKeys.forEach(key => {
      const field = configToApply[key];
      const input = document.getElementById(key);
      if (!input) return;
      const row = input.closest(".form-group-row");
      const toggle = row?.querySelector(".toggle-checkbox");
      if (field.type === "boolean") input.checked = !!field.value;
      else input.value = field.value;
      const emojiTrigger = row?.querySelector(".emoji-trigger");
      if (emojiTrigger && typeof field.value === "string") {
        emojiTrigger.textContent = field.value.trim() || "🙂";
      }
      if (toggle && toggle.type === "checkbox") toggle.checked = field.active;
    });
    renderPreview();
  };

  // ---------------------------
  // Save button
  // ---------------------------
  document.getElementById("saveBtn").addEventListener("click", async () => {
    // Reconstruct the persisted config from the current controls. Numeric fields
    // fall back to their previous value if the input cannot be parsed.
    const newConfig = buildDraftConfig();
    const nextPat = patInput.value.trim();

    await saveConfig(newConfig);
    if (nextPat !== pat) {
      await savePAT(nextPat);
      pat = nextPat;
    }
    alert("Configuration saved!");
  });

  // ---------------------------
  // Reset button
  // ---------------------------
  document.getElementById("clearBtn").addEventListener("click", async () => {
    // Reset both rules and PAT-related cached results. Clearing cache ensures the
    // next page check reflects default thresholds and auth state immediately.
    const confirmReset = confirm("Are you sure you want to reset your configuration to the default settings?");
    if (!confirmReset) return;

    const defaultConfigCopy = await resetConfig(); // from config.js now returns the defaults
    patInput.value = "";                           // clear PAT
    if (pat) {
      await savePAT("");
      pat = "";
    }
    alert("✅ Configuration has been reset to defaults.");

    updateUI(defaultConfigCopy);                   // update form inputs
  });

  renderPreview();
});
