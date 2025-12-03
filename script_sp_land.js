// -------------------------
// 1. AOI & map setup
// -------------------------

const swLon = -123.23407668799925;
const swLat = 49.53559929341239;
const neLon = -123.06988635889327;
const neLat = 49.61080514852734;

// --- 5 km buffer around the original box ---
const bufferLat = 0.045045;  // 5 km / 111 km per degree
const bufferLon = 0.06926;   // 5 km / (111.32 km * cos(lat))

const maxBounds = L.latLngBounds(
    [swLat - bufferLat, swLon - bufferLon],
    [neLat + bufferLat, neLon + bufferLon]
);

const mapCenter = maxBounds.getCenter();

const map = L.map("map", {
    attributionControl: true,
    minZoom: 11,
    maxZoom: 16,
    maxBounds: maxBounds,
    maxBoundsViscosity: 0.8
}).setView(mapCenter, 12);

// ArcGIS Terrain basemap
L.esri.tiledMapLayer({
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer",
    attribution: "Esri, HERE, Garmin, FAO, NOAA, NGA, USGS"
}).addTo(map);

// --- Hatched pattern for AOI boundary fill ---
const hatchedPattern = new L.StripePattern({
    patternContentUnits: "objectBoundingBox",
    weight: 2,
    spaceWeight: 4,
    color: "#6a0dad",
    opacity: 1,
    angle: 315
});

hatchedPattern.addTo(map);

L.esri.featureLayer({
    url: "https://services7.arcgis.com/MNgXxsTORgPk9EjE/arcgis/rest/services/storymap_boundary/FeatureServer/0",
    style: function () {
        return {
            color: "#6a0dad",
            weight: 3,
            opacity: 1,
            fillPattern: hatchedPattern,
            fillOpacity: 0
        };
    }
}).addTo(map);

// -------------------------
// 2. Taxon styling & buffers
// -------------------------

// Only keep these iconic taxa
const allowedIconicTaxa = [
    "Aves",
    // "Fungi",
    "Mollusca",
    "Mammalia",
    "Insecta",
    "Arachnida",
    "Amphibia",
    "Reptilia"
];

const taxaColors = {
    Mammalia: "#e41a1c",
    Aves: "#377eb8",
    Amphibia: "#4daf4a",
    Reptilia: "#984ea3",
    Actinopterygii: "#ff7f00",
    Insecta: "#ffff33",
    Arachnida: "#a65628",
    Plantae: "#4a9c4a",
    Fungi: "#f781bf",
    Mollusca: "#999999",
    Other: "#666666"
};

const bufferSpeciesCommonNames = [
    "black bear",
    "american black bear",
    "coastal tailed frog",
    "cougar",
    "coyote",
    "black-tailed deer",
    "black tailed deer",
    "bobcat"
];

const bufferRadiusMeters = 500; // 0.5 km

function needsBuffer(taxon) {
    if (!taxon) return false;
    const commonName = (taxon.preferred_common_name || "").toLowerCase();
    return bufferSpeciesCommonNames.some(target =>
        commonName.includes(target)
    );
}

function getTaxonColor(iconicName) {
    if (!iconicName) return taxaColors.Other;
    return taxaColors[iconicName] || taxaColors.Other;
}

// Group markers by iconic taxon so we can toggle them
const taxonLayers = {};

function getOrCreateTaxonLayer(iconicName) {
    const key = iconicName || "Other";
    if (!taxonLayers[key]) {
        taxonLayers[key] = L.layerGroup().addTo(map);
    }
    return taxonLayers[key];
}

// -------------------------
// 3. Fetch iNaturalist data (all pages)
// -------------------------

const baseInatParams = {
    nelat: neLat,
    nelng: neLon,
    swlat: swLat,
    swlng: swLon,
    per_page: 200,
    order_by: "observed_on",
    order: "desc",
    verifiable: true
};

let allObservations = [];

// Let viewers know that the data is loading to the app
function hideLoadingOverlay() {
    const overlay = document.getElementById("loading-overlay");
    if (!overlay) return;
    // Use CSS class for fade-out + disable interaction
    overlay.classList.add("is-hidden");
}

