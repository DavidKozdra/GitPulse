(function () {
  // Lightweight emoji data provider for the popup
  // - Curated set with rich names + generated Unicode ranges
  // - Exposes window.EmojiData with { list, search(query, limit) }

  const curated = [
    { char: "✅", name: "check success done pass ok green checkmark white_check_mark" },
    { char: "❌", name: "cross fail error x cancel stop" },
    { char: "⚠️", name: "warning caution alert attention" },
    { char: "⏳", name: "hourglass waiting rate limited time" },

    { char: "🔒", name: "lock private secret restricted secure" },
    { char: "🔓", name: "unlock public open" },

    { char: "🟢", name: "green circle active online" },
    { char: "🔴", name: "red circle inactive offline" },
    { char: "🟡", name: "yellow circle pending caution" },
    { char: "🟠", name: "orange circle warning" },
    { char: "🟣", name: "purple circle" },
    { char: "🔵", name: "blue circle info" },
    { char: "⚪", name: "white circle" },
    { char: "⚫", name: "black circle" },

    { char: "🟩", name: "green square" },
    { char: "🟥", name: "red square" },
    { char: "🟨", name: "yellow square" },
    { char: "🟦", name: "blue square" },

    { char: "🚀", name: "rocket launch fast ship deploy release" },
    { char: "🐛", name: "bug issue defect" },
    { char: "🧪", name: "test experiment lab" },
    { char: "✨", name: "sparkles feature new shiny" },
    { char: "♻️", name: "recycle refactor cleanup" },

    { char: "🔧", name: "wrench fix tool" },
    { char: "🛠️", name: "tools build maintenance" },
    { char: "📦", name: "package release ship artifact" },
    { char: "📝", name: "memo note docs documentation" },
    { char: "🚨", name: "alarm breaking urgent" },
    { char: "🔥", name: "fire hot important breaking change" },

    { char: "⭐", name: "star favorite highlight" },
    { char: "🌟", name: "star rating" },

    { char: "📈", name: "chart up growth increase trending" },
    { char: "📉", name: "chart down decrease" },
    { char: "⬆️", name: "up increase upgrade" },
    { char: "⬇️", name: "down decrease downgrade" },

    { char: "🔀", name: "merge shuffle" },
    { char: "🔄", name: "refresh sync cycle" },
    { char: "🔁", name: "repeat again retry" },
    { char: "🔂", name: "repeat once" },
    { char: "🔃", name: "cycle reload" },

    { char: "👀", name: "eyes review look" },
    { char: "🤖", name: "bot automation robot" },
    { char: "🧠", name: "brain smart ai" },
    { char: "🧩", name: "puzzle piece component" },

    { char: "📌", name: "pin important" },
    { char: "📍", name: "pin location" },
    { char: "🏷️", name: "label tag" },
    { char: "🏁", name: "finish flag done" },
    { char: "🎯", name: "target goal focus" },
    { char: "🧵", name: "thread discussion" },
    { char: "🔗", name: "link url" },

    { char: "🗑️", name: "trash delete remove" },
    { char: "🧹", name: "broom cleanup clean" },
    { char: "📥", name: "inbox import" },
    { char: "📤", name: "outbox export" },

    { char: "🕒", name: "clock time waiting" },
    { char: "⏱️", name: "stopwatch timer" },

    { char: "🔎", name: "search find" },
    { char: "🔍", name: "search zoom" },

    { char: "💡", name: "idea lightbulb suggestion" },
    { char: "📚", name: "books knowledge" },
    { char: "🚧", name: "construction wip" },
    { char: "🧯", name: "extinguisher safety" }
  ];

  function uniqByChar(arr) {
    // Curated and generated ranges can overlap. Keep the first occurrence so
    // curated names/search terms win over anonymous generated entries.
    const seen = new Set();
    const out = [];
    for (const it of arr) {
      if (!seen.has(it.char)) {
        seen.add(it.char);
        out.push(it);
      }
    }
    return out;
  }

  function generateFromRanges() {
    // Broad emoji-heavy ranges. Generated items usually have no searchable name,
    // but they let users paste/search by exact character or codepoint.
    const ranges = [
      [0x1F300, 0x1F5FF], // Misc Symbols and Pictographs
      [0x1F600, 0x1F64F], // Emoticons
      [0x1F680, 0x1F6FF], // Transport & Map
      [0x2600,  0x26FF],  // Misc symbols
      [0x2700,  0x27BF],  // Dingbats
      [0x1F900, 0x1F9FF], // Supplemental Symbols and Pictographs
      [0x1FA70, 0x1FAFF]  // Symbols & Pictographs Extended-A
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
          list.push({ char: ch, name: "" });
        }
      }
    }
    return list;
  }

  const generated = generateFromRanges();
  const list = uniqByChar([...curated, ...generated]);

  function tokenize(str) {
    // Search terms are simple whitespace tokens because the curated names are a
    // compact bag of aliases rather than natural-language descriptions.
    return (str || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function search(query, limit = 250) {
    // The search scorer is intentionally small: exact character wins, codepoint
    // lookups are next, then all query tokens must appear somewhere in the
    // curated name aliases.
    const raw = (query || "").trim();
    const q = raw.toLowerCase();
    if (!q) return list.slice(0, limit);

    // Normalize colon-style shortcodes like :bug: -> "bug"
    const shortcodeMatch = /^:([a-z0-9_+-]+):?$/.exec(q);
    const normalized = shortcodeMatch ? shortcodeMatch[1] : q;

    const tokens = tokenize(normalized);

    // If query is hex like 1f600 or u+1f600, match by codepoint
    const hexCandidate = normalized.replace(/^u\+/, "");
    const isHex = /^[0-9a-f]{3,6}$/i.test(hexCandidate);

    const scored = [];

    outer: for (const item of list) {
      if (scored.length >= limit * 3) break; // avoid unbounded work

      const name = (item.name || "").toLowerCase();

      // Exact character match
      if (item.char === raw) {
        scored.push({ item, score: 100 });
        continue;
      }

      // Hex / codepoint match (applies to curated + generated)
      if (isHex) {
        const cps = Array.from(item.char)
          .map(c => c.codePointAt(0)?.toString(16))
          .filter(Boolean);
        if (cps.some(h => h === hexCandidate)) {
          scored.push({ item, score: 90 });
          continue;
        }
      }

      // No textual metadata for generated items -> skip for word search
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
