export const environment = {
  production: true,
  envName: 'production',
  apiUrl: 'https://PRODUCTION_BACKEND_URL', // TODO: set to production BACKEND_URL
  // OpenFreeMap vector styles, the same IoTility uses (light / dark follow the .dark class).
  mapLightStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  mapDarkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
  // The same vector tiles, for maps that draw their own minimal style (the sign-in globe).
  mapVectorTilesUrl: 'https://tiles.openfreemap.org/planet',
};
