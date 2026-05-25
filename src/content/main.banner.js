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
  textContainer.appendChild(configLink);

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
  banner.appendChild(closeBtn);
  document.body.prepend(banner);

  return banner;
}

function ToggleBanner(status, Toggle) {
  const isRateLimited = status === "rate_limited";
  const isPrivate = status === "private";
  const isActive = status === true;
  const isInactive = status === false;

  // EXPECTS an existing banner element in the HTML
  const banner = document.getElementById("my-banner");
  const mainText = banner.querySelector(".banner-main-text");
  const configLink = banner.querySelector(".banner-config-link");

  if (!banner) {
    console.error("Banner element #my-banner not found in DOM.");
    return;
  }

  // Toggle visibility
  banner.style.display = Toggle ? "flex" : "none";

  // Persist last status so we can re-render on config changes without refetching.
  try {
    banner.dataset.gitpulseStatus =
      status === true ? "true" :
      status === false ? "false" :
      (status === "private" || status === "rate_limited") ? status : "";
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
    isActive ? pick("emoji_active", "✅") :
    isInactive ? pick("emoji_inactive", "❌") :
    null;
  const emojiPrefix = emoji ? `${emoji} ` : "";

  if (isRateLimited) {
    mainMessage = `${emojiPrefix}Rate limit hit — Results temporarily inactive`;
    bgColor = "#f57c00";
  } else if (isPrivate) {
    mainMessage = `${emojiPrefix}Private Repository`;
    bgColor = "#555";
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

  // Update config link text
  configLink.textContent = isRateLimited
    ? "(GitHub API limit reached — Add your Personal Access Token)"
    : "(According to your Configuration)";

    
}

// Expose for bootstrap (config changes)
window.gitpulseRefreshBanner = () => {
  const banner = document.getElementById("my-banner");
  if (!banner) return;
  const raw = banner.dataset?.gitpulseStatus || "";
  const status = raw === "true" ? true : raw === "false" ? false : raw;
  if (status === "private" || status === "rate_limited" || status === true || status === false) {
    ToggleBanner(status, banner.style.display !== "none");
  }
};
document.getElementById("banner-close").onclick = () => {
  document.getElementById("my-banner").style.display = "none";
};

