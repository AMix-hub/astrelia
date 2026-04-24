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

Return ONLY a valid JSON object — no markdown fences, no explanation outside the JSON.

{
  "name": "card name exactly as printed on the card",
  "englishName": "English name of the Pokémon/card — always provide this even for non-English cards, e.g. Magcargo",
  "setName": "full set name in its original language",
  "setNumber": "number/total e.g. 4/102, or null",
  "japaneseSetCode": "for Japanese cards: the set code used on Cardmarket e.g. s6a, s12a, sv3pt5, sv2D — null for non-Japanese cards",
  "year": "year on card or estimated year, or null",
  "variant": "normal|reverseHolo|holo|fullArt|secretRare|altArt|rainbowRare|goldRare|promo|ultraRare|vMax|vStar|other",
  "variantLabel": "human readable e.g. Reverse Holo, Full Art, Secret Rare",
  "stage": "Basic|Stage1|Stage2|EX|GX|V|VMAX|VSTAR|Trainer|Energy|other",
  "hp": "HP value as string or null",
  "isFirstEdition": true or false,
  "isShadowless": true or false,
  "language": "English|Japanese|German|French|other",
  "condition": "Mint|NearMint|Excellent|LightPlayed|Played|Damaged",
  "conditionScore": <integer 1-10, 10=Mint>,
  "centering": "Centered|SlightlyOff|Off",
  "surfaceIssues": ["list scratch lines, scuffs, print defects on front face"],
  "edgeIssues": ["list whitening, chipping on edges"],
  "cornerIssues": ["list corner wear, bends, dents"],
  "backIssues": ["list issues found on back, or empty array if no back image"],
  "confidence": <0.0-1.0, how confident you are in the identification>,
  "notes": "any extra observations worth knowing"
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

  // --- Step 2: pokemontcg.io lookup (English name for better match) ---
  let tcgCard = null;
  let prices  = null;
  try {
    const headers  = process.env.POKEMONTCG_API_KEY
      ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
      : {};
    const lookupName = card.englishName || card.name;
    const q = encodeURIComponent(`name:"${lookupName}"`);
    const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&orderBy=-set.releaseDate&pageSize=20`, { headers });
    const json = await r.json();

    if (json.data?.length > 0) {
      const setLower = (card.setName || '').toLowerCase();
      const match =
        json.data.find(c =>
          c.set.name.toLowerCase().includes(setLower) ||
          setLower.includes(c.set.name.toLowerCase())
        ) || json.data[0];

      tcgCard = {
        id:           match.id,
        name:         match.name,
        setName:      match.set.name,
        setId:        match.set.id,
        setPtcgoCode: match.set.ptcgoCode || match.set.id?.toUpperCase(),
        number:       match.number,
        rarity:       match.rarity,
        imageUrl:     match.images?.large || match.images?.small || null,
      };

      if (match.tcgplayer?.prices) prices = match.tcgplayer.prices;
    }
  } catch (_) { /* continue without */ }

  // --- Step 3: Cardmarket URL ---
  const cardmarketUrl = buildCardmarketUrl(card, tcgCard);

  return res.status(200).json({ card, tcgCard, prices, cardmarketUrl });
}
