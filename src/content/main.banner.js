// main.banner.js
function createBanner(status) {
  const isRateLimited = status === "rate_limited";
  const isPrivate = status === "private";
  const isActive = status === true;
  const isInactive = status === false;

  const banner = document.createElement("div");
  banner.className = "my-banner";

  Object.assign(banner.style, {
    background: isRateLimited ? "#fff4e5" :
                isPrivate ? "#f0f0f0" :
                isActive ? "#e6ffe6" : "#ffe6e6",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75em 1.25em",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    fontFamily: "system-ui, sans-serif",
    margin: ".5em 0",
    position: "relative",
    transition: "all 0.3s ease",
  });

  const textContainer = document.createElement("div");
  textContainer.style.display = "flex";
  textContainer.style.flexDirection = "column";
  textContainer.style.flex = "1";

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

  const mainText = document.createElement("span");
  mainText.textContent = mainMessage;
  Object.assign(mainText.style, {
    color: "white",
    fontWeight: "600",
    fontSize: "1rem",
    padding: "0.5em 1em",
    backgroundColor: bgColor,
    borderRadius: "9999px",
    textAlign: "center",
    transition: "background-color 0.3s ease, transform 0.2s ease",
  });

  const configLink = document.createElement("a");
  configLink.href = "#";
  configLink.textContent = isRateLimited
    ? "(GitHub API limit reached Add your Personal Access Token)"
    : "(According to your Configuration)";
  Object.assign(configLink.style, {
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    marginTop: "0.25em",
    alignSelf: "center",
  });
  configLink.onclick = e => {
    e.preventDefault();
    ext.sendMessage({ action: "open_popup" });
  };

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✖";
  Object.assign(closeBtn.style, {
    background: "transparent",
    border: "none",
    color: "#444",
    fontSize: "1.25rem",
    cursor: "pointer",
    marginLeft: "1em",
    transition: "color 0.2s ease",
  });
  closeBtn.onclick = () => banner.remove();

  textContainer.appendChild(mainText);
  textContainer.appendChild(configLink);
  banner.appendChild(textContainer);
  banner.appendChild(closeBtn);
  document.body.prepend(banner);
}
