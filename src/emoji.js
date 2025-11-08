(function () {
  // Lightweight emoji data provider for the popup
  // - Combines a curated set (with names) and a generated set from Unicode ranges
  // - Exposes window.EmojiData with { list, search(query, limit) }

  const curated = [
    { char: "✅", name: "check success done pass ok green checkmark" },
    { char: "❌", name: "cross fail error x cancel stop" },
    { char: "⚠️", name: "warning caution alert attention" },
    { char: "⏳", name: "hourglass waiting rate limited time" },
    { char: "🔒", name: "lock private secret restricted" },
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
    { char: "🚀", name: "rocket launch fast ship" },
    { char: "🐛", name: "bug issue defect" },
    { char: "🧪", name: "test experiment lab" },
    { char: "✨", name: "sparkles feature new shiny" },
    { char: "♻️", name: "recycle refactor cleanup" },
    { char: "🔧", name: "wrench fix tool" },
    { char: "🛠️", name: "tools build maintenance" },
    { char: "📦", name: "package release ship" },
    { char: "📝", name: "memo note docs documentation" },
    { char: "🚨", name: "alarm breaking urgent" },
    { char: "🔥", name: "fire hot important" },
    { char: "🌟", name: "star favorite highlight" },
    { char: "⭐", name: "star rating" },
    { char: "📈", name: "chart up growth increase" },
    { char: "📉", name: "chart down decrease" },
    { char: "⬆️", name: "up increase upgrade" },
    { char: "⬇️", name: "down decrease downgrade" },
    { char: "🔀", name: "merge shuffle" },
    { char: "🔃", name: "refresh sync cycle" },
    { char: "🔁", name: "repeat again retry" },
    { char: "🔂", name: "repeat once" },
    { char: "🔄", name: "cycle reload" },
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
    { char: "🔍", name: "search find" },
    { char: "🔎", name: "search zoom" },
    { char: "💡", name: "idea lightbulb suggestion" },
    { char: "📚", name: "books knowledge" },
    { char: "🔒", name: "lock private secure" },
    { char: "🔓", name: "unlock public" },
    { char: "🚧", name: "construction wip" },
    { char: "🧯", name: "extinguisher safety" }
  ];

  function uniqByChar(arr) {
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
    // Broad emoji-heavy ranges
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
      try { testRe = /\p{Emoji_Presentation}/u; } catch (_) { testRe = null; }
    }

    for (const [start, end] of ranges) {
      for (let cp = start; cp <= end; cp++) {
        const ch = String.fromCodePoint(cp);
        if (!testRe || testRe.test(ch)) list.push({ char: ch, name: "" });
      }
    }
    return list;
  }

  const generated = generateFromRanges();
  const list = uniqByChar([...curated, ...generated]);

  function search(query, limit = 250) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return list.slice(0, limit);

    // If query is hex like 1f600 or u+1f600, match by codepoint
    const hex = q.replace(/^u\+/, "");
    const isHex = /^[0-9a-f]{3,6}$/i.test(hex);

    const results = [];
    for (const item of list) {
      if (results.length >= limit) break;
      if (!q) { results.push(item); continue; }

      if (item.name && item.name.includes(q)) { results.push(item); continue; }
      if (item.char === query) { results.push(item); continue; }

      if (isHex) {
        const cps = Array.from(item.char).map(c => c.codePointAt(0)?.toString(16)).filter(Boolean);
        if (cps.some(h => h === hex)) { results.push(item); continue; }
      }
    }
    return results;
  }

  window.EmojiData = {
    list,
    search
  };
})();

