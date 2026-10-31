const SHEET_ID = "1o5lqxDjTSB5DMUi7N_KPV-MnVXPsZSymE62V1q0ylAM";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const NAMES_SHEET_GID = "2045842481";
const NAMES_SHEET_URL = `${SHEET_URL}&gid=${NAMES_SHEET_GID}`;

const META_COLUMNS = new Set(["Song", "Artist", "Year", "No", "Note", "Lyrics"]);

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

let columns = [];
let tagColumns = [];
let songs = [];
let names = [];
let namesLoaded = false;
const activeTagFilters = new Set();
let selectedArtist = "";
let sortMode = "time";
let toastTimer = 0;

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
      },
      tags,
    };
  });
}

function flattenNames(table) {
  const colCount = table.cols.length;
  const collected = [];

    // 1. Extract names from column labels
    for (const col of table.cols || []) {
        if (col.label) {
            const names = col.label.trim().split(/\s+/);
            collected.push(...names);
        }
    }

    // 2. Extract names from row cells
    for (const row of table.rows || []) {
        for (const cell of row.c || []) {
            const value = cellValue(cell);

            if (value && typeof value === "string") {
                collected.push(value.trim());
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
  nameListEl.innerHTML = "v6";
  names.forEach((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "name-chip";
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
    history.replaceState(null, "", hash);
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

async function loadSongs() {
  try {
    const response = await fetch(SHEET_URL);
    if (!response.ok) {
      throw new Error(`Failed to load sheet (${response.status})`);
    }

    const text = await response.text();
    const data = parseGoogleSheetResponse(text);
    songs = normalizeSongs(data.table);

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
    const response = await fetch(NAMES_SHEET_URL);
    if (!response.ok) {
      throw new Error(`Failed to load sheet (${response.status})`);
    }

    const text = await response.text();
    const data = parseGoogleSheetResponse(text);
    names = flattenNames(data.table);
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

setPage(pageFromHash());
loadSongs();
