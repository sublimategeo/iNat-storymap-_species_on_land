// -------------------------
// 1. AOI & map setup
// -------------------------

const swLon = -123.23407668799925;
const swLat = 49.53559929341239;
const neLon = -123.06988635889327;
const neLat = 49.61080514852734;

const bufferLat = 7.5 / 111;
const bufferLon = 0.06926;

// aoi for iNat
const aoiBounds = L.latLngBounds(
  [swLat, swLon],
  [neLat, neLon]
);


const maxBounds = L.latLngBounds(
  [swLat - bufferLat, swLon - bufferLon],
  [neLat + bufferLat, neLon + bufferLon]
);

const map = L.map("map", {
  attributionControl: true,
  minZoom: 11,
  maxZoom: 16,
  maxBounds,
  maxBoundsViscosity: 0.8
}).setView(maxBounds.getCenter(), 13);

window.addEventListener("load", () => {
  setTimeout(() => map.invalidateSize(), 0);
});

L.esri.tiledMapLayer({
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer",
  attribution: "Esri, HERE, Garmin, FAO, NOAA, NGA, USGS"
}).addTo(map);

let aoiGeoJSON = null; // will hold polygon geometry for true AOI boundary

const hatchedPattern = new L.StripePattern({
  patternContentUnits: "objectBoundingBox",
  weight: 2,
  spaceWeight: 4,
  color: "#6a0dad",
  opacity: 1,
  angle: 315
});
hatchedPattern.addTo(map);

const boundaryLayer = L.esri.featureLayer({
  url: "https://services7.arcgis.com/MNgXxsTORgPk9EjE/arcgis/rest/services/storymap_boundary/FeatureServer/0",
  style: () => ({
    color: "#6a0dad",
    weight: 3,
    opacity: 1,
    fillPattern: hatchedPattern,
    fillOpacity: 0
  })
}).addTo(map);

// Fetch boundary geometry (first feature) then load iNat
boundaryLayer.query()
  .where("1=1")
  .returnGeometry(true)
  .run((err, fc) => {
    if (err) {
      console.warn("Failed to read AOI boundary geometry; falling back to bbox-only filter.", err);
      loadAllObservations(); // fallback
      return;
    }
    const feat = fc?.features?.[0];
    aoiGeoJSON = feat?.geometry || null;

    if (!aoiGeoJSON) {
      console.warn("AOI geometry missing; falling back to bbox-only filter.");
    }
    loadAllObservations();
  });

// -------------------------
// 2. Taxon styling & layers
// -------------------------

const allowedIconicTaxa = ["Aves", "Mollusca", "Mammalia", "Insecta", "Arachnida", "Amphibia", "Reptilia"];

const taxaColors = {
  Mammalia: "#117733",
  Aves: "#332288",
  Amphibia: "#DDCC77",
  Reptilia: "#CC6677",
  Insecta: "#AA4499",
  Arachnida: "#882255",
  Mollusca: "#44AA99",
  Other: "#666666"
};

function getTaxonColor(iconicName) {
  return taxaColors[iconicName] || taxaColors.Other;
}

const taxonLayers = {};
function getOrCreateTaxonLayer(iconicName) {
  const key = iconicName || "Other";
  if (!taxonLayers[key]) taxonLayers[key] = L.layerGroup().addTo(map);
  return taxonLayers[key];
}


// -------------------------
// 3. iNat fetch (all pages)
// -------------------------

// Use buffered bounds for fetch (matches what user can pan to)
const sw = aoiBounds.getSouthWest();
const ne = aoiBounds.getNorthEast();

const baseInatParams = {
  nelat: ne.lat,
  nelng: ne.lng,
  swlat: sw.lat,
  swlng: sw.lng,
  per_page: 200,
  order_by: "observed_on",
  order: "desc",
  quality_grade: "research",
  photos: true
};

let allObservations = [];
const markerIndex = [];

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.add("is-hidden");
  setTimeout(() => map.invalidateSize(), 350);
}

async function fetchInatPage(page = 1) {
  const url = new URL("https://api.inaturalist.org/v1/observations");
  Object.entries(baseInatParams).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("page", page);

  console.log("Fetching iNat page", page, url.toString());

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`iNat request failed: ${response.status} ${response.statusText}`);

  const data = await response.json();
  const results = data.results || [];
  allObservations = allObservations.concat(results);

  const total = data.total_results || 0;
  const perPage = data.per_page || baseInatParams.per_page;

  if (page * perPage < total) return fetchInatPage(page + 1);
}

async function loadAllObservations() {
  try {
    await fetchInatPage(1);
    addObservationsToMap(allObservations);
    shuffleVisibleGallery();
  } catch (err) {
    console.error("Error fetching iNaturalist data:", err);
    alert("Failed to load iNaturalist observations.");
  } finally {
    hideLoadingOverlay();
  }
}


// -------------------------
// 4. Add observations to map
// -------------------------