function fetchInatPage(page = 1) {
    const url = new URL("https://api.inaturalist.org/v1/observations");

    Object.entries(baseInatParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    url.searchParams.set("page", page);

    console.log("Fetching iNat page", page, url.toString());

    return fetch(url.toString())
        .then(response => response.json())
        .then(data => {
            const results = data.results || [];
            allObservations = allObservations.concat(results);

            console.log(
                `Page ${data.page} of iNat: got ${results.length}, total so far ${allObservations.length} / ${data.total_results}`
            );

            const total = data.total_results || 0;
            const perPage = data.per_page || baseInatParams.per_page;

            if (page * perPage < total) {
                return fetchInatPage(page + 1);
            } else {
                addObservationsToMap(allObservations);
                hideLoadingOverlay(); // all data loaded
            }
        })
        .catch(err => {
            console.error("Error fetching iNaturalist data:", err);
            alert("Failed to load iNaturalist observations.");
            hideLoadingOverlay();
        });

}

fetchInatPage(1);

// -------------------------
// 4. Add observations to map
// -------------------------

function addObservationsToMap(observations) {
    observations.forEach(obs => {
        const taxon = obs.taxon || {};
        const iconic = taxon.iconic_taxon_name || "Other";

        // Only keep desired taxa
        if (!allowedIconicTaxa.includes(iconic)) return;

        const color = getTaxonColor(iconic);

        let lat = null;
        let lon = null;

        if (obs.geojson && obs.geojson.coordinates) {
            lon = obs.geojson.coordinates[0];
            lat = obs.geojson.coordinates[1];
        } else if (obs.location) {
            const parts = obs.location.split(",");
            if (parts.length === 2) {
                lat = parseFloat(parts[0]);
                lon = parseFloat(parts[1]);
            }
        }

        if (lat == null || lon == null) return;

        const taxonLayer = getOrCreateTaxonLayer(iconic);

        const marker = L.circleMarker([lat, lon], {
            radius: 5,
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.7
        });

        const commonName = taxon.preferred_common_name || "Unknown species";
        const sciName = taxon.name || "";
        const obsDate = obs.observed_on || obs.time_observed_at || "";
        const obsUrl = obs.uri || obs.url || "#";

        // Is this one of your target species?
        const isTarget = needsBuffer(taxon);

        // Build optional photo HTML if it's a target species and has photos
        let photoHtml = "";
        if (isTarget && obs.photos && obs.photos.length > 0) {
            // iNat photo URLs often have "square" size, switch to "medium" for nicer popup
            let imgUrl =
                obs.photos[0].medium_url ||
                obs.photos[0].url ||
                obs.photos[0].small_url;

            if (imgUrl && imgUrl.includes("square")) {
                imgUrl = imgUrl.replace("square", "medium");
            }

            if (imgUrl) {
                photoHtml = `
          <br/>
          <img src="${imgUrl}" alt="${commonName}">
        `;
            }
        }

        marker.bindPopup(`
      <strong>${commonName}</strong>
      <em>${sciName}</em>
      Iconic taxon: ${iconic}<br/>
      Observed: ${obsDate}<br/>
      <a href="${obsUrl}" target="_blank" rel="noopener">View on iNaturalist</a>
      ${photoHtml}   <!-- image only appears for target species -->
    `);

        // draw buffer first, under the point, and non-interactive
        if (isTarget) {
            L.circle([lat, lon], {
                radius: bufferRadiusMeters,
                color: color,
                weight: 1,
                fillOpacity: 0.05,
                interactive: false
            }).addTo(taxonLayer);
        }

        // marker on top
        marker.addTo(taxonLayer);
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
            text.textContent = name;

            checkbox.addEventListener("change", function () {
                const taxonName = this.dataset.taxon;
                const layer = taxonLayers[taxonName];
                if (!layer) return;

                if (this.checked) {
                    if (!map.hasLayer(layer)) map.addLayer(layer);
                } else {
                    if (map.hasLayer(layer)) map.removeLayer(layer);
                }
            });

            row.appendChild(checkbox);
            row.appendChild(dot);
            row.appendChild(text);
            div.appendChild(row);
        });

        L.DomEvent.disableClickPropagation(div);
        return div;
    };

    control.addTo(map);
}
