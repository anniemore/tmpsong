const SHEET_ID = "1o5lqxDjTSB5DMUi7N_KPV-MnVXPsZSymE62V1q0ylAM";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const NAMES_SHEET_GID = "2045842481";
const NAMES_SHEET_URL = `${SHEET_URL}&gid=${NAMES_SHEET_GID}`;

const META_COLUMNS = new Set(["Song", "Artist", "Year", "No", "Note", "Lyrics", "Link"]);

const pageA = document.getElementById("page-a");
const pageB = document.getElementById("page-b");
const fabEar = document.getElementById("fab-ear");
const fabMic = document.getElementById("fab-mic");
const searchInput = document.getElementById("search");
const searchHintsEl = document.getElementById("search-hints");
const tagFiltersEl = document.getElementById("tag-filters");
const clearFiltersBtn = document.getElementById("clear-filters");
const songListEl = document.getElementById("song-list");
const resultCountEl = document.getElementById("result-count");
const statusEl = document.getElementById("status");
const sortBtn = document.getElementById("sort-btn");
const sortMenu = document.getElementById("sort-menu");
const nameListEl = document.getElementById("name-list");
const namesStatusEl = document.getElementById("names-status");
const toastEl = document.getElementById("toast");
const linkSheetEl = document.getElementById("link-sheet");
const linkSheetTitleEl = document.getElementById("link-sheet-title");
const linkSheetExternalEl = document.getElementById("link-sheet-external");
const linkSheetCloseBtn = document.getElementById("link-sheet-close");
const linkSheetLoadingEl = document.getElementById("link-sheet-loading");
const linkSheetFrameEl = document.getElementById("link-sheet-frame");

let columns = [];
let tagColumns = [];
let songs = [];
let names = [];
let namesLoaded = false;
const activeTagFilters = new Set();
let selectedArtist = "";
let sortMode = "time";
let toastTimer = 0;
let activeSheetUrl = "";

const strokeCollator = new Intl.Collator("zh-Hant", {
  collation: "stroke",
  sensitivity: "base",
});
const enCollator = new Intl.Collator("en", { sensitivity: "base" });
const numCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function parseGoogleSheetResponse(text) {
  const jsonText = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(jsonText);
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function formatArtistMeta(year, no) {
  if (year && no) return ` ${year}.${no}`;
  if (year) return ` ${year}`;
  if (no) return ` ${no}`;
  return "";
}

function isTagV(value) {
  return value.toLowerCase() === "v";
}

function normalizeSongs(table) {
  columns = table.cols.map((col) => col.label);
  tagColumns = columns.filter((label) => !META_COLUMNS.has(label));

  return table.rows.map((row, index) => {
    const values = {};
    columns.forEach((label, colIndex) => {
      values[label] = cellValue(row.c?.[colIndex]);
    });

    const tags = tagColumns
      .filter((label) => values[label] !== "")
      .map((label) => ({
        label,
        value: values[label],
      }));

    return {
      id: index,
      song: values.Song || "Untitled",
      artist: values.Artist || "Unknown artist",
      meta: {
        Year: values.Year,
        No: values.No,
        Note: values.Note,
        Lyrics: values.Lyrics,
        Link: values.Link,
      },
      tags,
    };
  });
}

function flattenNames(table) {
  const collected = [];
  const colCount = (table.cols || []).length;

  for (let colIndex = 0; colIndex < colCount; colIndex++) {
    for (const row of table.rows || []) {
      const value = cellValue(row.c?.[colIndex]);
      if (value) {
        collected.push({ name: value, col: colIndex });
      }
    }
  }

  return collected;
}

function uniqueArtists() {
  const seen = new Set();
  const artists = [];
  songs.forEach((song) => {
    if (!seen.has(song.artist)) {
      seen.add(song.artist);
      artists.push(song.artist);
    }
  });
  return artists;
}

function renderTagFilters() {
  tagFiltersEl.innerHTML = "";

  tagColumns.forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-filter";
    button.textContent = label;
    button.dataset.tag = label;
    button.setAttribute("aria-pressed", activeTagFilters.has(label) ? "true" : "false");
    button.addEventListener("click", () => toggleTagFilter(label));
    tagFiltersEl.appendChild(button);
  });
}

