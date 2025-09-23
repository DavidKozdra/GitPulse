// ---------- Configuration ----------
const CONFIG_KEY = "repoCheckerConfig";

const defaultConfig = {
  max_repo_update_time: 365,
  max_issues_update_time: 30,
  max_count_unmerged_Prs: 5,
  emoji_active: "✅",
  emoji_inactive: "❌"
};

function loadConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
  } catch {
    return { ...defaultConfig };
  }
}

const config = loadConfig();

// ---------- Repo URL Detection ----------
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

// ---------- Repo Activity Check ----------
async function isRepoActive(url) {
  
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    let lastUpdate;

    switch (hostname) {
      case "github.com": {
        const [owner, repo] = parts;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!res.ok) throw new Error("GitHub API failed");
        lastUpdate = new Date((await res.json()).pushed_at);
        break;
      }
      case "gitlab.com": {
        const projectPath = encodeURIComponent(parts.slice(0, 2).join("/"));
        const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}`);
        if (!res.ok) throw new Error("GitLab API failed");
        lastUpdate = new Date((await res.json()).last_activity_at);
        break;
      }
      case "npmjs.com":
      case "www.npmjs.com": {
        const pkgName = parts[1];
        const res = await fetch(`https://registry.npmjs.org/${pkgName}`);
        if (!res.ok) throw new Error("NPM API failed");
        const data = await res.json();
        lastUpdate = new Date(data.time?.modified || data.time?.created);
        break;
      }
      case "hub.docker.com": {
        const [_, namespace, image] = parts;
        const res = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${image}`);
        if (!res.ok) throw new Error("Docker Hub API failed");
        lastUpdate = new Date((await res.json()).last_updated);
        break;
      }
      case "pypi.org": {
        const pkgName = parts[1];
        const res = await fetch(`https://pypi.org/pypi/${pkgName}/json`);
        if (!res.ok) throw new Error("PyPI API failed");
        const data = await res.json();
        lastUpdate = Object.values(data.releases).flat().reduce((latest, file) => {
          const uploaded = new Date(file.upload_time_iso_8601);
          return !latest || uploaded > latest ? uploaded : latest;
        }, null);
        break;
      }
      case "crates.io": {
        const crateName = parts[1];
        const res = await fetch(`https://crates.io/api/v1/crates/${crateName}`);
        if (!res.ok) throw new Error("Crates.io API failed");
        lastUpdate = new Date((await res.json()).crate.updated_at);
        break;
      }
      default:
        {
          return false;
        }
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.max_repo_update_time);
    const isActive = lastUpdate >= cutoff;
    return isActive;
  } catch {
    return false;
  }
}

// ---------- Banner for Repo Page ----------
function createBanner(isActive) {
  const banner = document.createElement("div");
  banner.className = "my-banner";

  Object.assign(banner.style, {
    background: isActive ? "#e6ffe6" : "#ffe6e6",
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

  const link = document.createElement("a");
  link.href = "#";

  Object.assign(link.style, {
    color: isActive ? "white" : "white",
    textDecoration: "none",
    flex: "1",
    fontWeight: "600",
    fontSize: "1rem",
    padding: "0.5em 1em",
    backgroundColor: isActive ? "#1a8917" : "#d32f2f",
    borderRadius: "9999px", // pill style
    textAlign: "center",
    transition: "background-color 0.3s ease, transform 0.2s ease",
  });

  link.textContent = `${isActive ? config.emoji_active : config.emoji_inactive} Repo is ${isActive ? "Active !" : "InActive"}`;
  link.onclick = e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "open_popup" });
  };

  // Hover effect
  link.addEventListener("mouseenter", () => {
    link.style.transform = "scale(1.0)";
    link.style.backgroundColor = isActive ? "#146c12" : "#b71c1c";
  });
  link.addEventListener("mouseleave", () => {
    link.style.transform = "scale(1)";
    link.style.backgroundColor = isActive ? "#1a8917" : "#d32f2f";
  });

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

  closeBtn.onmouseenter = () => (closeBtn.style.color = "#000");
  closeBtn.onmouseleave = () => (closeBtn.style.color = "#444");
  closeBtn.onclick = () => banner.remove();

  banner.appendChild(link);
  banner.appendChild(closeBtn);
  document.body.prepend(banner);

  setTimeout(() => banner.classList.add("active"), 50);
}

// ---------- Mark Repo Links ----------
async function markRepoLinks() {
  const links = document.querySelectorAll("a");
  for (const link of links) {
    if (isRepoUrl(link.href) && !link.dataset.repoChecked) {
      link.dataset.repoChecked = "true";
      const active = await isRepoActive(link.href);
      const mark = document.createElement("span");
      mark.textContent = active ? `${config.emoji_active} ` : `${config.emoji_inactive} `;
      mark.style.color = active ? "green" : "red";
      link.prepend(mark);
    }
  }
}

// ---------- Main Execution ----------
(async () => {
  const currentUrl = window.location.href;
  let onRepoPage = isRepoUrl(currentUrl);

  if (currentUrl.includes("github")) {
    const meta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    if (!meta) onRepoPage = false;
  }

  if (onRepoPage) {
    const active = await isRepoActive(currentUrl);
    createBanner(active);
  } else {
    markRepoLinks();
    const observer = new MutationObserver(markRepoLinks);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
