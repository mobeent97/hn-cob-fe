// Local development. Mirrors DEBUG=True on the backend.
export const environment = {
  production: false,
  envName: 'development',
  apiUrl: 'http://localhost:8000',
  // OpenFreeMap vector styles, the same IoTility uses (light / dark follow the .dark class).
  mapLightStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  mapDarkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
};
