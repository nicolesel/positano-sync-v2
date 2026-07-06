const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

const STORE_ID = process.env.STORE_ID || '4784990';
const TN_TOKEN = process.env.TN_TOKEN || '';
const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
const MAPEO_FILE = 'mapeo.json';
const CACHE_FILE = 'stock_cache.json';

let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};
let mlToken = '';

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

  // Leer cache
  let stockCache = null;
  let runCount = 0;
  try {
    if(fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if(raw && raw.v === 2) {
        stockCache = raw.data;
        runCount = raw.runCount || 0;
      }
    }
  } catch(e) {}

  const newCache = {};

  // TN -> ML
  for(const p of products) {
    for(const v of (p.variants||[])) {
      const key = p.id+'_'+v.id;
      const stockActual = parseInt(v.stock)||0;
      newCache[key] = stockActual;

      if(stockCache !== null && stockCache[key] !== undefined && stockCache[key] !== stockActual) {
        console.log('CAMBIO:', v.sku, stockCache[key], '->', stockActual);
        console.log('CAMBIO DETECTADO:', v.sku, stockCache[key], '->', stockActual);
        const color = ((v.values&&v.values[0]&&v.values[0].es)||'Unico');
        const mlId = v.sku && mapeo[v.sku+'_'+color];
        if(mlId) {
          try {
            await axios.put('https://api.mercadolibre.com/items/'+mlId,
              { available_quantity: stockActual },
              { headers: { 'Authorization': 'Bearer '+mlToken, 'Content-Type': 'application/json' }}
            );
            console.log('TN->ML:', v.sku, color, stockCache[key], '->', stockActual);
          } catch(e) { console.log('Error TN->ML:', v.sku, e.message); }
        }
      }
    }
  }

  runCount++;
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ v: 2, runCount, data: newCache }, null, 2), 'utf8');

  // Ventas ML -> TN
  const PROCESSED_FILE = 'processed_orders.json';
  let processedOrders = fs.existsSync(PROCESSED_FILE) ? JSON.parse(fs.readFileSync(PROCESSED_FILE,'utf8')) : [];
  const ultimaRevision = new Date(Date.now() - 10*60*1000).toISOString();
  const { data: ordersML } = await axios.get(
    'https://api.mercadolibre.com/orders/search?seller=303503376&order.status=paid&order.date_created.from='+ultimaRevision,
    { headers: { 'Authorization': 'Bearer '+mlToken }}
  );
  let newProcessed = false;
  for(const order of (ordersML.results||[])) {
    if(processedOrders.includes(String(order.id))) continue;
    for(const item of order.order_items) {
      const mlId = item.item.id;
      const qty = item.quantity;
      const skuEntry = Object.entries(mapeo).find(([k,v]) => v===mlId);
      if(skuEntry) {
        const skuColor = skuEntry[0];
        const sku = skuColor.split('_')[0];
        const color = skuColor.split('_').slice(1).join('_').toLowerCase();
        const p = products.find(x => x.variants&&x.variants.some(v=>v.sku===sku));
        if(p) {
          const variant = p.variants.find(v=>v.sku===sku && ((v.values&&v.values[0]&&v.values[0].es)||'Unico').toLowerCase()===color)
            || p.variants.find(v=>v.sku===sku);
          if(variant) {
            const nuevoStock = Math.max(0,(parseInt(variant.stock)||0)-qty);
            await axios.put('https://api.tiendanube.com/v1/'+STORE_ID+'/products/'+p.id+'/variants/'+variant.id,
              { stock: nuevoStock },
              { headers: { 'Authentication': 'bearer '+TN_TOKEN, 'User-Agent': 'PositanoSync/1.0' }}
            );
            console.log('Venta ML:', sku, '->', nuevoStock);
            processedOrders.push(String(order.id));
            newProcessed = true;
          }
        }
      }
    }
  }

  // Verificar productos eliminados de TN
  const skusEnTN = new Set();
  for(const p of products) {
    for(const v of (p.variants||[])) {
      if(v.sku) skusEnTN.add(v.sku);
    }
  }
  for(const [skuColor, mlId] of Object.entries(mapeo)) {
    const sku = skuColor.split('_')[0];
    if(!skusEnTN.has(sku)) {
      try {
        await axios.put('https://api.mercadolibre.com/items/'+mlId,
          { status: 'closed' },
          { headers: { 'Authorization': 'Bearer '+mlToken, 'Content-Type': 'application/json' }}
        );
        delete mapeo[skuColor];
        console.log('Cerrado en ML por eliminacion en TN:', skuColor, mlId);
      } catch(e) { console.log('Error cerrando:', mlId, e.message); }
    }
  }

  // Guardar ordenes procesadas
  if(newProcessed) {
    if(processedOrders.length > 500) processedOrders = processedOrders.slice(-500);
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(processedOrders), 'utf8');
    try { execSync('git add processed_orders.json', {stdio:'ignore'}); } catch(e) {}
  }

  // Verificar eliminados cada 10 runs
  if(runCount % 10 === 0) {
    console.log('Verificando eliminados...');
    const mlIds = [...new Set(Object.values(mapeo))];
    for(const mlId of mlIds) {
      try {
        const { data: item } = await axios.get('https://api.mercadolibre.com/items/'+mlId,
          { headers: { 'Authorization': 'Bearer '+mlToken }});
        if(item.status==='closed'||item.status==='deleted') {
          const keys = Object.keys(mapeo).filter(k=>mapeo[k]===mlId);
          for(const k of keys) delete mapeo[k];
          console.log('Eliminado de ML:', mlId);
        }
      } catch(e) {
        if(e.response&&e.response.status===404) {
          const keys = Object.keys(mapeo).filter(k=>mapeo[k]===mlId);
          for(const k of keys) delete mapeo[k];
          console.log('No encontrado:', mlId);
        }
      }
      await new Promise(r=>setTimeout(r,300));
    }
    fs.writeFileSync(MAPEO_FILE, JSON.stringify(mapeo, null, 2), 'utf8');
  }

  // Subir cambios a GitHub
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

  console.log('Sync completado. Run:', runCount);
}

main().catch(console.error);