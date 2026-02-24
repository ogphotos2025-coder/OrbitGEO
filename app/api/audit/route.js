import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Helper Functions ---

/**
 * Resilient schema scraper that uses Firecrawl specifically for technical audits
 */
async function scrapeSchemaResilient(url, apiKey) {
  try {
    console.log(`[Audit] Resilient Scrape starting for: ${url}`);

    // Use Firecrawl to handle WAF/Bot detection
    const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';
    const response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        formats: ["markdown", "json"],
        jsonOptions: {
          prompt: "Extract all schema.org data from this page"
        }
      }),
    });

    if (!response.ok) {
      console.warn(`[Audit] Firecrawl scrape failed, falling back to basic fetch: ${response.statusText}`);
      return await scrapeSchemaBasic(url);
    }

    const data = await response.json();
    console.log(`[Audit] Firecrawl scrape response success: ${data.success}`);

    const markdown = data.data?.markdown || "";
    const schemaData = data.data?.json || {};

    // Analyze markdown/text for schema types if json prompt wasn't enough
    const detectedTypes = [];
    if (markdown.includes('"@type":')) {
      const matches = markdown.match(/"@type":\s*"([^"]+)"/g);
      if (matches) {
        matches.forEach(m => {
          const type = m.split('"')[3];
          if (type && !detectedTypes.includes(type)) detectedTypes.push(type);
        });
      }
    }

    // Merge with JSON prompt results
    if (schemaData && schemaData['@type']) {
      const type = schemaData['@type'];
      if (Array.isArray(type)) detectedTypes.push(...type);
      else detectedTypes.push(type);
    }

    const uniqueTypes = [...new Set(detectedTypes)];
    const missing = ["Organization", "Product", "FAQPage", "LocalBusiness"].filter(t => !uniqueTypes.includes(t));

    return {
      schemaFound: uniqueTypes.length > 0,
      schemaTypes: uniqueTypes,
      schemaMissing: missing
    };
  } catch (error) {
    console.error("[Audit] Resilient scrape error:", error);
    return await scrapeSchemaBasic(url);
  }
}

async function scrapeSchemaBasic(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
    if (!response.ok) return { schemaFound: false, schemaTypes: [], error: 'Access Blocked' };
    const html = await response.text();
    const $ = cheerio.load(html);
    const schemaScripts = $('script[type="application/ld+json"]');
    const detectedTypes = [];
    schemaScripts.each((i, el) => {
      try {
        const json = JSON.parse($(el).html());
        const type = json['@type'];
        if (type) {
          if (Array.isArray(type)) detectedTypes.push(...type);
          else detectedTypes.push(type);
        }
      } catch (e) { }
    });
    const uniqueTypes = [...new Set(detectedTypes)];
    const missing = ["Organization", "Product", "FAQPage", "LocalBusiness"].filter(t => !uniqueTypes.includes(t));
    return { schemaFound: uniqueTypes.length > 0, schemaTypes: uniqueTypes, schemaMissing: missing };
  } catch (e) {
    return { schemaFound: false, schemaTypes: [] };
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
      const response = await fetch(FIRECRAWL_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: p.prompt }),
      });
      if (response.status === 402) throw new Error("Firecrawl API Credits Exhausted");
      if (!response.ok) return [];
      const data = await response.json();
      return data.data || data.web || data.results || [];
    } catch (e) {
      console.error(`[Audit] Firecrawl Search Error: ${e.message}`);
      if (e.message.includes("Credits Exhausted")) throw e;
      return [];
    }
  });
  return await Promise.all(searchPromises);
}

// --- Main Execution logic ---

