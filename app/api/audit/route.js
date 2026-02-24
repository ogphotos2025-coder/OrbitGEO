import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Helper Functions ---

async function scrapeSchema(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'OrbitGEO-Audit-Bot/1.0' } });
    if (!response.ok) {
      return { schemaFound: false, schemaTypes: [], error: `Failed to fetch URL (${response.status})` };
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const schemaScripts = $('script[type="application/ld+json"]');
    if (schemaScripts.length === 0) {
      return { schemaFound: false, schemaTypes: [], schemaMissing: ["Organization", "Product", "FAQPage", "LocalBusiness"] };
    }
    const detectedTypes = [];
    schemaScripts.each((i, el) => {
      try {
        const scriptContent = $(el).html();
        const json = JSON.parse(scriptContent);
        const type = json['@type'];
        if (type) {
          if (Array.isArray(type)) detectedTypes.push(...type);
          else detectedTypes.push(type);
        }
      } catch (e) { /* ignore parse errors */ }
    });
    const uniqueTypes = [...new Set(detectedTypes)];
    const missing = ["Organization", "Product", "FAQPage", "LocalBusiness"].filter(t => !uniqueTypes.includes(t));
    return { schemaFound: true, schemaTypes: uniqueTypes, schemaMissing: missing };
  } catch (error) {
    return { schemaFound: false, schemaTypes: [], error: 'Could not analyze the website.' };
  }
}

function getGeoPrompts(formData) {
  const { industry, brand, competitor } = formData;
  return [
    { type: "topOfFunnel", label: "Top of Funnel", prompt: `most reliable ${industry} solutions 2026` },
    { type: "competitive", label: "Competitive Combat", prompt: `${brand} vs ${competitor || 'major competitor'} pricing and features` },
    { type: "trust", label: "Trust & Verification", prompt: `is ${brand} GDPR compliant official documentation` },
    { type: "solution", label: "Solution Search", prompt: `tools for AI-driven employee retention mapping` },
    { type: "authority", label: "Authority Check", prompt: `experts and credentials behind ${brand} ${industry}` },
  ];
}

