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

const repoCache = {}; // Cache last-checked status to reduce API calls

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

// ---------- Check if repo/package updated in last year ----------
async function isRepoActive(url) {
  if (repoCache[url] !== undefined) return repoCache[url];

  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);

    let lastUpdate;

    switch (hostname) {
      case "github.com": {
        const owner = parts[0];
        const repo = parts[1];
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.pushed_at);
        break;
      }

      case "gitlab.com": {
        const projectPath = encodeURIComponent(parts.slice(0,2).join("/"));
        const apiUrl = `https://gitlab.com/api/v4/projects/${projectPath}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.last_activity_at);
        break;
      }

      // For package registries, we can use the "date" field or default to now if not available
      case "www.npmjs.com":
      case "npmjs.com": {
        const pkgName = parts[1];
        const apiUrl = `https://registry.npmjs.org/${pkgName}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.time?.modified || data.time?.created);
        break;
      }

      case "hub.docker.com": {
        const namespace = parts[1];
        const image = parts[2];
        const apiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${image}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.last_updated);
        break;
      }

      case "pypi.org": {
        const pkgName = parts[1];
        const apiUrl = `https://pypi.org/pypi/${pkgName}/json`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.info?.release_url || Date.now());
        break;
      }

      case "crates.io": {
        const crateName = parts[1];
        const apiUrl = `https://crates.io/api/v1/crates/${crateName}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        lastUpdate = new Date(data.crate.updated_at);
        break;
      }

      case "packagist.org": {
        const vendor = parts[1];
        const packageName = parts[2];
        const apiUrl = `https://repo.packagist.org/p/${vendor}/${packageName}.json`;
        const res = await fetch(apiUrl);
        if (!res.ok) return false;
        const data = await res.json();
        const versions = Object.values(data.packages[`${vendor}/${packageName}`]);
        lastUpdate = new Date(versions[0]?.time || Date.now());
        break;
      }

      default:
        return false;
    }

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const isActive = lastUpdate >= oneYearAgo;
    repoCache[url] = isActive;
    return isActive;

  } catch {
    repoCache[url] = false;
    return false;
  }
}

// ---------- Detect if current page is a repo ----------
const currentUrl = window.location.href;
const onRepoPage = isRepoUrl(currentUrl);

if (onRepoPage) {
  (async () => {
    const active = await isRepoActive(currentUrl);
    // Create banner
    const banner = document.createElement("div");
    banner.className = "my-banner";
    banner.textContent = "🚀 Repo ! " + (active ? "Active" : "Inactive");
    // Set background color based on activity
    banner.style.background = active ? "#1eff00ff" : "#ff3300ff";

    // Hide button
    const btn = document.createElement("button");
    btn.textContent = "✖";
    btn.onclick = () => banner.remove();
    banner.appendChild(btn);
    document.body.prepend(banner);

    // Trigger slide-down animation
    setTimeout(() => banner.classList.add("active"), 50);
  })();
}



// ---------- Mark links only if NOT on a repo page ----------
if (!onRepoPage) {
  async function markRepoLinks() {
    const links = document.querySelectorAll("a");
    for (const link of links) {
      if (isRepoUrl(link.href) && !link.dataset.repoChecked) {
        link.dataset.repoChecked = "true";
        const active = await isRepoActive(link.href);
        if (active) {
          const mark = document.createElement("span");
          mark.textContent = "✅ ";
          mark.style.color = "green";
          link.prepend(mark);
        }else {
            const mark = document.createElement("span");
          mark.textContent = "X";
          mark.style.color = "Red";
          link.prepend(mark);
        }
      }
    }
  }

  // Initial run
  markRepoLinks();

  // Observe dynamically added links (search pages, SPAs)
  const observer = new MutationObserver(markRepoLinks);
  observer.observe(document.body, { childList: true, subtree: true });
}
