const SHEET_ID = "1o5lqxDjTSB5DMUi7N_KPV-MnVXPsZSymE62V1q0ylAM";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

const META_COLUMNS = new Set(["Song", "Artist", "Year", "No", "Note", "Lyrics"]);

const searchInput = document.getElementById("search");
const tagFiltersEl = document.getElementById("tag-filters");
const clearFiltersBtn = document.getElementById("clear-filters");
const songListEl = document.getElementById("song-list");
const resultCountEl = document.getElementById("result-count");
const statusEl = document.getElementById("status");

let columns = [];
let tagColumns = [];
let songs = [];
const activeTagFilters = new Set();

function parseGoogleSheetResponse(text) {
  const jsonText = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(jsonText);
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function formatArtistLine(artist, year, no) {
  let line = artist;
  if (year && no) {
    line += ` ${year}.${no}`;
  } else if (year) {
    line += ` ${year}`;
  } else if (no) {
    line += ` ${no}`;
  }
  return line;
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
      values[label] = cellValue(row.c[colIndex]);
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
  searchInput.value = "";
  renderTagFilters();
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

function getFilteredSongs() {
  const query = searchInput.value.trim();
  return songs.filter((song) => matchesSearch(song, query) && matchesTags(song));
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

  const artist = document.createElement("span");
  artist.className = "song-artist";
  artist.textContent = formatArtistLine(
    song.artist,
    song.meta.Year,
    song.meta.No,
  );

  line.append(title, artist);
  card.appendChild(line);

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";

  if (song.tags.length === 0) {
    const emptyTag = document.createElement("span");
    emptyTag.className = "meta-chip";
    emptyTag.textContent = "No tags";
    tagRow.appendChild(emptyTag);
  } else {
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
  }

  card.appendChild(tagRow);

  if (song.meta.Note) {
    const noteRow = document.createElement("div");
    noteRow.className = "meta-row";
    const noteChip = renderMetaChip("Note", song.meta.Note);
    if (noteChip) noteRow.appendChild(noteChip);
    card.appendChild(noteRow);
  }

  if (song.meta.Lyrics) {
    const lyricsRow = document.createElement("div");
    lyricsRow.className = "meta-row";

    const lyricsBtn = document.createElement("button");
    lyricsBtn.type = "button";
    lyricsBtn.className = "meta-chip lyrics-toggle";
    lyricsBtn.textContent = "Lyrics";
    lyricsBtn.setAttribute("aria-expanded", "false");

    const lyricsPanel = document.createElement("div");
    lyricsPanel.className = "lyrics-panel";
    lyricsPanel.hidden = true;
    lyricsPanel.textContent = song.meta.Lyrics;

    lyricsBtn.addEventListener("click", () => {
      const opening = lyricsPanel.hidden;
      lyricsPanel.hidden = !opening;
      lyricsBtn.setAttribute("aria-expanded", opening ? "true" : "false");
      lyricsBtn.classList.toggle("is-open", opening);
    });

    lyricsRow.appendChild(lyricsBtn);
    card.appendChild(lyricsRow);
    card.appendChild(lyricsPanel);
  }

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
    activeTagFilters.size === 0 && searchInput.value.trim() === "";
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

searchInput.addEventListener("input", renderSongs);
clearFiltersBtn.addEventListener("click", clearFilters);

loadSongs();
