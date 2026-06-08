# Bucharest Weather

A small GitHub Pages dashboard for Bucharest, Romania. It shows current temperature, current UV index, and hourly temperature and UV charts for 12 hours in the past through 36 hours in the future.

The public site is fully static and fetches weather data directly from Open-Meteo in the browser. No API key, GitHub secret, Apple Developer account, or server-side proxy is required.

## Local Preview

Start a local server:

```powershell
npm run serve
```

Open the live Open-Meteo view:

```text
http://localhost:8000/
```

Open the sample fixture view:

```text
http://localhost:8000/?sample=1
```

## Deployment

The workflow at `.github/workflows/pages.yml` deploys the static app to GitHub Pages on pushes to `main` and can also be started manually with `workflow_dispatch`.

For a new repository:

1. Push these files to GitHub.
2. In GitHub, set Pages to deploy from GitHub Actions.
3. Push to `main` or run the workflow manually.

Each deployment copies `index.html`, `styles.css`, `app.js`, and the sample fixture into the Pages artifact. Weather data is fetched by each visitor's browser from Open-Meteo.

## Weather API

The app calls Open-Meteo with this request:

```text
https://api.open-meteo.com/v1/forecast?latitude=44.4268&longitude=26.1025&current=temperature_2m,uv_index&hourly=temperature_2m,uv_index&past_hours=12&forecast_hours=37&timezone=Europe/Bucharest
```

Open-Meteo returns local Bucharest hourly timestamps, Celsius temperatures, and UV index values. The app maps that response into chart points and displays attribution in the page footer.

## References

- [Open-Meteo](https://open-meteo.com/)
- [Open-Meteo Forecast API docs](https://open-meteo.com/en/docs)
