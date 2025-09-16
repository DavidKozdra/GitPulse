// Hosts we consider "repo sources"
const repoHosts = ["github.com", "gitlab.com", "npmjs.com"];

// Detect if URL looks like a repo
function isRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);

    if (repoHosts.includes(hostname)) {
      // GitHub/GitLab repos: /owner/repo
      if (hostname === "github.com" || hostname === "gitlab.com") {
        const parts = pathname.split("/").filter(Boolean);
        return parts.length >= 2; // /owner/repo
      }

      // npm packages: /package-name
      if (hostname === "npmjs.com") {
        const parts = pathname.split("/").filter(Boolean);
        return parts.length >= 1;
      }

      return true;
    }
  } catch (e) {
    return false; // bad URL
  }
  return false;
}

// Check if *current page* is a repo
const currentUrl = window.location.href;
const onRepoPage = isRepoUrl(currentUrl);

// If we’re on a repo, show the banner
if (onRepoPage) {
  const banner = document.createElement("div");
  banner.className = "my-banner";
  banner.textContent = "🚀 Custom Extension Active!";
  banner.style.zIndex = "9999";
  document.body.prepend(banner);
}

// If we’re NOT on a repo page, scan for repo links
if (!onRepoPage) {
  function markRepoLinks() {
    document.querySelectorAll("a").forEach((link) => {
      if (isRepoUrl(link.href) && !link.dataset.repoChecked) {
        link.dataset.repoChecked = "true";
        const mark = document.createElement("span");
        mark.textContent = "✅ ";
        mark.style.color = "green";
        link.prepend(mark);
      }
    });
  }

  // Initial run
  markRepoLinks();

  // Watch for dynamically added links (SPAs, infinite scroll)
  const observer = new MutationObserver(markRepoLinks);
  observer.observe(document.body, { childList: true, subtree: true });
}
