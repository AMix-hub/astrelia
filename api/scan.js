import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

const PROMPT = `You are a professional Pokémon card grader and expert with deep knowledge of all sets, variants, and editions.

Analyze the provided card image(s). The first image is the front of the card. If a second image is provided it is the back.

Return ONLY a valid JSON object — no markdown fences, no explanation outside the JSON.

{
  "name": "exact card name as printed",
  "setName": "full set name",
  "setNumber": "number/total e.g. 4/102, or null",
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

  // --- Step 2: pokemontcg.io lookup ---
  let tcgCard = null;
  let prices = null;
  try {
    const headers = process.env.POKEMONTCG_API_KEY
      ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
      : {};
    const q = encodeURIComponent(`name:"${card.name}"`);
    const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&orderBy=-set.releaseDate&pageSize=20`, { headers });
    const json = await r.json();

    if (json.data?.length > 0) {
      const setLower = (card.setName || '').toLowerCase();
      const match =
        json.data.find(c => c.set.name.toLowerCase().includes(setLower) || setLower.includes(c.set.name.toLowerCase())) ||
        json.data[0];

      tcgCard = {
        id: match.id,
        name: match.name,
        setName: match.set.name,
        setId: match.set.id,
        number: match.number,
        rarity: match.rarity,
        imageUrl: match.images?.large || match.images?.small || null,
      };

      if (match.tcgplayer?.prices) prices = match.tcgplayer.prices;
    }
  } catch (_) { /* continue without */ }

  // --- Step 3: Cardmarket search URL ---
  const cardmarketUrl = `https://www.cardmarket.com/en/Pokemon/Products/Singles?searchString=${encodeURIComponent(card.name || '')}`;

  return res.status(200).json({ card, tcgCard, prices, cardmarketUrl });
}
