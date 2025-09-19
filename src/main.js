// ---------- Configuration ----------
const CONFIG_KEY = "repoCheckerConfig";
const CACHE_KEY = "repoCache_v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const defaultConfig = {
  max_repo_update_time: 365,
  emoji_active: "✅",
  emoji_inactive: "❌",
  emoji_private: "🔒"
};

function loadConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
  } catch { return { ...defaultConfig }; }
}
const config = loadConfig();

// ---------- Cache ----------
let repoCache = {};
try { repoCache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch {}
function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(repoCache)); } catch {} }

// ---------- URL Helpers ----------
function isRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    const reserved = new Set([
      "topics","explore","features","issues","pulls",
      "marketplace","orgs","enterprise","settings"
    ]);
    switch (hostname) {
      case "github.com":
      case "gitlab.com": return parts.length >= 2 && !reserved.has(parts[0]);
      case "npmjs.com":
      case "www.npmjs.com": return parts[0] === "package" && parts.length >= 2;
      case "hub.docker.com": return parts[0] === "r" && parts.length >= 3;
      case "pypi.org": return parts[0] === "project" && parts.length >= 2;
      case "crates.io": return parts[0] === "crates" && parts.length >= 2;
      default: return false;
    }
  } catch { return false; }
}

// ---------- Fetch and Mutate Object ----------
async function fetchLastUpdate(linkObj) {
  if (!linkObj.isRepo) return linkObj;

  const cached = repoCache[linkObj.link_url];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    Object.assign(linkObj, cached);
    return linkObj;
  }

  try {
    const { hostname, pathname } = new URL(linkObj.link_url);
    const parts = pathname.split("/").filter(Boolean);
    let lastUpdate = null;

    switch (hostname) {
      case "github.com": {
        const [owner, repo] = parts;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!res.ok) throw new Error();
        lastUpdate = new Date((await res.json()).pushed_at);
        break;
      }
      case "gitlab.com": {
        const projectPath = encodeURIComponent(parts.slice(0, 2).join("/"));
        const res = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}`);
        if (!res.ok) throw new Error();
        lastUpdate = new Date((await res.json()).last_activity_at);
        break;
      }
      case "npmjs.com":
      case "www.npmjs.com": {
        const pkg = parts[1];
        const res = await fetch(`https://registry.npmjs.org/${pkg}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        lastUpdate = new Date(data.time?.modified || data.time?.created);
        break;
      }
      case "hub.docker.com": {
        const [_, ns, image] = parts;
        const res = await fetch(`https://hub.docker.com/v2/repositories/${ns}/${image}`);
        if (!res.ok) throw new Error();
        lastUpdate = new Date((await res.json()).last_updated);
        break;
      }
      case "pypi.org": {
        const pkg = parts[1];
        const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        lastUpdate = Object.values(data.releases).flat().reduce((latest, file) => {
          const uploaded = new Date(file.upload_time_iso_8601);
          return !latest || uploaded > latest ? uploaded : latest;
        }, null);
        break;
      }
      case "crates.io": {
        const crate = parts[1];
        const res = await fetch(`https://crates.io/api/v1/crates/${crate}`);
        if (!res.ok) throw new Error();
        lastUpdate = new Date((await res.json()).crate.updated_at);
        break;
      }
      default: break;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.max_repo_update_time);
    linkObj.isActive = lastUpdate && lastUpdate >= cutoff;
    linkObj.isPrivate = !lastUpdate;

    repoCache[linkObj.link_url] = { ...linkObj, timestamp: Date.now() };
    saveCache();
  } catch {
    linkObj.isActive = false;
    linkObj.isPrivate = true;
    repoCache[linkObj.link_url] = { ...linkObj, timestamp: Date.now() };
    saveCache();
  }

  return linkObj;
}

// ---------- Annotate Links ----------
async function annotateLinks(currentRepoUrl, onRepoPage) {
  const links = Array.from(document.querySelectorAll("a"));
  const objs = links.map(link => ({
    link_url: link.href,
    isRepo: isRepoUrl(link.href),
    isActive: false,
    isPrivate: false,
    isOutsideOfThisRepo: currentRepoUrl ? new URL(link.href).href !== new URL(currentRepoUrl).href : true,
    element: link
  }));

  for (const obj of objs) {
    if (obj.element.dataset.repoChecked) continue;
    obj.element.dataset.repoChecked = "true";

    await fetchLastUpdate(obj);

    if (onRepoPage && !obj.isOutsideOfThisRepo) continue;
    if (!onRepoPage && obj.isPrivate) continue;

    if (obj.isRepo) {
      const mark = document.createElement("span");
      mark.textContent = obj.isPrivate ? config.emoji_private : obj.isActive ? config.emoji_active : config.emoji_inactive;
      mark.style.color = obj.isPrivate ? "gray" : obj.isActive ? "green" : "red";
      mark.style.marginRight = "2px";
      //obj.element.prepend(mark);
    }
  }
}

// ---------- Banner ----------
function createBanner(linkObj) {
  const banner = document.createElement("div");
  banner.className = "my-banner";
  banner.style.background = linkObj.isActive ? "#1eff00" : "#ff3300";
  banner.style.color = "#000";
  banner.style.display = "flex";
  banner.style.alignItems = "center";
  banner.style.justifyContent = "space-between";
  banner.style.padding = "0.5em 1em";
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "9999";
  banner.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
  banner.style.fontFamily = "sans-serif";
  banner.style.fontWeight = "bold";

  const link = document.createElement("a");
  link.href = "#";
  link.style.color = "inherit";
  link.style.textDecoration = "none";
  link.style.flex = "1";
  link.style.textAlign = "center";
  link.textContent = linkObj.isPrivate
    ? `${config.emoji_private} Private Repo`
    : `${linkObj.isActive ? config.emoji_active : config.emoji_inactive} Repo is ${linkObj.isActive ? "Active" : "Inactive"}`;

  link.onclick = e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "open_popup" });
  };

  const btn = document.createElement("button");
  btn.textContent = "✖";
  btn.style.marginLeft = "1em";
  btn.style.background = "transparent";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.fontSize = "1em";
  btn.style.fontWeight = "bold";
  btn.onclick = () => banner.remove();

  banner.appendChild(link);
  banner.appendChild(btn);
  document.body.prepend(banner);

  // Animate in
  banner.style.transform = "translateY(-100%)";
  banner.style.transition = "transform 0.3s ease";
  setTimeout(() => {
    banner.style.transform = "translateY(0)";
  }, 50);
}


// ---------- Main ----------
(async () => {
  const currentUrl = window.location.href;
  const onRepoPage = isRepoUrl(currentUrl) && currentUrl.includes("github.com");

  if (onRepoPage) {
    const currentRepoObj = { link_url: currentUrl, isRepo: true, isActive: false, isPrivate: false, isOutsideOfThisRepo: false };
    await fetchLastUpdate(currentRepoObj);

    await annotateLinks(currentUrl, true);
    createBanner(currentRepoObj);
    new MutationObserver(() => annotateLinks(currentUrl, true)).observe(document.body, { childList: true, subtree: true });
  } else {
    await annotateLinks(null, false);
    new MutationObserver(() => annotateLinks(null, false)).observe(document.body, { childList: true, subtree: true });
  }
})();
