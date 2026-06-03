const axios = require('axios');
const fs = require('fs');

const STORE_ID = '4784990';
const TN_TOKEN = '2ac2da90bccc350d041d1fbaddd5f3e664f2e22f';
const ML_CLIENT_ID = '7264088506318196';
const ML_CLIENT_SECRET = 'sXlSgTEWWRGrOMHGDPg3JiMPSFSQUBAV';
const MAPEO_FILE = 'mapeo.json';

let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};
let mlToken = '';

async function renovarTokenML() {
  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'client_credentials', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET,
  });
  mlToken = data.access_token;
  console.log('Token renovado');
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

  // Solo ventas ML -> TN
  const ultimaRevision = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: ordersML } = await axios.get(
    'https://api.mercadolibre.com/orders/search?seller=303503376&order.status=paid&order.date_created.from=' + ultimaRevision,
    { headers: { 'Authorization': 'Bearer ' + mlToken }}
  );
  for (const order of (ordersML.results || [])) {
    for (const item of order.order_items) {
      const mlId = item.item.id;
      const qty = item.quantity;
      const skuEntry = Object.entries(mapeo).find(([k, v]) => v === mlId);
      if (skuEntry) {
        const sku = skuEntry[0].split('_')[0];
        const p = products.find(x => x.variants && x.variants.some(v => v.sku === sku));
        if (p) {
          const variant = p.variants.find(v => v.sku === sku);
          if (variant) {
            const nuevoStock = Math.max(0, (parseInt(variant.stock) || 0) - qty);
            await axios.put('https://api.tiendanube.com/v1/' + STORE_ID + '/products/' + p.id + '/variants/' + variant.id,
              { stock: nuevoStock },
              { headers: { 'Authentication': 'bearer ' + TN_TOKEN, 'User-Agent': 'PositanoSync/1.0' }}
            );
            console.log('Venta ML:', sku, '->', nuevoStock);
          }
        }
      }
    }
  }

  console.log('Sync completado');
}

main().catch(console.error);