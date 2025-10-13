// main.links.js
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
