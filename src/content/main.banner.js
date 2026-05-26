// main.banner.js

ensureBannerExists()
function ensureBannerExists() {
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

  textContainer.appendChild(mainText);

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
  const isRateLimited = status === "rate_limited";
  const isPrivate = status === "private";
  const isUnsupported = status === "unsupported";
  const isActive = status === true;
  const isInactive = status === false;

  // EXPECTS an existing banner element in the HTML
  const banner = document.getElementById("my-banner");
  if (!banner) {
    console.error("Banner element #my-banner not found in DOM.");
    return;
  }
  const mainText = banner.querySelector(".banner-main-text");
  const configLink = banner.querySelector(".banner-config-link");
  const detailsText = banner.querySelector(".banner-details-text");

  // Toggle visibility
  banner.style.display = Toggle ? "flex" : "none";

  // Persist last status so we can re-render on config changes without refetching.
  try {
    banner.dataset.gitpulseStatus =
      status === true ? "true" :
      status === false ? "false" :
      (status === "private" || status === "rate_limited" || status === "unsupported") ? status : "";
    banner.dataset.gitpulseDetails = JSON.stringify(details || {});
  } catch {
    // ignore
  }

  let mainMessage = "";
  let bgColor = "";
  const pick = (key, fallback) => {
    const field = config?.[key];
    if (field && field.active === false) return null;
    const raw = typeof field?.value === "string" ? field.value.trim() : "";
    return raw ? raw : fallback;
  };
  const emoji =
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

  // Update bubble text + color
  mainText.textContent = mainMessage;
  mainText.style.backgroundColor = bgColor;

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
  if (status === "private" || status === "rate_limited" || status === "unsupported" || status === true || status === false) {
    ToggleBanner(status, banner.style.display !== "none", details);
  }
};
window.__gp.refreshBanner = window.gitpulseRefreshBanner;
const bannerCloseBtn = document.getElementById("banner-close");
if (bannerCloseBtn) {
  bannerCloseBtn.onclick = () => {
    document.getElementById("my-banner").style.display = "none";
  };
}

