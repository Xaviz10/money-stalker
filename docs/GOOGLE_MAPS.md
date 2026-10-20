# Google Maps setup

The main captured-location map uses MapLibre GL JS (see `LOCATION_CAPTURE.md`). Money Stalker loads Google Maps only when the owner expands the optional business-confirmation section of a movement editor. The transaction API stores the selected place ID, display name, address and coordinates; it never stores the Google API key.

1. In Google Cloud, use a billing-enabled project and enable **Maps JavaScript API** and **Places API (New)**.
2. Create a browser API key. Under **Application restrictions**, choose **Websites** and allow `https://money-stalker.vercel.app/*`. Add the exact Vercel preview domains only if maps are needed in previews.
3. Under **API restrictions**, allow only **Maps JavaScript API** and **Places API (New)**.
4. In Vercel, add `VITE_GOOGLE_MAPS_API_KEY` as a Production environment variable and redeploy. This is a public browser configuration value by design; domain and API restrictions protect it. Never use an unrestricted key.

When the key is absent or Google Maps cannot load, the main MapLibre map, saved evidence and coordinate links remain available. Financial capture continues normally.
