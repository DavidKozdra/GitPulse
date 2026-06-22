// main.banner.js
//
// Repository pages get a single banner near the top of the document. Link pages
// use inline markers instead. The banner stores its last rendered status in
// data attributes so config-only changes can repaint it without another fetch.

ensureBannerExists()
function ensureBannerExists() {
  // Build the banner entirely from script so the content script does not depend
  // on host-page markup or a pre-existing extension container.
  let banner = document.getElementById("my-banner");
  if (banner) return banner; // already created

  // --- Create DOM structure entirely in JS ---
  banner = document.createElement("div");
  banner.id = "my-banner";
  banner.className = "my-banner";
  banner.style.display = "none";

  // Style container
  Object.assign(banner.style, {
    display: "none",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75em 1.25em",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    fontFamily: "system-ui, sans-serif",
    margin: ".5em 0",
    transition: "all 0.3s ease"
  });

  // text container
  const textContainer = document.createElement("div");
  textContainer.className = "text-container";
  Object.assign(textContainer.style, {
    display: "flex",
    flexDirection: "column",
    flex: "1"
  });

  // main message
  const mainText = document.createElement("span");
  mainText.className = "banner-main-text";
  Object.assign(mainText.style, {
    color: "white",
    fontWeight: "600",
    fontSize: "1rem",
    padding: "0.5em 1em",
    borderRadius: "9999px",
    textAlign: "center"
  });

  // config link
  const configLink = document.createElement("a");
  configLink.className = "banner-config-link";
  configLink.href = "#";
  Object.assign(configLink.style, {
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    marginTop: "0.25em",
    alignSelf: "center"
  });

  configLink.onclick = e => {
    e.preventDefault();
    ext.sendMessage({ action: "open_popup" });
  };

  const statusRow = document.createElement("div");
  statusRow.className = "banner-status-row";
  Object.assign(statusRow.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    flexWrap: "wrap"
  });
  statusRow.appendChild(mainText);
  textContainer.appendChild(statusRow);

  const detailsText = document.createElement("span");
  detailsText.className = "banner-details-text";
  Object.assign(detailsText.style, {
    color: "#444",
    fontSize: "0.8rem",
    lineHeight: "1.35",
    marginTop: "0.35em",
    textAlign: "center"
  });
  textContainer.appendChild(detailsText);

  textContainer.appendChild(configLink);

  const refreshBtn = document.createElement("button");
  refreshBtn.id = "banner-refresh";
  refreshBtn.textContent = "↻";
  refreshBtn.title = "Refresh repository status";
  Object.assign(refreshBtn.style, {
    background: "transparent",
    border: "none",
    color: "#444",
    fontSize: "1.35rem",
    lineHeight: "1",
    cursor: "pointer",
    marginLeft: "1em"
  });

  refreshBtn.onclick = async () => {
    // A manual refresh bypasses cache through bootstrap's refresh function. The
    // temporary disabled state prevents duplicate refresh requests.
    if (typeof window.gitpulseRefreshCurrentRepo !== "function") return;
    refreshBtn.disabled = true;
    refreshBtn.style.opacity = "0.55";
    try {
      await window.gitpulseRefreshCurrentRepo();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = "1";
    }
  };

  // close button
  const closeBtn = document.createElement("button");
  closeBtn.id = "banner-close";
  closeBtn.textContent = "✖";
  Object.assign(closeBtn.style, {
    background: "transparent",
    border: "none",
    color: "#444",
    fontSize: "1.25rem",
    cursor: "pointer",
    marginLeft: "1em"
  });

  closeBtn.onclick = () => {
    banner.style.display = "none";
  };

  // assemble
  banner.appendChild(textContainer);
  banner.appendChild(refreshBtn);
  banner.appendChild(closeBtn);
  document.body.prepend(banner);

  return banner;
}