async function runFirecrawlSearch(prompts, apiKey) {
  const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/search';

  const searchPromises = prompts.map(async (p) => {
    try {
      console.log(`[Audit] Searching Firecrawl for: "${p.prompt}"`);
      const response = await fetch(FIRECRAWL_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: p.prompt
        }),
      });

      if (!response.ok) {
        console.error(`[Audit] Firecrawl error for prompt "${p.prompt}": ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      // Handle various Firecrawl result structures
      let results = [];
      if (data.success && data.data) results = data.data;
      else if (data.data) results = data.data;
      else if (data.web) results = data.web;
      else if (data.results) results = data.results;
      else if (Array.isArray(data)) results = data;

      console.log(`[Audit] Firecrawl returned ${results.length} results for: "${p.prompt}"`);
      return results;
    } catch (e) {
      console.error(`[Audit] Firecrawl fetch failed for prompt "${p.prompt}":`, e);
      return [];
    }
  });

  return await Promise.all(searchPromises);
}

export async function POST(request) {
  try {
    const body = await request.json();
    let { url, brand, industry, competitor } = body;

    console.log(`[Audit] Starting audit for Brand: ${brand}, URL: ${url}`);

    if (!url || !brand || !industry) {
      return NextResponse.json({ error: 'URL, Brand Name, and Industry are required' }, { status: 400 });
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    const schemaData = await scrapeSchema(url);
    console.log(`[Audit] Schema Analysis: Found=${schemaData.schemaFound}`);

    const geoPrompts = getGeoPrompts(body);
    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

    let searchResults;

    if (!firecrawlApiKey || firecrawlApiKey.includes("YOUR_")) {
      console.warn("[Audit] FIRECRAWL_API_KEY is missing or invalid.");
      searchResults = geoPrompts.map(() => []);
    } else {
      try {
        searchResults = await runFirecrawlSearch(geoPrompts, firecrawlApiKey);
      } catch (e) {
        console.error("[Audit] Firecrawl overall search failed:", e.message);
        searchResults = geoPrompts.map(() => []);
      }
    }

    const formattedResults = searchResults.map((results, i) => {
      const prompt = geoPrompts[i].prompt;
      if (!results || results.length === 0) {
        return `No web search results found for prompt: "${prompt}"`;
      }

      const resultText = results.map(r => `Title: ${r.title || 'N/A'}
Link: ${r.url || 'N/A'}
Snippet: ${r.description || r.snippet || 'N/A'}`).join('\n\n');

      return `Web search results for prompt "${prompt}":
${resultText}`;
    }).join('\n\n---\n\n');

    const analysisPrompt = `
      Analyze the following GEO audit data for the brand "${brand}" in the "${industry}" industry.

      Schema Data:
      - Found: ${schemaData.schemaFound}
      - Detected Types: ${(schemaData.schemaTypes || []).join(', ') || 'None'}
      - Missing Crucial Types: ${(schemaData.schemaMissing || []).join(', ') || 'None'}

      Web Search Context (Real-time Results):
      ${formattedResults}

      INSTRUCTIONS:
      Based ONLY on the context above, generate a highly detailed and critical JSON response.
      The report must be professional, data-centric, and provide specific "Executive-level" insights.
      If "${brand}" is not explicitly listed in search snippets, reflect this with low scores.
      Compare "${brand}" against "${competitor || 'Category Leaders'}".
      
      {
        "geoScore": 0-100,
        "visibilityPct": 0-100,
        "citationHealth": 0-100,
        "sentimentScore": 0-100,
        "sentimentWords": [
          {"word": "string", "type": "positive|neutral|negative"}
        ],
        "promptResults": [
          {"type": "string", "label": "string", "mentioned": true/false, "finding": "critical summary of why the brand was or wasn't found"}
        ],
        "topFix": "Primary technical recommendation (e.g., Schema, entity grounding)",
        "contentFix": "Primary content-led recommendation (e.g., semantic keyword targeting)",
        "jsonLd": "A full, valid JSON-LD Organization/Product script for the brand",
        "competitorInsight": "Deep strategic comparison. How is ${competitor || 'the competition'} outperforming ${brand}?",
        "quickWins": [
          "Specific, prioritized action item 1",
          "Specific, prioritized action item 2",
          "Specific, prioritized action item 3"
        ],
        "brandVsCompetitor": [
          {"name": "${brand}", "color": "#2563eb", "visibility": 0-100},
          {"name": "${competitor || 'Competitor A'}", "color": "#0891b2", "visibility": 0-100},
          {"name": "Industry Avg", "color": "#94a3b8", "visibility": 0-100}
        ]
      }
      Strictly return valid JSON only. No markdown formatting.
    `;

    let finalResult;
    const googleGeminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

    if (!googleGeminiApiKey || googleGeminiApiKey.includes("YOUR_")) {
      console.warn("[Audit] GOOGLE_GEMINI_API_KEY is missing or invalid.");
      finalResult = null;
    } else {
      try {
        console.log(`[Audit] Requesting Gemini analysis for ${brand} using gemini-2.5-flash...`);
        const genAI = new GoogleGenerativeAI(googleGeminiApiKey);
        // Using "gemini-2.5-flash" as confirmed by testing
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(analysisPrompt);
        const response = await result.response;
        const text = response.text();
        console.log(`[Audit] Gemini raw response length: ${text.length}`);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        finalResult = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        console.log(`[Audit] Gemini analysis parsed successfully.`);
      } catch (geminiError) {
        console.error("[Audit] Error calling/parsing Gemini API:", geminiError);
        finalResult = null;
      }
    }

    if (!finalResult) {
      console.warn(`[Audit] No result from Gemini. Using MOCK data for brand: ${brand}`);
      finalResult = {
        geoScore: 38, visibilityPct: 20, citationHealth: 10, sentimentScore: 55,
        sentimentWords: [{ word: "Innovative", type: "positive" }, { word: "Uncited", type: "negative" }],
        promptResults: geoPrompts.map((p, i) => ({ ...p, mentioned: i < 1, finding: i < 1 ? `Found but low ranking.` : `Not mentioned.` })),
        topFix: `Implement 'Organization' schema.`,
        contentFix: `Rewrite your homepage title.`,
        jsonLd: `{"@context": "https://schema.org","@type": "Organization","name": "${brand}","url": "${url}"}`,
        competitorInsight: `Competitors have better landing pages.`,
        quickWins: ["Add FAQs", "Update Schema"],
        brandVsCompetitor: [
          { name: brand, color: "#2563eb", visibility: 20 },
          { name: competitor || "Competitor", color: "#0891b2", visibility: 80 },
          { name: "Global Avg", color: "#94a3b8", visibility: 45 }
        ]
      };
    }

    const responsePayload = {
      ...finalResult,
      ...schemaData,
      promptResults: geoPrompts.map((p, i) => ({ ...p, ...finalResult.promptResults[i] })),
    };

    return NextResponse.json(responsePayload);

  } catch (error) {
    console.error('[Audit] API Crash:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}