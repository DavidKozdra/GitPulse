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

  let mainMessage = "";
  let bgColor = "";
  let emoji = "";

  if (isRateLimited) {
    emoji = "⏳";
    mainMessage = "Rate limit hit — Results temporarily inactive";
    bgColor = "#f57c00";
  } else if (isPrivate) {
    emoji = "🔒";
    mainMessage = "Private Repository";
    bgColor = "#555";
  } else if (isActive) {
    emoji = config.emoji_active.active ? config.emoji_active.value : "";
    mainMessage = `${emoji} Repo is Active !`;
    bgColor = "#1a8917";
  } else if (isInactive) {
    emoji = config.emoji_inactive.active ? config.emoji_inactive.value : "";
    mainMessage = `${emoji} Repo is InActive`;
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
document.getElementById("banner-close").onclick = () => {
  document.getElementById("my-banner").style.display = "none";
};

