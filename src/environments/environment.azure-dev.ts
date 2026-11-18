// Azure dev deployment (App Service app-hypernym-portal-dev, branch dev). Built by npm run build:azure-dev.
export const environment = {
  production: true,
  envName: 'azure-dev',
  apiUrl: 'https://devgateway.hypernymbiz.com/hypernym-portal-be/api/v1', // hypernym-portal-be on the HyperNym Azure dev cluster
  // OpenFreeMap vector styles, the same IoTility uses (light / dark follow the .dark class).
  mapLightStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  mapDarkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
  // The same vector tiles, for maps that draw their own minimal style (the sign-in globe).
  mapVectorTilesUrl: 'https://tiles.openfreemap.org/planet',
};
