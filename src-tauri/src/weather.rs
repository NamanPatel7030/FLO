//! Weather widget data: approximate location from IP (ipapi.co, key-less) + current conditions
//! from open-meteo (key-less, privacy-friendly). Cached for 15 minutes so opening the notch panel
//! doesn't hit the network each time. Both hosts are gated behind `Purpose::Weather` in egress.
use crate::egress::Purpose;
use crate::model::Weather;
use crate::state::Shared;
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::time::Instant;

static CACHE: Mutex<Option<(Instant, Weather)>> = Mutex::new(None);
const TTL_SECS: u64 = 15 * 60;
/// The IP-based location barely changes: look it up once every 6 hours, not with every refresh.
static LOCATION: Mutex<Option<(Instant, f64, f64, String)>> = Mutex::new(None);
const LOCATION_TTL_SECS: u64 = 6 * 60 * 60;

pub async fn current(st: &Shared) -> Result<Weather> {
    if let Some((at, w)) = CACHE.lock().as_ref() {
        if at.elapsed().as_secs() < TTL_SECS {
            return Ok(w.clone());
        }
    }
    let client = st.egress.client(Purpose::Weather, true);

    // 1) approximate location from IP (no API key), cached for hours
    let known = LOCATION.lock().as_ref().filter(|(at, ..)| at.elapsed().as_secs() < LOCATION_TTL_SECS).map(|(_, a, b, p)| (*a, *b, p.clone()));
    let (lat, lon, place) = match known {
        Some(l) => l,
        None => {
            let loc_url = "https://ipapi.co/json/";
            st.egress.check(loc_url, Purpose::Weather, true)?;
            let loc: serde_json::Value = client.get(loc_url).timeout(std::time::Duration::from_secs(10)).send().await?.json().await?;
            st.egress.record(loc_url, Purpose::Weather, loc.to_string().len() as u64);
            let lat = loc["latitude"].as_f64().ok_or_else(|| anyhow!("no location"))?;
            let lon = loc["longitude"].as_f64().ok_or_else(|| anyhow!("no location"))?;
            let place = loc["city"].as_str().filter(|s| !s.is_empty()).unwrap_or("").to_string();
            *LOCATION.lock() = Some((Instant::now(), lat, lon, place.clone()));
            (lat, lon, place)
        }
    };

    // 2) current conditions from open-meteo (no API key)
    let wx_url = format!("https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,weather_code,is_day");
    st.egress.check(&wx_url, Purpose::Weather, true)?;
    let wx: serde_json::Value = client.get(&wx_url).timeout(std::time::Duration::from_secs(10)).send().await?.json().await?;
    st.egress.record(&wx_url, Purpose::Weather, wx.to_string().len() as u64);
    let cur = &wx["current"];
    let w = Weather {
        temp_c: cur["temperature_2m"].as_f64().ok_or_else(|| anyhow!("no temperature"))?,
        code: cur["weather_code"].as_i64().unwrap_or(0),
        is_day: cur["is_day"].as_i64().unwrap_or(1) == 1,
        place,
    };
    *CACHE.lock() = Some((Instant::now(), w.clone()));
    Ok(w)
}
