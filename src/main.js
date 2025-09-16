// ---------- Load Configuration ----------
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

// ---------- Hosts and cache ----------
const repoHosts = [
  "github.com",
  "gitlab.com",
  "npmjs.com",
  "hub.docker.com",
  "pypi.org",
  "crates.io",
  "packagist.org"
];

const CACHE_KEY = "repoCache_v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let repoCache = {};
try {
  const stored = localStorage.getItem(CACHE_KEY);
  if (stored) repoCache = JSON.parse(stored);
} catch {}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(repoCache));
  } catch {}
}

// ---------- Detect if a URL looks like a repo/package ----------
function isRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);

    switch (hostname) {
      case "github.com":
      case "gitlab.com":
        return parts.length >= 2;
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

// ---------- Check if repo/package updated recently ----------
async function isRepoActive(url) {
  const cached = repoCache[url];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.active;

  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    let lastUpdate;

    switch (hostname) {
      case "github.com": {
        const [owner, repo] = parts;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!res.ok) throw new Error("GitHub API failed");
        const data = await res.json();
        lastUpdate = new Date(data.pushed_at);
        break;
      }
      case "gitlab.com": {
        const projectPath = encodeURIComponent(parts.slice(0, 2).join("/"));
        const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}`);
        if (!res.ok) throw new Error("GitLab API failed");
        const data = await res.json();
        lastUpdate = new Date(data.last_activity_at);
        break;
      }
      case "www.npmjs.com":
      case "npmjs.com": {
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
        const data = await res.json();
        lastUpdate = new Date(data.last_updated);
        break;
      }
      case "pypi.org": {
        const pkgName = parts[1];
        const res = await fetch(`https://pypi.org/pypi/${pkgName}/json`);
        if (!res.ok) throw new Error("PyPI API failed");
        const data = await res.json();
        lastUpdate = new Date(data.info?.release_url || Date.now());
        break;
      }
      case "crates.io": {
        const crateName = parts[1];
        const res = await fetch(`https://crates.io/api/v1/crates/${crateName}`);
        if (!res.ok) throw new Error("Crates.io API failed");
        const data = await res.json();
        lastUpdate = new Date(data.crate.updated_at);
        break;
      }
      case "packagist.org": {
        const [_, vendor, packageName] = parts;
        const res = await fetch(`https://repo.packagist.org/p/${vendor}/${packageName}.json`);
        if (!res.ok) throw new Error("Packagist API failed");
        const data = await res.json();
        const versions = Object.values(data.packages[`${vendor}/${packageName}`]);
        lastUpdate = new Date(versions[0]?.time || Date.now());
        break;
      }
      default:
        return false;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.max_repo_update_time);
    const isActive = lastUpdate >= cutoffDate;

    repoCache[url] = { active: isActive, timestamp: Date.now() };
    saveCache();
    return isActive;
  } catch {
    repoCache[url] = { active: false, timestamp: Date.now() };
    saveCache();
    return false;
  }
}

// ---------- Detect if current page is a repo ----------
const currentUrl = window.location.href;
const onRepoPage = isRepoUrl(currentUrl);

if (onRepoPage) {
  (async () => {
    const active = await isRepoActive(currentUrl);
    const banner = document.createElement("div");
    banner.className = "my-banner";
    banner.textContent = `${active ? config.emoji_active : config.emoji_inactive} Repo !`;
    banner.style.background = active ? "#1eff00ff" : "#ff3300ff";

    const btn = document.createElement("button");
    btn.textContent = "✖";
    btn.onclick = () => banner.remove();
    banner.appendChild(btn);
    document.body.prepend(banner);

    setTimeout(() => banner.classList.add("active"), 50);
  })();
}

// ---------- Mark links if NOT on a repo page ----------
if (!onRepoPage) {
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

  markRepoLinks();
  const observer = new MutationObserver(markRepoLinks);
  observer.observe(document.body, { childList: true, subtree: true });
}
