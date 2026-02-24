I have resolved the build error and the port issue.

**Build Error Fix:**
The "Hydration failed" and "import/export cannot be used outside module code" errors in `app/page.js` were due to a conflict between server-side rendering and client-side styling, and potentially some syntax issues after previous modifications. I have completely overwritten `app/page.js` with a corrected and cleaned-up version. This new version:
*   Removes the old `FONTS` and `CSS` constants and `<style>` tags, as global styles are now handled in `app/globals.css` and fonts via `next/font` in `app/layout.js`.
*   Ensures the component structure is syntactically correct.

**Port 3000 Fix:**
I have terminated the previous `npm run dev` process that was occupying port `3001` (and indirectly, `3000` if it was preventing it). The server is now successfully running on `http://localhost:3000`.

**You can now preview the web app at: http://localhost:3000**

Please test the application by entering a URL, Brand Name, and Industry.
*   The schema detection will run directly.
*   The GEO prompts will be processed by your **Browse AI robot** (using the ID you provided), scraping search results.
*   The analysis will be performed by **Google Gemini** (using your API key).

Let me know if you encounter any further issues or have questions!