function renderSearchHints() {
  searchHintsEl.innerHTML = "";
  uniqueArtists().forEach((artist) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "search-hint";
    chip.textContent = artist;
    if (selectedArtist === artist) chip.classList.add("is-active");
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      filterByArtist(artist);
      hideSearchHints();
    });
    searchHintsEl.appendChild(chip);
  });
}

function showSearchHints() {
  if (songs.length === 0) return;
  renderSearchHints();
  searchHintsEl.hidden = false;
}

function hideSearchHints() {
  searchHintsEl.hidden = true;
}

function toggleTagFilter(label) {
  if (activeTagFilters.has(label)) {
    activeTagFilters.delete(label);
  } else {
    activeTagFilters.add(label);
  }

  renderTagFilters();
  renderSongs();
}

function clearFilters() {
  activeTagFilters.clear();
  selectedArtist = "";
  searchInput.value = "";
  renderTagFilters();
  renderSongs();
}

function filterByArtist(artist) {
  selectedArtist = artist;
  searchInput.value = artist;
  renderSongs();
}

function matchesSearch(song, query) {
  if (!query) return true;
  const haystack = `${song.song} ${song.artist}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesTags(song) {
  if (activeTagFilters.size === 0) return true;
  return [...activeTagFilters].every((label) => {
    const tag = song.tags.find((entry) => entry.label === label);
    return tag && isTagV(tag.value);
  });
}

function titleCategory(title) {
  const first = Array.from(title.trim())[0] || "";
  if (/\d/.test(first)) return 0;
  if (/[A-Za-z]/.test(first)) return 1;
  return 2;
}

function compareByChars(a, b) {
  const ta = a.song.trim();
  const tb = b.song.trim();
  const ca = titleCategory(ta);
  const cb = titleCategory(tb);
  if (ca !== cb) return ca - cb;
  if (ca === 0) return numCollator.compare(ta, tb);
  if (ca === 1) return enCollator.compare(ta, tb);

  const len = Array.from(ta).length - Array.from(tb).length;
  if (len !== 0) return len;
  return strokeCollator.compare(ta, tb);
}

function getFilteredSongs() {
  const query = searchInput.value.trim();
  const filtered = songs.filter((song) => {
    const textMatch = selectedArtist
      ? song.artist === selectedArtist
      : matchesSearch(song, query);
    return textMatch && matchesTags(song);
  });

  if (sortMode === "chars") {
    return [...filtered].sort(compareByChars);
  }
  return filtered;
}

function renderMetaChip(label, value) {
  if (!value) return null;
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.innerHTML = `<strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}`;
  return chip;
}

function renderSongCard(song) {
  const card = document.createElement("article");
  card.className = "song-card";

  const line = document.createElement("div");
  line.className = "song-line";

  const title = document.createElement("span");
  title.className = "song-title";
  title.textContent = song.song;

  const artist = document.createElement("button");
  artist.type = "button";
  artist.className = "song-artist";
  artist.textContent = song.artist + formatArtistMeta(song.meta.Year, song.meta.No);
  artist.addEventListener("click", () => filterByArtist(song.artist));

  line.append(title, artist);
  card.appendChild(line);

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";

  if (song.meta.Note) {
    const noteChip = renderMetaChip("Note", song.meta.Note);
    if (noteChip) tagRow.appendChild(noteChip);
  }

  let lyricsPanel = null;
  if (song.meta.Lyrics) {
    const lyricsBtn = document.createElement("button");
    lyricsBtn.type = "button";
    lyricsBtn.className = "lyrics-toggle";
    lyricsBtn.textContent = "Lyrics";
    lyricsBtn.setAttribute("aria-expanded", "false");

    lyricsPanel = document.createElement("div");
    lyricsPanel.className = "lyrics-panel";
    lyricsPanel.hidden = true;
    lyricsPanel.textContent = song.meta.Lyrics;

    lyricsBtn.addEventListener("click", () => {
      const opening = lyricsPanel.hidden;
      lyricsPanel.hidden = !opening;
      lyricsBtn.setAttribute("aria-expanded", opening ? "true" : "false");
      lyricsBtn.classList.toggle("is-open", opening);
    });

    tagRow.appendChild(lyricsBtn);
  }

  const links = extractUrls(song.meta.Link);
  links.forEach((url, idx) => {
    const linkChip = document.createElement("a");
    linkChip.className = "link-chip";
    linkChip.href = url;
    linkChip.target = "_blank";
    linkChip.rel = "noopener noreferrer";
    linkChip.dataset.url = url;
    if (activeSheetUrl === url) {
      linkChip.classList.add("is-active");
    }
    const labelText = links.length > 1 ? `Link ${idx + 1}` : "Link";
    linkChip.setAttribute("aria-label", labelText);
    linkChip.title = url;
    linkChip.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>` +
      (links.length > 1 ? `<span>${idx + 1}</span>` : "");
    linkChip.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      openLinkSheet(url, song.song);
    });
    tagRow.appendChild(linkChip);
  });

  song.tags.forEach((tag) => {
    const badge = document.createElement("span");
    badge.className = "song-tag";
    const marker = tag.value.toLowerCase();
    if (marker === "x") {
      badge.classList.add("is-x");
    } else if (isTagV(tag.value)) {
      badge.classList.add("is-v");
    }
    const showValue = !isTagV(marker) && marker !== "x";
    badge.textContent = showValue ? `${tag.label}: ${tag.value}` : tag.label;
    tagRow.appendChild(badge);
  });

  if (tagRow.childNodes.length > 0) {
    card.appendChild(tagRow);
  }
  if (lyricsPanel) card.appendChild(lyricsPanel);

  return card;
}

