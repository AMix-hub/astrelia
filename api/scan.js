import Anthropic from '@anthropic-ai/sdk';

// Converts "Scarlet & Violet—Twilight Masquerade" → "Twilight-Masquerade"
function toSlug(str) {
  return (str || '')
    .split(/[—–]/).pop()
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function buildCardmarketUrl(card, tcgCard) {
  const base = 'https://www.cardmarket.com/en/Pokemon/Products/Singles';
  const isJapanese = card.language === 'Japanese';

  // Japanese cards: search with English name + Japanese set code (e.g. "Magcargo s6a")
  if (isJapanese) {
    const englishName = card.englishName || card.name;
    const setCode     = card.japaneseSetCode || '';
    const searchTerm  = setCode ? `${englishName} ${setCode}` : englishName;
    return `${base}?searchString=${encodeURIComponent(searchTerm)}`;
  }

  // English/other: try direct product page URL
  if (tcgCard?.setName && tcgCard?.name) {
    const expansionSlug = toSlug(tcgCard.setName);
    const nameSlug      = toSlug(tcgCard.name);
    const abbr          = tcgCard.setPtcgoCode || '';
    const num           = (tcgCard.number || '').replace(/\/.+$/, '').padStart(3, '0');
    const productSlug   = abbr && num ? `${nameSlug}-${abbr}-${num}` : nameSlug;
    return `${base}/${expansionSlug}/${productSlug}`;
  }

  // Fallback: plain name search
  return `${base}?searchString=${encodeURIComponent(card.englishName || card.name || '')}`;
}

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

const PROMPT = `You are a professional Pokémon card grader and expert with deep knowledge of all sets, variants, and editions, including all Japanese sets.

Analyze the provided card image(s). The first image is the front of the card. If a second image is provided it is the back.

IDENTIFICATION STEPS — follow these carefully before filling in the JSON:
1. Read the card number printed at the bottom of the card (e.g. "099/098", "024/100"). This is the single most reliable identifier — read it exactly.
2. Read the set symbol in the bottom right corner — use this to identify the exact set.
3. For Japanese cards: identify the Japanese set code (s6a, s12a, sv3pt5, sv2D, sv4K, etc.) from the set symbol and card layout. Japanese sets from the Sword & Shield era start with "s", Scarlet & Violet era with "sv".
4. Read the Pokémon name as printed, then determine the English name.
5. Identify the card variant by examining the card surface: reverse holo has a sparkle pattern on the border/background but not the artwork; holo rare has a sparkle/foil pattern in the artwork; full art covers the entire card; normal has no foil.

Return ONLY a valid JSON object — no markdown fences, no explanation outside the JSON.

{
  "name": "card name exactly as printed on the card",
  "englishName": "English name — always provide this even for non-English cards e.g. Magcargo not マグカルゴ",
  "setName": "full set name",
  "setNumber": "collector number only e.g. 099 — NOT the total, just the card's own number",
  "setTotal": "total cards in set e.g. 098, or null",
  "japaneseSetCode": "for Japanese cards ONLY: set code e.g. s6a, s12a, sv3pt5 — null for non-Japanese",
  "year": "year printed on card or null",
  "variant": "common|uncommon|rare|reverseHolo|holoRare|doubleRare|ultraRare|illustrationRare|specialIllustrationRare|hyperRare|aceSpec|shinyRare|shinyUltraRare|amazingRare|radiantRare|fullArt|rainbowRare|goldRare|secretRare|vmax|vstar|gx|exOld|firstEditionHolo|shadowlessHolo|promo|trainerGallery|other",
  "variantLabel": "human readable label matching the select options: Common, Uncommon, Rare, Reverse Holo, Holo Rare, Double Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, Hyper Rare, ACE SPEC Rare, Shiny Rare, Shiny Ultra Rare, Amazing Rare, Radiant Rare, Full Art, Rainbow Rare, Gold Rare, Secret Rare, VMAX, VSTAR, GX, EX (old), 1st Edition Holo, Shadowless Holo, Promo, Trainer Gallery, Other",
  "stage": "Basic|Stage1|Stage2|EX|GX|V|VMAX|VSTAR|Trainer|Energy|other",
  "hp": "HP value as string or null",
  "isFirstEdition": true or false,
  "isShadowless": true or false,
  "language": "English|Japanese|German|French|other",
  "condition": "Mint|NearMint|Excellent|LightPlayed|Played|Damaged",
  "conditionScore": <integer 1-10, 10=Mint>,
  "centering": "Centered|SlightlyOff|Off",
  "surfaceIssues": ["scratch lines, scuffs, print defects on front face"],
  "edgeIssues": ["whitening, chipping on edges"],
  "cornerIssues": ["corner wear, bends, dents"],
  "backIssues": ["issues on back, or empty array if no back image"],
  "confidence": <0.0-1.0>,
  "notes": "any extra observations"
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { frontImage, backImage } = req.body;
  if (!frontImage?.data) return res.status(400).json({ error: 'Front image is required' });

  // --- Step 1: Claude vision ---
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: frontImage.mimeType || 'image/jpeg', data: frontImage.data },
    },
  ];
  if (backImage?.data) {
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: backImage.mimeType || 'image/jpeg', data: backImage.data },
    });
  }
  imageContent.push({ type: 'text', text: PROMPT });

  let card;
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: imageContent }],
    });
    const text = msg.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    card = JSON.parse(match[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Card analysis failed', details: e.message });
  }

  // --- Step 2: pokemontcg.io lookup ---
  let tcgCard = null;
  let prices  = null;
  try {
    const headers    = process.env.POKEMONTCG_API_KEY
      ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
      : {};
    const lookupName = card.englishName || card.name;
    const cardNum    = (card.setNumber || '').replace(/^0+/, ''); // strip leading zeros for query

    // Try precise lookup: name + number first
    let found = null;
    if (cardNum) {
      const q = encodeURIComponent(`name:"${lookupName}" number:${cardNum}`);
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=20`, { headers });
      const json = await r.json();
      if (json.data?.length > 0) {
        // Among matches, prefer the one whose set matches the identified set/code
        const setLower  = (card.setName || '').toLowerCase();
        const setCode   = (card.japaneseSetCode || '').toLowerCase();
        found =
          json.data.find(c => c.set.id.toLowerCase() === setCode) ||
          json.data.find(c => c.set.name.toLowerCase().includes(setLower) || setLower.includes(c.set.name.toLowerCase())) ||
          json.data[0];
      }
    }

    // Fallback: name-only search
    if (!found) {
      const q = encodeURIComponent(`name:"${lookupName}"`);
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&orderBy=-set.releaseDate&pageSize=20`, { headers });
      const json = await r.json();
      if (json.data?.length > 0) {
        const setLower = (card.setName || '').toLowerCase();
        found =
          json.data.find(c => c.set.name.toLowerCase().includes(setLower) || setLower.includes(c.set.name.toLowerCase())) ||
          json.data[0];
      }
    }

    if (found) {
      tcgCard = {
        id:           found.id,
        name:         found.name,
        setName:      found.set.name,
        setId:        found.set.id,
        setPtcgoCode: found.set.ptcgoCode || found.set.id?.toUpperCase(),
        number:       found.number,
        rarity:       found.rarity,
        imageUrl:     found.images?.large || found.images?.small || null,
      };
      if (found.tcgplayer?.prices) prices = found.tcgplayer.prices;
    }
  } catch (_) { /* continue without */ }

  // --- Step 3: Cardmarket URL ---
  const cardmarketUrl = buildCardmarketUrl(card, tcgCard);

  return res.status(200).json({ card, tcgCard, prices, cardmarketUrl });
}