function addObservationsToMap(observations) {
  observations.forEach(obs => {
    const taxon = obs.taxon || {};
    const iconic = taxon.iconic_taxon_name || "Other";
    if (!allowedIconicTaxa.includes(iconic)) return;

    let lat = null, lon = null;

    if (obs.geojson?.coordinates?.length === 2) {
      [lon, lat] = obs.geojson.coordinates;
    } else if (typeof obs.location === "string") {
      const parts = obs.location.split(",");
      if (parts.length === 2) {
        lat = parseFloat(parts[0]);
        lon = parseFloat(parts[1]);
      }
    }

    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const layer = getOrCreateTaxonLayer(iconic);
    const color = getTaxonColor(iconic);

    const marker = L.circleMarker([lat, lon], {
      radius: 5,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.7
    });

    const commonName = taxon.preferred_common_name || "Unknown species";
    const sciName = taxon.name || "";
    const obsDate = obs.observed_on || obs.time_observed_at || "";
    const obsUrl = obs.uri || obs.url || "#";

    let photoHtml = "";
    const photo = obs.photos?.[0];
    if (photo) {
      let imgUrl = photo.medium_url || photo.url || photo.small_url || "";
      if (imgUrl.includes("square")) imgUrl = imgUrl.replace("square", "medium");

      const photoAttribution =
        photo.attribution || photo.native_realname || photo.native_username || "";

      if (imgUrl) {
        photoHtml = `
          <div class="popup-photo-wrap">
            <img class="popup-photo" src="${imgUrl}" alt="${commonName}">
            ${photoAttribution ? `<div class="popup-photo-attrib">Photo: ${photoAttribution}</div>` : ""}
          </div>
        `;
      }
    }

    marker.bindPopup(`
      <strong>${commonName}</strong><br/>
      <em>${sciName}</em><br/>
      Iconic taxon: ${iconic}<br/>
      Observed: ${obsDate}<br/>
      <a href="${obsUrl}" target="_blank" rel="noopener">View on iNaturalist</a>
      ${photoHtml}
    `);

    marker.addTo(layer);
    markerIndex.push({ marker, obs, lat, lon });
  });

  if (!taxonControlAdded) {
    addTaxonControl();
    taxonControlAdded = true;
  }
}


// -------------------------
// 5. Legend / filter control
// -------------------------

let taxonControlAdded = false;

function addTaxonControl() {
  const control = L.control({ position: "bottomright" });

  control.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");

    const title = document.createElement("div");
    title.className = "legend-title";
    title.textContent = "Iconic taxa";
    div.appendChild(title);

    // two-row layout wrapper
    const wrap = document.createElement("div");
    wrap.className = "legend-grid";
    div.appendChild(wrap);

    allowedIconicTaxa.forEach(name => {
      const row = document.createElement("label");
      row.className = "legend-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.taxon = name;

      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.backgroundColor = getTaxonColor(name);

      const text = document.createElement("span");
      text.className = "legend-text";
      text.textContent = name;

      checkbox.addEventListener("change", function () {
        const layer = taxonLayers[this.dataset.taxon];
        if (!layer) return;

        this.checked ? map.addLayer(layer) : map.removeLayer(layer);
        shuffleVisibleGallery();
      });

      row.appendChild(checkbox);
      row.appendChild(dot);
      row.appendChild(text);
      wrap.appendChild(row);
    });

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  control.addTo(map);
}


// -------------------------
// 6. Random visible gallery
// -------------------------

function getVisibleMarkers() {
  const bounds = map.getBounds();

  return markerIndex.filter(m => {
    const iconic = m.obs?.taxon?.iconic_taxon_name || "Other";
    const layer = taxonLayers[iconic];
    return bounds.contains([m.lat, m.lon]) && layer && map.hasLayer(layer);
  });
}

function groupByTaxon(items) {
  const groups = new Map();
  items.forEach(item => {
    const iconic = item.obs?.taxon?.iconic_taxon_name || "Other";
    if (!groups.has(iconic)) groups.set(iconic, []);
    groups.get(iconic).push(item);
  });
  return groups;
}

function sampleArray(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

function getObsThumbUrl(obs) {
  const p = obs?.photos?.[0];
  if (!p) return null;

  let url = p.small_url || p.url || p.medium_url || null;
  if (!url) return null;

  if (url.includes("square")) url = url.replace("square", "small");
  if (url.includes("medium")) url = url.replace("medium", "small");
  return url;
}

function renderGallery(items) {
  const grid = document.getElementById("gallery-grid");
  if (!grid) return;

  grid.innerHTML = "";

  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; font-size: 12px; color:#555;">
        No visible observations to sample (try zooming out or toggling layers on).
      </div>
    `;
    return;
  }

  items.forEach(item => {
    const taxon = item.obs.taxon || {};
    const common = taxon.preferred_common_name || "Unknown species";
    const sci = taxon.name || "";
    const thumb = getObsThumbUrl(item.obs);

    const card = document.createElement("div");
    card.className = "gallery-card";

    card.innerHTML = `
      ${thumb ? `<img class="gallery-thumb" src="${thumb}" alt="${common}">` : ""}
      <div class="gallery-meta">
        <span class="gallery-common">${common}</span>
        <span class="gallery-sci">${sci}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      map.setView([item.lat, item.lon], Math.max(map.getZoom(), 14), { animate: true });
      item.marker.openPopup();
    });

    grid.appendChild(card);
  });
}

function shuffleVisibleGallery() {
  if (markerIndex.length === 0) return;

  const visible = getVisibleMarkers();
  if (visible.length === 0) {
    renderGallery([]);
    return;
  }

  // shuffle a copy
  const shuffled = sampleArray(visible, visible.length);

  const groups = groupByTaxon(shuffled);

  // Step 1: pick at least one from each taxon (if possible)
  const picks = [];
  for (const name of allowedIconicTaxa) {
    const arr = groups.get(name);
    if (arr && arr.length) picks.push(arr.pop());
    if (picks.length === 8) break;
  }

  // Step 2: fill remaining slots from everything else, randomly
  if (picks.length < 8) {
    const remainingPool = [];
    for (const arr of groups.values()) remainingPool.push(...arr);
    const fill = sampleArray(remainingPool, 8 - picks.length);
    picks.push(...fill);
  }

  renderGallery(picks.slice(0, 8));
}



// -------------------------
// 7. Wire up UI events
// -------------------------

document.getElementById("shuffle-btn")?.addEventListener("click", shuffleVisibleGallery);

map.on("moveend", () => {
  if (markerIndex.length === 0) return;
  shuffleVisibleGallery();
});
