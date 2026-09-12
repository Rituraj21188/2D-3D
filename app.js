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

const PAN_BOUNDS = SITE_BOUNDS.pad(0.3);

/* Global layer holders for Contours */
let contourLayer2D = null;
let contourLines3D = null;
let cachedContourGeoJSON = null;

/* =========================================================
   2D MAP & CONTOUR LOADER
========================================================= */

function init2DMap() {
  map2d = L.map('view-2d', {
    zoomControl: false,
    attributionControl: false,
    center: SITE_CENTER,
    zoom: 18,
    minZoom: 16,
    maxZoom: 22,
    maxBounds: PAN_BOUNDS,
    maxBoundsViscosity: 1.0
  });

  // Satellite basemap background
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22
    }
  ).addTo(map2d);

  const tileConfig = {
    minZoom: 14,
    maxNativeZoom: 20,
    maxZoom: 22,
    tms: true,
    opacity: 1.0
  };

  tileLayers = {
    ortho: L.tileLayer('./data/ortho/{z}/{x}/{y}.png', tileConfig),
    dsm:   new TransparentBlackTileLayer('./data/dsm/{z}/{x}/{y}.png', tileConfig),
    dtm:   new TransparentBlackTileLayer('./data/dtm/{z}/{x}/{y}.png', tileConfig)
  };

  currentTileLayer = tileLayers.ortho;
  currentTileLayer.addTo(map2d);

  map2d.fitBounds(SITE_BOUNDS);

  // Coordinate Telemetry
  map2d.on('mousemove', function(e) {
    const coordEl = document.getElementById('coord-display');
    if (coordEl) {
      coordEl.innerText =
        `Lat: ${e.latlng.lat.toFixed(6)}° | ` +
        `Lng: ${e.latlng.lng.toFixed(6)}° | ` +
        `Zoom: ${map2d.getZoom()} | ` +
        `Layer: ${activeRasterType.toUpperCase()}`;
    }
  });

  // Fetch and overlay Contour.geojson in 2D
  loadContourData();
}

function loadContourData() {
  fetch('./Contour.geojson')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    })
    .then(geoJson => {
      cachedContourGeoJSON = geoJson;
      render2DContours(geoJson);

      // If 3D point cloud has already loaded, generate 3D lines immediately
      if (pointCloudGroup && !contourLines3D) {
        build3DContours(geoJson);
      }
    })
    .catch(err => console.error('Error loading Contour.geojson:', err));
}

function render2DContours(data) {
  if (!map2d) return;

  contourLayer2D = L.geoJSON(data, {
    style: function(feature) {
      const coords = feature.geometry.coordinates;
      const elev = Math.round(coords[0][2] || 0)[cite: 1];
      const isIndex = elev % 5 === 0; // Thicker line for 5m index contours

      return {
        color: isIndex ? '#f59e0b' : '#38bdf8',
        weight: isIndex ? 2.0 : 1.0,
        opacity: 0.85
      };
    },
    onEachFeature: function(feature, layer) {
      const coords = feature.geometry.coordinates;
      const elev = Math.round(coords[0][2] || 0)[cite: 1];
      layer.bindTooltip(`${elev} m`, {
        sticky: true,
        direction: 'top',
        className: 'glass-panel'
      });
    }
  }).addTo(map2d);
}

/* =========================================================
   3D CONTOUR BUILDER (WGS84 -> Metric Translation)
========================================================= */

function build3DContours(geoJson) {
  if (!pointCloudGroup || !geoJson) return;

  const positions = [];
  const colors = [];

  // Geodesic metric conversion at site latitude (25.2117° N)
  const latRad = (SITE_CENTER[0] * Math.PI) / 180.0;
  const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  const indexColor = new THREE.Color(0xf59e0b); // 5m interval lines
  const intermediateColor = new THREE.Color(0x38bdf8); // Standard 1m lines

  geoJson.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const baseElev = Math.round(coords[0][2] || 0)[cite: 1];
    const isIndex = baseElev % 5 === 0;
    const stroke = isIndex ? indexColor : intermediateColor;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];

      // Convert WGS84 coordinates into local metric offsets relative to site center[cite: 1]
      const x1 = (p1[0] - SITE_CENTER[1]) * metersPerDegLon;
      const y1 = (p1[1] - SITE_CENTER[0]) * metersPerDegLat;
      const z1 = p1[2];[cite: 1]

      const x2 = (p2[0] - SITE_CENTER[1]) * metersPerDegLon;
      const y2 = (p2[1] - SITE_CENTER[0]) * metersPerDegLat;
      const z2 = p2[2];[cite: 1]

      // Align with point cloud centering
      positions.push(
        x1, y1, z1 - cloudCenter.z,
        x2, y2, z2 - cloudCenter.z
      );

      colors.push(
        stroke.r, stroke.g, stroke.b,
        stroke.r, stroke.g, stroke.b
      );
    }
  });

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    depthTest: true,
    transparent: true,
    opacity: 0.85
  });

  contourLines3D = new THREE.LineSegments(lineGeometry, lineMaterial);
  pointCloudGroup.add(contourLines3D);
}