function renderSongs() {
  const filtered = getFilteredSongs();

  songListEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No songs match your search or tag filters.";
    songListEl.appendChild(empty);
  } else {
    filtered.forEach((song) => {
      songListEl.appendChild(renderSongCard(song));
    });
  }

  const total = songs.length;
  const shown = filtered.length;
  resultCountEl.textContent =
    shown === total ? `${total} songs` : `${shown} of ${total} songs`;

  clearFiltersBtn.hidden =
    activeTagFilters.size === 0 &&
    searchInput.value.trim() === "" &&
    selectedArtist === "";

  updateSortMenu();
}

function updateSortMenu() {
  sortMenu.querySelectorAll("button[data-sort]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sort === sortMode);
  });
}

function renderNames() {
  nameListEl.innerHTML = "v7";
  names.forEach(({ name, col }) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "name-chip";
    chip.dataset.col = String(col % 8);
    chip.textContent = name;
    chip.addEventListener("click", () => copyText(name));
    nameListEl.appendChild(chip);
  });
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 1200);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied");
  } catch (error) {
    const helper = document.createElement("textarea");
    helper.value = value;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    showToast("Copied");
  }
}

function setPage(page) {
  const isB = page === "b";
  pageA.hidden = isB;
  pageB.hidden = !isB;
  fabEar.hidden = isB;
  fabMic.hidden = !isB;
  const hash = isB ? "#b" : "#a";
  if (location.hash !== hash) {
    try {
      history.replaceState(null, "", hash);
    } catch {
      // Ignored in sandboxed origins (e.g. x20web)
    }
  }
  if (isB && !namesLoaded) {
    loadNames();
  }
}

