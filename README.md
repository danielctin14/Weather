# Weather Dashboard

A small, static GitHub Pages dashboard for current temperature, UV index, and hourly charts (the previous 12 hours through the next 36 hours). Weather and place search are provided directly to the browser by Open-Meteo; no API key or server-side proxy is required.

## Locations and privacy

- Search for any place supported by Open-Meteo Geocoding. Country and administrative region are shown where available to distinguish duplicate names.
- **Bucharest, Romania** is the first-visit default and remains a permanent picker option.
- A location is saved as the default only after its forecast loads successfully following an explicit selection. The versioned `weather-location-v1` browser-local-storage entry contains its display fields, coordinates, and timezone. Theme preference is stored separately. Invalid or obsolete saved values are ignored safely.
- **Use my location** is opt-in: the browser permission prompt is shown only after that button is activated. The resulting coordinates are presented as “Current location” without guessing a city, and must be confirmed before they are loaded and saved. A failed or denied request leaves the current and Bucharest choices intact.
- Searches are sent to the [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api). Selected place coordinates—or confirmed device coordinates—are sent to the [Open-Meteo Forecast API](https://open-meteo.com/en/docs). This app has no analytics or application server and stores no weather/search history.

Each chart highlights the response's current local hour. Hover with a mouse or drag on touch screens to inspect another hour; touch inspection resets when released. Times use the forecast response timezone.

## Local preview

Start a local server with `npm run serve`, then open `http://localhost:8000/`.

For deterministic fixture data, open `http://localhost:8000/?sample=1`. Sample mode always identifies and displays the Bucharest fixture, disables location changes and geolocation, ignores the saved live default, and never overwrites it.

## Deployment

The workflow at `.github/workflows/pages.yml` deploys this static app to GitHub Pages on pushes to `main` or a manual `workflow_dispatch`. For a new repository, enable GitHub Pages via GitHub Actions and push the files. Each visitor's browser fetches Open-Meteo data.

## Weather API

Forecast requests are parameterized for the selected location:

```text
https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m%2Cuv_index&hourly=temperature_2m%2Cuv_index&past_hours=12&forecast_hours=37&timezone={timezone}
```

The app retains the selected place metadata while preferring the timezone returned by the forecast response.

## References

- [Open-Meteo](https://open-meteo.com/)
- [Open-Meteo Forecast API docs](https://open-meteo.com/en/docs)
- [Open-Meteo Geocoding API docs](https://open-meteo.com/en/docs/geocoding-api)
