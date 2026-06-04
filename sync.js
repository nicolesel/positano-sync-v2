const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE_ID = '4784990';
const TN_TOKEN = '2ac2da90bccc350d041d1fbaddd5f3e664f2e22f';
const ML_CLIENT_ID = '7264088506318196';
const ML_CLIENT_SECRET = 'sXlSgTEWWRGrOMHGDPg3JiMPSFSQUBAV';
const MAPEO_FILE = 'mapeo.json';
const CACHE_FILE = 'stock_cache.json';

let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};
let stockCache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let mlToken = '';
let runCount = stockCache._runCount || 0;

async function renovarTokenML() {
  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'client_credentials', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET,
  });
  mlToken = data.access_token;
}

async function fetchAllProducts() {
  let all = [], page = 1;
  while(true) {
    const { data } = await axios.get('https://api.tiendanube.com/v1/'+STORE_ID+'/products?per_page=50&page='+page,
      { headers: { 'Authentication': 'bearer '+TN_TOKEN, 'User-Agent': 'PositanoSync/1.0' }});
    if(!data.length) break;
    all = all.concat(data);
    if(data.length < 50) break;
    page++;
  }
  return all;
}

async function main() {
  await renovarTokenML();
  const products = await fetchAllProducts();
  console.log('Productos:', products.length);

  const newCache = { _runCount: runCount + 1 };

  // TN -> ML
  for(const p of products) {
    for(const v of (p.variants||[])) {
      const key = p.id+'_'+v.id;
      const stockActual = parseInt(v.stock)||0;
      newCache[key] = stockActual;

      if(runCount > 0) {
        const stockAnterior = (stockCache && typeof stockCache === 'object') ? stockCache[key] : undefined;
        if(stockAnterior !== undefined && stockAnterior !== null && stockAnterior !== stockActual) {
          const color = ((v.values&&v.values[0]&&v.values[0].es)||'Unico');
          const mlId = v.sku && mapeo[v.sku+'_'+color];
          if(mlId) {
            try {
              await axios.put('https://api.mercadolibre.com/items/'+mlId,
                { available_quantity: stockActual },
                { headers: { 'Authorization': 'Bearer '+mlToken, 'Content-Type': 'application/json' }}
              );
              console.log('TN->ML:', v.sku, color, stockAnterior, '->', stockActual);
            } catch(e) { console.log('Error TN->ML:', v.sku, e.message); }
          }
        }
      }
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(newCache, null, 2), 'utf8');

  // Ventas ML -> TN
  const ultimaRevision = new Date(Date.now() - 3*60*1000).toISOString();
  const { data: ordersML } = await axios.get(
    'https://api.mercadolibre.com/orders/search?seller=303503376&order.status=paid&order.date_created.from='+ultimaRevision,
    { headers: { 'Authorization': 'Bearer '+mlToken }}
  );
  for(const order of (ordersML.results||[])) {
    for(const item of order.order_items) {
      const mlId = item.item.id;
      const qty = item.quantity;
      const skuEntry = Object.entries(mapeo).find(([k,v]) => v===mlId);
      if(skuEntry) {
        const sku = skuEntry[0].split('_')[0];
        const p = products.find(x => x.variants&&x.variants.some(v=>v.sku===sku));
        if(p) {
          const variant = p.variants.find(v=>v.sku===sku);
          if(variant) {
            const nuevoStock = Math.max(0,(parseInt(variant.stock)||0)-qty);
            await axios.put('https://api.tiendanube.com/v1/'+STORE_ID+'/products/'+p.id+'/variants/'+variant.id,
              { stock: nuevoStock },
              { headers: { 'Authentication': 'bearer '+TN_TOKEN, 'User-Agent': 'PositanoSync/1.0' }}
            );
            console.log('Venta ML:', sku, '->', nuevoStock);
          }
        }
      }
    }
  }

  // Verificar eliminados cada 10 runs
  if((runCount + 1) % 10 === 0) {
    const mlIds = [...new Set(Object.values(mapeo))];
    for(const mlId of mlIds) {
      try {
        const { data: item } = await axios.get('https://api.mercadolibre.com/items/'+mlId, { headers: { 'Authorization': 'Bearer '+mlToken }});
        if(item.status==='closed'||item.status==='deleted') {
          const keys = Object.keys(mapeo).filter(k=>mapeo[k]===mlId);
          for(const k of keys) delete mapeo[k];
          console.log('Eliminado:', mlId);
        }
      } catch(e) {
        if(e.response&&e.response.status===404) {
          const keys = Object.keys(mapeo).filter(k=>mapeo[k]===mlId);
          for(const k of keys) delete mapeo[k];
        }
      }
      await new Promise(r=>setTimeout(r,300));
    }
    fs.writeFileSync(MAPEO_FILE, JSON.stringify(mapeo, null, 2), 'utf8');
  }

  // Subir cache y mapeo a GitHub
  try {
    execSync('git config user.email "sync@positano.app"', { stdio: 'ignore' });
    execSync('git config user.name "Positano Sync"', { stdio: 'ignore' });
    execSync('git add stock_cache.json mapeo.json', { stdio: 'ignore' });
    const status = execSync('git status --porcelain').toString();
    if(status.trim()) {
      execSync('git commit -m "sync update"', { stdio: 'ignore' });
      execSync('git push', { stdio: 'ignore' });
    }
  } catch(e) { console.log('Error git:', e.message); }

  console.log('Sync completado. Run:', runCount + 1);
}

main().catch(console.error);