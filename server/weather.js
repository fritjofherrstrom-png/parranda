function summarizeWeather(code) {
  if ([0, 1].includes(code)) {
    return "sun";
  }

  if ([2, 3, 45, 48].includes(code)) {
    return "clouds";
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "rain";
  }

  return "mixed";
}

function assertValidAnchor(anchor) {
  const lat = Number(anchor?.lat);
  const lng = Number(anchor?.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Weather anchor.lat måste vara mellan -90 och 90");
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Weather anchor.lng måste vara mellan -180 och 180");
  }

  return { lat, lng };
}

async function fetchWeatherForDates(dates, anchor, options = {}) {
  if (!dates.length) {
    return {};
  }

  const weatherAnchor = assertValidAnchor(anchor);
  const start = dates[0];
  const end = dates[dates.length - 1];
  const timezone =
    typeof options.timezone === "string" && options.timezone.trim()
      ? options.timezone.trim()
      : "UTC";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(weatherAnchor.lat));
  url.searchParams.set("longitude", String(weatherAnchor.lng));
  url.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather failed with status ${response.status}`);
  }

  const payload = await response.json();
  const result = {};
  const times = payload.daily?.time || [];
  const codes = payload.daily?.weathercode || [];
  const maxTemps = payload.daily?.temperature_2m_max || [];
  const minTemps = payload.daily?.temperature_2m_min || [];
  const current = payload.current || {};

  times.forEach((date, index) => {
    const condition = summarizeWeather(codes[index]);
    const temp = maxTemps[index];
    const minTemp = minTemps[index];

    result[date] = {
      condition,
      maxTemp: temp,
      minTemp,
      hot: typeof temp === "number" && temp >= 30,
      pleasant: typeof temp === "number" && temp >= 18 && temp < 30,
      rawCode: codes[index],
      currentTemp: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
      currentCode: typeof current.weather_code === "number" ? current.weather_code : null,
      isDay: typeof current.is_day === "number" ? current.is_day === 1 : null,
    };
  });

  return result;
}

module.exports = {
  fetchWeatherForDates,
};
