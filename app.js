/* =========================================================
   SITE BOUNDS
========================================================= */

const MIN_LAT = 25.21063054697481;
const MAX_LAT = 25.21277826092301;
const MIN_LNG = 91.06061914668449;
const MAX_LNG = 91.06305746574276;

const SITE_CENTER = [
  (MIN_LAT + MAX_LAT) / 2,
  (MIN_LNG + MAX_LNG) / 2
];

const SITE_BOUNDS = L.latLngBounds(
  [MIN_LAT, MIN_LNG],
  [MAX_LAT, MAX_LNG]
);

// Generates a ~250m safe buffer around your drone boundary
const PAN_BOUNDS = SITE_BOUNDS.pad(0.3);


/* =========================================================
   2D MAP (CORRECTED)
========================================================= */

function init2DMap(){
  map2d = L.map('view-2d', {
    zoomControl: false,
    attributionControl: false,
    center: SITE_CENTER,
    zoom: 18,
    minZoom: 16,               // PREVENTS ZOOMING OUT to empty non-existent tile levels
    maxZoom: 22,               // Allows sharp zoom inspection
    maxBounds: PAN_BOUNDS,     // LOCKS PANNING strictly to your mine site
    maxBoundsViscosity: 1.0    // Solid boundary wall (no elastic dragging away)
  });

  // Satellite basemap background
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22
    }
  ).addTo(map2d);

  // Tile configuration without the restrictive bounds parameter
  const tileConfig = {
  minZoom: 14,
  maxNativeZoom: 20,   // was 20 already — leave as-is, confirmed correct
  maxZoom: 22,
  tms: true,           // was false — this was the actual bug
  opacity: 1.0
};

  tileLayers = {
    ortho: L.tileLayer('./data/ortho/{z}/{x}/{y}.png', tileConfig),
    dsm:   L.tileLayer('./data/dsm/{z}/{x}/{y}.png',   tileConfig),
    dtm:   L.tileLayer('./data/dtm/{z}/{x}/{y}.png',   tileConfig)
  };

  // Add default layer
  currentTileLayer = tileLayers.ortho;
  currentTileLayer.addTo(map2d);

  // Directly center and fit map strictly onto the orthomosaic
  map2d.fitBounds(SITE_BOUNDS);

  // Coordinate Telemetry
  map2d.on('mousemove', function(e){
    document.getElementById('coord-display').innerText =
      `Lat: ${e.latlng.lat.toFixed(6)}° | ` +
      `Lng: ${e.latlng.lng.toFixed(6)}° | ` +
      `Zoom: ${map2d.getZoom()} | ` +
      `Layer: ${activeRasterType.toUpperCase()}`;
  });
}
