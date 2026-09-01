// Initialize 2D tile layers
tileLayers = {
  ortho: L.tileLayer('./tiles/ortho/{z}/{x}/{y}.png', {
    maxNativeZoom: 20,
    maxZoom: 22,
    tms: false
  }),
  dsm: L.tileLayer('./tiles/dsm/{z}/{x}/{y}.png', {
    maxNativeZoom: 20,
    maxZoom: 22,
    tms: false
  }),
  dtm: L.tileLayer('./tiles/dtm/{z}/{x}/{y}.png', {
    maxNativeZoom: 20,
    maxZoom: 22,
    tms: false
  })
};

// Add default view
currentTileLayer = tileLayers.ortho;
currentTileLayer.addTo(map2d);
