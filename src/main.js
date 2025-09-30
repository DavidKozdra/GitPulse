var config;
var rate_limited = false
// ---------- Helpers ----------
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

async function getPAT() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "get_pat" }, (response) => {
      resolve(response?.pat || "");
    });
  });
}

async function getCacheFromBackground(key) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "getCache", key }, (response) => resolve(response));
  });
}

async function setCacheInBackground(key, value) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "setCache", key, value }, (response) => resolve(response));
  });
}

function getActiveConfigMetrics() {
  return Object.entries(config)
    .filter(([key, field]) => field.active && field.value !== undefined)
    .reduce((acc, [key, field]) => {
      acc[key] = field.value;
      return acc;
    }, {});
}

// ---------- Repo Activity Check ----------
async function isRepoActive(url) {
  const activeMetrics = getActiveConfigMetrics();
  const key = new URL(url).hostname + new URL(url).pathname;

  const cached = await getCacheFromBackground(key);
  if (cached?.isActive !== undefined && cached?.isActive !== null) {
    console.log(`[Cache hit] ${url} isActive=${cached.isActive}`);
    return cached.isActive;
  } else {
    console.log("Cache miss");
  }

  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    let isActive = true;

    if (hostname === "github.com") {
      const [owner, repo] = parts;
      const githubPAT = await getPAT();
      const headers = {
        Accept: "application/vnd.github.v3+json",
        ...(githubPAT ? { Authorization: `token ${githubPAT}` } : {})
      };

      // Repo info
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

      if (repoRes.status === 403) {
        console.warn(`[Rate limited] GitHub API rate limit hit for ${owner}/${repo}`);]
        rate_limited = true
        console.log("limit !!")
        return "rate_limited";
        
      }else {
        console.log("back on ")
        rate_limited = false
      }

      if (!repoRes.ok) throw new Error(`GitHub API failed: ${repoRes.status}`);

      const repoData = await repoRes.json();
      console.log(`[Repo fetched] ${url}, last push: ${repoData.pushed_at}`);

      // Private repo check
      if (repoData.private) {
        console.log(`[Private Repo] ${owner}/${repo}`);
        await setCacheInBackground(key, { isActive: "private" });
        return "private";
      }

      // Open PRs
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=1`, { headers });
      const openPRs = prRes.ok ? await prRes.json() : [];
      console.log(`[Open PRs] ${openPRs.length} open`);

      // Open Issues
      const issuesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=1`, { headers });
      const openIssues = issuesRes.ok ? await issuesRes.json() : [];
      console.log(`[Open Issues] ${openIssues.length} open`);

      // Last release
      const releasesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`, { headers });
      const releases = releasesRes.ok ? await releasesRes.json() : [];
      if (releases.length) console.log(`[Last Release] ${releases[0].published_at}`);

      const now = new Date();

      // Check max_repo_update_time
      if (activeMetrics.max_repo_update_time !== undefined) {
        const lastPush = new Date(repoData.pushed_at);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - activeMetrics.max_repo_update_time);
        if (lastPush < cutoff) {
          console.log(`[Inactive] Last push too old: ${lastPush}`);
          isActive = false;
        }
      }

      // Check max_issues_update_time
      if (activeMetrics.max_issues_update_time !== undefined && openIssues.length) {
        const lastIssue = new Date(openIssues[0].updated_at);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - activeMetrics.max_issues_update_time);
        if (lastIssue < cutoff) {
          console.log(`[Inactive] Last issue updated too long ago: ${lastIssue}`);
          isActive = false;
        }
      }

      // Check max_count_unmerged_Prs
      if (activeMetrics.max_count_unmerged_Prs !== undefined) {
        if (openPRs.length > activeMetrics.max_count_unmerged_Prs) {
          console.log(`[Inactive] Too many unmerged PRs: ${openPRs.length}`);
          isActive = false;
        }
      }

      // Check max_days_since_last_pr
      if (activeMetrics.max_days_since_last_pr !== undefined && openPRs.length) {
        const lastPR = new Date(openPRs[0].updated_at);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - activeMetrics.max_days_since_last_pr);
        if (lastPR < cutoff) {
          console.log(`[Inactive] Last PR updated too long ago: ${lastPR}`);
          isActive = false;
        }
      }

      // Check max_days_since_last_release
      if (activeMetrics.max_days_since_last_release !== undefined && releases.length) {
        const lastRelease = new Date(releases[0].published_at);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - activeMetrics.max_days_since_last_release);
        if (lastRelease < cutoff) {
          console.log(`[Inactive] Last release too old: ${lastRelease}`);
          isActive = false;
        }
      }
    }

    await setCacheInBackground(key, { isActive });
    console.log(`[Result] ${url} isActive=${isActive}`);
    return isActive;

  } catch (e) {
    console.warn("[Repo check failed]", url, e);
    await setCacheInBackground(key, { isActive: false });
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
    chrome.runtime.sendMessage({ action: "open_popup" });
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

// ---------- Mark Repo Links ----------
async function markRepoLinks() {
  const links = document.querySelectorAll("a");
  for (const link of links) {
    if (isRepoUrl(link.href) && !link.dataset.repoChecked) {
      link.dataset.repoChecked = "true";
      const status = await isRepoActive(link.href);
   
      const mark = document.createElement("span");
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

// ---------- Main ----------
(async () => {
  config = await new Promise(resolve => {
    chrome.storage.local.get(["repoCheckerConfig"], ({ repoCheckerConfig }) => {
      resolve(repoCheckerConfig || defaultConfig);
    });
  });

  const currentUrl = window.location.href;
  let onRepoPage = isRepoUrl(currentUrl);

  if (currentUrl.includes("github")) {
    const meta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    if (!meta) onRepoPage = false;
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

