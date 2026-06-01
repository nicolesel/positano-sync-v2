const axios = require('axios');
const fs = require('fs');

const STORE_ID = process.env.STORE_ID || '4784990';
const TN_TOKEN = process.env.TN_TOKEN || '2ac2da90bccc350d041d1fbaddd5f3e664f2e22f';
let mlToken = process.env.ML_TOKEN || '';

const MAPEO_FILE = 'mapeo.json';
let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};

async function renovarTokenML() {
  try {
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'client_credentials',
      client_id: '7264088506318196',
      client_secret: 'sXlSgTEWWRGrOMHGDPg3JiMPSFSQUBAV',
    });
    mlToken = data.access_token;
    console.log('Token renovado');
  } catch(e) { console.error('Error token:', e.message); }
}

async function fetchAllProducts() {
  let all = [], page = 1;
  while(true) {
    const { data } = await axios.get('https://api.tiendanube.com/v1/' + STORE_ID + '/products?per_page=50&page=' + page,
      { headers: { 'Authentication': 'bearer ' + TN_TOKEN, 'User-Agent': 'PositanoSync/1.0' }});
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < 50) break;
    page++;
  }
  return all;
}

async function main() {
  await renovarTokenML();
  const products = await fetchAllProducts();
  console.log('Productos:', products.length);

  // Verificar items eliminados de ML
  const mlIds = [...new Set(Object.values(mapeo))];
  for (const mlId of mlIds) {
    try {
      const { data } = await axios.get('https://api.mercadolibre.com/items/' + mlId,
        { headers: { 'Authorization': 'Bearer ' + mlToken }});
      if (data.status === 'closed' || data.status === 'deleted') {
        const keys = Object.keys(mapeo).filter(k => mapeo[k] === mlId);
        for (const k of keys) delete mapeo[k];
        console.log('Eliminado de mapeo:', mlId);
      }
    } catch(e) {
      if (e.response && e.response.status === 404) {
        const keys = Object.keys(mapeo).filter(k => mapeo[k] === mlId);
        for (const k of keys) delete mapeo[k];
        console.log('No encontrado, eliminado:', mlId);
      }
    }
  }

  // Sincronizar stock TN -> ML
  for (const p of products) {
    for (const v of (p.variants || [])) {
      const color = ((v.values && v.values[0] && v.values[0].es) || 'Unico').trim();
      const mlId = v.sku && mapeo[v.sku + '_' + color];
      if (mlId) {
        const stock = parseInt(v.stock) || 0;
        try {
          await axios.put('https://api.mercadolibre.com/items/' + mlId,
            { available_quantity: stock },
            { headers: { 'Authorization': 'Bearer ' + mlToken, 'Content-Type': 'application/json' }});
          console.log('Stock actualizado:', v.sku, color, '->', stock);
        } catch(e) { console.log('Error actualizando:', v.sku, e.message); }
      }
    }
  }

  fs.writeFileSync(MAPEO_FILE, JSON.stringify(mapeo, null, 2), 'utf8');
  console.log('Sync completado');
}

main().catch(console.error);