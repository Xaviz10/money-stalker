# Google Maps setup

Money Stalker loads Google Maps only in the browser when a movement editor is opened. The transaction API stores the selected place ID, display name, address and coordinates; it never stores the Google API key.

1. In Google Cloud, use a billing-enabled project and enable **Maps JavaScript API** and **Places API (New)**.
2. Create a browser API key. Under **Application restrictions**, choose **Websites** and allow `https://money-stalker.vercel.app/*`. Add the exact Vercel preview domains only if maps are needed in previews.
3. Under **API restrictions**, allow only **Maps JavaScript API** and **Places API (New)**.
4. In Vercel, add `VITE_GOOGLE_MAPS_API_KEY` as a Production environment variable and redeploy. This is a public browser configuration value by design; domain and API restrictions protect it. Never use an unrestricted key.

When the key is absent or Maps cannot load, saved coordinates remain available through a Google Maps link and financial capture continues normally.