function pageFromHash() {
  return location.hash === "#b" ? "b" : "a";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function syncActiveLinkChips() {
  songListEl.querySelectorAll(".link-chip").forEach((chip) => {
    chip.classList.toggle("is-active", activeSheetUrl !== "" && chip.dataset.url === activeSheetUrl);
  });
}

function openLinkSheet(url, title) {
  linkSheetTitleEl.textContent = title ? `${title} · ${url}` : url;
  linkSheetTitleEl.title = url;
  linkSheetExternalEl.href = url;
  const sameUrl = !linkSheetEl.hidden && activeSheetUrl === url;
  activeSheetUrl = url;
  if (!sameUrl) {
    linkSheetLoadingEl.hidden = false;
    linkSheetFrameEl.src = url;
  }
  linkSheetEl.hidden = false;
  document.body.classList.add("sheet-open");
  syncActiveLinkChips();
}

function closeLinkSheet() {
  if (linkSheetEl.hidden) return;
  linkSheetEl.hidden = true;
  document.body.classList.remove("sheet-open");
  linkSheetFrameEl.src = "about:blank";
  linkSheetLoadingEl.hidden = true;
  activeSheetUrl = "";
  syncActiveLinkChips();
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'，。；：！？、（）【】「」『』《》]+/g) || [];
  return matches.map((raw) => raw.replace(/[.,;:!?]+$/, "")).filter(Boolean);
}

let jsonpCounter = 0;

function fetchSheetJsonp(gid, headers) {
  return new Promise((resolve, reject) => {
    const callbackName = `__gvizCallback_${Date.now()}_${++jsonpCounter}`;
    const script = document.createElement("script");
    const tqx = `out:json;responseHandler:${callbackName}`;
    const gidParam = gid ? `&gid=${encodeURIComponent(gid)}` : "";
    const headersParam = headers != null ? `&headers=${encodeURIComponent(headers)}` : "";
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=${encodeURIComponent(tqx)}${gidParam}${headersParam}`;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      if (data?.status === "error") {
        reject(new Error(data.errors?.[0]?.detailed_message || "Sheet query failed"));
        return;
      }
      resolve(data.table);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Failed to load sheet via JSONP"));
    };

    document.head.appendChild(script);
  });
}

async function fetchSheetTable(gid, headers) {
  if (window.origin === "null") {
    return fetchSheetJsonp(gid, headers);
  }
  const gidParam = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const headersParam = headers != null ? `&headers=${encodeURIComponent(headers)}` : "";
  const url = `${SHEET_URL}${gidParam}${headersParam}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load sheet (${response.status})`);
    }
    const text = await response.text();
    const data = parseGoogleSheetResponse(text);
    return data.table;
  } catch {
    return fetchSheetJsonp(gid, headers);
  }
}

async function loadSongs() {
  try {
    const table = await fetchSheetTable();
    songs = normalizeSongs(table);

    statusEl.hidden = true;
    renderTagFilters();
    renderSongs();
  } catch (error) {
    statusEl.textContent = `Could not load songs: ${error.message}`;
    statusEl.classList.add("error");
  }
}

async function loadNames() {
  namesStatusEl.hidden = false;
  namesStatusEl.textContent = "Loading names…";
  namesStatusEl.classList.remove("error");

  try {
    const table = await fetchSheetTable(NAMES_SHEET_GID, 0);
    names = flattenNames(table);
    namesLoaded = true;
    namesStatusEl.hidden = true;
    renderNames();
  } catch (error) {
    namesStatusEl.textContent = `Could not load names: ${error.message}`;
    namesStatusEl.classList.add("error");
  }
}

searchInput.addEventListener("input", () => {
  selectedArtist = "";
  renderSongs();
  showSearchHints();
});

searchInput.addEventListener("focus", showSearchHints);
searchInput.addEventListener("click", showSearchHints);

clearFiltersBtn.addEventListener("click", clearFilters);

sortBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = sortMenu.hidden;
  sortMenu.hidden = !open;
  sortBtn.setAttribute("aria-expanded", open ? "true" : "false");
});

sortMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort]");
  if (!button) return;
  sortMode = button.dataset.sort;
  sortMenu.hidden = true;
  sortBtn.setAttribute("aria-expanded", "false");
  renderSongs();
});

document.addEventListener("click", (event) => {
  if (!sortMenu.hidden && !event.target.closest(".sort-wrap")) {
    sortMenu.hidden = true;
    sortBtn.setAttribute("aria-expanded", "false");
  }
  if (!searchHintsEl.hidden && !event.target.closest(".search-wrap")) {
    hideSearchHints();
  }
});

fabEar.addEventListener("click", () => setPage("b"));
fabMic.addEventListener("click", () => setPage("a"));
window.addEventListener("hashchange", () => setPage(pageFromHash()));

linkSheetCloseBtn.addEventListener("click", closeLinkSheet);
linkSheetFrameEl.addEventListener("load", () => {
  if (!linkSheetEl.hidden) {
    linkSheetLoadingEl.hidden = true;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLinkSheet();
  }
});

setPage(pageFromHash());
loadSongs();