function ToggleBanner(status, Toggle, details = {}, meta = {}) {
  // Render all possible status states in one place so the banner, dataset state,
  // details line, and config link text cannot drift apart.
  const isRateLimited = status === "rate_limited";
  const isPrivate = status === "private";
  const isUnsupported = status === "unsupported";
  const isActive = status === true;
  const isInactive = status === false;

  // Recreate the banner if the host page wiped it. SPA frameworks (e.g. Nuxt on
  // frame.work) replace document.body's contents on client-side navigation,
  // destroying the banner injected at module load. ensureBannerExists is
  // idempotent, so this is a cheap lookup when the banner is already attached.
  const banner = ensureBannerExists();
  if (!banner) {
    console.error("Banner element #my-banner could not be created in DOM.");
    return;
  }
  const mainText = banner.querySelector(".banner-main-text");
  const statusRow = banner.querySelector(".banner-status-row") || mainText?.parentElement;
  const configLink = banner.querySelector(".banner-config-link");
  const detailsText = banner.querySelector(".banner-details-text");
  statusRow?.querySelector(".gitpulse-grade-badge")?.remove();

  // Toggle visibility
  banner.style.display = Toggle ? "flex" : "none";

  // Persist last status so we can re-render on config changes without refetching.
  try {
    banner.dataset.gitpulseStatus =
      status === true ? "true" :
      status === false ? "false" :
      (status === "private" || status === "rate_limited" || status === "unsupported") ? status : "";
    banner.dataset.gitpulseDetails = JSON.stringify(details || {});
    if (Number.isFinite(meta?.score)) banner.dataset.gitpulseScore = String(meta.score);
    else delete banner.dataset.gitpulseScore;
    if (typeof meta?.grade === "string") banner.dataset.gitpulseGrade = meta.grade;
    else delete banner.dataset.gitpulseGrade;
  } catch {
    // ignore
  }

  let mainMessage = "";
  let bgColor = "";
  const pick = (key, fallback) => {
    // Emoji config is optional per state. If disabled, the status text remains
    // visible while the decorative prefix is omitted.
    const field = config?.[key];
    if (field && field.active === false) return null;
    const raw = typeof field?.value === "string" ? field.value.trim() : "";
    return raw ? raw : fallback;
  };
  const showEmoji = typeof window.__gp?.emojiDisplayEnabled === "function"
    ? window.__gp.emojiDisplayEnabled("banner")
    : true;
  const emoji =
    !showEmoji ? null :
    isRateLimited ? pick("emoji_rate_limited", "⏳") :
    isPrivate ? pick("emoji_private", "🔒") :
    isUnsupported ? pick("emoji_unsupported", "❔") :
    isActive ? pick("emoji_active", "✅") :
    isInactive ? pick("emoji_inactive", "❌") :
    null;
  const emojiPrefix = emoji ? `${emoji} ` : "";

  if (isRateLimited) {
    mainMessage = `${emojiPrefix}Rate limit hit — Results temporarily inactive`;
    bgColor = "#f57c00";
  } else if (isPrivate) {
    mainMessage = `${emojiPrefix}Private or Unavailable`;
    bgColor = "#555";
  } else if (isUnsupported) {
    mainMessage = `${emojiPrefix}Host Not Supported`;
    bgColor = "#6a737d";
  } else if (isActive) {
    mainMessage = `${emojiPrefix}Repo is Active !`;
    bgColor = "#1a8917";
  } else if (isInactive) {
    mainMessage = `${emojiPrefix}Repo is InActive`;
    bgColor = "#d32f2f";
  }

  const gradeInfo = typeof window.__gp?.repoGradeInfo === "function"
    ? window.__gp.repoGradeInfo(details, meta)
    : null;
  if (gradeInfo && (isActive || isInactive)) {
    bgColor = gradeInfo.color;
  }

  // Update bubble text + color
  mainText.textContent = mainMessage;
  mainText.style.backgroundColor = bgColor;
  mainText.style.color = gradeInfo?.textColor || "white";

  if (statusRow && typeof window.__gp?.createGradeBadge === "function" && (isActive || isInactive)) {
    const badge = window.__gp.createGradeBadge(details, meta, "banner");
    if (badge) statusRow.appendChild(badge);
  }

  if (detailsText) {
    const detailMessage =
      typeof window.__gp?.formatRepoStatusDetails === "function"
        ? window.__gp.formatRepoStatusDetails(status, details, meta)
        : "";
    detailsText.textContent = detailMessage;
    detailsText.style.display = detailMessage ? "block" : "none";
  }

  // Update config link text
  configLink.textContent =
    isRateLimited ? "(GitHub API limit reached — Add your Personal Access Token)" :
    isUnsupported ? "(This host needs a GitPulse checker)" :
    "(According to your Configuration)";

    
}

// Expose for bootstrap (config changes)
globalThis.__gp = globalThis.__gp || {};
window.__gp = globalThis.__gp;
window.gitpulseRefreshBanner = () => {
  // Repaint from stored data after emoji config changes. This avoids making a
  // network request when only the presentation changed.
  const banner = document.getElementById("my-banner");
  if (!banner) return;
  const raw = banner.dataset?.gitpulseStatus || "";
  const status = raw === "true" ? true : raw === "false" ? false : raw;
  let details = {};
  try {
    details = banner.dataset?.gitpulseDetails ? JSON.parse(banner.dataset.gitpulseDetails) : {};
  } catch {
    details = {};
  }
  const storedScore = Number(banner.dataset?.gitpulseScore);
  const meta = {
    score: Number.isFinite(storedScore) ? storedScore : details.score,
    grade: banner.dataset?.gitpulseGrade || details.grade,
  };
  if (status === "private" || status === "rate_limited" || status === "unsupported" || status === true || status === false) {
    ToggleBanner(status, banner.style.display !== "none", details, meta);
  }
};
window.__gp.refreshBanner = window.gitpulseRefreshBanner;
const bannerCloseBtn = document.getElementById("banner-close");
if (bannerCloseBtn) {
  bannerCloseBtn.onclick = () => {
    document.getElementById("my-banner").style.display = "none";
  };
}

