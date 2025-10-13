// src/main.js
// Content script to check repository activity status and mark links/pages accordingly
var config;
var rate_limited = false


// ---------- Helpers ----------
async function isRepoActive(url) {
  const res = await ext.sendMessage({ action: "fetchRepoStatus", url });
  if (!res || res.ok === false) {
    console.warn("[Repo check] background error", res?.error);
    return false; // fail closed
  }
  return res.result?.status; // true | false | "rate_limited" | "private"
}


async function getCacheFromBackground(key) {
  return ext.sendMessage({ action: "getCache", key });
}

async function setCacheInBackground(key, value) {
  return ext.sendMessage({ action: "setCache", key, value });
}

function getActiveConfigMetrics() {
  return Object.entries(config)
    .filter(([key, field]) => field.active && field.value !== undefined)
    .reduce((acc, [key, field]) => {
      acc[key] = field.value;
      return acc;
    }, {});
}

function isRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);

    const reservedPaths = new Set([
      "topics", "explore", "features", "issues", "pulls",
      "marketplace", "orgs", "enterprise", "settings",
      "sponsors", "login", "logout", "signup", "register",
      "notifications", "dashboard", "admin", "administrator",
      "help", "support", "docs", "api", "about", "contact",
      "security", "apps", "blog", "events", "community",
      "organizations", "repositories", "search", "trending",
      "gist", "gist.github", "releases", "archive", "new",
      "watching", "stars", "forks", "followers", "following",
      "milestones", "projects", "teams", "labels", "topics",
      "codespaces", "actions", "discussions", "pages"
    ]);

    switch (hostname) {
      case "github.com":
      case "gitlab.com":
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "codeberg.org":
        // Gitea-based, similar structure: owner/repo
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "bitbucket.org":
        // /workspace/repo
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "git.sr.ht":
        // Sourcehut: /~user/repo or /user/repo
        return (parts.length >= 2 || (parts.length >= 1 && parts[0].startsWith("~")));

      case "launchpad.net":
        // /project or /project/series
        return parts.length >= 1 && !reservedPaths.has(parts[0]);

      case "www.npmjs.com":
      case "npmjs.com":
        return parts[0] === "package" && parts.length >= 2;

      case "hub.docker.com":
        return parts[0] === "r" && parts.length >= 3;

      case "pypi.org":
        return parts[0] === "project" && parts.length >= 2;

      case "crates.io":
        return parts[0] === "crates" && parts.length >= 2;

      case "packagist.org":
        return parts[0] === "packages" && parts.length >= 3;

      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ---------- Banner ----------
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

async function markRepoLinks() {
  // Top-level document
  await markLinksInDocument(document);

  // Then check iframes
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (iframeDoc) {
        await markLinksInDocument(iframeDoc);
      }
    } catch (err) {
      // Cross-origin iframe — can't access
      console.warn("Cannot access iframe:", iframe?.src, err);
    }
  }
}

async function markLinksInDocument(doc) {
  const links = doc.querySelectorAll("a");
  for (const link of links) {
    if (isRepoUrl(link.href) && !link.dataset.repoChecked) {
      link.dataset.repoChecked = "true";
      const status = await isRepoActive(link.href);

      const mark = doc.createElement("span");
      mark.textContent =
        status === "private" ? "🔒 " :
        status === "rate_limited" ? "⏳ " :
        status === true ? (config.emoji_active.active ? `${config.emoji_active.value} ` : "") :
        status === false ? (config.emoji_inactive.active ? `${config.emoji_inactive.value} ` : "") :
        "";

      mark.style.color =
        status === "private" ? "#555" :
        status === "rate_limited" ? "#f57c00" :
        status === true ? "green" :
        "red";

      link.prepend(mark);
    }
  }
}

function looksLikeGithubRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "github.com") return false;
    const parts = pathname.split("/").filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

function isGithubRepoPageNow() {
  // Meta tag check
  if (document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')) return true;

  // AppHeader context label (very reliable)
  if (document.querySelector('.AppHeader-context-item-label')) return true;

  // Tabs bar (Code / Issues / PRs)
  if (document.querySelector('.UnderlineNav')) return true;

  return false;
}

async function waitForGithubRepoIndicators(timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (isGithubRepoPageNow()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

(async () => {
  const stored = await ext.storage.local.get(["repoCheckerConfig"]);
  config = (stored && stored.repoCheckerConfig) ? stored.repoCheckerConfig : defaultConfig;

  const currentUrl = window.location.href;
  let onRepoPage = isRepoUrl(currentUrl);

  if (looksLikeGithubRepoUrl(currentUrl)) {
    const confirmed = await waitForGithubRepoIndicators();
    if (confirmed) {
      console.log("[Repo detection] Confirmed GitHub repo page");
      onRepoPage = true;
    } else {
      console.log("[Repo detection] No repo indicators found, not a repo page");
      onRepoPage = false;
    }
  }

  if (onRepoPage) {
    const status = await isRepoActive(currentUrl);
    createBanner(status);
  } else {
    markRepoLinks();
    const observer = new MutationObserver(markRepoLinks);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();

/*

const githubNavObserver = new MutationObserver(async () => {
  if (looksLikeGithubRepoUrl(window.location.href) && isGithubRepoPageNow()) {
    const existingBanner = document.querySelector(".my-banner");
    if (existingBanner) existingBanner.remove();

    console.log("[Repo detection] PJAX navigation detected — injecting fresh banner");
    const status = await isRepoActive(window.location.href);
    createBanner(status);
  }
});


githubNavObserver.observe(document.body, { childList: true, subtree: true });
*/
