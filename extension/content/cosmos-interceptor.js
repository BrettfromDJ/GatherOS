// MAIN-world interceptor for cosmos.so — real-time save capture.
//
// Cosmos saves an element by firing an `EditElementsConnectionsToClusters`
// GraphQL mutation (connect element(s) → cluster(s)). That mutation only
// returns { success } — no image — so we also watch every other GraphQL
// response and remember each element's cdn.cosmos.so image as it streams by.
// When a save fires, we look up the saved element's image and postMessage it
// to the isolated-world watcher, which relays it to the desktop /save pipeline
// — so a save shows up in GatherOS the moment you make it, like X bookmarks.
//
// Runs at document_start in the MAIN world so it patches fetch before Apollo
// captures it.

(() => {
  const GQL_RE = /api\.cosmos\.so\/graphql/i;
  const CDN_RE = /https:\/\/cdn\.cosmos\.so\/[^"'\s?]+/i;

  // numeric elementId -> its cdn image URL, learned from any response.
  const mediaById = new Map();

  // Walk a response, associating each cdn.cosmos.so image with the element it
  // belongs to (the nearest ancestor whose __typename names an element). This
  // keeps element images from being confused with cluster covers, etc.
  function learn(node, elementId) {
    if (!node || typeof node !== 'object') return;
    let elId = elementId;
    const tn = node.__typename || '';
    if (/element/i.test(tn)) {
      const raw = node.id;
      if (typeof raw === 'number') elId = raw;
      else if (typeof raw === 'string' && /^\d+$/.test(raw)) elId = Number(raw);
    }
    for (const k in node) {
      const v = node[k];
      if (typeof v === 'string') {
        if (elId != null && !mediaById.has(elId)) {
          const m = v.match(CDN_RE);
          if (m) mediaById.set(elId, m[0]);
        }
      } else if (v && typeof v === 'object') {
        learn(v, elId);
      }
    }
  }

  function emitSave(elementIds) {
    for (const raw of elementIds) {
      const id = Number(raw);
      const media = mediaById.get(id);
      // Normalize to the full-res base URL.
      const uuidMatch = media && /cdn\.cosmos\.so\/([^/?#]+)/i.exec(media);
      const mediaUrl = uuidMatch ? `https://cdn.cosmos.so/${uuidMatch[1]}?format=webp` : null;
      console.log('[gatheros] cosmos save detected — element', id, mediaUrl ? '(image found)' : '(image not seen yet)');
      window.postMessage({
        source: 'gatheros-cosmos-interceptor',
        type: 'save',
        elementId: id,
        mediaUrl,
        pageUrl: `https://www.cosmos.so/e/${id}`,
      }, window.location.origin);
    }
  }

  // Pull every cdn.cosmos.so image id out of a response (deduped, lowercased).
  function extractCdnUuids(data) {
    const uuids = [];
    const seen = new Set();
    try {
      const re = /cdn\.cosmos\.so\/([^/?#"'\s\\]+)/gi;
      const str = JSON.stringify(data);
      let m;
      while ((m = re.exec(str)) !== null) {
        const id = m[1].toLowerCase();
        if (!seen.has(id)) { seen.add(id); uuids.push(id); }
      }
    } catch { /* ignore */ }
    return uuids;
  }

  function handle(reqBody, data) {
    if (data) learn(data, null);
    let op, vars;
    try { const j = JSON.parse(reqBody); op = j.operationName; vars = j.variables; }
    catch { return; }
    // A collection page appends a "Similar" recommendations grid below the real
    // saves — same markup, no divider — so the DOM scraper can't separate them.
    // GetClusterRecommendations *is* that grid, so hand its image ids to the
    // watcher as an exclude list; the real saves come from GetClusterElements.
    if (/Recommendation/i.test(op || '') && data) {
      const uuids = extractCdnUuids(data);
      if (uuids.length) {
        console.log('[gatheros] cosmos: excluding', uuids.length, 'similar/recommended image(s)');
        window.postMessage({ source: 'gatheros-cosmos-interceptor', type: 'exclude', uuids }, window.location.origin);
      }
    }
    // A save = connecting element(s) to cluster(s). (Disconnect-only calls
    // have an empty clusterIdsToConnect and are ignored.)
    if (op === 'EditElementsConnectionsToClusters'
        && vars && Array.isArray(vars.elementIds) && vars.elementIds.length
        && Array.isArray(vars.clusterIdsToConnect) && vars.clusterIdsToConnect.length) {
      emitSave(vars.elementIds);
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const url = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)) || '';
    const res = await origFetch.apply(this, args);
    if (GQL_RE.test(url)) {
      const body = args[1] && args[1].body;
      if (typeof body === 'string') {
        res.clone().json().then((data) => handle(body, data)).catch(() => {});
      }
    }
    return res;
  };
})();
