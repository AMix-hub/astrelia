function toSlug(str) {
  return (str || '')
    .split(/[—–]/).pop()
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function buildCardmarketUrl(found, fallbackName) {
  const base = 'https://www.cardmarket.com/en/Pokemon/Products/Singles';
  if (found?.set?.name && found?.name) {
    const expansionSlug = toSlug(found.set.name);
    const nameSlug      = toSlug(found.name);
    const abbr          = found.set.ptcgoCode || found.set.id?.toUpperCase() || '';
    const num           = (found.number || '').replace(/\/.+$/, '').padStart(3, '0');
    const productSlug   = abbr && num ? `${nameSlug}-${abbr}-${num}` : nameSlug;
    return `${base}/${expansionSlug}/${productSlug}`;
  }
  return `${base}?searchString=${encodeURIComponent(fallbackName || '')}`;
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, setName, setNumber } = req.body;
  if (!name) return res.status(400).json({ error: 'Card name required' });

  const headers = process.env.POKEMONTCG_API_KEY
    ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
    : {};

  const cardNum = (setNumber || '').replace(/\/.*$/, '').replace(/^0+/, '').trim();
  let found = null;

  try {
    // Precise: name + number
    if (cardNum) {
      const q = encodeURIComponent(`name:"${name}" number:${cardNum}`);
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=20`, { headers });
      const json = await r.json();
      if (json.data?.length > 0) {
        const setLower = (setName || '').toLowerCase();
        found = json.data.find(c => c.set.name.toLowerCase().includes(setLower)) || json.data[0];
      }
    }

    // Fallback: name only, prefer matching set
    if (!found) {
      const q = encodeURIComponent(`name:"${name}"`);
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&orderBy=-set.releaseDate&pageSize=20`, { headers });
      const json = await r.json();
      if (json.data?.length > 0) {
        const setLower = (setName || '').toLowerCase();
        found = setLower
          ? json.data.find(c => c.set.name.toLowerCase().includes(setLower)) || json.data[0]
          : json.data[0];
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'Lookup failed', details: e.message });
  }

  if (!found) return res.status(404).json({ error: 'Card not found on pokemontcg.io' });

  const prices = found.tcgplayer?.prices || null;
  const variantKeys = ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil'];
  let marketPrice = null;
  for (const k of variantKeys) {
    if (prices?.[k]?.market) { marketPrice = prices[k].market; break; }
  }

  return res.status(200).json({
    name:          found.name,
    setName:       found.set.name,
    number:        `${found.number}/${found.set.total}`,
    imageUrl:      found.images?.large || found.images?.small || null,
    prices,
    marketPrice,
    cardmarketUrl: buildCardmarketUrl(found, name),
  });
}
