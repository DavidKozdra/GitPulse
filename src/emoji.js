(function () {
  // Lightweight emoji data provider for the popup
  // - Everything comes from generated Unicode ranges
  // - Exposes window.EmojiData with { list, search(query, limit) }

  function generateFromRanges() {
    // Broad emoji-heavy ranges
    const ranges = [
      [0x1F300, 0x1F5FF], // Misc Symbols and Pictographs
      [0x1F600, 0x1F64F], // Emoticons
      [0x1F680, 0x1F6FF], // Transport & Map Symbols
      [0x2600,  0x26FF],  // Misc symbols
      [0x2700,  0x27BF],  // Dingbats

      // New & extended emoji blocks:
      [0x1F900, 0x1F9FF], // Supplemental Symbols & Pictographs
      [0x1FA70, 0x1FAFF], // Symbols & Pictographs Extended-A
      [0x1F780, 0x1F7FF], // Geometric Shapes Extended (some emoji-like)
      [0x1F650, 0x1F67F], // Ornamental Dingbats
      [0x1F700, 0x1F77F], // Alchemical Symbols (rarely emoji but sometimes rendered)

      // Flags — Regional Indicator Symbols
      [0x1F1E6, 0x1F1FF],

      // Supplemental Arrows-C, etc. (occasional emoji-style glyphs)
      [0x1F800, 0x1F8FF],

      // Misc Symbols Extended (Unicode 15)
      [0x1FB00, 0x1FBFF]
    ];

    const list = [];
    let testRe = null;
    try {
      // Prefer Extended_Pictographic for better coverage
      testRe = /\p{Extended_Pictographic}/u;
    } catch (_) {
      try {
        testRe = /\p{Emoji_Presentation}/u;
      } catch (_) {
        testRe = null;
      }
    }

    for (const [start, end] of ranges) {
      for (let cp = start; cp <= end; cp++) {
        const ch = String.fromCodePoint(cp);
        if (!testRe || testRe.test(ch)) {
          const hex = cp.toString(16).padStart(4, "0");
          // Not curated: just algorithmic hex labels so you can still
          // search by u+1f600 or 1f600 if you want.
          list.push({ char: ch, name: `u+${hex} ${hex}` });
        }
      }
    }
    return list;
  }

  const list = generateFromRanges();

  function tokenize(str) {
    return (str || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function search(query, limit = 250) {
    const raw = (query || "").trim();
    const q = raw.toLowerCase();
    if (!q) return list.slice(0, limit);

    // Normalize colon-style shortcodes like :bug: -> "bug"
    const shortcodeMatch = /^:([a-z0-9_+\-]+):?$/.exec(q);
    const normalized = shortcodeMatch ? shortcodeMatch[1] : q;

    const tokens = tokenize(normalized);

    // If query is hex like 1f600, u+1f600, or 0x1f600, match by codepoint
    const hexCandidate = normalized.replace(/^u\+|^0x/, "");
    const isHex = /^[0-9a-f]{3,6}$/i.test(hexCandidate);

    const scored = [];

    outer: for (const item of list) {
      const name = (item.name || "").toLowerCase();

      // Exact character match
      if (item.char === raw) {
        scored.push({ item, score: 100 });
        continue;
      }

      // Hex / codepoint match
      if (isHex) {
        const cps = Array.from(item.char)
          .map(c => c.codePointAt(0)?.toString(16))
          .filter(Boolean);
        if (cps.some(h => h === hexCandidate)) {
          scored.push({ item, score: 90 });
          continue;
        }
      }

      // Word search is now basically just for hex-like names (u+1f600 etc).
      if (!name || !tokens.length) continue;

      const nameTokens = tokenize(name);
      let matchedTokens = 0;
      let wordStarts = 0;

      for (const t of tokens) {
        let found = false;
        for (const nt of nameTokens) {
          const idx = nt.indexOf(t);
          if (idx >= 0) {
            matchedTokens++;
            if (idx === 0) wordStarts++;
            found = true;
            break;
          }
        }
        if (!found) {
          continue outer; // require all tokens to match somewhere
        }
      }

      const score = matchedTokens * 10 + wordStarts * 5;
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.item);
  }

  window.EmojiData = {
    list,
    search
  };
})();