export async function POST(request) {
  try {
    const body = await request.json();
    let { url, brand, industry, competitor, turboMode } = body;

    if (!url || !brand || !industry) {
      return NextResponse.json({ error: 'URL, Brand Name, and Industry are required' }, { status: 400 });
    }

    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
    const googleGeminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

    // 1. DATA GATHERING
    const schemaData = await scrapeSchemaResilient(url, firecrawlApiKey);
    const geoPrompts = getGeoPrompts(body);
    const searchResults = await runFirecrawlSearch(geoPrompts, firecrawlApiKey);

    // 2. DETERMINISTIC CALCULATIONS (Zero Variance)

    // Visibility: Count how many results actually mention the brand
    let totalMentions = 0;
    const mentionDetails = searchResults.map((results, i) => {
      const prompt = geoPrompts[i];
      const mentions = results.filter(r => {
        const text = `${r.title} ${r.description} ${r.snippet}`.toLowerCase();
        return text.includes(brand.toLowerCase());
      });
      const mentioned = mentions.length > 0;
      if (mentioned) totalMentions++;

      return {
        ...prompt,
        mentioned,
        finding: mentioned
          ? `Brand recognized in ${mentions.length} authority snippet(s).`
          : `Zero brand citations found for this specific query cluster.`
      };
    });

    const visibilityPct = Math.round((totalMentions / geoPrompts.length) * 100);

    // Technical: Based on Schema (Organization and Product are weighted highest)
    let techScore = 0;
    if (schemaData.schemaFound) {
      techScore += 30; // base score for having any schema
      if (schemaData.schemaTypes.includes("Organization")) techScore += 30;
      if (schemaData.schemaTypes.includes("Product")) techScore += 20;
      if (schemaData.schemaTypes.includes("LocalBusiness") || schemaData.schemaTypes.includes("FAQPage")) techScore += 20;
    }
    const technicalScore = Math.min(techScore, 100);

    // 3. AI ANALYSIS (Deterministic Context)
    const formattedResults = searchResults.map((results, i) => {
      const resultText = results.map(r => `Title: ${r.title}\nSnippet: ${r.description || r.snippet}`).join('\n\n');
      return `Prompt "${geoPrompts[i].prompt}":\n${resultText}`;
    }).join('\n\n---\n\n');

    const analysisPrompt = `
      Perform an Enterprise GEO Audit for "${brand}" (${industry}).
      
      HARD METRICS (Calculated):
      - Visibility: ${visibilityPct}% (Mentions in ${totalMentions}/5 benchmark prompts)
      - Technical Health: ${technicalScore}% (Detected: ${schemaData.schemaTypes.join(', ') || 'None'})
      - Missing Crucial Schema: ${schemaData.schemaMissing.join(', ') || 'None'}

      SEARCH SNIPPETS:
      ${formattedResults}

      INSTRUCTIONS:
      1. Use the Hard Metrics provided above for your scoring. 
      2. Analyze the sentiment of the snippets to generate a "sentimentScore" (0-100).
      3. Calculate the final "geoScore" using this weighted formula: (Visibility * 0.5) + (Technical * 0.3) + (Sentiment * 0.2).
      4. Compare "${brand}" strictly against "${competitor || 'Category Leaders'}".

      RETURN ONLY VALID JSON:
      {
        "geoScore": number,
        "visibilityPct": ${visibilityPct},
        "citationHealth": ${technicalScore},
        "sentimentScore": number,
        "sentimentWords": [{"word": "string", "type": "positive|neutral|negative"}],
        "promptResults": ${JSON.stringify(mentionDetails.map(m => ({ type: m.type, label: m.label, mentioned: m.mentioned, finding: m.finding })))},
        "topFix": "Specific technical fix",
        "contentFix": "Specific content fix",
        "jsonLd": "Full JSON-LD script string",
        "competitorInsight": "How is ${competitor} outperforming ${brand}?",
        "quickWins": ["Task 1", "Task 2", "Task 3"],
        "brandVsCompetitor": [
          {"name": "${brand}", "color": "#2563eb", "visibility": ${visibilityPct}},
          {"name": "${competitor || 'Competitor'}", "color": "#0891b2", "visibility": 85},
          {"name": "Industry Avg", "color": "#94a3b8", "visibility": 45}
        ]
      }
    `;

    let finalResult;

    try {
      // Jump to high-speed deterministic results if Turbo Mode is requested
      if (turboMode) {
        console.log(`[Audit] Turbo Mode active for ${brand} - Skipping AI Narrative.`);
        throw new Error("TURBO_MODE_ACTIVE");
      }
      console.log(`[Audit] Requesting Gemini analysis for ${brand} using gemini-1.5-flash-latest (temperature: 0)...`);
      const genAI = new GoogleGenerativeAI(googleGeminiApiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash-latest",
        generationConfig: { temperature: 0 }
      });
      const result = await model.generateContent(analysisPrompt);
      const response = await result.response;

      // Some SDK versions require await text(), and it's safer to check
      const text = typeof response.text === 'function' ? await response.text() : response.text;

      console.log(`[Audit] Gemini raw response length: ${text.length}`);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[Audit] No JSON found in prompt output:", text);
        throw new Error("Invalid Gemini response format");
      }

      finalResult = JSON.parse(jsonMatch[0]);
      console.log(`[Audit] Gemini analysis parsed successfully. geoScore: ${finalResult.geoScore}`);

      // Override final geoScore to ensure code-level consistency
      const calcGeoScore = Math.round(
        (visibilityPct * 0.5) +
        (technicalScore * 0.3) +
        ((finalResult.sentimentScore || 50) * 0.2)
      );
      finalResult.geoScore = calcGeoScore;
      finalResult.visibilityPct = visibilityPct;
      finalResult.citationHealth = technicalScore;

    } catch (e) {
      const isTurbo = e.message === "TURBO_MODE_ACTIVE";
      console.warn(`[Audit] ${isTurbo ? 'Turbo Mode' : 'AI Fallback'} active (Context: ${e.message})`);

      finalResult = {
        geoScore: Math.round((visibilityPct * 0.5) + (technicalScore * 0.3) + (10)),
        visibilityPct,
        citationHealth: technicalScore,
        sentimentScore: 50,
        sentimentWords: [{ word: isTurbo ? "Fast Audit" : "Quota Limit", type: "neutral" }],
        promptResults: mentionDetails.map(m => ({ type: m.type, label: m.label, mentioned: m.mentioned, finding: m.finding })),
        topFix: isTurbo ? "Initialize standard audit for deep AI insights." : "Gemini API Limit reached. Insights restricted.",
        contentFix: "Ensure high-quality content for citation grounding.",
        jsonLd: `{"@context": "https://schema.org","@type": "Organization","name": "${brand}","url": "${url}"}`,
        competitorInsight: isTurbo ? "Competitive intelligence requires Standard Mode." : "Competitive data partially restricted during fallback.",
        quickWins: [isTurbo ? "Try Standard Mode" : "Retry in 30s", "Optimize Schema"],
        brandVsCompetitor: [
          { name: brand, visibility: visibilityPct },
          { name: competitor || 'Industry Avg', visibility: 45 }
        ]
      };
    }

    if (!finalResult) {
      return NextResponse.json({ error: 'Failed to generate consistent audit data' }, { status: 500 });
    }

    const responsePayload = {
      ...finalResult,
      schemaFound: schemaData.schemaFound,
      schemaTypes: schemaData.schemaTypes,
      schemaMissing: schemaData.schemaMissing,
      promptResults: mentionDetails.map((m, i) => ({ ...m, ...finalResult.promptResults[i] })),
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[Audit] Fatal Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}